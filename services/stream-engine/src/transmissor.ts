import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { AMBIENTE_GPU } from './ffmpeg.ts';

interface Opcoes {
  esperaInicialMs?: number;
  esperaMaximaMs?: number;
  /** Tempo além da duração do bloco que o envio pode levar antes de o FFmpeg ser dado como travado. */
  folgaMs?: number;
  /** Executável do FFmpeg (testes). */
  binario?: string;
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
  private readonly folga: number;
  private readonly binario: string;
  private iniciadoEm = 0;
  private pronto: Promise<void> = Promise.resolve();

  private readonly destino: string;

  constructor(destino: string, opts: Opcoes = {}) {
    super();
    this.destino = destino;
    this.esperaInicial = opts.esperaInicialMs ?? 5_000;
    this.esperaMaxima = opts.esperaMaximaMs ?? 60_000;
    this.folga = opts.folgaMs ?? 20_000;
    this.binario = opts.binario ?? 'ffmpeg';
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
    const ehRtmp = /^rtmps?:\/\//.test(this.destino);
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-re', '-fflags', '+genpts', '-f', 'mpegts', '-i', 'pipe:0',
      '-c', 'copy', '-f', 'flv', '-flvflags', 'no_duration_filesize',
      // RTMP: escrita parada por 15 s (conexão morta sem RST) faz o FFmpeg sair e cair na reconexão
      ...(ehRtmp ? ['-rw_timeout', '15000000'] : ['-y']),
      this.destino,
    ];
    const p = spawn(this.binario, args, { env: AMBIENTE_GPU, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    this.proc = p;
    this.offset = 0;
    this.iniciadoEm = Date.now();
    p.stdin?.on('error', () => {}); // EPIPE quando o processo morre: tratado no fim
    let ultimoErro = '';
    p.stderr?.on('data', (d: Buffer) => {
      ultimoErro = d.toString().trim().split('\n').at(-1) ?? ultimoErro;
    });
    let terminou = false;
    const fim = (codigo: number | null, erro?: Error) => {
      if (terminou) return;
      terminou = true;
      if (this.proc === p) this.proc = null;
      if (this.parando) return;
      if (Date.now() - this.iniciadoEm > ESTAVEL_MS) this.espera = this.esperaInicial;
      const espera = this.espera;
      this.espera = Math.min(this.espera * 2, this.esperaMaxima);
      this.emit('queda', erro ? `ffmpeg não abriu: ${erro.message}` : `ffmpeg saiu (${codigo ?? 'morto'}): ${ultimoErro}`);
      this.pronto = new Promise((ok) => {
        setTimeout(() => {
          if (!this.parando) {
            this.abrir();
            this.emit('reconectou');
          }
          ok();
        }, espera);
      });
    };
    p.on('exit', (codigo) => fim(codigo));
    // spawn falhou (binário sumiu, EMFILE…): sem este listener o Node derruba a live inteira
    p.on('error', (e) => fim(null, e));
  }

  /** Envia um bloco inteiro; resolve quando todos os bytes entraram no transmissor. */
  async enviar(arquivoTs: string, duracao: number): Promise<void> {
    await this.pronto;
    const destino = this.proc;
    if (!destino?.stdin || this.parando) throw new Error('transmissor parado');
    const remux = spawn(
      this.binario,
      ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', arquivoTs, '-map', '0', '-c', 'copy',
        '-output_ts_offset', String(this.offset), '-f', 'mpegts', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    remux.on('error', () => {}); // vira código != 0 no 'close'
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    // 'close', não 'exit': só dispara depois que o stdout do remux esvaziou inteiro no transmissor
    const fim = once(remux, 'close', { signal: ac.signal }).then(([c]) => c as number | null, () => -1);
    const morreu = once(destino, 'exit', { signal: ac.signal }).then(() => 'morreu' as const, () => 'morreu' as const);
    const travou = new Promise<'travou'>((ok) => {
      timer = setTimeout(() => ok('travou'), duracao * 1000 + this.folga);
    });
    remux.stdout.pipe(destino.stdin, { end: false });
    try {
      const r = await Promise.race([fim, morreu, travou]);
      if (r === 'morreu') {
        remux.kill();
        return; // a queda já foi avisada; o próximo envio espera a reconexão
      }
      if (r === 'travou') {
        // saída parada (RTMP pendurado): derruba o transmissor; o 'exit' avisa a queda e agenda a reconexão
        remux.stdout.unpipe(destino.stdin);
        remux.kill();
        if (destino.exitCode === null && destino.signalCode === null) {
          const saiu = once(destino, 'exit');
          destino.kill();
          await saiu;
        }
        return;
      }
      remux.stdout.unpipe(destino.stdin);
      if (r !== 0) throw new Error(`falha ao ler o bloco ${arquivoTs}`);
      this.offset += duracao;
    } finally {
      clearTimeout(timer);
      ac.abort(); // tira os listeners do FFmpeg de vida longa (senão acumulam ~2 por bloco)
    }
  }

  async parar(): Promise<void> {
    this.parando = true;
    const p = this.proc;
    if (!p || p.exitCode !== null) return;
    const saiu = once(p, 'exit');
    p.stdin?.end();
    const timer = setTimeout(() => p.kill(), 15_000);
    await saiu;
    clearTimeout(timer);
  }
}
