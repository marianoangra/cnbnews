// Robô colunista (CLAUDE.md §4A e §7B): 1 coluna educativa por execução, assinada por
// Rafael Mariano, SEMPRE para a fila de aprovação — nunca publica sozinho.
//   node src/colunista.ts              → escreve 1 coluna em fila-aprovacao/colunas/
//   node src/colunista.ts --simular    → mostra a coluna no terminal, sem gravar
//   node src/colunista.ts --tema fe    → força o tema (financas | negocios | fe)
// Para publicar: revisar o .md e mover para content/colunas/ (o produto e a nota de
// transparência entram pelo layout, com rel="sponsored"; o texto não leva link nenhum).
// Na rig: timer systemd 2x por semana (CLAUDE.md: 1 a 2 colunas por semana).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { slugificar } from './guardrails.ts';
import { configDoAmbiente, criarLlm, ErroLlm, objeto, texto, type Llm } from './ollama.ts';
import { dataBrt } from './publicador.ts';

export type Tema = 'financas' | 'negocios' | 'fe';

export interface Pauta {
  id: string;
  tema: Tema;
  assunto: string;
}

// Produto que cada tema pode recomendar (chaves de data/produtos.yaml).
export const PRODUTO_DO_TEMA: Record<Tema, string> = {
  financas: 'sai-do-vermelho',
  negocios: 'mentoria',
  fe: 'fe-prosperidade',
};

// Pautas atemporais. O robô pega a primeira que ainda não virou coluna (nem está na fila).
export const PAUTAS: Pauta[] = [
  { id: 'reserva-emergencia', tema: 'financas', assunto: 'Como montar uma reserva de emergência começando com pouco dinheiro' },
  { id: 'cartao-rotativo', tema: 'financas', assunto: 'Por que o rotativo do cartão de crédito é a dívida mais cara e como sair dele' },
  { id: 'orcamento-50-30-20', tema: 'financas', assunto: 'A regra 50-30-20 para organizar o salário: como adaptar à realidade brasileira' },
  { id: 'negociar-dividas', tema: 'financas', assunto: 'Passo a passo para negociar dívidas atrasadas sem cair em golpe' },
  { id: 'gastos-invisiveis', tema: 'financas', assunto: 'Gastos invisíveis: assinaturas, taxas e pequenas compras que somem com o salário' },
  { id: 'decimo-terceiro', tema: 'financas', assunto: 'O que fazer com o 13º salário: quitar dívida, reservar ou gastar?' },
  { id: 'financas-casal', tema: 'financas', assunto: 'Dinheiro no casamento: como o casal pode conversar sobre contas sem brigar' },
  { id: 'golpes-pix', tema: 'financas', assunto: 'Golpes mais comuns no Pix e no WhatsApp e como se proteger' },
  { id: 'primeiro-negocio-digital', tema: 'negocios', assunto: 'Primeiros passos para quem quer começar um negócio pela internet sem cair em promessas fáceis' },
  { id: 'nicho', tema: 'negocios', assunto: 'Como escolher um nicho: conhecimento que você já tem pode virar serviço' },
  { id: 'mei', tema: 'negocios', assunto: 'MEI para quem vende pela internet: o que é, quanto custa e quando vale a pena' },
  { id: 'preco-servico', tema: 'negocios', assunto: 'Como definir o preço de um serviço ou produto digital sem se desvalorizar' },
  { id: 'consistencia-redes', tema: 'negocios', assunto: 'Constância nas redes sociais: por que postar todo dia importa mais que viralizar' },
  { id: 'atendimento-whatsapp', tema: 'negocios', assunto: 'Atendimento pelo WhatsApp que vende: respostas rápidas, educação e acompanhamento' },
  { id: 'mordomia', tema: 'fe', assunto: 'Mordomia cristã: cuidar bem do que se recebe, do salário ao tempo' },
  { id: 'gratidao-ansiedade', tema: 'fe', assunto: 'Gratidão como prática diária contra a ansiedade com dinheiro' },
  { id: 'generosidade', tema: 'fe', assunto: 'Generosidade com responsabilidade: ajudar o próximo sem se endividar' },
  { id: 'trabalho-proposito', tema: 'fe', assunto: 'Trabalho com propósito: a visão cristã sobre esforço, descanso e sustento' },
  { id: 'contentamento', tema: 'fe', assunto: 'Contentamento num mundo de comparação: redes sociais, consumo e paz interior' },
  { id: 'familia-financas-fe', tema: 'fe', assunto: 'Ensinar os filhos sobre dinheiro com valores cristãos' },
];

