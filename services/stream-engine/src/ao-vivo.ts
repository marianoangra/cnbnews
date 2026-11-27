/**
 * Live 24h da CNB News. Uso:
 *   npm run ao-vivo                 → transmite para o YouTube (YOUTUBE_STREAM_KEY no .env)
 *   DESTINO=data/teste.flv npm run ao-vivo -- --por 180   → teste local por 3 min
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { garantirInstitucional, listarBlocos } from './fabrica.ts';
import { gpuConfigurada, listarGpus, temNvenc } from './ffmpeg.ts';
import { EdgeLocutor } from './locutor.ts';
import { CAMINHOS, cicloProducao, listarTrilhas } from './producao.ts';
import { Programador } from './programador.ts';
import { Transmissor } from './transmissor.ts';

const INTERVALO_PRODUCAO_MS = 5 * 60_000;
const NOVOS_POR_CICLO = 20;
const BUFFER_MINIMO_MIN = 15;

function log(msg: string): void {
  console.log(`[${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ${msg}`);
}

function destino(): string {
  if (process.env.DESTINO) return process.env.DESTINO;
  const chave = process.env.YOUTUBE_STREAM_KEY?.trim();
  if (!chave) {
    console.error('Falta YOUTUBE_STREAM_KEY no .env (ou DESTINO para testar sem YouTube). Veja o README.');
    process.exit(1);
  }
  return `rtmp://a.rtmp.youtube.com/live2/${chave}`;
}

const alvo = destino();
const por = process.argv.indexOf('--por');
const limiteS = por >= 0 ? Number(process.argv[por + 1]) : Infinity;

const gpu = gpuConfigurada();
const gpus = await listarGpus();
if (gpus.length <= gpu || !(await temNvenc(gpu))) {
  console.error(`GPU ${gpu} (FFMPEG_GPU_DEVICE) não existe ou não abre o NVENC. GPUs vistas pelo nvidia-smi:\n${gpus.join('\n') || '(nenhuma)'}`);
  process.exit(1);
}
log(`NVENC na GPU ${gpu}: ${gpus[gpu]}`);

const locutor = new EdgeLocutor();
await mkdir(CAMINHOS.blocos, { recursive: true });
await mkdir(CAMINHOS.fixos, { recursive: true });
await garantirInstitucional(CAMINHOS.fixos, locutor, await listarTrilhas(), { gpu });

const status = { noAr: '', desde: '', quedas: 0, minutosProntos: 0, ultimaGeracao: null as null | object, destino: alvo.replace(/live2\/.+$/, 'live2/***') };
async function gravarStatus(): Promise<void> {
  await mkdir(dirname(CAMINHOS.status), { recursive: true });
  await writeFile(CAMINHOS.status, JSON.stringify(status, null, 2)).catch(() => {});
}

let encerrando = false;

// Produção: independente da exibição; erro num ciclo não derruba a live.
void (async () => {
  while (!encerrando) {
    try {
      const r = await cicloProducao(locutor, gpu, NOVOS_POR_CICLO);
      status.ultimaGeracao = { ...r, em: new Date().toISOString() };
      log(`produção: ${r.gerados} novos, ${r.falhas} falhas, ${r.apagados} apagados, ${r.aprovadas} aprovadas${r.sincronizou ? '' : ' (sem sincronizar)'}`);
    } catch (e) {
      log(`produção falhou: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((ok) => setTimeout(ok, INTERVALO_PRODUCAO_MS));
  }
})();

const tx = new Transmissor(alvo);
tx.on('queda', (motivo: string) => {
  status.quedas++;
  log(`⚠ QUEDA: ${motivo}`);
});
tx.on('reconectou', () => log('transmissão reconectada'));
tx.iniciar();

const programador = new Programador();
const inicio = Date.now();
let bufferBaixo = false;

async function encerrar(): Promise<void> {
  if (encerrando) return;
  encerrando = true;
  log('encerrando…');
  await tx.parar();
  await gravarStatus();
  process.exit(0);
}
process.on('SIGINT', () => void encerrar());
process.on('SIGTERM', () => void encerrar());

log(`no ar → ${status.destino}`);
while (!encerrando && (Date.now() - inicio) / 1000 < limiteS) {
  const blocos = await listarBlocos([CAMINHOS.blocos, CAMINHOS.fixos]);
  const agora = new Date();
  if (blocos.length === 0) {
    // fixos sumiram ou ainda não existem: refaz e espera, em vez de derrubar a live
    log('⚠ nenhum bloco disponível; tentando de novo em 5 s');
    await garantirInstitucional(CAMINHOS.fixos, locutor, await listarTrilhas(), { gpu })
      .catch((e) => log(`fixos: ${e instanceof Error ? e.message : e}`));
    await new Promise((ok) => setTimeout(ok, 5_000));
    continue;
  }
  const b = programador.proximo(blocos, agora);
  status.noAr = b.id;
  status.desde = agora.toISOString();
  status.minutosProntos = Math.round(programador.minutosProntosAFrente(blocos, agora));
  const baixo = status.minutosProntos < BUFFER_MINIMO_MIN;
  if (baixo !== bufferBaixo) log(baixo ? `⚠ buffer baixo: ${status.minutosProntos} min de notícia pronta` : `buffer ok: ${status.minutosProntos} min`);
  bufferBaixo = baixo;
  await gravarStatus();
  try {
    await tx.enviar(b.arquivo, b.duracao);
  } catch (e) {
    log(`bloco pulado (${b.id}): ${e instanceof Error ? e.message : e}`);
  }
  programador.registrarExibicao(b.id, agora, b);
}
await encerrar();
