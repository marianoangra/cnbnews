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
async function blocoTeste(saida: string, segundos: number, bitrate = '2M'): Promise<string> {
  await rodarFfmpeg([
    '-y', '-f', 'lavfi', '-t', String(segundos), '-i', 'testsrc2=s=1920x1080:r=30',
    '-f', 'lavfi', '-t', String(segundos), '-i', 'sine=frequency=330:sample_rate=48000',
    '-c:v', 'h264_nvenc', '-gpu', String(GPU), '-b:v', bitrate, '-g', '60', '-bf', '0', '-pix_fmt', 'yuv420p', '-r', '30',
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

async function pacotesVideo(arq: string): Promise<number> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', arq,
  ]);
  return Number(stdout.trim());
}

test('Transmissor: entrega o bloco inteiro, sem cortar o fim (frames = soma exata)', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tx-'));
  const a = await blocoTeste(join(dir, 'a.ts'), 2);
  const destino = join(dir, 'saida.flv');
  const tx = new Transmissor(destino);
  tx.iniciar();
  for (let i = 0; i < 3; i++) await tx.enviar(a, 2);
  await tx.parar();
  assert.equal(await pacotesVideo(destino), 180);
});

test('Transmissor: não acumula listeners no FFmpeg de vida longa', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tx-'));
  const a = await blocoTeste(join(dir, 'a.ts'), 1);
  const tx = new Transmissor(join(dir, 'saida.flv'));
  tx.iniciar();
  const proc = (tx as unknown as { proc: import('node:child_process').ChildProcess }).proc;
  const antes = proc.listenerCount('exit') + proc.listenerCount('error');
  for (let i = 0; i < 3; i++) await tx.enviar(a, 1);
  const depois = proc.listenerCount('exit') + proc.listenerCount('error');
  await tx.parar();
  assert.equal(depois, antes);
});

test('Transmissor: bloco que trava além de duração + folga derruba e reinicia o FFmpeg (watchdog)', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tx-'));
  // grande o bastante para não caber nos buffers de leitura do FFmpeg (bloco real ~14 MB)
  const a = await blocoTeste(join(dir, 'a.ts'), 10, '20M');
  const tx = new Transmissor(join(dir, 'saida.flv'), { esperaInicialMs: 100, folgaMs: 300 });
  const quedas: string[] = [];
  tx.on('queda', (m: string) => quedas.push(m));
  tx.iniciar();
  const t0 = Date.now();
  await tx.enviar(a, 0.1); // anuncia 0,1 s mas o -re leva ~10 s: simula a saída travada
  assert.ok(Date.now() - t0 < 2500, `enviar demorou ${Date.now() - t0} ms`);
  assert.equal(quedas.length, 1);
  await tx.parar();
});

test('Transmissor: FFmpeg que nem abre (spawn error) vira queda, não derruba o processo', async () => {
  const tx = new Transmissor(join(tmpdir(), 'x.flv'), { esperaInicialMs: 50, binario: 'ffmpeg-que-nao-existe-cnb' });
  const queda = once(tx, 'queda');
  tx.iniciar();
  await queda;
  await tx.parar();
});
