import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { coletar } from './coletor.ts';
import { garantirInstitucional, gerarPendentes, limpar } from './fabrica.ts';
import { carregarBloqueio, filtrar } from './filtro.ts';
import type { Locutor } from './locutor.ts';
import { REPO_PADRAO, sincronizar } from './sincronizador.ts';

const RAIZ = join(import.meta.dirname, '..');

export const CAMINHOS = {
  repo: join(RAIZ, 'data', 'repo'),
  blocos: join(RAIZ, 'data', 'blocos'),
  fixos: join(RAIZ, 'data', 'fixos'),
  trilhas: join(RAIZ, 'trilhas'),
  bloqueio: join(RAIZ, 'config', 'bloqueio.txt'),
  status: join(RAIZ, 'data', 'status.json'),
};

export async function listarTrilhas(): Promise<string[]> {
  const nomes = await readdir(CAMINHOS.trilhas).catch(() => [] as string[]);
  return nomes.filter((n) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(n)).sort().map((n) => join(CAMINHOS.trilhas, n));
}

export interface ResultadoCiclo {
  sincronizou: boolean;
  materias: number;
  aprovadas: number;
  gerados: number;
  falhas: number;
  apagados: number;
}

/** Um ciclo de produção: sincroniza, coleta, filtra, gera o que falta e limpa o velho. Nunca lança por rede. */
export async function cicloProducao(locutor: Locutor, gpu: number, limite = Infinity): Promise<ResultadoCiclo> {
  await mkdir(CAMINHOS.blocos, { recursive: true });
  await mkdir(CAMINHOS.fixos, { recursive: true });
  const trilhas = await listarTrilhas();
  await garantirInstitucional(CAMINHOS.fixos, locutor, trilhas, { gpu });
  const s = await sincronizar(process.env.CNB_REPO_URL || REPO_PADRAO, CAMINHOS.repo);
  if (!s.ok) console.warn(`[produção] sincronização falhou, seguindo com o clone antigo: ${s.erro}`);
  const agora = new Date();
  const todas = await coletar(CAMINHOS.repo, agora);
  const aprovadas = filtrar(todas, await carregarBloqueio(CAMINHOS.bloqueio));
  const r = await gerarPendentes(aprovadas.slice(0, limite), CAMINHOS.blocos, locutor, trilhas, { gpu });
  // só com o repo atualizado a lista aprovada é confiável para tirar matéria do ar
  const manter = s.ok && aprovadas.length > 0 ? new Set(aprovadas.map((m) => m.id)) : undefined;
  const apagados = await limpar(CAMINHOS.blocos, agora, 48, manter);
  return {
    sincronizou: s.ok, materias: todas.length, aprovadas: aprovadas.length,
    gerados: r.gerados.length, falhas: r.falhas.length, apagados,
  };
}
