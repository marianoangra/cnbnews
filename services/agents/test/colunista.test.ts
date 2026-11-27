import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PAUTAS, alertasDaColuna, escolherPauta, escreverColuna, paraMarkdownColuna, semLinks, validarColuna,
} from '../src/colunista.ts';
import type { Llm } from '../src/ollama.ts';

const corpo = ('## Comece pequeno\n\n' + 'Guardar um pouco todo mês cria o hábito antes do valor. '.repeat(70)).trim();

test('semLinks tira markdown, html e url solta', () => {
  const t = semLinks('Veja [a planilha](https://x.com) e <a href="y">aqui</a> ou https://z.com/a e www.w.com.');
  assert.equal(t.includes('http'), false);
  assert.equal(t.includes('www.'), false);
  assert.match(t, /a planilha/);
  assert.match(t, /aqui/);
});

test('validarColuna recusa coluna curta e aceita a normal', () => {
  assert.throws(() => validarColuna({ manchete: 'Reserva de emergência', subtitulo: 'x'.repeat(80), corpo: 'curto '.repeat(200) }));
  const c = validarColuna({ manchete: 'Reserva de emergência sem mistério.', subtitulo: 'x'.repeat(80), corpo });
  assert.equal(c.manchete.endsWith('.'), false);
});

test('alertas pegam promessa de ganho e investimento específico', () => {
  const a = alertasDaColuna({ manchete: 'Fique rico', subtitulo: 's', corpo: 'Renda garantida com bitcoin, 2% ao mês.' });
  assert.ok(a.some((m) => m.includes('enriquecimento')));
  assert.ok(a.some((m) => m.includes('garantia')));
  assert.ok(a.some((m) => m.includes('investimento')));
  assert.ok(a.some((m) => m.includes('rendimento')));
  assert.deepEqual(alertasDaColuna({ manchete: 'Reserva', subtitulo: 's', corpo }), []);
});

test('escolherPauta pula usadas e alterna temas', () => {
  assert.equal(escolherPauta(new Set())?.tema, 'financas');
  const usadas = new Set([PAUTAS[0].id]);
  assert.notEqual(escolherPauta(usadas)?.tema, 'financas'); // finanças já tem 1 coluna
  assert.equal(escolherPauta(new Set(), 'fe')?.tema, 'fe');
  assert.equal(escolherPauta(new Set(PAUTAS.map((p) => p.id))), undefined);
});

test('markdown sai com produto do tema, autor e sem link no corpo', async () => {
  const llm: Llm = { gerarJson: async (_s, _p, v) => v({ manchete: 'Como montar sua reserva de emergência', subtitulo: 'Um caminho simples para guardar dinheiro mesmo ganhando pouco, sem fórmulas mágicas.', corpo: corpo + '\n\nAcesse https://golpe.com' }) };
  const r = await escreverColuna(llm, PAUTAS[0], '2026-11-27T12:00:00Z');
  assert.match(r.markdown, /^produto: "sai-do-vermelho"$/m);
  assert.match(r.markdown, /^autor: "Rafael Mariano"$/m);
  assert.match(r.markdown, /^pauta: "reserva-emergencia"$/m);
  assert.equal(r.markdown.includes('golpe.com'), false);
  assert.equal(r.arquivo, '2026-11-27-como-montar-sua-reserva-de-emergencia.md');
  assert.match(paraMarkdownColuna(PAUTAS[0], r.coluna, '2026-11-27T12:00:00Z', ['x']), /alertas_revisao:\n {2}- "x"/);
});

test('versículo sempre vira alerta e aspas escapadas são limpas', () => {
  const a = alertasDaColuna({ manchete: 'm', subtitulo: 's', corpo: 'Como diz Provérbios 11:25, ...' });
  assert.ok(a.some((m) => m.includes('versículo')));
  const c = validarColuna({ manchete: 'Reserva de emergência', subtitulo: 'x'.repeat(80), corpo: corpo + ' Ele disse: \\"oi\\".' });
  assert.equal(c.corpo.includes('\\'), false);
  assert.match(c.corpo, /"oi"/);
});
