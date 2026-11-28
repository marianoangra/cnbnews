import { readFile } from 'node:fs/promises';
import type { Materia } from './tipos.ts';

const RESUMO_MINIMO = 80;

/** Minúsculas, sem acento, pontuação vira espaço, espaços colapsados. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export async function carregarBloqueio(caminho: string): Promise<string[]> {
  const bruto = await readFile(caminho, 'utf8');
  return bruto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(normalizar)
    .filter(Boolean);
}

function contemTermo(textoNormalizado: string, termo: string): boolean {
  return ` ${textoNormalizado} `.includes(` ${termo} `);
}

/** Tira da live o que não é amigável a anunciante, resumos curtos e títulos repetidos. */
export function filtrar(materias: Materia[], bloqueio: string[]): Materia[] {
  const ordenadas = [...materias].sort((a, b) => b.publicadaEm.getTime() - a.publicadaEm.getTime());
  const vistos = new Set<string>();
  const saida: Materia[] = [];
  for (const m of ordenadas) {
    if (m.resumo.length < RESUMO_MINIMO) continue;
    const texto = normalizar(`${m.titulo} ${m.resumo} ${m.lauda?.textoLocucao ?? ''}`);
    if (bloqueio.some((t) => contemTermo(texto, t))) continue;
    const chave = normalizar(m.titulo);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(m);
  }
  return saida;
}
