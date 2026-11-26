import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { criarLlm, type Llm } from '../src/ollama.ts';
import { processarItem } from '../src/orquestrador.ts';
import { PROMPT_EDITOR_SEO, PROMPT_REDATOR, PROMPT_REVISOR } from '../src/prompts.ts';
import { dataBrt, gravar } from '../src/publicador.ts';
import { coletarFonte, extrairItens, htmlParaTexto, limparRelacionadas } from '../src/rss.ts';
import type { ItemBruto } from '../src/tipos.ts';

const CORPO =
  'Segundo a Agência Brasil, o governo federal vai prorrogar por mais um mês a subvenção ao diesel importado. ' +
  'A decisão busca evitar alta no preço do combustível nas bombas durante dezembro, período de maior demanda no transporte de cargas. ' +
  'O custo estimado é de R$ 1,2 bilhão, de acordo com a equipe econômica.';

const item: ItemBruto = {
  id: 'abc',
  fonte: 'Agência Brasil',
  titulo_original: 'Governo deve renovar subsídio ao diesel por mais 30 dias',
  link_original: 'https://agenciabrasil.ebc.com.br/economia/noticia/x',
  conteudo_bruto: 'A equipe econômica deve prorrogar o subsídio ao diesel. '.repeat(10),
  publicado_em: '2026-11-25T21:11:00.000Z',
  categoria_padrao: 'economia',
};

// Ollama falso: responde conforme o system prompt de cada agente.
function llmFalso(respostas: Record<string, unknown[]>): Llm & { chamadas: string[] } {
  const chamadas: string[] = [];
  const fila = new Map(Object.entries(respostas).map(([k, v]) => [k, [...v]]));
  const nome = (s: string) =>
    s === PROMPT_REDATOR ? 'redator' : s === PROMPT_REVISOR ? 'revisor' : s === PROMPT_EDITOR_SEO ? 'seo' : '?';
  return {
    chamadas,
    async gerarJson(system, _prompt, validar) {
      const n = nome(system);
      chamadas.push(n);
      const r = fila.get(n)?.shift();
      return validar(r);
    },
  };
}

test('esteira completa: redator → revisor → SEO gera matéria publicável', async () => {
  const llm = llmFalso({
    redator: [{ categoria: 'economia', urgencia: 'normal', corpo_artigo_markdown: CORPO, fontes_creditadas: ['Agência Brasil'] }],
    revisor: [{ texto_final_revisado: CORPO, score_risco_juridico: 1, requer_aprovacao_humana: false, alertas_ao_editor: [] }],
    seo: [{ manchete_home: 'Governo prorroga subsídio ao diesel por mais 30 dias', subtitulo: 'Medida evita alta nas bombas em dezembro' }],
  });
  const a = await processarItem(item, llm);
  // com um Llm só, triagem e lauda caem no mesmo modelo ('?' = sem resposta no falso)
  assert.deepEqual(llm.chamadas, ['?', 'redator', 'revisor', 'seo', '?']);
  assert.equal(a.requer_aprovacao_humana, false);
  assert.equal(a.slug, 'governo-prorroga-subsidio-ao-diesel-por-mais-30-dias');
  assert.equal(a.categoria, 'economia');
  assert.equal(a.autor_atribuicao, 'Redação CNB News (Editor-Chefe: Rafael Mariano)');
});

test('manchete longa: pede de novo ao SEO e, se insistir, corta em 70', async () => {
  const longa = 'Governo federal confirma prorrogação do subsídio ao diesel importado por mais trinta dias corridos';
  const llm = llmFalso({
    redator: [{ categoria: 'inventada', corpo_artigo_markdown: CORPO }],
    revisor: [{ texto_final_revisado: CORPO, score_risco_juridico: '2' }],
    seo: [
      { manchete_home: longa, subtitulo: 'Linha fina de teste' },
      { manchete_home: longa, subtitulo: 'Linha fina de teste' },
    ],
  });
  const a = await processarItem(item, llm);
  assert.deepEqual(llm.chamadas, ['?', 'redator', 'revisor', 'seo', 'seo', '?']);
  assert.ok(a.manchete_home.length <= 70);
  assert.equal(a.categoria, 'economia', 'categoria fora da lista cai na padrão da fonte');
});

test('revisor que devolve o texto do molde: segue o texto do redator, com alerta', async () => {
  const llm = llmFalso({
    redator: [{ categoria: 'economia', corpo_artigo_markdown: CORPO }],
    revisor: [{ texto_final_revisado: 'matéria integral corrigida em Markdown', score_risco_juridico: 1, alertas_ao_editor: ['...'] }],
    seo: [{ manchete_home: 'Governo prorroga subsídio ao diesel por mais 30 dias', subtitulo: 'Medida evita alta nas bombas em dezembro' }],
  });
  const a = await processarItem(item, llm);
  assert.equal(a.corpo_artigo_md.startsWith(CORPO), true);
  assert.ok(a.motivos_revisao.some((m) => m.includes('texto do redator')));
  assert.ok(!a.motivos_revisao.some((m) => m.includes('...')));
});

