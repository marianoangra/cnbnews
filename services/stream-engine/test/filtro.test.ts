import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { carregarBloqueio, filtrar } from '../src/filtro.ts';
import type { Materia } from '../src/tipos.ts';

const RESUMO = 'Resumo com tamanho suficiente para ir ao ar na live da CNB News, passando dos oitenta caracteres.';

function m(titulo: string, o: Partial<Materia> = {}): Materia {
  return {
    id: titulo,
    titulo,
    resumo: RESUMO,
    fonte: 'Fonte',
    cidade: 'pelotas',
    publicadaEm: new Date('2026-11-26T12:00:00Z'),
    caminho: '',
    lauda: null,
    ...o,
  };
}

const BLOQUEIO = ['baleada', 'morte', 'prisao em flagrante'];

test('filtrar: matéria de violência sai da live', () => {
  const r = filtrar([m('Adolescente baleada na cabeça pelo ex-companheiro em Pelotas')], BLOQUEIO);
  assert.equal(r.length, 0);
});

test('filtrar: matéria comum fica', () => {
  const r = filtrar([m('MEC promove último aulão do Enem em Pelotas')], BLOQUEIO);
  assert.equal(r.length, 1);
});

test('filtrar: termo no resumo também barra, e expressão de várias palavras funciona', () => {
  const r = filtrar([m('Operação em Pelotas', { resumo: RESUMO + ' Houve prisão em flagrante.' })], BLOQUEIO);
  assert.equal(r.length, 0);
});

test('filtrar: palavra inteira — "amorteceu" não é barrada por "morte"', () => {
  const r = filtrar([m('Prefeitura amorteceu custos da obra')], BLOQUEIO);
  assert.equal(r.length, 1);
});

test('filtrar: resumo com menos de 80 caracteres sai', () => {
  const r = filtrar([m('Notícia curta', { resumo: 'Curto demais.' })], BLOQUEIO);
  assert.equal(r.length, 0);
});

test('filtrar: títulos iguais (sem acento/pontuação) de cidades diferentes ficam só uma vez, a mais nova', () => {
  const velha = m('Detran-RS lança campanha!', { id: 'a', cidade: 'pelotas', publicadaEm: new Date('2026-11-26T10:00:00Z') });
  const nova = m('detran rs lanca campanha', { id: 'b', cidade: 'curitiba', publicadaEm: new Date('2026-11-26T11:00:00Z') });
  const r = filtrar([velha, nova], BLOQUEIO);
  assert.deepEqual(r.map((x) => x.id), ['b']);
});

test('carregarBloqueio: ignora comentários e linhas vazias, normaliza acento', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-bloq-'));
  const arq = join(dir, 'b.txt');
  await writeFile(arq, '# comentário\n\nHomicídio\n  tiroteio  \r\n');
  assert.deepEqual(await carregarBloqueio(arq), ['homicidio', 'tiroteio']);
});