export const SYSTEM_COLUNISTA = `Você escreve colunas para o portal de notícias CNB News, assinadas por Rafael Mariano.
Público: brasileiros comuns, linguagem simples, direta e respeitosa, português do Brasil.
Regras obrigatórias:
- Texto EDUCATIVO e PRÁTICO: o leitor precisa sair sabendo fazer algo, sem precisar comprar nada.
- Texto LONGO: no mínimo 750 palavras, em Markdown, com 4 ou 5 subtítulos "## " e 2 ou 3 parágrafos em cada um, com exemplos do dia a dia.
- NÃO prometa ganho, renda, enriquecimento ou resultado garantido. NÃO recomende ação, criptomoeda, banco ou investimento específico.
- NÃO invente números, pesquisas, leis, datas ou citações de pessoas. Se não tiver certeza de um dado, não use.
- Em temas de fé: tom acolhedor e respeitoso, pode citar versículos bíblicos conhecidos com a referência (livro capítulo:versículo), sem prometer prosperidade material.
- NÃO escreva links, URLs nem nomes de produtos ou cursos. NÃO faça propaganda.
- Último parágrafo: um resumo prático do que fazer a partir de hoje.
Responda SOMENTE com JSON: {"manchete": "...", "subtitulo": "...", "corpo": "..."}
- manchete: até 80 caracteres, sem ponto final.
- subtitulo: 1 frase de 100 a 160 caracteres que resume a coluna.
- corpo: a coluna completa em Markdown (sem repetir a manchete como título).`;

export function promptColuna(p: Pauta): string {
  return `Escreva a coluna desta semana sobre: ${p.assunto}`;
}

export interface Coluna {
  manchete: string;
  subtitulo: string;
  corpo: string;
}

export function validarColuna(x: unknown): Coluna {
  const o = objeto(x);
  const manchete = texto(o, 'manchete', 15).replace(/\.$/, '');
  const subtitulo = texto(o, 'subtitulo', 60);
  const corpo = texto(o, 'corpo', 1500);
  const palavras = contarPalavras(corpo);
  if (palavras < 350) throw new ErroLlm(`coluna curta demais (${palavras} palavras)`);
  return { manchete, subtitulo, corpo };
}

export const contarPalavras = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Tira qualquer link que o modelo tenha escrito: link comercial só pelo layout, com rel="sponsored".
export function semLinks(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '');
}

const ALERTAS: [RegExp, string][] = [
  [/\b(garantid[oa]s?|sem risco|risco zero)\b/i, 'promessa de garantia ou "sem risco"'],
  [/\b(fique rico|ficar rico|enriquec|renda extra garantida|dinheiro f[aá]cil|liberdade financeira em)\b/i, 'promessa de enriquecimento'],
  [/\b\d{1,3}\s?% ao (m[eê]s|ano)\b/i, 'percentual de rendimento citado (conferir)'],
  [/\b(bitcoin|ethereum|criptomoeda|a[cç][oõ]es da|tesouro direto|cdb|fii)\b/i, 'cita investimento específico'],
  [/\b(segundo (uma )?pesquisa|estudo (da|do|de)|de acordo com (o|a) (ibge|banco central|serasa))\b/i, 'cita pesquisa ou dado (conferir a fonte)'],
  [/\b(lei n?º?\s?\d|artigo \d+)/i, 'cita lei ou artigo (conferir)'],
];

export function alertasDaColuna(c: Coluna): string[] {
  const tudo = `${c.manchete}\n${c.subtitulo}\n${c.corpo}`;
  const achados = ALERTAS.filter(([re]) => re.test(tudo)).map(([, m]) => m);
  const n = contarPalavras(c.corpo);
  if (n > 1000) achados.push(`longa demais (${n} palavras)`);
  if (n < 550) achados.push(`curta (${n} palavras; o alvo é 600 a 800)`);
  return achados;
}

