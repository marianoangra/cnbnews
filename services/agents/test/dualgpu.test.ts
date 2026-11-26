import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { comReserva, configDoAmbiente, criarLlm, type Llm } from '../src/ollama.ts';
import { ROTAS, maxEntradaPara, processarItem } from '../src/orquestrador.ts';
import { PROMPT_EDITOR_SEO, PROMPT_LAUDA, PROMPT_REDATOR, PROMPT_REVISOR, PROMPT_TRIAGEM } from '../src/prompts.ts';
import { gravar } from '../src/publicador.ts';
import type { ItemBruto } from '../src/tipos.ts';

const CORPO =
  'Segundo a Agência Brasil, o governo federal vai prorrogar por mais um mês a subvenção ao diesel importado. ' +
  'A decisão busca evitar alta no preço do combustível nas bombas durante dezembro, período de maior demanda no transporte de cargas. ' +
  'O custo estimado é de R$ 1,2 bilhão, de acordo com a equipe econômica.';

const LOCUCAO =
  'Segundo a Agência Brasil, o governo federal vai prorrogar por mais um mês a subvenção ao diesel importado. ' +
  'A medida tenta segurar o preço nas bombas em dezembro.';

const item: ItemBruto = {
  id: 'abc',
  fonte: 'Agência Brasil',
  titulo_original: 'Governo deve renovar subsídio ao diesel por mais 30 dias',
  link_original: 'https://agenciabrasil.ebc.com.br/economia/noticia/x',
  conteudo_bruto: 'A equipe econômica deve prorrogar o subsídio ao diesel. '.repeat(10),
  publicado_em: '2026-11-25T21:11:00.000Z',
  categoria_padrao: 'economia',
};

const NOMES: [string, string][] = [
  [PROMPT_TRIAGEM, 'triagem'],
  [PROMPT_REDATOR, 'redator'],
  [PROMPT_REVISOR, 'revisor'],
  [PROMPT_EDITOR_SEO, 'seo'],
  [PROMPT_LAUDA, 'lauda'],
];

// GPU falsa: responde conforme o system prompt e registra "gpu:etapa".
function gpuFalsa(gpu: string, respostas: Record<string, unknown[]>, log: string[]): Llm {
  const fila = new Map(Object.entries(respostas).map(([k, v]) => [k, [...v]]));
  return {
    async gerarJson(system, _p, validar) {
      const n = NOMES.find(([s]) => s === system)?.[1] ?? '?';
      log.push(`${gpu}:${n}`);
      return validar(fila.get(n)?.shift());
    },
  };
}

const heavyOk = (log: string[]) =>
  gpuFalsa(
    'heavy',
    {
      redator: [{ categoria: 'economia', corpo_artigo_markdown: CORPO }],
      revisor: [{ texto_final_revisado: CORPO, score_risco_juridico: 1 }],
      seo: [{ manchete_home: 'Governo prorroga subsídio ao diesel por mais 30 dias', subtitulo: 'Medida evita alta nas bombas em dezembro' }],
    },
    log,
  );

test('dual-GPU: triagem e lauda na fast, redação/revisão/SEO na heavy, nessa ordem', async () => {
  const log: string[] = [];
  const fast = gpuFalsa(
    'fast',
    {
      triagem: [{ score_sensibilidade: 1, motivos: [] }],
      lauda: [{ texto_locucao: LOCUCAO, texto_gc: 'governo prorroga subsídio ao diesel.', palavras_chave_visuais: ['diesel', 'posto'] }],
    },
    log,
  );
  const a = await processarItem(item, { heavy: heavyOk(log), fast });
  assert.deepEqual(log, ['fast:triagem', 'heavy:redator', 'heavy:revisor', 'heavy:seo', 'fast:lauda']);
  assert.equal(a.requer_aprovacao_humana, false);
  assert.equal(a.lauda_youtube?.texto_gc, 'GOVERNO PRORROGA SUBSÍDIO AO DIESEL');
  assert.ok(a.lauda_youtube!.texto_gc.length <= 45);
  assert.equal(ROTAS.colunista, 'heavy');
});

test('dual-GPU: triagem com score 4 manda pra fila e não gera lauda', async () => {
  const log: string[] = [];
  const fast = gpuFalsa('fast', { triagem: [{ score_sensibilidade: 4, motivos: ['acusação a empresa'] }] }, log);
  const a = await processarItem(item, { heavy: heavyOk(log), fast });
  assert.equal(a.requer_aprovacao_humana, true);
  assert.equal(a.score_sensibilidade, 4);
  assert.equal(a.lauda_youtube, undefined);
  assert.ok(!log.includes('fast:lauda'));
  assert.ok(a.motivos_revisao.includes('triagem: acusação a empresa'));
});

