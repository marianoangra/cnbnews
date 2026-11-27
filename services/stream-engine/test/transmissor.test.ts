import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rodarFfmpeg, sondar, temNvenc } from '../src/ffmpeg.ts';
import { Transmissor } from '../src/transmissor.ts';

const GPU = Number(process.env.FFMPEG_GPU_DEVICE ?? 0);
const NVENC = await temNvenc(GPU);

/** Bloco curto com os MESMOS parâmetros de stream dos blocos reais. */
async function blocoTeste(saida: string, segundos: number): Promise<string> {
  await rodarFfmpeg([
    '-y', '-f', 'lavfi', '-t', String(segundos), '-i', 'testsrc2=s=1920x1080:r=30',
    '-f', 'lavfi', '-t', String(segundos), '-i', 'sine=frequency=330:sample_rate=48000',
    '-c:v', 'h264_nvenc', '-gpu', String(GPU), '-g', '60', '-bf', '0', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-t', String(segundos), '-f', 'mpegts', saida,
  ]);
  return saida;
}

test('Transmissor: emenda blocos com relógio contínuo (duração = soma)', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tx-'));
  const a = await blocoTeste(join(dir, 'a.ts'), 2);
  const b = await blocoTeste(join(dir, 'b.ts'), 2);
  const destino = join(dir, 'saida.flv');
  const tx = new Transmissor(destino);
  tx.iniciar();
  await tx.enviar(a, 2);
  await tx.enviar(b, 2);
  await tx.enviar(a, 2);
  await tx.parar();
  const s = await sondar(destino);
  assert.ok(Math.abs(s.duracao - 6) < 0.6, `duração ${s.duracao}`);
  assert.equal(s.video?.codec, 'h264');
  assert.equal(s.audio?.codec, 'aac');
});

test('Transmissor: se o FFmpeg morre, avisa a queda, reinicia e segue enviando', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tx-'));
  const a = await blocoTeste(join(dir, 'a.ts'), 2);
  const tx = new Transmissor(join(dir, 'saida.flv'), { esperaInicialMs: 200 });
  const eventos: string[] = [];
  tx.on('queda', () => eventos.push('queda'));
  tx.on('reconectou', () => eventos.push('reconectou'));
  tx.iniciar();
  await tx.enviar(a, 2);
  const reconectou = once(tx, 'reconectou');
  process.kill(tx.pid!);
  await reconectou;
  await tx.enviar(a, 2);
  await tx.parar();
  assert.deepEqual(eventos, ['queda', 'reconectou']);
});

test('Transmissor: parar sem ter iniciado não lança', async () => {
  await new Transmissor(join(tmpdir(), 'nunca.flv')).parar();
});