test('manchete com texto do molde é rejeitada', async () => {
  const llm = llmFalso({
    redator: [{ corpo_artigo_markdown: CORPO }],
    revisor: [{ texto_final_revisado: CORPO, score_risco_juridico: 1 }],
    seo: [{ manchete_home: 'título (máx 70 caracteres)', subtitulo: 'linha fina (máx 155 caracteres)' }],
  });
  await assert.rejects(processarItem(item, llm), /molde/);
});

test('resposta inválida do modelo derruba a matéria (não publica lixo)', async () => {
  const llm = llmFalso({ redator: [{ corpo_artigo_markdown: 'curto' }] });
  await assert.rejects(processarItem(item, llm), /corpo_artigo_markdown/);
});

test('cliente Ollama: tenta de novo quando o JSON vem quebrado', async () => {
  let n = 0;
  const fetchFalso = (async () => {
    n++;
    const response = n === 1 ? '{quebrado' : '{"ok":"sim"}';
    return new Response(JSON.stringify({ response }), { status: 200 });
  }) as typeof fetch;
  const llm = criarLlm({ endpoint: 'http://x', modelo: 'm', timeoutMs: 1000 }, fetchFalso);
  const r = await llm.gerarJson('s', 'p', (x) => x as { ok: string });
  assert.equal(r.ok, 'sim');
  assert.equal(n, 2);
});

test('gravar: aprovada vai para content/noticias, sensível vai para a fila', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cnb-'));
  const destinos = { publicadas: join(dir, 'noticias'), fila: join(dir, 'fila') };
  const llm = llmFalso({
    redator: [{ corpo_artigo_markdown: CORPO }],
    revisor: [{ texto_final_revisado: CORPO, score_risco_juridico: 1 }],
    seo: [{ manchete_home: 'Governo prorroga subsídio ao diesel', subtitulo: 'Linha fina "com aspas"' }],
  });
  const a = await processarItem(item, llm);
  const r = gravar(a, destinos);
  assert.equal(r.destino, 'publicada');
  assert.ok(r.caminho.startsWith(destinos.publicadas));
  const md = readFileSync(r.caminho, 'utf8');
  assert.match(md, /^---\ntitle: "Governo prorroga subsídio ao diesel"\n/);
  assert.match(md, /description: "Linha fina \\"com aspas\\""/);
  assert.match(md, /date: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-03:00/);
  assert.equal(gravar(a, destinos).novo, false, 'não sobrescreve');

  const r2 = gravar({ ...a, slug: 'outra', requer_aprovacao_humana: true, motivos_revisao: ['crime violento'] }, destinos);
  assert.equal(r2.destino, 'fila');
  assert.match(readFileSync(r2.caminho, 'utf8'), /motivos_revisao:\n {2}- "crime violento"/);
});

test('data no fuso de Brasília vira o dia certo', () => {
  assert.deepEqual(dataBrt('2026-11-26T01:30:00.000Z'), { dia: '2026-11-25', carimbo: '2026-11-25T22:30:00-03:00' });
});

const XML = `<?xml version="1.0"?><rss><channel>
<item><title>Subsídio &amp; diesel</title><link>https://ab.ebc/x1</link>
<pubDate>Wed, 25 Nov 2026 18:11:00 -0300</pubDate>
<description>&lt;p&gt;Primeiro &lt;strong&gt;parágrafo&lt;/strong&gt; ${'texto '.repeat(100)}&lt;/p&gt;&lt;p&gt;Segundo&amp;nbsp;parágrafo&lt;/p&gt;</description></item>
<item><title><![CDATA[Velha]]></title><link>https://ab.ebc/x2</link><pubDate>Mon, 01 Jan 2024 10:00:00 -0300</pubDate>
<description><![CDATA[<p>${'antiga '.repeat(100)}</p>]]></description></item>
</channel></rss>`;

test('RSS: decodifica entidades e HTML', () => {
  const [a] = extrairItens(XML);
  assert.equal(a.title, 'Subsídio & diesel');
  const t = htmlParaTexto(a.description);
  assert.match(t, /^Primeiro parágrafo texto/);
  assert.match(t, /\n\nSegundo parágrafo$/);
});

test('RSS: remove bloco de notícias relacionadas', () => {
  const longo = 'A previsão foi anunciada nesta quarta-feira pelo ministro durante entrevista coletiva sobre a liberação de recursos do Orçamento federal.';
  const t = limparRelacionadas(`Primeiro parágrafo.\n\nNotícias relacionadas:\n\nTítulo curto um.\n\nTítulo curto dois.\n\n${longo}`);
  assert.equal(t, `Primeiro parágrafo.\n\n${longo}`);
});

test('RSS: coleta descarta itens velhos', async () => {
  const fetchFalso = (async () => new Response(XML, { status: 200 })) as typeof fetch;
  const itens = await coletarFonte(
    { nome: 'Agência Brasil', url: 'http://x', categoria_padrao: 'economia' },
    { maxIdadeHoras: 24, minCaracteres: 100, agora: new Date('2026-11-25T23:00:00-03:00'), fetchImpl: fetchFalso },
  );
  assert.equal(itens.length, 1);
  assert.equal(itens[0].link_original, 'https://ab.ebc/x1');
  assert.equal(itens[0].publicado_em, '2026-11-25T21:11:00.000Z');
});
