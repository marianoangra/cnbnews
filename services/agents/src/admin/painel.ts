// "Redação de uma pessoa só": quem trabalha na CNB News (os robôs), em que estado estão e
// quanto produziram. Tudo lido da própria rig: arquivos do site, logs, systemd e Ollama.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dataBrt } from '../publicador.ts';
import type { StatusAoVivo } from './aovivo.ts';
import { listarFila, type Raizes } from './fila.ts';

const run = promisify(execFile);

export type Estado = 'trabalhando' | 'de_plantao' | 'reserva' | 'parado' | 'em_teste' | 'em_montagem' | 'aguardando_rig';

/** Vagas do plano (ainda não existem): não contam como agente em funcionamento. */
export const PLANEJADO: Estado[] = ['em_montagem', 'aguardando_rig'];

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
    if (!v) return undefined;
    // systemd: "Mon 2026-11-30 12:00:00 UTC" → "seg., 30/11 às 09:00" (Brasília)
    const d = new Date(v.replace(/^\w{3} /, '').replace(' UTC', 'Z').replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return v;
    const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return f.format(d).replace(',', '').replace(' ', ', ').replace(/(\d{2}\/\d{2}),? /, '$1 às ');
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
    viagens: conta(ls(join(r.repo, 'content', 'viagens'))),
    totais: {
      nacional: ls(join(r.repo, 'content', 'noticias')).length,
      cidades: deCidades.length,
      colunas: ls(join(r.repo, 'content', 'colunas')).length,
      viagens: ls(join(r.repo, 'content', 'viagens')).length,
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

export function equipe(s: Saude, cidadesNoAr: number, live?: StatusAoVivo): Setor[] {
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
      nome: 'Checagem',
      funcionarios: [
        { nome: 'Checador de fatos', faz: 'Confere cada número, nome e data contra a fonte antes de publicar', motor: 'a definir', estado: 'em_montagem' },
        { nome: 'Erratas e direito de resposta', faz: 'Publica a correção e registra pedido de resposta de quem foi citado', motor: 'a definir', estado: 'em_montagem' },
      ],
    },
    {
      nome: 'Arte',
      funcionarios: [
        { nome: 'Editor de fotos', faz: 'Escolhe a foto de arquivo do banco (Wikimedia) com legenda e crédito; polícia e mundo ficam sem foto', motor: 'regra fixa', estado: 'de_plantao' },
        { nome: 'Designer', faz: 'Card da matéria para o Instagram, capa da live, tarja e vinheta, sempre em modelo fixo (nunca imagem inventada)', motor: 'modelo fixo', estado: 'em_montagem' },
      ],
    },
    {
      nome: 'Social mídia',
      funcionarios: [
        { nome: 'Social media', faz: 'Posta no @cnbnewstv as matérias aprovadas, stories e o resumo do dia', motor: 'Instagram', estado: 'em_montagem' },
        { nome: 'Moderador', faz: 'Comentários, mensagens e chat da live; escala reclamação de citado para o editor-chefe', motor: 'a definir', estado: 'em_montagem' },
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
      ],
    },
    {
      nome: 'TV CNB News 24h',
      funcionarios: [
        {
          nome: 'Âncora da live 24h',
          faz: 'Lê as laudas no YouTube',
          motor: 'stream-engine',
          estado: live?.aoVivo ? 'trabalhando' : 'em_teste',
          detalhe: live?.aoVivo ? 'NO AR agora' : 'canal sem transmissão',
        },
        { nome: 'Diretor de programação', faz: 'Monta a grade de hora em hora: blocos de notícia, colunas e reprises', motor: 'a definir', estado: 'aguardando_rig' },
        { nome: 'Editor de cortes', faz: 'Transforma trechos da live em Reels e Shorts', motor: 'a definir', estado: 'aguardando_rig' },
        { nome: 'Operador de transmissão', faz: 'Reinicia o stream se cair, chaveia o loop institucional e avisa', motor: 'a definir', estado: 'aguardando_rig' },
      ],
    },
    {
      nome: 'Rádio web',
      funcionarios: [
        { nome: 'Locutor', faz: 'Boletim de hora em hora em voz sintética, a partir da lauda', motor: 'a definir', estado: 'aguardando_rig' },
        { nome: 'Programador', faz: 'Trilha com licença comercial, vinhetas e grade da rádio', motor: 'a definir', estado: 'aguardando_rig' },
      ],
    },
    {
      nome: 'Audiência',
      funcionarios: [
        { nome: 'Analista', faz: 'Lê o GA4 e mostra o que deu audiência por cidade e assunto, para a pauta', motor: 'a definir', estado: 'em_montagem' },
        { nome: 'Resumo da manhã', faz: 'Boletim diário por WhatsApp ou e-mail com as principais notícias', motor: 'a definir', estado: 'em_montagem' },
      ],
    },
    {
      nome: 'Infra',
      funcionarios: [
        { nome: 'Vigia da rig', faz: 'Abre alerta no GitHub se os robôs param de publicar', motor: 'GitHub Actions', estado: 'de_plantao' },
        { nome: 'Coordenador das rigs', faz: 'Distribui o trabalho entre as rigs e assume o serviço de uma que cair', motor: 'a definir', estado: 'aguardando_rig' },
      ],
    },
  ];
}

export async function painel(r: Raizes, env: NodeJS.ProcessEnv, agoraIso = new Date().toISOString(), live?: StatusAoVivo) {
  const s = await saude(r, env);
  const prod = producao(r, agoraIso);
  const fila = listarFila(r);
  const setores = equipe(s, prod.totais.cidadesNoAr, live);
  const todos = setores.flatMap((x) => x.funcionarios);
  const vagas = todos.filter((f) => PLANEJADO.includes(f.estado)).length;
  const agentes = todos.length - vagas;
  return {
    agora: agoraIso,
    resumo: {
      pessoas: 1,
      agentes,
      vagas,
      setores: setores.length,
      publicadasHoje: prod.nacional.at(-1)! + prod.cidades.at(-1)! + prod.colunas.at(-1)!,
      naFila: fila.length,
    },
    fila: {
      nacional: fila.filter((i) => i.tipo === 'nacional').length,
      cidades: fila.filter((i) => i.tipo === 'cidades').length,
      colunas: fila.filter((i) => i.tipo === 'colunas').length,
      viagens: fila.filter((i) => i.tipo === 'viagens').length,
    },
    ultimoCiclo: ultimoFimDeCiclo(r),
    producao: prod,
    saude: s,
    aoVivo: live ?? null,
    setores,
  };
}
