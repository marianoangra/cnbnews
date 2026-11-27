// "Redação de uma pessoa só": quem trabalha na CNB News (os robôs), em que estado estão e
// quanto produziram. Tudo lido da própria rig: arquivos do site, logs, systemd e Ollama.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dataBrt } from '../publicador.ts';
import { listarFila, type Raizes } from './fila.ts';

const run = promisify(execFile);

export type Estado = 'trabalhando' | 'de_plantao' | 'reserva' | 'parado' | 'em_teste';

export interface Funcionario {
  nome: string;
  faz: string;
  motor: string; // modelo/GPU ou "regra fixa"
  estado: Estado;
  detalhe?: string;
}

export interface Setor {
  nome: string;
  funcionarios: Funcionario[];
}

interface Saude {
  servicos: Record<string, string>;
  pesada: { online: boolean; modelos: string[] };
  rapida: { online: boolean; modelos: string[]; url: string };
  gpu?: { usadaMiB: number; totalMiB: number; temp: number; uso: number };
  ultimoCicloNacional?: string;
  ultimoCicloCidades?: string;
  proximaColuna?: string;
}

async function servico(nome: string): Promise<string> {
  try {
    return (await run('systemctl', ['is-active', nome], { timeout: 5000 })).stdout.trim();
  } catch (e) {
    return ((e as { stdout?: string }).stdout ?? 'desconhecido').trim() || 'desconhecido';
  }
}

