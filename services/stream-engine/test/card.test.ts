import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  escolherDestaque,
  renderizarConteudo,
  renderizarFundo,
  renderizarTicker,
  renderizarMusica,
  renderizarVinheta,
} from '../src/card.ts';
import type { Materia } from '../src/tipos.ts';

function dimensoesPng(b: Buffer): { w: number; h: number } {
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'não é PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const MATERIA: Materia = {
  id: 'cidades/pelotas/x',
  titulo: 'MEC promove último aulão do Enem em Pelotas',
  resumo: 'O Ministério da Educação realiza neste sábado o último aulão preparatório para o Enem, com entrada gratuita.',
  fonte: 'Agência Brasil',
  cidade: 'pelotas',
  publicadaEm: new Date('2026-11-26T17:10:00Z'),
  caminho: '',
  lauda: null,
};

test('renderizarFundo: PNG 1920x1080', async () => {
  assert.deepEqual(dimensoesPng(await renderizarFundo()), { w: 1920, h: 1080 });
});

test('renderizarConteudo: matéria normal vira PNG 1920x1080', async () => {
  assert.deepEqual(dimensoesPng(await renderizarConteudo(MATERIA)), { w: 1920, h: 1080 });
});

test('renderizarConteudo: manchete enorme com aspas, travessão e emoji não quebra', async () => {
  const titulo = '🚨 “Urgente” — ' + 'Prefeitura anuncia mudança histórica no transporte '.repeat(8);
  const png = await renderizarConteudo({ ...MATERIA, titulo, resumo: MATERIA.resumo.repeat(5), cidade: null });
  assert.deepEqual(dimensoesPng(png), { w: 1920, h: 1080 });
});

test('renderizarTicker: faixa de 110 px de altura com largura positiva', async () => {
  const { png, largura } = await renderizarTicker(['Primeira manchete', 'Segunda manchete']);
  assert.ok(largura > 0);
  const d = dimensoesPng(png);
  assert.equal(d.h, 110);
  assert.equal(d.w, largura);
});

test('renderizarVinheta: PNG 1920x1080', async () => {
  assert.deepEqual(dimensoesPng(await renderizarVinheta('Você está na CNB News')), { w: 1920, h: 1080 });
});

test('escolherDestaque: primeira palavra com 5+ letras ou número', () => {
  assert.equal(escolherDestaque('O dólar bateu R$ 6 na semana'), 'dólar');
  assert.equal(escolherDestaque('Enem 2026 em Pelotas'), '2026');
  assert.equal(escolherDestaque('Ai de mim'), null);
});

test('renderizarMusica: "tocando agora" vira PNG 1920x1080, mesmo com nome enorme', async () => {
  assert.deepEqual(dimensoesPng(await renderizarMusica('Jazz In Paris', 'Media Right Productions')), { w: 1920, h: 1080 });
  assert.deepEqual(dimensoesPng(await renderizarMusica('X'.repeat(300), 'Y'.repeat(300))), { w: 1920, h: 1080 });
});
