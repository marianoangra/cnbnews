import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarGuardrails,
  CLAUSULA_CONTRADITORIO,
  limitarManchete,
  similaridade,
  slugificar,
  type EntradaGuardrails,
} from '../src/guardrails.ts';

const base = (o: Partial<EntradaGuardrails>): EntradaGuardrails => ({
  manchete: 'Governo prorroga subsídio ao diesel por mais 30 dias',
  subtitulo: 'Medida vale a partir de dezembro, informou o Ministério da Fazenda',
  corpo: 'Segundo a Agência Brasil, o governo federal decidiu prorrogar o subsídio ao óleo diesel por mais trinta dias.',
  fonte: 'Agência Brasil',
  textoOriginal: 'A equipe econômica deve prorrogar o subsídio.',
  scoreLlm: 1,
  llmPediuHumano: false,
  ...o,
});

test('matéria cotidiana passa limpa e sem cláusulas extras', () => {
  const r = aplicarGuardrails(base({}));
  assert.equal(r.score, 1);
  assert.equal(r.requerHumano, false);
  assert.deepEqual(r.motivos, []);
  assert.ok(!r.corpoFinal.includes(CLAUSULA_CONTRADITORIO));
});

test('termo condenatório vai para aprovação humana (presunção de inocência)', () => {
  const r = aplicarGuardrails(base({ corpo: 'Segundo a Agência Brasil, o prefeito corrupto foi afastado.' }));
  assert.equal(r.score, 5);
  assert.equal(r.requerHumano, true);
});

test('acentos não escapam da trava ("ladrão")', () => {
  assert.equal(aplicarGuardrails(base({ manchete: 'Ladrão invade loja no centro' })).requerHumano, true);
});

test('menor + crime na mesma frase dispara ECA', () => {
  const r = aplicarGuardrails(base({ corpo: 'Segundo a Agência Brasil, um adolescente foi apreendido após o roubo.' }));
  assert.equal(r.score, 5);
  assert.ok(r.motivos.some((m) => m.includes('ECA')));
});

test('menor fora de contexto de crime não dispara ECA', () => {
  const r = aplicarGuardrails(base({ corpo: 'Segundo a Agência Brasil, as crianças voltam às aulas na segunda-feira.' }));
  assert.equal(r.requerHumano, false);
});

test('investigação recebe cláusula de contraditório e não duplica', () => {
  const corpo = 'Segundo a Agência Brasil, o empresário é investigado pela Polícia Federal.';
  const r1 = aplicarGuardrails(base({ corpo }));
  assert.ok(r1.corpoFinal.includes(CLAUSULA_CONTRADITORIO));
  const r2 = aplicarGuardrails(base({ corpo: r1.corpoFinal }));
  assert.equal(r2.corpoFinal.split(CLAUSULA_CONTRADITORIO).length, 2);
});

test('corrupção (sem condenação) exige aprovação humana', () => {
  const r = aplicarGuardrails(base({ corpo: 'Segundo a Agência Brasil, a operação apura desvio de recursos da saúde.' }));
  assert.ok(r.score >= 4);
  assert.equal(r.requerHumano, true);
});

test('fonte ausente no corpo é acrescentada', () => {
  const r = aplicarGuardrails(base({ corpo: 'O governo decidiu prorrogar o subsídio ao diesel.' }));
  assert.match(r.corpoFinal, /Com informações da Agência Brasil/);
});

test('clickbait na manchete vai para aprovação humana', () => {
  assert.equal(aplicarGuardrails(base({ manchete: 'Você não vai acreditar no preço do diesel' })).requerHumano, true);
});

test('score alto do revisor LLM é respeitado', () => {
  assert.equal(aplicarGuardrails(base({ scoreLlm: 4 })).requerHumano, true);
  assert.equal(aplicarGuardrails(base({ llmPediuHumano: true })).requerHumano, true);
});

test('cópia da fonte é detectada', () => {
  const original =
    'A equipe econômica deve prorrogar por mais trinta dias o subsídio ao óleo diesel importado, segundo fontes do Ministério da Fazenda ouvidas nesta quarta-feira.';
  assert.ok(similaridade(original, original) > 0.9);
  const r = aplicarGuardrails(base({ corpo: `Segundo a Agência Brasil, ${original}`, textoOriginal: original }));
  assert.equal(r.requerHumano, true);
  assert.ok(r.motivos.some((m) => m.includes('igual à fonte')));
});

test('slug sem acento, minúsculo e curto', () => {
  assert.equal(slugificar('Câmara aprova reforma: o que muda?'), 'camara-aprova-reforma-o-que-muda');
  assert.ok(slugificar('palavra '.repeat(30)).length <= 60);
});

test('manchete cortada na palavra, dentro do limite', () => {
  const m = limitarManchete('Governo federal anuncia prorrogação do subsídio ao diesel importado por mais trinta dias');
  assert.ok(m.length <= 70);
  assert.ok(!m.endsWith(' '));
  assert.ok('Governo federal anuncia prorrogação do subsídio ao diesel importado por mais trinta dias'.startsWith(m));
});
