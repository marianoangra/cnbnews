// Ponto de entrada do robô de redação.
//   node src/ciclo.ts                 → 1 ciclo, grava os arquivos (sem git)
//   node src/ciclo.ts --simular       → roda o LLM e mostra o que gravaria, sem gravar
//   node src/ciclo.ts --push          → ao fim, commita SÓ content/noticias e faz push
//   node src/ciclo.ts --loop 30       → repete a cada 30 min (use com --push na rig)
//   --limite N                        → máx. matérias por ciclo (padrão 5)
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { lerGravadas, mancheteRepetida } from './duplicatas.ts';
import { Estado } from './estado.ts';
import { FONTES_RSS } from './fontes.ts';
import { comReserva, configDoAmbiente, criarLlm } from './ollama.ts';
import { maxEntradaPara, processarItem, type Llms } from './orquestrador.ts';
import { gravar } from './publicador.ts';
import { coletarFonte } from './rss.ts';
import type { ItemBruto } from './tipos.ts';

const AGENTS = resolve(import.meta.dirname, '..');
const REPO = resolve(AGENTS, '..', '..');
// OLLAMA_HEAVY_*/OLLAMA_FAST_* (dual-GPU) ou OLLAMA_ENDPOINT/OLLAMA_MODEL antigos — ver .env.example
dotenv.config({ path: join(AGENTS, '.env'), quiet: true });
const DESTINOS = {
  publicadas: join(REPO, 'content', 'noticias'),
  fila: join(AGENTS, 'fila-aprovacao'),
};

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (nome: string) => process.argv.includes(nome);

const log = (...m: unknown[]) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...m);

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
}

// O robo_cnb.py dá push no mesmo checkout. Se o nosso push perder a corrida, o commit
// fica local e sai no próximo ciclo (ou no push do robô de cidades) — nada se perde.
function publicarNoGit(n: number): void {
  git('add', '--', 'content/noticias');
  if (git('diff', '--cached', '--name-only', '--', 'content/noticias')) {
    git('commit', '-m', `noticias: ${n} matéria(s) da redação automática`, '--', 'content/noticias');
  }
  git('fetch', '-q', 'origin');
  if (git('rev-list', '--count', 'origin/main..HEAD') === '0') return;
  git('pull', '--rebase', '--autostash', 'origin', 'main');
  git('push', 'origin', 'HEAD:main');
  log(`git: matérias enviadas (o push publica na Vercel)`);
}

export async function rodarCiclo(): Promise<void> {
  const simular = flag('--simular');
  const limite = Number(arg('--limite')) || 5;
  const estado = new Estado(join(AGENTS, 'estado', 'vistos.json'));
  const cfgHeavy = configDoAmbiente(process.env, 'heavy');
  const cfgFast = configDoAmbiente(process.env, 'fast');
  const heavy = criarLlm(cfgHeavy);
  let avisouFast = false;
  const llms: Llms = {
    heavy,
    // GPU 1 fora do ar → a etapa roda na GPU 0 (avisa uma vez por ciclo)
    fast: comReserva(criarLlm(cfgFast, fetch, 1), heavy, (err) => {
      if (avisouFast) return;
      avisouFast = true;
      log(`GPU rápida (${cfgFast.endpoint}) falhou, usando a pesada —`, err instanceof Error ? err.message.split('\n')[0] : err);
    }),
  };
  const maxEntrada = maxEntradaPara(cfgHeavy.numCtx ?? 4096);
  log(`heavy: ${cfgHeavy.modelo} @ ${cfgHeavy.endpoint} (ctx ${cfgHeavy.numCtx}) · fast: ${cfgFast.modelo} @ ${cfgFast.endpoint} (ctx ${cfgFast.numCtx})`);

  const candidatos: ItemBruto[] = [];
  const vistosNoCiclo = new Set<string>();
  // O que já está gravado (site + fila + aprovadas) manda mais que o estado em JSON: ver duplicatas.ts
  const gravadas = lerGravadas(DESTINOS.publicadas, DESTINOS.fila, join(DESTINOS.fila, 'aprovadas'));
  const linksGravados = new Set(gravadas.map((g) => g.fonteUrl).filter(Boolean));
  for (const fonte of FONTES_RSS) {
    try {
      const itens = await coletarFonte(fonte, { maxIdadeHoras: 24, minCaracteres: 400 });
      for (const it of itens) {
        // o mesmo link aparece em mais de um feed (últimas notícias + editoria)
        if (vistosNoCiclo.has(it.link_original) || !estado.pendente(it.link_original)) continue;
        if (linksGravados.has(it.link_original)) {
          if (!simular) estado.marcar(it.link_original, 'publicada'); // já está no site/fila: não reprocessa
          continue;
        }
        vistosNoCiclo.add(it.link_original);
        candidatos.push(it);
      }
    } catch (err) {
      log(`feed falhou (${fonte.url}):`, err instanceof Error ? err.message : err);
    }
  }
  // mais recentes primeiro
  candidatos.sort((a, b) => b.publicado_em.localeCompare(a.publicado_em));
  log(`${candidatos.length} pauta(s) nova(s); processando até ${limite}`);

  let publicadas = 0;
  let naFila = 0;
  for (const item of candidatos.slice(0, limite)) {
    const t0 = Date.now();
    try {
      const artigo = await processarItem(item, llms, { maxEntrada });
      const repetida = mancheteRepetida(artigo.manchete_home, gravadas);
      if (repetida) {
        log(`repetida, descartada: "${artigo.manchete_home}" ≈ "${repetida.titulo}"`);
        if (!simular) estado.marcar(item.link_original, 'publicada'); // resolvida: não gastar GPU de novo
        continue;
      }
      const r = gravar(artigo, DESTINOS, simular);
      gravadas.push({ titulo: artigo.manchete_home, fonteUrl: item.link_original, quando: Date.now() });
      linksGravados.add(item.link_original);
      const seg = Math.round((Date.now() - t0) / 1000);
      if (r.destino === 'publicada') publicadas += r.novo ? 1 : 0;
      else naFila += r.novo ? 1 : 0;
      log(
        `${r.destino === 'fila' ? 'FILA (aprovação humana)' : 'publicada'} · score ${artigo.score_sensibilidade} · ${seg}s · ${artigo.manchete_home}`,
      );
      if (artigo.motivos_revisao.length) log('   motivos:', artigo.motivos_revisao.join('; '));
      if (simular) log('   →', r.caminho);
      else estado.marcar(item.link_original, r.destino === 'fila' ? 'fila' : 'publicada');
    } catch (err) {
      log(`falhou: ${item.titulo_original} —`, err instanceof Error ? err.message : err);
      if (!simular) estado.marcar(item.link_original, 'falhou');
    }
  }

  if (!simular) {
    estado.salvar();
    if (flag('--push')) {
      try {
        publicarNoGit(publicadas);
      } catch (err) {
        log('git: push falhou, tento de novo no próximo ciclo —', err instanceof Error ? err.message.split('\n')[0] : err);
      }
    }
  }
  log(`fim do ciclo: ${publicadas} publicada(s), ${naFila} na fila de aprovação`);
}

async function main(): Promise<void> {
  const loopMin = Number(arg('--loop'));
  if (!loopMin) return rodarCiclo();
  // limite de deploys do plano Hobby: não rodar com push a menos de 20 min
  const minutos = Math.max(20, loopMin);
  for (;;) {
    try {
      await rodarCiclo();
    } catch (err) {
      log('ciclo abortado:', err);
    }
    await new Promise((r) => setTimeout(r, minutos * 60_000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