test('dual-GPU: triagem que falha não derruba a matéria', async () => {
  const log: string[] = [];
  const fast = gpuFalsa('fast', { triagem: ['lixo'], lauda: [{ texto_locucao: LOCUCAO, texto_gc: 'DIESEL', palavras_chave_visuais: [] }] }, log);
  const a = await processarItem(item, { heavy: heavyOk(log), fast });
  assert.equal(a.requer_aprovacao_humana, false);
  assert.ok(a.motivos_revisao.some((m) => m.includes('triagem indisponível')));
});

test('dual-GPU: lauda com termo condenatório é descartada, matéria sai sem ela', async () => {
  const log: string[] = [];
  const fast = gpuFalsa(
    'fast',
    {
      triagem: [{ score_sensibilidade: 1 }],
      lauda: [{ texto_locucao: `${LOCUCAO} O empresário é corrupto.`, texto_gc: 'DIESEL', palavras_chave_visuais: [] }],
    },
    log,
  );
  const a = await processarItem(item, { heavy: heavyOk(log), fast });
  assert.equal(a.requer_aprovacao_humana, false);
  assert.equal(a.lauda_youtube, undefined);
});

test('dual-GPU: GPU rápida fora do ar → etapa roda na pesada', async () => {
  const log: string[] = [];
  const morta: Llm = {
    async gerarJson() {
      throw new TypeError('fetch failed (ECONNREFUSED 11435)');
    },
  };
  const heavy = gpuFalsa('heavy', { triagem: [{ score_sensibilidade: 2 }] }, log);
  let avisos = 0;
  const fast = comReserva(morta, heavy, () => avisos++);
  const r = await fast.gerarJson(PROMPT_TRIAGEM, 'x', (x) => x as { score_sensibilidade: number });
  assert.equal(r.score_sensibilidade, 2);
  assert.deepEqual(log, ['heavy:triagem']);
  assert.equal(avisos, 1);
});

test('dual-GPU: config lê HEAVY/FAST e mantém compatibilidade com o .env antigo', () => {
  const f = configDoAmbiente({ OLLAMA_HEAVY_URL: 'http://h:11434/', OLLAMA_FAST_MODEL: 'llama3.2:3b' }, 'fast');
  assert.equal(f.endpoint, 'http://localhost:11435');
  assert.equal(f.modelo, 'llama3.2:3b');
  assert.equal(f.numCtx, 4096);
  const h = configDoAmbiente({ OLLAMA_HEAVY_URL: 'http://h:11434/' }, 'heavy');
  assert.equal(h.endpoint, 'http://h:11434');
  assert.equal(h.modelo, 'qwen2.5:14b-instruct-q4_K_M');
  assert.equal(h.numCtx, 8192);
  const antigo = configDoAmbiente({ OLLAMA_MODEL: 'qwen3:4b', OLLAMA_NUM_CTX: '4096' }, 'heavy');
  assert.equal(antigo.modelo, 'qwen3:4b');
  assert.equal(antigo.numCtx, 4096);
  assert.equal(maxEntradaPara(8192), 9000);
  assert.equal(maxEntradaPara(4096), 4500);
});

test('cliente Ollama: think:false só vai para qwen3', async () => {
  const corpos: Record<string, unknown>[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    corpos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ response: '{}' }), { status: 200 });
  }) as unknown as typeof fetch;
  await criarLlm({ endpoint: 'http://x', modelo: 'qwen3:4b', timeoutMs: 1000 }, f).gerarJson('s', 'p', (x) => x);
  await criarLlm({ endpoint: 'http://x', modelo: 'qwen2.5:14b-instruct-q4_K_M', timeoutMs: 1000 }, f).gerarJson('s', 'p', (x) => x);
  assert.equal(corpos[0].think, false);
  assert.equal('think' in corpos[1], false);
});

test('gravar: lauda vai para o front matter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cnb-'));
  const fast = gpuFalsa(
    'fast',
    {
      triagem: [{ score_sensibilidade: 1 }],
      lauda: [{ texto_locucao: LOCUCAO, texto_gc: 'DIESEL MAIS BARATO', palavras_chave_visuais: ['diesel'] }],
    },
    [],
  );
  const a = await processarItem(item, { heavy: heavyOk([]), fast });
  const md = readFileSync(gravar(a, { publicadas: join(dir, 'p'), fila: join(dir, 'f') }).caminho, 'utf8');
  assert.match(md, /lauda_youtube:\n {2}texto_gc: "DIESEL MAIS BARATO"\n {2}texto_locucao: "Segundo/);
  assert.match(md, /palavras_chave_visuais: \["diesel"\]/);
});
