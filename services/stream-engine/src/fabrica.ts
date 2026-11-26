import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { todasAsCidades } from './cidades.ts';
import type { Locutor } from './locutor.ts';
import { montarBloco, montarVinheta, nomeArquivo } from './montador.ts';
import type { BlocoPronto, Materia } from './tipos.ts';

export type Montar = typeof montarBloco;
export type MontarVinheta = (texto: string, duracao: number, saida: string, trilha: string | null, gpu: number) => Promise<void>;

interface Opcoes {
  gpu: number;
  montar?: Montar;
  vinheta?: MontarVinheta;
}

const MANCHETES_NO_TICKER = 8;
export const DURACAO_VINHETA = 6;
const TEXTO_VINHETA = 'Você está na CNB News • notícias das cidades 24 horas';
const CONFIG_INSTITUCIONAL = join(import.meta.dirname, '..', 'config', 'institucional.json');

/** Gera um bloco para cada matéria que ainda não tem; falha numa não interrompe as outras. */
export async function gerarPendentes(
  materias: Materia[],
  dirBlocos: string,
  locutor: Locutor,
  trilhas: string[],
  opts: Opcoes,
): Promise<{ gerados: string[]; falhas: string[] }> {
  const montar = opts.montar ?? montarBloco;
  const gerados: string[] = [];
  const falhas: string[] = [];
  for (const [i, m] of materias.entries()) {
    if (existsSync(join(dirBlocos, `${nomeArquivo(m.id)}.ts.json`))) continue;
    const ticker = materias
      .filter((x) => x !== m)
      .slice(0, MANCHETES_NO_TICKER)
      .map((x) => x.lauda?.textoGc || x.titulo);
    try {
      await montar(m, ticker, locutor, dirBlocos, trilhas, opts.gpu, i);
      gerados.push(m.id);
    } catch (e) {
      falhas.push(m.id);
      console.warn(`[fábrica] ${m.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { gerados, falhas };
}

interface ItemInstitucional {
  id: string;
  titulo: string;
  resumo: string;
}

/** Blocos fixos do loop de contingência: 3 institucionais + 1 vinheta. Só cria o que falta. */
export async function garantirInstitucional(dirFixos: string, locutor: Locutor, trilhas: string[], opts: Opcoes): Promise<void> {
  const montar = opts.montar ?? montarBloco;
  const vinheta = opts.vinheta ?? montarVinheta;
  const itens = JSON.parse(await readFile(CONFIG_INSTITUCIONAL, 'utf8')) as ItemInstitucional[];
  const cidades = todasAsCidades();
  for (const [i, it] of itens.entries()) {
    if (existsSync(join(dirFixos, `${nomeArquivo(it.id)}.ts.json`))) continue;
    const resumo = it.resumo.replace(
      '{cidades}',
      `Entre elas: ${cidades.slice(0, -1).join(', ')} e ${cidades.at(-1)}.`,
    );
    const materia: Materia = {
      id: it.id, titulo: it.titulo, resumo, fonte: 'CNB News', cidade: null,
      publicadaEm: new Date(), caminho: '', lauda: null,
    };
    const b = await montar(materia, itens.filter((x) => x !== it).map((x) => x.titulo), locutor, dirFixos, trilhas, opts.gpu, i);
    const fixo: BlocoPronto = { ...b, tipo: 'institucional' };
    await writeFile(fixo.arquivo + '.json', JSON.stringify(fixo, null, 2));
  }
  const arqVinheta = join(dirFixos, 'vinheta.ts');
  if (!existsSync(arqVinheta + '.json')) {
    await vinheta(TEXTO_VINHETA, DURACAO_VINHETA, arqVinheta, trilhas[0] ?? null, opts.gpu);
    const b: BlocoPronto = { id: 'vinheta', arquivo: arqVinheta, duracao: DURACAO_VINHETA, criadoEm: new Date(), tipo: 'vinheta', cidade: null };
    await writeFile(arqVinheta + '.json', JSON.stringify(b, null, 2));
  }
}

/** Apaga blocos de notícia mais velhos que `maxHoras`. Só deve receber a pasta de notícias. */
export async function limpar(dirBlocos: string, agora: Date, maxHoras = 48): Promise<number> {
  const limite = agora.getTime() - maxHoras * 3600_000;
  let apagados = 0;
  for (const nome of await readdir(dirBlocos).catch(() => [] as string[])) {
    if (!nome.endsWith('.ts')) continue;
    const arq = join(dirBlocos, nome);
    if ((await stat(arq)).mtimeMs >= limite) continue;
    await rm(arq, { force: true });
    await rm(arq + '.json', { force: true });
    apagados++;
  }
  return apagados;
}

/** Lê os metadados de todos os blocos prontos (ignora .ts sem meta válido ou sem o .ts). */
export async function listarBlocos(dirs: string[]): Promise<BlocoPronto[]> {
  const saida: BlocoPronto[] = [];
  for (const dir of dirs) {
    for (const nome of await readdir(dir).catch(() => [] as string[])) {
      if (!nome.endsWith('.ts.json')) continue;
      try {
        const b = JSON.parse(await readFile(join(dir, nome), 'utf8')) as BlocoPronto;
        if (!b.id || !b.arquivo || !existsSync(b.arquivo)) continue;
        saida.push({ ...b, criadoEm: new Date(b.criadoEm) });
      } catch {
        // meta quebrado: o bloco fica fora até ser regerado
      }
    }
  }
  return saida;
}
