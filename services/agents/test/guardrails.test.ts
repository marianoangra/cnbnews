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

test('linha fina: corta na frase, nunca no meio de uma enumeração (caso "meninas, pretas")', async () => {
  const { limitarLinhaFina } = await import('../src/guardrails.ts');
  const real = 'Quase 400 mil crianças e adolescentes brasileiros viviam em união conjugal em 2022, segundo levantamento do UNFPA. Dados revelam perfil de meninas, pretas ou pardas, de baixa renda.';
  const r = limitarLinhaFina(real, 155);
  assert.ok(r.endsWith('UNFPA.'), r);
  assert.ok(!/pretas$/.test(r));
  const semPonto = 'Um texto bem comprido sem ponto final no meio que segue falando de muitas coisas diferentes ao mesmo tempo até passar do limite de tamanho da linha fina do portal';
  const c = limitarLinhaFina(semPonto, 100);
  assert.ok(c.endsWith('…') && c.length <= 101, c);
  assert.equal(limitarLinhaFina('Curta.', 155), 'Curta.');
});

test('categoria: feed de editoria manda; feed geral deixa o modelo decidir', async () => {
  const { categoriaValida } = await import('../src/orquestrador.ts');
  assert.equal(categoriaValida('brasil', 'politica'), 'politica');
  assert.equal(categoriaValida('saude', 'esportes'), 'esportes');
  assert.equal(categoriaValida('esportes', 'brasil'), 'esportes');
  assert.equal(categoriaValida('entrevistas', 'brasil'), 'brasil');
  assert.equal(categoriaValida('inventada', 'brasil'), 'brasil');
  // caso real: festival de cinema classificado como agro pelo modelo
  assert.equal(categoriaValida('agro', 'brasil', 'Mulheres ocupam metade dos filmes concorrentes no Animage 2025'), 'brasil');
  assert.equal(categoriaValida('agro', 'brasil', 'Ministério propõe inclusão de peixe no cardápio; pesca e aquicultura'), 'agro');
  assert.equal(categoriaValida('entretenimento', 'brasil', 'Mulheres ocupam metade dos filmes concorrentes no Animage 2025'), 'entretenimento');
  // tecnologia (leva 2): só com palavra do assunto; "IA" só em maiúsculas; golpe de Estado não é tecnologia
  assert.equal(categoriaValida('tecnologia', 'brasil', 'Com tema Ciência Delas, Semana de Ciência e Tecnologia vai até sábado'), 'tecnologia');
  assert.equal(categoriaValida('tecnologia', 'brasil', 'Governo lança plano nacional de IA para o SUS'), 'tecnologia');
  assert.equal(categoriaValida('tecnologia', 'brasil', 'Ministério da Justiça bloqueia 4 mil celulares em presídios'), 'tecnologia');
  assert.equal(categoriaValida('tecnologia', 'brasil', 'Ele ia para casa quando foi abordado'), 'brasil');
  assert.equal(categoriaValida('tecnologia', 'brasil', 'STF julga réus da trama golpista e do golpe de Estado'), 'brasil');
  assert.equal(categoriaValida('tecnologia', 'politica', 'Projeto de regulação das big techs será votado'), 'politica');
});

test('corrigirMeses: mês em inglês/espanhol vira português, nome de gente fica', async () => {
  const { corrigirMeses } = await import('../src/guardrails.ts');
  assert.equal(corrigirMeses('Decembro sem taxa extra em contas de energia'), 'Dezembro sem taxa extra em contas de energia');
  assert.equal(corrigirMeses('vendas de octubre e de November'), 'vendas de outubro e de Novembro');
  assert.equal(corrigirMeses('Julio Cesar e Junio falam em marcha'), 'Julio Cesar e Junio falam em marcha');
  assert.equal(corrigirMeses('Em dezembro, a Aneel'), 'Em dezembro, a Aneel');
});
