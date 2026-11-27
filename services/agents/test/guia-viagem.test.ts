import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  alertasDoGuia, buscarVerbete, cidadesComGuia, cidadesDoPortal, escolherTrechos, numerosForaDaFonte,
  paraMarkdownGuia, trechosCopiados, validarGuia,
} from '../src/guia-viagem.ts';
import { listarFila, moverParaSite, urlPublica } from '../src/admin/fila.ts';

const EXTRATO = `Paraty é um município brasileiro do estado do Rio de Janeiro. Fundada em 1667, tem cerca de 45 mil habitantes.

== História ==
A cidade foi porto do ouro de Minas Gerais no século XVIII e guarda casario colonial preservado em todo o centro histórico.

== Política ==
A prefeitura é dividida em várias secretarias municipais que cuidam da administração do município inteiro.

== Turismo ==
A Festa Literária Internacional de Paraty atrai visitantes. A baía tem mais de 60 ilhas e praias de águas calmas para passeios de barco.

== Referências ==
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;

test('guia: escolhe introdução + seções de viagem e deixa política/referências de fora', () => {
  const t = escolherTrechos(EXTRATO);
  assert.match(t, /^Paraty é um município/);
  assert.match(t, /## História/);
  assert.match(t, /## Turismo/);
  assert.doesNotMatch(t, /Política|secretarias|Referências/);
  assert.ok(escolherTrechos(EXTRATO, 200).length <= 200);
});

test('guia: números fora da fonte e trechos copiados viram alerta', () => {
  assert.deepEqual(numerosForaDaFonte('Fundada em 1667, com 60 ilhas e 45 mil moradores', EXTRATO), []);
  assert.deepEqual(numerosForaDaFonte('A cidade tem 120 praias e foi fundada em 1650', EXTRATO), ['120', '1650']);
  const copia = 'A cidade foi porto do ouro de Minas Gerais no século XVIII e guarda casario colonial preservado em todo o centro histórico.';
  assert.ok(trechosCopiados(copia, EXTRATO) >= 1);
  assert.equal(trechosCopiados('Texto totalmente novo escrito com outras palavras sobre a visita à cidade litorânea.', EXTRATO), 0);
  const g = { manchete: 'O que fazer em Paraty', subtitulo: 'x'.repeat(100), corpo: 'Entrada a R$ 30 no hotel Fulano, 99 quartos. ' + 'palavra '.repeat(400) };
  const a = alertasDoGuia(g, { titulo: 'Paraty', url: 'u', texto: EXTRATO });
  assert.ok(a.some((x) => /números que não estão/.test(x) && x.includes('99')));
  assert.ok(a.some((x) => /preço, horário/.test(x)));
});

test('guia: validação recusa texto curto e o Markdown credita a Wikipédia', () => {
  assert.throws(() => validarGuia({ manchete: 'O que fazer em Paraty', subtitulo: 'y'.repeat(80), corpo: 'curto '.repeat(240) }));
  const g = validarGuia({ manchete: 'O que fazer em Paraty.', subtitulo: 'y'.repeat(80), corpo: '# Título\n\n' + 'Veja [isto](https://x.com) '.repeat(300) });
  assert.equal(g.manchete, 'O que fazer em Paraty');
  const md = paraMarkdownGuia({ slug: 'paraty', nome: 'Paraty', uf: 'RJ' }, { titulo: 'Paraty', url: 'https://pt.wikipedia.org/wiki/Paraty', texto: '' }, g, '2026-11-27T15:00:00Z', ['conferir']);
  assert.match(md, /^cidade: "paraty"$/m);
  assert.match(md, /^fonte_url: "https:\/\/pt\.wikipedia\.org\/wiki\/Paraty"$/m);
  assert.match(md, /^licenca_texto: "CC BY-SA 4.0"$/m);
  assert.match(md, /alertas_revisao:\n {2}- "conferir"/);
  assert.doesNotMatch(md, /https:\/\/x\.com|^# Título/m);
});

test('guia: verbete do município certo ("Lorena (São Paulo)", não a do Peru)', async () => {
  const pedidos: string[] = [];
  const f = (async (u: string) => {
    const t = new URL(u).searchParams.get('titles')!;
    pedidos.push(t);
    const extract = t === 'Lorena (São Paulo)'
      ? 'Lorena é um município brasileiro do estado de São Paulo.\n\n== História ==\n' + 'Fundada às margens do rio Paraíba. '.repeat(10)
      : 'Lorena é uma cidade do Peru.';
    return new Response(JSON.stringify({ query: { pages: { 1: { title: t, extract } } } }));
  }) as typeof fetch;
  const v = await buscarVerbete({ slug: 'lorena', nome: 'Lorena', uf: 'SP' }, f);
  assert.equal(v?.titulo, 'Lorena (São Paulo)');
  assert.equal(v?.url, 'https://pt.wikipedia.org/wiki/Lorena_(S%C3%A3o_Paulo)');
  assert.deepEqual(pedidos, ['Lorena (São Paulo)']);
  const peru = await buscarVerbete({ slug: 'x', nome: 'Lorena', uf: 'MG' }, f);
  assert.equal(peru, undefined);
});

test('guia: cidades do portal e fila "viagens" no painel', () => {
  const repo = mkdtempSync(join(tmpdir(), 'guia-'));
  for (const [s, t] of [['paraty', 'Paraty (RJ)'], ['lorena', 'Lorena (SP)']]) {
    mkdirSync(join(repo, 'content', 'cidades', s), { recursive: true });
    writeFileSync(join(repo, 'content', 'cidades', s, '_index.md'), `---\ntitle: "${t}"\n---\n`);
  }
  assert.deepEqual(cidadesDoPortal(repo), [{ slug: 'lorena', nome: 'Lorena', uf: 'SP' }, { slug: 'paraty', nome: 'Paraty', uf: 'RJ' }]);
  const fila = join(repo, 'services', 'agents', 'fila-aprovacao', 'viagens');
  mkdirSync(fila, { recursive: true });
  mkdirSync(join(repo, 'content', 'viagens'), { recursive: true });
  writeFileSync(join(fila, 'paraty.md'), '---\ntitle: "O que fazer em Paraty"\ndate: 2026-11-27T10:00:00-03:00\nalertas_revisao:\n  - "conferir"\ndraft: false\n---\n\nTexto.\n');
  assert.deepEqual([...cidadesComGuia(fila, join(repo, 'content', 'viagens'))], ['paraty']);
  const itens = listarFila({ repo });
  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 'viagens/paraty.md');
  assert.deepEqual(itens[0].motivos, ['conferir']);
  const r = moverParaSite({ repo }, 'viagens/paraty.md', undefined, '2026-11-27T15:00:00Z');
  assert.equal(r.url, 'https://news.cnbmobile.com/viagens/paraty/');
  assert.equal(urlPublica('viagens', 'paraty.md'), 'https://news.cnbmobile.com/viagens/paraty/');
  assert.deepEqual([...cidadesComGuia(fila, join(repo, 'content', 'viagens'))], ['paraty']);
});
