/** Gera PNGs de amostra (fundo + ticker + conteúdo compostos) de matérias reais, para revisão visual. */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderizarConteudo, renderizarFundo, renderizarTicker, renderizarVinheta, X_TICKER, ALTURA, ALTURA_TICKER } from './card.ts';
import { coletar } from './coletor.ts';
import { carregarBloqueio, filtrar } from './filtro.ts';
import { REPO_PADRAO, sincronizar } from './sincronizador.ts';

const DATA = join(import.meta.dirname, '..', 'data');
const repo = join(DATA, 'repo');
const saida = join(DATA, 'amostras');
await mkdir(saida, { recursive: true });
const s = await sincronizar(REPO_PADRAO, repo);
if (!s.ok) console.warn('sincronização falhou, usando clone antigo:', s.erro);
const todas = await coletar(repo, new Date());
const ok = filtrar(todas, await carregarBloqueio(join(import.meta.dirname, '..', 'config', 'bloqueio.txt')));
console.log(`matérias 48h: ${todas.length}, após filtro: ${ok.length}`);
const fundo = join(saida, '_fundo.png');
await writeFile(fundo, await renderizarFundo());
const n = Number(process.argv[2] ?? 5);
for (const [i, m] of ok.slice(0, n).entries()) {
  const c = join(saida, `_c${i}.png`);
  const t = join(saida, `_t${i}.png`);
  await writeFile(c, await renderizarConteudo(m));
  const outras = ok.filter((x) => x !== m).slice(0, 8).map((x) => x.titulo);
  await writeFile(t, (await renderizarTicker(outras)).png);
  const final = join(saida, `amostra-${i + 1}.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', fundo, '-i', t, '-i', c, '-filter_complex',
    `[0][1]overlay=${X_TICKER}:${ALTURA - ALTURA_TICKER}[b];[b][2]overlay=0:0`, '-frames:v', '1', final]);
  console.log(final, '←', m.cidade ?? 'nacional', '|', m.titulo);
}
await writeFile(join(saida, 'vinheta.png'), await renderizarVinheta('Você está na CNB News • notícias das cidades 24 horas'));
