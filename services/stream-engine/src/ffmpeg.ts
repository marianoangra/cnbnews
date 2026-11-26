import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Ambiente de todo FFmpeg da live: índice de GPU na ordem PCI, igual ao nvidia-smi. */
export const AMBIENTE_GPU = { ...process.env, CUDA_DEVICE_ORDER: 'PCI_BUS_ID' };

/** GPU do NVENC (FFMPEG_GPU_DEVICE, padrão 1 = RTX 2060 da rig dual-GPU). */
export function gpuConfigurada(): number {
  const n = Number(process.env.FFMPEG_GPU_DEVICE ?? 1);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

export async function rodarFfmpeg(args: string[], timeoutMs = 600_000): Promise<void> {
  try {
    await exec('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
      env: AMBIENTE_GPU,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`ffmpeg falhou: ${(err.stderr || err.message).trim().split('\n').slice(-3).join(' | ')}`);
  }
}

export interface Sondagem {
  duracao: number;
  video: { codec: string; largura: number; altura: number; fps: string; pixFmt: string } | null;
  audio: { codec: string; taxa: number; canais: number } | null;
}

export async function sondar(arquivo: string): Promise<Sondagem> {
  const { stdout } = await exec(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo],
    { windowsHide: true },
  );
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, string | number | undefined>>;
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  const a = j.streams?.find((s) => s.codec_type === 'audio');
  return {
    duracao: Number(j.format?.duration ?? 0),
    video: v
      ? { codec: String(v.codec_name), largura: Number(v.width), altura: Number(v.height), fps: String(v.r_frame_rate), pixFmt: String(v.pix_fmt) }
      : null,
    audio: a ? { codec: String(a.codec_name), taxa: Number(a.sample_rate), canais: Number(a.channels) } : null,
  };
}

/** Confere se o NVENC abre na GPU indicada (codifica 1 quadro de teste). */
export async function temNvenc(gpu: number): Promise<boolean> {
  try {
    await rodarFfmpeg(
      ['-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1', '-frames:v', '1', '-c:v', 'h264_nvenc', '-gpu', String(gpu), '-f', 'null', '-'],
      30_000,
    );
    return true;
  } catch {
    return false;
  }
}

/** Lista as GPUs NVIDIA (`nvidia-smi -L`), na ordem PCI. Vazio se não houver driver. */
export async function listarGpus(): Promise<string[]> {
  try {
    const { stdout } = await exec('nvidia-smi', ['-L'], { windowsHide: true });
    return stdout.split(/\r?\n/).filter((l) => l.startsWith('GPU '));
  } catch {
    return [];
  }
}
