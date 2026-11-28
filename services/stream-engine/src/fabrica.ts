import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { todasAsCidades } from './cidades.ts';
import type { Locutor } from './locutor.ts';
import { idMusica, montarBloco, montarMusica, montarVinheta, nomeArquivo } from './montador.ts';
import type { BlocoPronto, Materia } from './tipos.ts';

export type Montar = typeof montarBloco;
export type MontarVinheta = (texto: string, duracao: number, saida: string, trilha: string | null, gpu: number) => Promise<void>;

interface Opcoes {
  gpu: number;
  /** Máximo de blocos NOVOS por chamada (mais novas primeiro). */
  limite?: number;
  montar?: Montar;
  vinheta?: MontarVinheta;
}

const MANCHETES_NO_TICKER = 8;
export const DURACAO_VINHETA = 6;
const TEXTO_VINHETA = 'Você está na CNB News • notícias das cidades 24 horas';
const CONFIG_INSTITUCIONAL = join(import.meta.dirname, '..', 'config', 'institucional.json');

/** Bloco pronto = .ts e meta no disco (só um dos dois = refazer). */
function blocoExiste(dir: string, id: string): boolean {
  const arq = join(dir, `${nomeArquivo(id)}.ts`);
  return existsSync(arq) && existsSync(arq + '.json');
}

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
  const limite = opts.limite ?? Infinity;
  let tentativas = 0;
  for (const [i, m] of materias.entries()) {
    if (blocoExiste(dirBlocos, m.id)) continue;
    if (tentativas >= limite) break; // a cota conta só blocos novos: os prontos não a gastam
    tentativas++;
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
    if (blocoExiste(dirFixos, it.id)) continue;
    const resumo = it.resumo.replace(
      '{cidades}',
      `Entre elas: ${cidades.slice(0, -1).join(', ')} e ${cidades.at(-1)}.`,
    );
    const materia: Materia = {
      id: it.id, titulo: it.titulo, resumo, fonte: 'CNB News', cidade: null,
      publicadaEm: new Date(), caminho: '', lauda: null,
    };
    const b = await montar(materia, itens.filter((x) => x !== it).map((x) => x.titulo), locutor, dirFixos, trilhas, opts.gpu, i);
    const { publicadaEm: _sempreAgora, ...semData } = b; // fixo não envelhece
    const fixo: BlocoPronto = { ...semData, tipo: 'institucional' };
    await writeFile(fixo.arquivo + '.json', JSON.stringify(fixo, null, 2));
  }
  const arqVinheta = join(dirFixos, 'vinheta.ts');
  if (!existsSync(arqVinheta) || !existsSync(arqVinheta + '.json')) {
    await vinheta(TEXTO_VINHETA, DURACAO_VINHETA, arqVinheta, trilhas[0] ?? null, opts.gpu);
    const b: BlocoPronto = { id: 'vinheta', arquivo: arqVinheta, duracao: DURACAO_VINHETA, criadoEm: new Date(), tipo: 'vinheta', cidade: null };
    await writeFile(arqVinheta + '.json', JSON.stringify(b, null, 2));
  }
}

/**
 * Modo rádio: um bloco por faixa (mp3/m4a/wav…) em `dirOrigem`, gerado uma vez em `dirSaida`.
 * Faixa que falha não impede as outras. Retorna quantos blocos novos criou.
 */
export async function garantirMusicas(
  dirOrigem: string,
  dirSaida: string,
  opts: { gpu: number; montarMusica?: (mp3: string, dir: string, gpu: number) => Promise<BlocoPronto> },
): Promise<number> {
  const montar = opts.montarMusica ?? montarMusica;
  const faixas = (await readdir(dirOrigem).catch(() => [] as string[])).filter((n) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(n)).sort();
  let novos = 0;
  for (const nome of faixas) {
    const mp3 = join(dirOrigem, nome);
    if (blocoExiste(dirSaida, idMusica(mp3))) continue;
    try {
      await montar(mp3, dirSaida, opts.gpu);
      novos++;
    } catch (e) {
      console.warn(`[música] ${nome}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return novos;
}

/**
 * Apaga blocos de notícia com mais de `maxHoras` desde a PUBLICAÇÃO da matéria (meta; sem ela, data do
 * arquivo). Com `manter` (ids aprovados no ciclo), também tira do ar o que saiu da lista: matéria
 * apagada, corrigida ou bloqueada. Só deve receber a pasta de notícias. Erro num arquivo não para os outros.
 */
export async function limpar(dirBlocos: string, agora: Date, maxHoras = 48, manter?: Set<string>): Promise<number> {
  const limite = agora.getTime() - maxHoras * 3600_000;
  let apagados = 0;
  for (const nome of await readdir(dirBlocos).catch(() => [] as string[])) {
    if (!nome.endsWith('.ts')) continue;
    const arq = join(dirBlocos, nome);
    try {
      let meta: Partial<BlocoPronto> = {};
      try {
        meta = JSON.parse(await readFile(arq + '.json', 'utf8')) as Partial<BlocoPronto>;
      } catch {
        // sem meta: decide pela data do arquivo
      }
      const publicada = meta.publicadaEm ? new Date(meta.publicadaEm).getTime() : NaN;
      const referencia = Number.isFinite(publicada) ? publicada : (await stat(arq)).mtimeMs;
      const saiuDaLista = manter !== undefined && typeof meta.id === 'string' && !manter.has(meta.id);
      if (referencia >= limite && !saiuDaLista) continue;
      await rm(arq, { force: true });
      await rm(arq + '.json', { force: true });
      apagados++;
    } catch (e) {
      // EBUSY no Windows quando o bloco está sendo transmitido: fica para o próximo ciclo
      console.warn(`[limpeza] ${nome}: ${e instanceof Error ? e.message : e}`);
    }
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
        if (!b.id || !b.arquivo) continue;
        // o .ts mora ao lado do meta: caminho absoluto antigo (pasta movida, copiada para a rig) não importa
        const arquivo = join(dir, b.arquivo.split(/[\\/]/).at(-1)!);
        if (!existsSync(arquivo)) continue;
        saida.push({
          ...b, arquivo, criadoEm: new Date(b.criadoEm),
          ...(b.publicadaEm ? { publicadaEm: new Date(b.publicadaEm) } : {}),
        });
      } catch {
        // meta quebrado: o bloco fica fora até ser regerado
      }
    }
  }
  return saida;
}
