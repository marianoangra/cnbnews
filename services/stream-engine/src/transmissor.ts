import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { AMBIENTE_GPU } from './ffmpeg.ts';

interface Opcoes {
  esperaInicialMs?: number;
  esperaMaximaMs?: number;
}

const ESTAVEL_MS = 5 * 60_000;

/**
 * Um FFmpeg de vida longa (`-re -c copy`) empurrando MPEG-TS para o RTMP (ou um .flv nos testes).
 * Cada bloco começa em t=0; antes de entrar, ele é remuxado (só cópia) com `-output_ts_offset`
 * acumulado, para o relógio da live nunca voltar para trás.
 * Eventos: `queda` (motivo) e `reconectou`.
 */
export class Transmissor extends EventEmitter {
  private proc: ChildProcess | null = null;
  private offset = 0;
  private parando = false;
  private espera: number;
  private readonly esperaInicial: number;
  private readonly esperaMaxima: number;
  private iniciadoEm = 0;
  private pronto: Promise<void> = Promise.resolve();

  private readonly destino: string;

  constructor(destino: string, opts: Opcoes = {}) {
    super();
    this.destino = destino;
    this.esperaInicial = opts.esperaInicialMs ?? 5_000;
    this.esperaMaxima = opts.esperaMaximaMs ?? 60_000;
    this.espera = this.esperaInicial;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  iniciar(): void {
    this.parando = false;
    this.abrir();
  }

  private abrir(): void {
    const ehArquivo = !/^rtmps?:\/\//.test(this.destino);
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-re', '-fflags', '+genpts', '-f', 'mpegts', '-i', 'pipe:0',
      '-c', 'copy', '-f', 'flv', '-flvflags', 'no_duration_filesize',
      ...(ehArquivo ? ['-y'] : []),
      this.destino,
    ];
    const p = spawn('ffmpeg', args, { env: AMBIENTE_GPU, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    this.proc = p;
    this.offset = 0;
    this.iniciadoEm = Date.now();
    p.stdin.on('error', () => {}); // EPIPE quando o processo morre: tratado no 'exit'
    let ultimoErro = '';
    p.stderr.on('data', (d: Buffer) => {
      ultimoErro = d.toString().trim().split('\n').at(-1) ?? ultimoErro;
    });
    p.on('exit', (codigo) => {
      if (this.proc === p) this.proc = null;
      if (this.parando) return;
      if (Date.now() - this.iniciadoEm > ESTAVEL_MS) this.espera = this.esperaInicial;
      const espera = this.espera;
      this.espera = Math.min(this.espera * 2, this.esperaMaxima);
      this.emit('queda', `ffmpeg saiu (${codigo ?? 'morto'}): ${ultimoErro}`);
      this.pronto = new Promise((ok) => {
        setTimeout(() => {
          if (!this.parando) {
            this.abrir();
            this.emit('reconectou');
          }
          ok();
        }, espera);
      });
    });
  }

  /** Envia um bloco inteiro; resolve quando todos os bytes entraram no transmissor. */
  async enviar(arquivoTs: string, duracao: number): Promise<void> {
    await this.pronto;
    const destino = this.proc;
    if (!destino?.stdin || this.parando) throw new Error('transmissor parado');
    const remux = spawn(
      'ffmpeg',
      ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', arquivoTs, '-map', '0', '-c', 'copy',
        '-output_ts_offset', String(this.offset), '-f', 'mpegts', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    remux.stdout.pipe(destino.stdin, { end: false });
    const morreu = once(destino, 'exit').then(() => 'morreu' as const);
    const fim = once(remux, 'exit').then(([c]) => c as number | null);
    const r = await Promise.race([fim, morreu]);
    if (r === 'morreu') {
      remux.kill();
      return; // a queda já foi avisada; o próximo envio espera a reconexão
    }
    remux.stdout.unpipe(destino.stdin);
    if (r !== 0) throw new Error(`falha ao ler o bloco ${arquivoTs}`);
    this.offset += duracao;
  }

  async parar(): Promise<void> {
    this.parando = true;
    const p = this.proc;
    if (!p) return;
    const saiu = once(p, 'exit');
    p.stdin?.end();
    const timer = setTimeout(() => p.kill(), 15_000);
    await saiu;
    clearTimeout(timer);
  }
}
