import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { garantirInstitucional, gerarPendentes, limpar, listarBlocos, type Montar } from '../src/fabrica.ts';
import { ErroLocucao, type Locutor } from '../src/locutor.ts';
import { nomeArquivo } from '../src/montador.ts';
import type { BlocoPronto, Materia } from '../src/tipos.ts';

const locutor: Locutor = { falar: async () => {} };

function m(id: string, horasAtras = 1): Materia {
  return {
    id, titulo: `Título ${id}`, resumo: 'r'.repeat(90), fonte: 'F', cidade: 'pelotas',
    publicadaEm: new Date(Date.now() - horasAtras * 3600_000), caminho: '', lauda: null,
  };
}

/** Montador falso: grava um .ts vazio + meta, falha para ids com "quebra". */
function montarFalso(chamadas: string[]): Montar {
  return async (mat, ticker, _loc, dir) => {
    chamadas.push(`${mat.id}|${ticker.length}`);
    if (mat.id.includes('quebra')) throw new ErroLocucao('offline');
    const arquivo = join(dir, `${nomeArquivo(mat.id)}.ts`);
    await writeFile(arquivo, 'x');
    const b: BlocoPronto = { id: mat.id, arquivo, duracao: 10, criadoEm: new Date(), tipo: 'noticia', cidade: mat.cidade };
    await writeFile(arquivo + '.json', JSON.stringify(b));
    return b;
  };
}

test('gerarPendentes: gera o que falta, não regera, e falha de uma não para as outras', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-fab-'));
  const chamadas: string[] = [];
  const opts = { gpu: 0, montar: montarFalso(chamadas) };
  const r1 = await gerarPendentes([m('a'), m('quebra'), m('b')], dir, locutor, [], opts);
  assert.deepEqual(r1.gerados.sort(), ['a', 'b']);
  assert.deepEqual(r1.falhas, ['quebra']);
  const r2 = await gerarPendentes([m('a'), m('b')], dir, locutor, [], opts);
  assert.deepEqual(r2.gerados, []);
  assert.equal(chamadas.filter((c) => c.startsWith('a|')).length, 1);
});

test('gerarPendentes: ticker leva as outras manchetes (até 8)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-fab-'));
  const chamadas: string[] = [];
  const ms = Array.from({ length: 12 }, (_, i) => m(`n${i}`));
  await gerarPendentes(ms, dir, locutor, [], { gpu: 0, montar: montarFalso(chamadas) });
  assert.ok(chamadas.every((c) => c.endsWith('|8')));
});

test('limpar: apaga notícia com mais de 48 h, nunca toca nos fixos', async () => {
  const blocos = await mkdtemp(join(tmpdir(), 'cnb-lim-'));
  const fixos = await mkdtemp(join(tmpdir(), 'cnb-fix-'));
  const velho = join(blocos, 'velho.ts');
  const novo = join(blocos, 'novo.ts');
  const inst = join(fixos, 'inst.ts');
  for (const f of [velho, novo, inst]) {
    await writeFile(f, 'x');
    await writeFile(f + '.json', '{}');
  }
  const t50h = new Date(Date.now() - 50 * 3600_000);
  await utimes(velho, t50h, t50h);
  await utimes(inst, t50h, t50h);
  assert.equal(await limpar(blocos, new Date()), 1);
  assert.ok(!existsSync(velho) && !existsSync(velho + '.json'));
  assert.ok(existsSync(novo));
  assert.ok(existsSync(inst));
});

test('garantirInstitucional: cria 3 institucionais + vinheta uma vez só', async () => {
  const fixos = await mkdtemp(join(tmpdir(), 'cnb-fix-'));
  const chamadas: string[] = [];
  const vinhetas: string[] = [];
  const opts = {
    gpu: 0,
    montar: montarFalso(chamadas),
    vinheta: async (_t: string, _d: number, saida: string) => {
      vinhetas.push(saida);
      await writeFile(saida, 'x');
    },
  };
  await garantirInstitucional(fixos, locutor, [], opts);
  await garantirInstitucional(fixos, locutor, [], opts);
  assert.equal(chamadas.length, 3);
  assert.equal(vinhetas.length, 1);
  const lista = await listarBlocos([fixos]);
  assert.deepEqual(lista.map((b) => b.tipo).sort(), ['institucional', 'institucional', 'institucional', 'vinheta']);
});

