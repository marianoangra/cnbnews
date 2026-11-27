import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Programador } from '../src/programador.ts';
import type { BlocoPronto } from '../src/tipos.ts';

const T0 = new Date('2026-11-26T12:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function b(id: string, o: Partial<BlocoPronto> = {}): BlocoPronto {
  return { id, arquivo: `${id}.ts`, duracao: 30, criadoEm: T0, tipo: 'noticia', cidade: 'pelotas', ...o };
}
const VINHETA = b('vinheta', { tipo: 'vinheta', cidade: null, duracao: 6 });
const INST = [1, 2, 3].map((i) => b(`inst${i}`, { tipo: 'institucional', cidade: null }));

test('proximo: notícia nunca exibida vem primeiro, a mais nova antes', () => {
  const p = new Programador();
  const velha = b('velha', { criadoEm: min(-30) });
  const nova = b('nova', { criadoEm: min(-1) });
  assert.equal(p.proximo([velha, nova, ...INST, VINHETA], T0).id, 'nova');
});

test('proximo: não repete em 60 min quando há alternativa', () => {
  const p = new Programador();
  const a = b('a', { cidade: 'pelotas' });
  const c = b('c', { cidade: 'curitiba' });
  p.registrarExibicao('a', min(-10));
  p.registrarExibicao('c', min(-70));
  assert.equal(p.proximo([a, c, ...INST], T0).id, 'c');
});

test('proximo: entre reprises, prefere cidade diferente da última exibida', () => {
  const p = new Programador();
  const pel = b('pel', { cidade: 'pelotas' });
  const cur = b('cur', { cidade: 'curitiba' });
  p.registrarExibicao('pel', min(-90));
  p.registrarExibicao('cur', min(-80));
  p.registrarExibicao('outra-pelotas', min(-1), b('outra-pelotas', { cidade: 'pelotas' })); // última exibida foi de Pelotas
  const blocos = [pel, cur, b('outra-pelotas', { cidade: 'pelotas' })];
  // pel foi exibida há mais tempo, mas é da mesma cidade da última → vai cur
  assert.equal(p.proximo(blocos, T0).id, 'cur');
});

test('proximo: o 6º item é a vinheta (a cada 5 blocos)', () => {
  const p = new Programador();
  const ns = Array.from({ length: 8 }, (_, i) => b(`n${i}`, { criadoEm: min(-i) }));
  const ordem: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = p.proximo([...ns, ...INST, VINHETA], min(i));
    p.registrarExibicao(x.id, min(i));
    ordem.push(x.id);
  }
  assert.equal(ordem[5], 'vinheta');
  assert.notEqual(ordem[6], 'vinheta');
  assert.equal(ordem.filter((x) => x === 'vinheta').length, 1);
});

test('proximo: sem notícias disponíveis, roda os institucionais em rodízio', () => {
  const p = new Programador({ vinhetaACada: 100 });
  const ordem: string[] = [];
  for (let i = 0; i < 4; i++) {
    const x = p.proximo([...INST], min(i));
    p.registrarExibicao(x.id, min(i));
    ordem.push(x.id);
  }
  assert.deepEqual(new Set(ordem.slice(0, 3)).size, 3);
  assert.equal(ordem[3], ordem[0]);
});

test('proximo: com só uma notícia já exibida e nada mais, repete ela (nunca lança)', () => {
  const p = new Programador();
  p.registrarExibicao('so', min(-5));
  assert.equal(p.proximo([b('so')], T0).id, 'so');
});

test('proximo: lista vazia lança erro claro', () => {
  assert.throws(() => new Programador().proximo([], T0), /nenhum bloco/);
});

test('minutosProntosAFrente: soma notícias não exibidas nos últimos 60 min', () => {
  const p = new Programador();
  p.registrarExibicao('a', min(-10));
  p.registrarExibicao('b', min(-90));
  const blocos = [b('a', { duracao: 60 }), b('b', { duracao: 120 }), b('c', { duracao: 60 }), ...INST];
  assert.equal(p.minutosProntosAFrente(blocos, T0), 3);
});

test('proximo: com toda notícia exibida na última hora, reprisa a mais antiga (>=15 min) antes do institucional', () => {
  const p = new Programador({ vinhetaACada: 100 });
  p.registrarExibicao('a', min(-20));
  p.registrarExibicao('c', min(-40));
  assert.equal(p.proximo([b('a'), b('c', { cidade: 'curitiba' }), ...INST], T0).id, 'c');
});

test('proximo: notícia exibida há menos de 15 min não volta; aí entra o institucional', () => {
  const p = new Programador({ vinhetaACada: 100 });
  p.registrarExibicao('a', min(-5));
  assert.equal(p.proximo([b('a'), ...INST], T0).tipo, 'institucional');
});

const NAC = (id: string, o: Partial<BlocoPronto> = {}) => b(`noticias/${id}`, { cidade: null, ...o });
const CID = (id: string, o: Partial<BlocoPronto> = {}) => b(`cidades/x/${id}`, o);

test('proximo: a cada 3 blocos de notícia, pelo menos 1 é nacional (mesmo com cidades mais novas)', () => {
  const p = new Programador({ vinhetaACada: 100 });
  const cidades = Array.from({ length: 8 }, (_, i) => CID(`c${i}`, { criadoEm: min(-i) }));
  const nac = [NAC('n1', { criadoEm: min(-60) }), NAC('n2', { criadoEm: min(-61) })];
  const ordem: string[] = [];
  for (let i = 0; i < 6; i++) {
    const x = p.proximo([...cidades, ...nac, ...INST], min(i));
    p.registrarExibicao(x.id, min(i), x);
    ordem.push(x.id);
  }
  const nacionais = ordem.map((id) => id.startsWith('noticias/'));
  assert.deepEqual(nacionais, [false, false, true, false, false, true]);
});

test('proximo: na vez da nacional, ela repete depois de 30 min (não espera 60)', () => {
  const p = new Programador({ vinhetaACada: 100 });
  const n = NAC('n1');
  p.registrarExibicao(n.id, min(-35), n);
  for (const c of ['c1', 'c2']) p.registrarExibicao(`cidades/x/${c}`, min(-1), CID(c));
  assert.equal(p.proximo([n, CID('c3'), CID('c4'), ...INST], T0).id, 'noticias/n1');
});

test('proximo: na vez da nacional, se nenhuma pode voltar, segue com cidade', () => {
  const p = new Programador({ vinhetaACada: 100 });
  const n = NAC('n1');
  p.registrarExibicao(n.id, min(-10), n);
  for (const c of ['c1', 'c2']) p.registrarExibicao(`cidades/x/${c}`, min(-1), CID(c));
  assert.equal(p.proximo([n, CID('c3'), ...INST], T0).id, 'cidades/x/c3');
});
