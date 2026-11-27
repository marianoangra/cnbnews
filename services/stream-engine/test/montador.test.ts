import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderizarConteudo, renderizarFundo, renderizarTicker } from '../src/card.ts';
import { rodarFfmpeg, sondar, temNvenc } from '../src/ffmpeg.ts';
import { ErroLocucao, type Locutor } from '../src/locutor.ts';
import { argsBloco, montarBloco, montarMusica, montarVinheta } from '../src/montador.ts';
import type { Materia } from '../src/tipos.ts';

const GPU = Number(process.env.FFMPEG_GPU_DEVICE ?? 0);
const NVENC = await temNvenc(GPU);

const MATERIA: Materia = {
  id: 'cidades/pelotas/2026-11-26-teste',
  titulo: 'MEC promove último aulão do Enem em Pelotas',
  resumo: 'O Ministério da Educação realiza neste sábado o último aulão preparatório para o Enem, com entrada gratuita.',
  fonte: 'Agência Brasil',
  cidade: 'pelotas',
  publicadaEm: new Date(),
  caminho: '',
  lauda: null,
};

/** Locutor falso: 3 s de tom, sem depender de internet. */
const locutorTom: Locutor = {
  async falar(_texto, saida) {
    await rodarFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libmp3lame', saida]);
  },
};

function sequencia(args: string[], ...esperado: string[]): boolean {
  return args.some((_, i) => esperado.every((e, j) => args[i + j] === e));
}

test('argsBloco: NVENC na GPU pedida, GOP 2 s, áudio 48 kHz, MPEG-TS e duração', () => {
  const a = argsBloco({
    fundo: 'f.png', conteudo: 'c.png', ticker: 't.png', larguraTicker: 3000,
    voz: 'v.mp3', trilha: null, duracao: 12.5, saida: 'o.ts', gpu: 1,
  });
  assert.ok(sequencia(a, '-c:v', 'h264_nvenc', '-gpu', '1'));
  assert.ok(sequencia(a, '-g', '60'));
  assert.ok(sequencia(a, '-ar', '48000'));
  assert.ok(sequencia(a, '-f', 'mpegts'));
  assert.ok(sequencia(a, '-t', '12.5'));
  assert.equal(a.at(-1), 'o.ts');
});

test('argsBloco: com trilha, mixa a trilha a -22 dB', () => {
  const a = argsBloco({
    fundo: 'f.png', conteudo: 'c.png', ticker: 't.png', larguraTicker: 3000,
    voz: 'v.mp3', trilha: 'm.mp3', duracao: 10, saida: 'o.ts', gpu: 0,
  });
  const filtro = a[a.indexOf('-filter_complex') + 1];
  assert.match(filtro, /volume=-22dB/);
  assert.match(filtro, /amix=inputs=2/);
});

const PARAMS = (s: Awaited<ReturnType<typeof sondar>>) => ({
  vcodec: s.video?.codec, w: s.video?.largura, h: s.video?.altura, fps: s.video?.fps, pix: s.video?.pixFmt,
  acodec: s.audio?.codec, ar: s.audio?.taxa, ac: s.audio?.canais,
});

async function cartas(dir: string) {
  const fundo = join(dir, 'fundo.png');
  const conteudo = join(dir, 'c.png');
  const ticker = join(dir, 't.png');
  await writeFile(fundo, await renderizarFundo());
  await writeFile(conteudo, await renderizarConteudo(MATERIA));
  const t = await renderizarTicker(['Manchete um', 'Manchete dois']);
  await writeFile(ticker, t.png);
  return { fundo, conteudo, ticker, larguraTicker: t.largura };
}

test('montarBloco: 1080p30 h264 + aac 48 kHz estéreo, duração = 0,5 s + voz + 2 s', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-bloco-'));
  const b = await montarBloco(MATERIA, ['Outra manchete'], locutorTom, dir, [], GPU);
  const s = await sondar(b.arquivo);
  assert.deepEqual(PARAMS(s), { vcodec: 'h264', w: 1920, h: 1080, fps: '30/1', pix: 'yuv420p', acodec: 'aac', ar: 48000, ac: 2 });
  assert.ok(Math.abs(s.duracao - 5.5) < 0.3, `duração ${s.duracao}`);
  assert.equal(b.tipo, 'noticia');
  assert.equal(b.cidade, 'pelotas');
  assert.ok(existsSync(b.arquivo + '.json'));
});

test('montarVinheta: mesmos parâmetros de stream do bloco de notícia', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-vin-'));
  const b = await montarBloco(MATERIA, [], locutorTom, dir, [], GPU);
  const vin = join(dir, 'vinheta.ts');
  await montarVinheta('Você está na CNB News', 4, vin, null, GPU);
  assert.deepEqual(PARAMS(await sondar(vin)), PARAMS(await sondar(b.arquivo)));
});

test('montarBloco: locutor que falha propaga o erro e não deixa .ts', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-falha-'));
  const quebrado: Locutor = { falar: async () => { throw new ErroLocucao('offline'); } };
  await assert.rejects(montarBloco(MATERIA, [], quebrado, dir, [], GPU), ErroLocucao);
  assert.deepEqual((await readdir(dir)).filter((f) => f.endsWith('.ts')), []);
});

test('argsBloco com cartas reais roda no ffmpeg (sem voz = silêncio)', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-args-'));
  const c = await cartas(dir);
  const saida = join(dir, 'mudo.ts');
  await rodarFfmpeg(argsBloco({ ...c, voz: null, trilha: null, duracao: 2, saida, gpu: GPU }));
  assert.ok(Math.abs((await sondar(saida)).duracao - 2) < 0.4);
});

test('argsBloco: toda entrada tem duração finita (evita trava do filtro)', () => {
  const a = argsBloco({
    fundo: 'f.png', conteudo: 'c.png', ticker: 't.png', larguraTicker: 3000,
    voz: null, trilha: 'm.mp3', duracao: 7, saida: 'o.ts', gpu: 0,
  });
  const entradas = a.reduce<number[]>((acc, v, i) => (v === '-i' ? [...acc, i] : acc), []);
  for (const i of entradas) {
    const antes = a.slice(Math.max(0, i - 8), i);
    assert.ok(antes.includes('-t') && antes[antes.lastIndexOf('-t') + 1] === '7', `entrada ${a[i + 1]} sem -t 7`);
  }
});

test('montarMusica: faixa inteira, mesmos parâmetros de stream, tipo musica com título e artista', { skip: !NVENC && 'sem NVENC' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-mus-'));
  const mp3 = join(dir, 'Artista Teste - Faixa Teste.mp3');
  await rodarFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', '-c:a', 'libmp3lame', mp3]);
  const noticia = await montarBloco(MATERIA, [], locutorTom, dir, [], GPU);
  const b = await montarMusica(mp3, dir, GPU);
  assert.equal(b.tipo, 'musica');
  assert.equal(b.titulo, 'Faixa Teste');
  assert.equal(b.artista, 'Artista Teste');
  assert.ok(Math.abs(b.duracao - 5) < 0.3, `duração ${b.duracao}`);
  const s = await sondar(b.arquivo);
  assert.ok(Math.abs(s.duracao - 5) < 0.5, `arquivo ${s.duracao}`);
  assert.deepEqual(PARAMS(s), PARAMS(await sondar(noticia.arquivo)));
  assert.ok(existsSync(b.arquivo + '.json'));
});
