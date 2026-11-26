import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALTURA,
  ALTURA_TICKER,
  LARGURA,
  X_TICKER,
  renderizarConteudo,
  renderizarFundo,
  renderizarTicker,
  renderizarVinheta,
} from './card.ts';
import { rodarFfmpeg, sondar } from './ffmpeg.ts';
import { type Locutor, textoLocucao } from './locutor.ts';
import type { BlocoPronto, Materia } from './tipos.ts';

/** Parâmetros de saída idênticos em TODO bloco (o transmissor só copia, não recodifica). */
function saidaPadrao(gpu: number, duracao: number, saida: string): string[] {
  return [
    '-c:v', 'h264_nvenc', '-gpu', String(gpu), '-preset', 'p4',
    '-rc', 'cbr', '-b:v', '4500k', '-maxrate', '4500k', '-bufsize', '9000k',
    '-g', '60', '-bf', '0', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-t', String(duracao), '-f', 'mpegts', saida,
  ];
}

const VELOCIDADE_TICKER = 120; // px/s
const ATRASO_VOZ_MS = 500;
const FOLGA_FINAL_S = 2;

export interface EntradaBloco {
  fundo: string;
  conteudo: string;
  ticker: string;
  larguraTicker: number;
  voz: string | null;
  trilha: string | null;
  duracao: number;
  saida: string;
  gpu: number;
}

export function argsBloco(e: EntradaBloco): string[] {
  const largFaixa = LARGURA - X_TICKER;
  const yFaixa = ALTURA - ALTURA_TICKER;
  // Toda entrada tem duração finita: com fonte infinita o filtro trava quando o áudio
  // termina antes do vídeo (visto no FFmpeg 8.1 com anullsrc + -t só na saída).
  const t = String(e.duracao);
  const entradas = [
    '-y',
    '-loop', '1', '-framerate', '30', '-t', t, '-i', e.fundo,
    '-loop', '1', '-framerate', '30', '-t', t, '-i', e.ticker,
    '-loop', '1', '-framerate', '30', '-t', t, '-i', e.conteudo,
    ...(e.voz ? ['-i', e.voz] : ['-f', 'lavfi', '-t', t, '-i', 'anullsrc=r=48000:cl=stereo']),
    ...(e.trilha ? ['-stream_loop', '-1', '-t', t, '-i', e.trilha] : []),
  ];
  const video = [
    '[0]split[f1][f2]',
    // faixa de manchetes rola da direita para a esquerda, em loop
    `[f1][1]overlay=x='${X_TICKER}+${largFaixa}-mod(t*${VELOCIDADE_TICKER},${largFaixa}+${e.larguraTicker})':y=${yFaixa}[b0]`,
    // rótulo "ÚLTIMAS" do fundo volta por cima do que passou à esquerda
    `[f2]crop=${X_TICKER}:${ALTURA_TICKER}:0:${yFaixa}[rot]`,
    `[b0][rot]overlay=0:${yFaixa}[b1]`,
    // notícia entra com fade e sobe 40 px
    '[2]format=rgba,fade=t=in:st=0.1:d=0.6:alpha=1[c]',
    `[b1][c]overlay=x=0:y='if(lt(t,0.8),40*(1-t/0.8),0)'[vf]`,
    '[vf]format=yuv420p[v]',
  ];
  const voz = e.voz
    ? `[3:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ATRASO_VOZ_MS}:all=1,apad=whole_dur=${t}[voz]`
    : '[3:a]aresample=48000,aformat=channel_layouts=stereo[voz]';
  const audio = e.trilha
    ? [voz, '[4:a]aresample=48000,aformat=channel_layouts=stereo,volume=-22dB[mus]', '[voz][mus]amix=inputs=2:duration=first:normalize=0[a]']
    : [voz.replace(/\[voz\]$/, '[a]')];
  return [
    ...entradas,
    '-filter_complex', [...video, ...audio].join(';'),
    '-map', '[v]', '-map', '[a]',
    ...saidaPadrao(e.gpu, e.duracao, e.saida),
  ];
}

/** Nome de arquivo seguro a partir do id da matéria. */
export function nomeArquivo(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]+/g, '_').slice(-120);
}

async function gravarMeta(b: BlocoPronto): Promise<void> {
  await writeFile(b.arquivo + '.json', JSON.stringify(b, null, 2));
}

/**
 * Gera o bloco de uma notícia. Se a locução falhar, o erro sobe e NENHUM .ts fica no disco:
 * notícia nunca vai ao ar muda.
 */
export async function montarBloco(
  m: Materia,
  manchetesTicker: string[],
  locutor: Locutor,
  dirSaida: string,
  trilhas: string[],
  gpu: number,
  indice = 0,
): Promise<BlocoPronto> {
  const tmp = await mkdtemp(join(tmpdir(), 'cnb-mont-'));
  try {
    const voz = join(tmp, 'voz.mp3');
    await locutor.falar(textoLocucao(m), voz);
    const durVoz = (await sondar(voz)).duracao;
    const fundo = join(tmp, 'fundo.png');
    const conteudo = join(tmp, 'conteudo.png');
    const ticker = join(tmp, 'ticker.png');
    await writeFile(fundo, await renderizarFundo());
    await writeFile(conteudo, await renderizarConteudo(m));
    const t = await renderizarTicker(manchetesTicker.length ? manchetesTicker : ['CNB News — notícias das cidades 24 horas']);
    await writeFile(ticker, t.png);
    const duracao = Math.round((durVoz + ATRASO_VOZ_MS / 1000 + FOLGA_FINAL_S) * 10) / 10;
    const arquivo = join(dirSaida, `${nomeArquivo(m.id)}.ts`);
    const parcial = arquivo + '.parcial';
    const trilha = trilhas.length ? trilhas[indice % trilhas.length] : null;
    await rodarFfmpeg(argsBloco({ fundo, conteudo, ticker, larguraTicker: t.largura, voz, trilha, duracao, saida: parcial, gpu }));
    const { rename } = await import('node:fs/promises');
    await rename(parcial, arquivo);
    const bloco: BlocoPronto = { id: m.id, arquivo, duracao, criadoEm: new Date(), tipo: 'noticia', cidade: m.cidade };
    await gravarMeta(bloco);
    return bloco;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Tela cheia da marca, mesmos parâmetros de stream; áudio = trilha ou silêncio. */
export async function montarVinheta(texto: string, duracao: number, saida: string, trilha: string | null, gpu: number): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'cnb-vin-'));
  try {
    const img = join(tmp, 'vinheta.png');
    await writeFile(img, await renderizarVinheta(texto));
    const d = String(duracao);
    const audioIn = trilha ? ['-stream_loop', '-1', '-t', d, '-i', trilha] : ['-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=48000:cl=stereo'];
    const filtroA = trilha ? '[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=-16dB,afade=t=out:st=' + Math.max(0, duracao - 1) + ':d=1[a]' : '[1:a]aresample=48000,aformat=channel_layouts=stereo[a]';
    await rodarFfmpeg([
      '-y', '-loop', '1', '-framerate', '30', '-t', d, '-i', img, ...audioIn,
      '-filter_complex', `[0]fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, duracao - 0.5)}:d=0.5,format=yuv420p[v];${filtroA}`,
      '-map', '[v]', '-map', '[a]',
      ...saidaPadrao(gpu, duracao, saida + '.parcial'),
    ]);
    const { rename } = await import('node:fs/promises');
    await rename(saida + '.parcial', saida);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
