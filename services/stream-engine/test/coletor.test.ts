import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { coletar, horaBrasilia } from '../src/coletor.ts';
import { nomeCidade } from '../src/cidades.ts';

const AGORA = new Date('2026-11-26T15:00:00-03:00');

function md(campos: Record<string, string>, extra = ''): string {
  const linhas = Object.entries(campos).map(([k, v]) => `${k}: "${v}"`);
  return `---\n${linhas.join('\n')}\n${extra}---\n\nCorpo da matéria que não vai ao ar.\n`;
}

async function repoFixture(): Promise<string> {
  const raiz = await mkdtemp(join(tmpdir(), 'cnb-coletor-'));
  const pel = join(raiz, 'content', 'cidades', 'pelotas');
  const nac = join(raiz, 'content', 'noticias');
  await mkdir(pel, { recursive: true });
  await mkdir(nac, { recursive: true });
  await writeFile(join(pel, '_index.md'), '---\ntitle: "Pelotas"\n---\n');
  await writeFile(
    join(pel, '2026-11-26-mec-aulao.md'),
    md({ title: 'MEC promove aulão do Enem em Pelotas', date: '2026-11-26T13:00:00-03:00', description: 'Resumo de Pelotas', fonte: 'Prefeitura' }),
  );
  await writeFile(
    join(pel, '2026-11-24-antiga.md'),
    md({ title: 'Matéria antiga', date: '2026-11-24T13:00:00-03:00', description: 'Velha', fonte: 'X' }),
  );
  await writeFile(
    join(nac, '2026-11-26-dolar.md'),
    md(
      { title: 'Dólar fecha em alta', date: '2026-11-26T05:00:00-03:00', description: 'Resumo nacional', fonte: 'Agência Brasil' },
      'lauda_youtube:\n  texto_gc: "DÓLAR FECHA EM ALTA"\n  texto_locucao: "O dólar fechou em alta nesta quarta."\n  palavras_chave_visuais: ["dólar", "câmbio"]\n',
    ),
  );
  await writeFile(
    join(nac, '2026-11-26-lauda-incompleta.md'),
    md(
      { title: 'Selic mantida', date: '2026-11-26T04:00:00-03:00', description: 'Resumo Selic', fonte: 'Agência Brasil' },
      'lauda_youtube:\n  texto_gc: "SELIC MANTIDA"\n',
    ),
  );
  return raiz;
}

test('coletar: janela de 48 h, mais nova primeiro, ignora _index', async () => {
  const ms = await coletar(await repoFixture(), AGORA);
  assert.deepEqual(
    ms.map((m) => m.titulo),
    ['MEC promove aulão do Enem em Pelotas', 'Dólar fecha em alta', 'Selic mantida'],
  );
});

test('coletar: cidade vem da pasta, nacional é null, resumo = description', async () => {
  const [pel, nac] = await coletar(await repoFixture(), AGORA);
  assert.equal(pel.cidade, 'pelotas');
  assert.equal(pel.resumo, 'Resumo de Pelotas');
  assert.equal(pel.fonte, 'Prefeitura');
  assert.equal(pel.id, 'cidades/pelotas/2026-11-26-mec-aulao');
  assert.equal(nac.cidade, null);
});

test('coletar: lauda_youtube completa vira lauda; ausente ou incompleta = null', async () => {
  const [pel, dolar, selic] = await coletar(await repoFixture(), AGORA);
  assert.equal(pel.lauda, null);
  assert.deepEqual(dolar.lauda, {
    textoGc: 'DÓLAR FECHA EM ALTA',
    textoLocucao: 'O dólar fechou em alta nesta quarta.',
    palavrasChaveVisuais: ['dólar', 'câmbio'],
  });
  assert.equal(selic.lauda, null);
});

test('coletar: repo sem pasta content devolve lista vazia', async () => {
  const vazio = await mkdtemp(join(tmpdir(), 'cnb-vazio-'));
  assert.deepEqual(await coletar(vazio, AGORA), []);
});

test('horaBrasilia: sempre no fuso de Brasília', () => {
  assert.equal(horaBrasilia(new Date('2026-11-25T17:10:31Z')), '14:10');
  assert.equal(horaBrasilia(new Date('2026-11-25T14:10:31-03:00')), '14:10');
});

test('nomeCidade: mapa com acentos e fallback capitalizado', () => {
  assert.equal(nomeCidade('sao-jose-dos-campos'), 'São José dos Campos');
  assert.equal(nomeCidade('cidade-nova'), 'Cidade Nova');
});