async function ollamaPs(url: string): Promise<{ online: boolean; modelos: string[] }> {
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/ps`, { signal: AbortSignal.timeout(2500) });
    const j = (await r.json()) as { models?: { name: string }[] };
    return { online: r.ok, modelos: (j.models ?? []).map((m) => m.name) };
  } catch {
    return { online: false, modelos: [] };
  }
}

async function gpu() {
  try {
    const out = (
      await run('nvidia-smi', ['--query-gpu=memory.used,memory.total,temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits'], {
        timeout: 5000,
      })
    ).stdout.trim();
    const [usadaMiB, totalMiB, temp, uso] = out.split('\n')[0].split(',').map((s) => Number(s.trim()));
    return { usadaMiB, totalMiB, temp, uso };
  } catch {
    return undefined;
  }
}

const mtime = (f: string) => (existsSync(f) ? statSync(f).mtime.toISOString() : undefined);

async function proximaColuna(): Promise<string | undefined> {
  try {
    const v = (await run('systemctl', ['show', 'cnbnews-colunista.timer', '-p', 'NextElapseUSecRealtime', '--value'], { timeout: 5000 })).stdout.trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}

export async function saude(r: Raizes, env: NodeJS.ProcessEnv): Promise<Saude> {
  const urlRapida = env.OLLAMA_FAST_URL || 'http://127.0.0.1:11435';
  const [ollama, cidades, nacional, colunista, pesada, rapida, g, prox] = await Promise.all([
    servico('ollama'),
    servico('cnbnews'),
    servico('cnbnews-agents'),
    servico('cnbnews-colunista.timer'),
    ollamaPs(env.OLLAMA_HEAVY_URL || env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434'),
    ollamaPs(urlRapida),
    gpu(),
    proximaColuna(),
  ]);
  return {
    servicos: { ollama, cidades, nacional, colunista },
    pesada,
    rapida: { ...rapida, url: urlRapida },
    gpu: g,
    ultimoCicloNacional: mtime(join(r.repo, 'agents.log')),
    ultimoCicloCidades: mtime(join(r.repo, 'robo.log')),
    proximaColuna: prox,
  };
}

// Publicadas por dia (fuso de Brasília), pelo prefixo AAAA-MM-DD do nome do arquivo.
export function producao(r: Raizes, agoraIso: string, dias = 7) {
  const lista: string[] = [];
  for (let i = dias - 1; i >= 0; i--) lista.push(dataBrt(new Date(Date.parse(agoraIso) - i * 86_400_000).toISOString()).dia);
  const conta = (arquivos: string[]) => lista.map((d) => arquivos.filter((f) => f.startsWith(d)).length);
  const ls = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md') && f !== '_index.md') : []);
  const cid = join(r.repo, 'content', 'cidades');
  const slugs = existsSync(cid) ? readdirSync(cid).filter((s) => statSync(join(cid, s)).isDirectory()) : [];
  const deCidades = slugs.flatMap((s) => ls(join(cid, s)));
  return {
    dias: lista,
    nacional: conta(ls(join(r.repo, 'content', 'noticias'))),
    cidades: conta(deCidades),
    colunas: conta(ls(join(r.repo, 'content', 'colunas'))),
    totais: {
      nacional: ls(join(r.repo, 'content', 'noticias')).length,
      cidades: deCidades.length,
      colunas: ls(join(r.repo, 'content', 'colunas')).length,
      cidadesNoAr: slugs.length,
    },
  };
}

// Última linha útil do log do robô nacional ("fim do ciclo: 1 publicada(s), 2 na fila").
function ultimoFimDeCiclo(r: Raizes): string | undefined {
  const f = join(r.repo, 'agents.log');
  if (!existsSync(f)) return undefined;
  const linhas = readFileSync(f, 'utf8').slice(-20_000).split('\n').filter((l) => l.includes('fim do ciclo'));
  return linhas.at(-1)?.replace(/^\[[^\]]*\]\s*/, '');
}

export function equipe(s: Saude, cidadesNoAr: number): Setor[] {
  const nac: Estado = s.servicos.nacional === 'active' ? 'trabalhando' : 'parado';
  const cid: Estado = s.servicos.cidades === 'active' ? 'trabalhando' : 'parado';
  const rapidaOk = s.rapida.online;
  const fast: Estado = nac === 'parado' ? 'parado' : rapidaOk ? 'trabalhando' : 'reserva';
  const fastDet = rapidaOk ? 'RTX 2060 (PC)' : 'PC desligado: rodando na 3060';
  const regra = (nome: string, faz: string): Funcionario => ({ nome, faz, motor: 'regra fixa', estado: nac === 'parado' && cid === 'parado' ? 'parado' : 'de_plantao' });
  return [
    {
      nome: 'Pauta',
      funcionarios: [
        { nome: 'Pauteiro nacional', faz: 'Lê a Agência Brasil (geral, economia, internacional) a cada 30 min', motor: 'RSS', estado: nac },
        { nome: 'Pauteiros locais', faz: `Buscam notícia de ${cidadesNoAr} cidades no Google Notícias a cada 45 min`, motor: 'RSS', estado: cid },
      ],
    },
    {
      nome: 'Redação nacional',
      funcionarios: [
        { nome: 'Triagem', faz: 'Dá nota de sensibilidade com prova no texto', motor: 'llama3.2:3b', estado: fast, detalhe: fastDet },
        { nome: 'Redator', faz: 'Reescreve em pirâmide invertida, citando a fonte', motor: 'qwen3:4b · RTX 3060', estado: nac },
        { nome: 'Revisor', faz: 'Lista correções pontuais (nunca apaga o crédito da fonte)', motor: 'qwen3:4b · RTX 3060', estado: nac },
        { nome: 'Editor de SEO', faz: 'Manchete, linha fina e slug', motor: 'qwen3:4b · RTX 3060', estado: nac },
        { nome: 'Produtor da lauda', faz: 'Texto de locução e tarja para a live', motor: 'llama3.2:3b', estado: fast, detalhe: fastDet },
      ],
    },
    {
      nome: 'Redação local',
      funcionarios: [{ nome: 'Repórter das cidades', faz: 'Escreve a matéria local e evita duplicada', motor: 'qwen3:4b · RTX 3060', estado: cid }],
    },
    {
      nome: 'Opinião',
      funcionarios: [
        {
          nome: 'Colunista',
          faz: 'Coluna educativa (finanças, negócios, fé), seg e qui às 9h',
          motor: 'qwen2.5:7b · RTX 3060',
          estado: s.servicos.colunista === 'active' ? 'de_plantao' : 'parado',
          detalhe: s.proximaColuna ? `próxima: ${s.proximaColuna}` : undefined,
        },
      ],
    },
    {
      nome: 'Jurídico e travas',
      funcionarios: [
        regra('Presunção de inocência', 'Barra "culpado", "assassino", "ladrão" antes de condenação'),
        regra('Proteção ECA', 'Veta nome/escola de menor envolvido em crime'),
        regra('Contraditório', 'Põe a cláusula de direito de resposta em acusações'),
        regra('Anti-cópia', 'Manda pra fila texto mais de 50% igual à fonte'),
      ],
    },
    {
      nome: 'Distribuição',
      funcionarios: [
        { nome: 'Publicador', faz: 'Commit e push: a Vercel põe no ar em ~1 min', motor: 'git', estado: nac === 'parado' && cid === 'parado' ? 'parado' : 'de_plantao' },
        { nome: 'Sitemap Google Notícias', faz: 'Lista as matérias das últimas 48 h', motor: 'Hugo', estado: 'de_plantao' },
        { nome: 'Âncora da live 24h', faz: 'Lê as laudas no YouTube', motor: 'stream-engine', estado: 'em_teste' },
        { nome: 'Vigia da rig', faz: 'Abre alerta no GitHub se os robôs param de publicar', motor: 'GitHub Actions', estado: 'de_plantao' },
      ],
    },
  ];
}

export async function painel(r: Raizes, env: NodeJS.ProcessEnv, agoraIso = new Date().toISOString()) {
  const s = await saude(r, env);
  const prod = producao(r, agoraIso);
  const fila = listarFila(r);
  const setores = equipe(s, prod.totais.cidadesNoAr);
  const agentes = setores.reduce((n, x) => n + x.funcionarios.length, 0);
  return {
    agora: agoraIso,
    resumo: {
      pessoas: 1,
      agentes,
      setores: setores.length,
      publicadasHoje: prod.nacional.at(-1)! + prod.cidades.at(-1)! + prod.colunas.at(-1)!,
      naFila: fila.length,
    },
    fila: {
      nacional: fila.filter((i) => i.tipo === 'nacional').length,
      cidades: fila.filter((i) => i.tipo === 'cidades').length,
      colunas: fila.filter((i) => i.tipo === 'colunas').length,
    },
    ultimoCiclo: ultimoFimDeCiclo(r),
    producao: prod,
    saude: s,
    setores,
  };
}