test('listarBlocos: ignora .ts sem meta e meta quebrado', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-lis-'));
  await writeFile(join(dir, 'sem-meta.ts'), 'x');
  await writeFile(join(dir, 'ruim.ts'), 'x');
  await writeFile(join(dir, 'ruim.ts.json'), '{quebrado');
  assert.deepEqual(await listarBlocos([dir]), []);
});

async function blocoNoDisco(dir: string, id: string, extra: Partial<BlocoPronto> = {}): Promise<string> {
  const arquivo = join(dir, `${nomeArquivo(id)}.ts`);
  await writeFile(arquivo, 'x');
  const b: BlocoPronto = { id, arquivo, duracao: 10, criadoEm: new Date(), tipo: 'noticia', cidade: null, ...extra };
  await writeFile(arquivo + '.json', JSON.stringify(b));
  return arquivo;
}

test('limpar: com a lista aprovada, tira do ar a notícia que saiu dela (corrigida/apagada/bloqueada)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-lim-'));
  const fica = await blocoNoDisco(dir, 'fica');
  const sai = await blocoNoDisco(dir, 'sai');
  assert.equal(await limpar(dir, new Date(), 48, new Set(['fica'])), 1);
  assert.ok(existsSync(fica));
  assert.ok(!existsSync(sai) && !existsSync(sai + '.json'));
});

test('limpar: usa a data de publicação da matéria, não a do arquivo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-lim-'));
  const velha = await blocoNoDisco(dir, 'velha', { publicadaEm: new Date(Date.now() - 50 * 3600_000) });
  assert.equal(await limpar(dir, new Date()), 1);
  assert.ok(!existsSync(velha));
});

test('listarBlocos: pasta movida (caminho absoluto antigo no meta) ainda acha o .ts ao lado', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-mov-'));
  await writeFile(join(dir, 'a.ts'), 'x');
  const meta: BlocoPronto = { id: 'a', arquivo: join(tmpdir(), 'pasta-que-nao-existe', 'a.ts'), duracao: 5, criadoEm: new Date(), tipo: 'noticia', cidade: null };
  await writeFile(join(dir, 'a.ts.json'), JSON.stringify(meta));
  const l = await listarBlocos([dir]);
  assert.equal(l.length, 1);
  assert.equal(l[0]!.arquivo, join(dir, 'a.ts'));
});

test('garantirInstitucional: refaz o fixo cujo .ts sumiu (meta sozinho não basta)', async () => {
  const fixos = await mkdtemp(join(tmpdir(), 'cnb-fix-'));
  const chamadas: string[] = [];
  const opts = { gpu: 0, montar: montarFalso(chamadas), vinheta: async (_t: string, _d: number, s: string) => { await writeFile(s, 'x'); } };
  await garantirInstitucional(fixos, locutor, [], opts);
  const { rm } = await import('node:fs/promises');
  const umFixo = (await listarBlocos([fixos])).find((x) => x.tipo === 'institucional')!;
  await rm(umFixo.arquivo);
  await garantirInstitucional(fixos, locutor, [], opts);
  assert.equal(chamadas.length, 4);
});

test('gerarPendentes: o limite conta blocos NOVOS (os já prontos não gastam a cota)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-fab-'));
  const chamadas: string[] = [];
  const montar = montarFalso(chamadas);
  const ms = ['a', 'b', 'c', 'd', 'e'].map((id) => m(id));
  await gerarPendentes(ms.slice(0, 2), dir, locutor, [], { gpu: 0, montar }); // a e b já prontos
  const r = await gerarPendentes(ms, dir, locutor, [], { gpu: 0, montar, limite: 2 });
  assert.deepEqual(r.gerados, ['c', 'd']);
});
