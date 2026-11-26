import { mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { limparTexto } from './card.ts';
import type { Materia } from './tipos.ts';

export const VOZ_PADRAO = 'pt-BR-FranciscaNeural';
const CHAMADA = 'Mais em cnbmobile ponto com.';

function frase(s: string): string {
  const t = limparTexto(s.replace(/https?:\/\/\S+/g, '')).replace(/[\s.]+$/, '');
  return t ? `${t}.` : '';
}

/** O que a voz lê. Com lauda do robô nacional, usa a locução dela; senão, título + resumo. */
export function textoLocucao(m: Materia): string {
  const corpo = m.lauda ? [frase(m.lauda.textoLocucao)] : [frase(m.titulo), frase(m.resumo)];
  const fonte = frase(m.fonte);
  return [...corpo, fonte ? `Fonte: ${fonte}` : '', CHAMADA].filter(Boolean).join(' ');
}

export class ErroLocucao extends Error {
  override name = 'ErroLocucao';
}

export interface Locutor {
  falar(texto: string, saidaMp3: string): Promise<void>;
}

/** Grava `texto` em MP3 dentro de `dir` (o msedge-tts sempre grava `dir/audio.mp3`). */
type Sintetizar = (texto: string, voz: string, dir: string) => Promise<void>;

const sintetizarEdge: Sintetizar = async (texto, voz, dir) => {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voz, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    await tts.toFile(dir, texto);
  } finally {
    tts.close();
  }
};

/**
 * Microsoft Edge TTS (vozes neurais pt-BR, grátis, serviço não oficial).
 * Trocar por Azure Speech quando o canal monetizar: implementar outro `Locutor`.
 */
export class EdgeLocutor implements Locutor {
  private readonly voz: string;
  private readonly sintetizar: Sintetizar;
  private readonly timeoutMs: number;

  constructor(opts: { voz?: string; sintetizar?: Sintetizar; timeoutMs?: number } = {}) {
    this.voz = opts.voz ?? process.env.TTS_VOZ ?? VOZ_PADRAO;
    this.sintetizar = opts.sintetizar ?? sintetizarEdge;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async falar(texto: string, saidaMp3: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'cnb-voz-'));
    let timer: NodeJS.Timeout | undefined;
    try {
      const estouro = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new ErroLocucao(`TTS passou de ${this.timeoutMs} ms`)), this.timeoutMs);
      });
      await Promise.race([this.sintetizar(texto, this.voz, dir), estouro]);
      const gerado = join(dir, 'audio.mp3');
      const tamanho = await stat(gerado).then((s) => s.size, () => 0);
      if (tamanho < 1_000) throw new ErroLocucao('TTS não gerou áudio');
      await rename(gerado, saidaMp3);
    } catch (e) {
      if (e instanceof ErroLocucao) throw e;
      throw new ErroLocucao(`TTS falhou: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
      await rm(dir, { recursive: true, force: true });
    }
  }
}
