import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EdgeLocutor, ErroLocucao, textoLocucao } from '../src/locutor.ts';
import type { Materia } from '../src/tipos.ts';

const BASE: Materia = {
  id: 'x',
  titulo: 'Pelotas oferece serviço online para a Carteira de Identidade',
  resumo: 'Moradores podem pedir o documento pelo portal rs.gov.br https://rs.gov.br/servicos sem custo 🚀',
  fonte: 'RS.GOV.BR',
  cidade: 'pelotas',
  publicadaEm: new Date(),
  caminho: '',
  lauda: null,
};

test('textoLocucao: título + resumo + fonte + chamada, sem URL nem emoji', () => {
  const t = textoLocucao(BASE);
  assert.ok(t.startsWith('Pelotas oferece serviço online para a Carteira de Identidade. Moradores podem'));
  assert.ok(t.includes('Fonte: RS.GOV.BR.'));
  assert.ok(t.endsWith('Mais em cnbmobile ponto com.'));
  assert.ok(!t.includes('https://'));
  assert.ok(!t.includes('🚀'));
  assert.ok(!/\.\./.test(t), 'não pode ter ponto duplo');
});

test('textoLocucao: com lauda, usa a locução do robô e não repete o título', () => {
  const t = textoLocucao({
    ...BASE,
    lauda: { textoGc: 'X', textoLocucao: 'O dólar fechou em alta nesta quarta', palavrasChaveVisuais: [] },
  });
  assert.ok(t.startsWith('O dólar fechou em alta nesta quarta.'));
  assert.ok(!t.includes('Pelotas oferece'));
  assert.ok(t.endsWith('Fonte: RS.GOV.BR. Mais em cnbmobile ponto com.'));
});

test('EdgeLocutor: falha do sintetizador vira ErroLocucao', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tts-'));
  const loc = new EdgeLocutor({
    sintetizar: async () => {
      throw new Error('sem internet');
    },
  });
  await assert.rejects(loc.falar('Teste.', join(dir, 'a.mp3')), ErroLocucao);
});

test('EdgeLocutor: sintetizador que não grava nada vira ErroLocucao', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tts-'));
  const loc = new EdgeLocutor({ sintetizar: async () => {} });
  await assert.rejects(loc.falar('Teste.', join(dir, 'a.mp3')), ErroLocucao);
});

test('EdgeLocutor: sintetizador que trava estoura o tempo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tts-'));
  const loc = new EdgeLocutor({ sintetizar: () => new Promise(() => {}), timeoutMs: 200 });
  await assert.rejects(loc.falar('Teste.', join(dir, 'a.mp3')), ErroLocucao);
});

test('EdgeLocutor: voz real gera MP3 (precisa de internet)', { skip: process.env.SEM_REDE === '1' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-tts-'));
  const saida = join(dir, 'voz.mp3');
  await new EdgeLocutor().falar('Teste da CNB News.', saida);
  assert.ok((await stat(saida)).size > 5_000);
});
