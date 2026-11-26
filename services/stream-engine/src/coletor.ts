import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import type { Lauda, Materia } from './tipos.ts';

const FMT_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function horaBrasilia(d: Date): string {
  return FMT_HORA.format(d);
}

async function listarMd(dir: string): Promise<string[]> {
  let entradas;
  try {
    entradas = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const saida: string[] = [];
  for (const e of entradas) {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) saida.push(...(await listarMd(caminho)));
    else if (e.name.endsWith('.md') && e.name !== '_index.md') saida.push(caminho);
  }
  return saida;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function lerLauda(v: unknown): Lauda | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const textoGc = texto(o.texto_gc);
  const textoLocucao = texto(o.texto_locucao);
  if (!textoGc || !textoLocucao) return null;
  const palavras = Array.isArray(o.palavras_chave_visuais)
    ? o.palavras_chave_visuais.filter((p): p is string => typeof p === 'string')
    : [];
  return { textoGc, textoLocucao, palavrasChaveVisuais: palavras };
}

function lerData(v: unknown): Date | null {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export async function coletar(raizRepo: string, agora: Date, janelaHoras = 48): Promise<Materia[]> {
  const content = join(raizRepo, 'content');
  const arquivos = [
    ...(await listarMd(join(content, 'cidades'))),
    ...(await listarMd(join(content, 'noticias'))),
  ];
  const limite = agora.getTime() - janelaHoras * 3600_000;
  const materias: Materia[] = [];
  for (const caminho of arquivos) {
    let fm: Record<string, unknown>;
    try {
      fm = matter(await readFile(caminho, 'utf8')).data;
    } catch {
      continue; // front matter quebrado: ignora a matéria, não derruba a coleta
    }
    const publicadaEm = lerData(fm.date);
    const titulo = texto(fm.title);
    if (!publicadaEm || !titulo) continue;
    if (publicadaEm.getTime() < limite || publicadaEm.getTime() > agora.getTime() + 3600_000) continue;
    const id = relative(content, caminho).split(sep).join('/').replace(/\.md$/, '');
    const partes = id.split('/');
    materias.push({
      id,
      titulo,
      resumo: texto(fm.description),
      fonte: texto(fm.fonte),
      cidade: partes[0] === 'cidades' ? (partes[1] ?? null) : null,
      publicadaEm,
      caminho,
      lauda: lerLauda(fm.lauda_youtube),
    });
  }
  return materias.sort((a, b) => b.publicadaEm.getTime() - a.publicadaEm.getTime());
}
