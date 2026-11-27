// Fila de aprovação da redação: o que os robôs deixaram para o Editor-Chefe decidir.
// Três filas, todas FORA do git (o repositório é público e a fila tem pauta sensível):
//   nacional → services/agents/fila-aprovacao/*.md          → content/noticias/
//   colunas  → services/agents/fila-aprovacao/colunas/*.md  → content/colunas/
//   cidades  → fila-aprovacao/cidades/<slug>/*.md           → content/cidades/<slug>/
// Recusar NÃO apaga o arquivo: os robôs olham a fila para não regerar a mesma pauta.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataBrt } from '../publicador.ts';

export type TipoFila = 'nacional' | 'cidades' | 'colunas';

export interface ItemFila {
  id: string; // "nacional/arq.md" | "colunas/arq.md" | "cidades/<slug>/arq.md"
  tipo: TipoFila;
  cidade?: string; // nome legível (do _index.md)
  titulo: string;
  descricao: string;
  data: string;
  score?: number;
  motivos: string[];
  fonte?: string;
  fonte_url?: string;
}

export interface Raizes {
  repo: string;
}

const SEG = /^[a-z0-9][a-z0-9._-]*$/i;

export function filaDir(r: Raizes, tipo: TipoFila): string {
  if (tipo === 'nacional') return join(r.repo, 'services', 'agents', 'fila-aprovacao');
  if (tipo === 'colunas') return join(r.repo, 'services', 'agents', 'fila-aprovacao', 'colunas');
  return join(r.repo, 'fila-aprovacao', 'cidades');
}

const recusadasArq = (r: Raizes) => join(filaDir(r, 'nacional'), 'recusadas.json');

// id → caminho na fila e destino no site. Só aceita nomes simples: nada de "..", barras extras ou caminho absoluto.
export function resolverId(r: Raizes, id: string): { tipo: TipoFila; origem: string; destino: string; slug?: string; arquivo: string } {
  const partes = id.split('/');
  const tipo = partes[0] as TipoFila;
  const ok = (s: string | undefined): s is string => !!s && SEG.test(s) && !s.includes('..');
  if (tipo === 'nacional' || tipo === 'colunas') {
    const arquivo = partes[1];
    if (partes.length !== 2 || !ok(arquivo) || !arquivo.endsWith('.md')) throw new Error('id inválido');
    const destDir = tipo === 'nacional' ? join(r.repo, 'content', 'noticias') : join(r.repo, 'content', 'colunas');
    return { tipo, arquivo, origem: join(filaDir(r, tipo), arquivo), destino: join(destDir, arquivo) };
  }
  if (tipo === 'cidades') {
    const [, slug, arquivo] = partes;
    if (partes.length !== 3 || !ok(slug) || !ok(arquivo) || !arquivo.endsWith('.md')) throw new Error('id inválido');
    return {
      tipo,
      slug,
      arquivo,
      origem: join(filaDir(r, 'cidades'), slug, arquivo),
      destino: join(r.repo, 'content', 'cidades', slug, arquivo),
    };
  }
  throw new Error('id inválido');
}

// Front matter dos robôs: "chave: valor" no topo, listas "  - item". Valor entre aspas = string JSON.
export function lerFrontMatter(md: string): { campos: Record<string, string | string[]>; corpo: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { campos: {}, corpo: md };
  const campos: Record<string, string | string[]> = {};
  let lista: string | null = null;
  for (const linha of m[1].split(/\r?\n/)) {
    const item = linha.match(/^\s+-\s+(.*)$/);
    if (item && lista) {
      (campos[lista] as string[]).push(valor(item[1]));
      continue;
    }
    const kv = linha.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === '') {
      campos[kv[1]] = [];
      lista = kv[1];
    } else {
      campos[kv[1]] = valor(kv[2]);
      lista = null;
    }
  }
  return { campos, corpo: m[2] };
}

function valor(v: string): string {
  const t = v.trim();
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.replace(/^"|"$/g, '');
    }
  }
  return t.replace(/^'|'$/g, '');
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const lst = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

export function recusadas(r: Raizes): Set<string> {
  try {
    return new Set((JSON.parse(readFileSync(recusadasArq(r), 'utf8')) as { id: string }[]).map((x) => x.id));
  } catch {
    return new Set();
  }
}

function nomeCidade(r: Raizes, slug: string): string {
  const idx = join(r.repo, 'content', 'cidades', slug, '_index.md');
  if (!existsSync(idx)) return slug;
  return str(lerFrontMatter(readFileSync(idx, 'utf8')).campos.title) || slug;
}

function itemDe(r: Raizes, id: string, tipo: TipoFila, caminho: string, slug?: string): ItemFila {
  const { campos } = lerFrontMatter(readFileSync(caminho, 'utf8'));
  const score = Number(campos.score_sensibilidade);
  return {
    id,
    tipo,
    cidade: slug ? nomeCidade(r, slug) : undefined,
    titulo: str(campos.title) || id,
    descricao: str(campos.description),
    data: str(campos.date) || statSync(caminho).mtime.toISOString(),
    score: Number.isFinite(score) ? score : undefined,
    motivos: [...lst(campos.motivos_revisao), ...lst(campos.alertas_revisao)],
    fonte: str(campos.fonte) || undefined,
    fonte_url: str(campos.fonte_url) || undefined,
  };
}

const mds = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md') && SEG.test(f)) : []);