const q = (s: string) => JSON.stringify(s);

export function paraMarkdownColuna(p: Pauta, c: Coluna, iso: string, alertas: string[]): string {
  const linhas = [
    '---',
    `title: ${q(c.manchete)}`,
    `date: ${dataBrt(iso).carimbo}`,
    `description: ${q(c.subtitulo)}`,
    `tema: ${q(p.tema)}`,
    `pauta: ${q(p.id)}`,
    `autor: "Rafael Mariano"`,
    `produto: ${q(PRODUTO_DO_TEMA[p.tema])}`,
    `gerado_por_ia: true`,
  ];
  if (alertas.length) linhas.push('alertas_revisao:', ...alertas.map((a) => `  - ${q(a)}`));
  linhas.push('draft: false', '---', '', semLinks(c.corpo).trim(), '');
  return linhas.join('\n');
}

// Pautas já usadas: front matter "pauta:" das colunas publicadas e das que estão na fila.
export function pautasUsadas(...dirs: string[]): Set<string> {
  const usadas = new Set<string>();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md')) continue;
      const m = readFileSync(join(d, f), 'utf8').match(/^pauta:\s*"?([^"\n]+)"?/m);
      if (m) usadas.add(m[1].trim());
    }
  }
  return usadas;
}

// Alterna os temas: escolhe o tema com menos colunas usadas e, nele, a 1ª pauta livre.
export function escolherPauta(usadas: Set<string>, tema?: Tema): Pauta | undefined {
  const livres = PAUTAS.filter((p) => !usadas.has(p.id) && (!tema || p.tema === tema));
  if (!livres.length) return undefined;
  const usoPorTema = (t: Tema) => PAUTAS.filter((p) => p.tema === t && usadas.has(p.id)).length;
  return [...livres].sort((a, b) => usoPorTema(a.tema) - usoPorTema(b.tema))[0];
}

export async function escreverColuna(llm: Llm, p: Pauta, iso = new Date().toISOString()) {
  const c = await llm.gerarJson(SYSTEM_COLUNISTA, promptColuna(p), validarColuna, 0.6);
  const alertas = alertasDaColuna(c);
  const slug = slugificar(c.manchete);
  return { coluna: c, alertas, slug, markdown: paraMarkdownColuna(p, c, iso, alertas), arquivo: `${dataBrt(iso).dia}-${slug}.md` };
}

async function main(): Promise<void> {
  const AGENTS = resolve(import.meta.dirname, '..');
  const REPO = resolve(AGENTS, '..', '..');
  dotenv.config({ path: join(AGENTS, '.env'), quiet: true });
  const fila = join(AGENTS, 'fila-aprovacao', 'colunas');
  const publicadas = join(REPO, 'content', 'colunas');
  const i = process.argv.indexOf('--tema');
  const tema = i >= 0 ? (process.argv[i + 1] as Tema) : undefined;
  const simular = process.argv.includes('--simular');

  const pauta = escolherPauta(pautasUsadas(fila, publicadas), tema);
  if (!pauta) {
    console.log('colunista: todas as pautas já foram usadas — adicionar novas em PAUTAS (colunista.ts)');
    return;
  }
  const cfg = configDoAmbiente(process.env, 'heavy');
  // Coluna é longa: pede mais tempo que a matéria.
  const llm = criarLlm({ ...cfg, timeoutMs: Math.max(cfg.timeoutMs, 600_000) });
  console.log(`colunista: ${pauta.tema} · ${pauta.assunto} (${cfg.modelo})`);
  const t0 = Date.now();
  const r = await escreverColuna(llm, pauta);
  const seg = Math.round((Date.now() - t0) / 1000);
  console.log(`colunista: "${r.coluna.manchete}" · ${contarPalavras(r.coluna.corpo)} palavras · ${seg}s`);
  if (r.alertas.length) console.log(`colunista: alertas → ${r.alertas.join('; ')}`);
  if (simular) {
    console.log('\n' + r.markdown);
    return;
  }
  mkdirSync(fila, { recursive: true });
  const caminho = join(fila, r.arquivo);
  writeFileSync(caminho, r.markdown, 'utf8');
  console.log(`colunista: na fila de aprovação → ${caminho}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error('colunista: falhou —', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