export function listarFila(r: Raizes): ItemFila[] {
  const fora = recusadas(r);
  const itens: ItemFila[] = [];
  for (const f of mds(filaDir(r, 'nacional'))) itens.push(itemDe(r, `nacional/${f}`, 'nacional', join(filaDir(r, 'nacional'), f)));
  for (const f of mds(filaDir(r, 'colunas'))) itens.push(itemDe(r, `colunas/${f}`, 'colunas', join(filaDir(r, 'colunas'), f)));
  const cid = filaDir(r, 'cidades');
  if (existsSync(cid)) {
    for (const slug of readdirSync(cid).filter((s) => SEG.test(s))) {
      const d = join(cid, slug);
      if (!statSync(d).isDirectory()) continue;
      for (const f of mds(d)) itens.push(itemDe(r, `cidades/${slug}/${f}`, 'cidades', join(d, f), slug));
    }
  }
  return itens.filter((i) => !fora.has(i.id)).sort((a, b) => b.data.localeCompare(a.data));
}

// Prepara o texto para ir ao ar: data = agora (é quando foi publicada de fato), tira as marcas da fila
// e registra quem aprovou. O resto do front matter (motivos, score) fica como trilha de auditoria.
export function prepararParaPublicar(md: string, agoraIso: string): string {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('texto sem front matter (--- no começo)');
  const linhas = m[1].split(/\r?\n/);
  const saida: string[] = [];
  let pulandoLista = false;
  let dataOriginal = '';
  for (const l of linhas) {
    if (pulandoLista) {
      if (/^\s+-\s/.test(l)) continue;
      pulandoLista = false;
    }
    if (/^alertas_revisao:\s*$/.test(l)) {
      pulandoLista = true;
      continue;
    }
    if (/^(retirada_do_site|aprovado_por|aprovado_em|criado_em):/.test(l)) continue;
    const d = l.match(/^date:\s*(.*)$/);
    if (d) {
      dataOriginal = d[1].trim();
      continue;
    }
    if (/^requer_aprovacao_humana:/.test(l)) {
      saida.push('requer_aprovacao_humana: false');
      continue;
    }
    if (/^draft:/.test(l)) continue;
    saida.push(l);
  }
  if (!saida.some((l) => /^title:\s*\S/.test(l))) throw new Error('falta o título (title:)');
  const fm = [
    ...saida,
    `date: ${dataBrt(agoraIso).carimbo}`,
    ...(dataOriginal ? [`criado_em: ${dataOriginal}`] : []),
    'aprovado_por: "Rafael Mariano"',
    `aprovado_em: ${dataBrt(agoraIso).carimbo}`,
    'draft: false',
  ];
  return ['---', ...fm, '---', '', m[2].trim(), ''].join('\n');
}

export function urlPublica(tipo: TipoFila, arquivo: string, slug?: string): string {
  const nome = arquivo.replace(/\.md$/, '');
  if (tipo === 'cidades') return `https://${slug}.news.cnbmobile.com/${nome}/`;
  return `https://news.cnbmobile.com/${tipo === 'nacional' ? 'noticias' : 'colunas'}/${nome}/`;
}

export function lerItem(r: Raizes, id: string): { item: ItemFila; markdown: string } {
  const alvo = resolverId(r, id);
  if (!existsSync(alvo.origem)) throw new Error('não está mais na fila');
  return { item: itemDe(r, id, alvo.tipo, alvo.origem, alvo.slug), markdown: readFileSync(alvo.origem, 'utf8') };
}

// Grava no content/ e tira da fila. O commit/push fica com quem chama (servidor).
export function moverParaSite(r: Raizes, id: string, markdownEditado: string | undefined, agoraIso: string) {
  const alvo = resolverId(r, id);
  if (!existsSync(alvo.origem)) throw new Error('não está mais na fila');
  if (existsSync(alvo.destino)) throw new Error('já existe uma matéria com esse arquivo no site');
  const base = markdownEditado ?? readFileSync(alvo.origem, 'utf8');
  if (base.length > 200_000) throw new Error('texto grande demais');
  const final = prepararParaPublicar(base, agoraIso);
  writeFileSync(alvo.destino, final, 'utf8');
  // Fica uma cópia em aprovadas/ (fora do site) para auditoria; o robô já tem a pauta no content/.
  const aprovadas = join(filaDir(r, 'nacional'), 'aprovadas');
  mkdirSync(aprovadas, { recursive: true });
  renameSync(alvo.origem, join(aprovadas, `${alvo.tipo}-${alvo.slug ? alvo.slug + '-' : ''}${alvo.arquivo}`));
  const { campos } = lerFrontMatter(final);
  return { ...alvo, titulo: str(campos.title), url: urlPublica(alvo.tipo, alvo.arquivo, alvo.slug) };
}

export function recusar(r: Raizes, id: string, motivo: string, agoraIso: string): void {
  const alvo = resolverId(r, id);
  if (!existsSync(alvo.origem)) throw new Error('não está mais na fila');
  const arq = recusadasArq(r);
  let lista: { id: string; motivo: string; em: string }[] = [];
  try {
    lista = JSON.parse(readFileSync(arq, 'utf8'));
  } catch {
    /* primeira recusa */
  }
  if (!lista.some((x) => x.id === id)) lista.push({ id, motivo: motivo.slice(0, 300), em: agoraIso });
  mkdirSync(filaDir(r, 'nacional'), { recursive: true });
  writeFileSync(arq, JSON.stringify(lista, null, 1), 'utf8');
}
