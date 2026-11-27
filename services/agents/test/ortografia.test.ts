import { test } from 'node:test';
import assert from 'node:assert/strict';
import { palavraSuspeita, revisarOrtografia } from '../src/ortografia.ts';

const m = (texto: string, palavra: string, rule: string, cat: string, sug: string[] = []) => ({
  rule: { id: rule, category: { id: cat } },
  context: { text: texto, offset: texto.indexOf(palavra), length: palavra.length },
  replacements: sug.map((value) => ({ value })),
});

// LanguageTool falso: devolve os matches cadastrados para o texto que contém a chave.
const lt = (respostas: Record<string, ReturnType<typeof m>[]>) =>
  (async (_u: string, init: { body: URLSearchParams }) => {
    const t = init.body.get('text') ?? '';
    const k = Object.keys(respostas).find((x) => t.includes(x));
    return new Response(JSON.stringify({ matches: k ? respostas[k] : [] }));
  }) as unknown as typeof fetch;

test('ortografia: só palavra minúscula fora da fonte é suspeita', () => {
  assert.equal(palavraSuspeita('fundass', 'texto da fonte'), true);
  assert.equal(palavraSuspeita('Inmet', ''), false); // nome/sigla
  assert.equal(palavraSuspeita('covid', ''), false); // lista de conhecidas
  assert.equal(palavraSuspeita('metapneumovírus', ''), false);
  assert.equal(palavraSuspeita('sobrepescada', ''), false);
  assert.equal(palavraSuspeita('cianobactéria', 'a cianobacteria foi achada'), false); // veio da fonte (já normalizada)
  assert.equal(palavraSuspeita('5g', ''), false);
});

test('ortografia: erro de grafia bloqueia, gramática só avisa, nome não dispara', async () => {
  const corpo = 'O governo fundass o programa. Segundo o Inmet, chove.';
  const r = await revisarOrtografia(
    { manchete: 'Chuva forte no Sul', subtitulo: 'Pagamento por meio do emissão de boletos', corpo, fonteTexto: 'fonte' },
    'http://lt',
    lt({
      fundass: [m(corpo, 'fundass', 'MORFOLOGIK_RULE_PT_BR', 'TYPOS', ['fundas', 'fundasse']), m(corpo, 'Inmet', 'MORFOLOGIK_RULE_PT_BR', 'TYPOS', ['Inter'])],
      emissão: [m('Pagamento por meio do emissão de boletos', 'do emissão', 'GENERAL_GENDER_AGREEMENT_ERRORS', 'GRAMMAR', ['da emissão'])],
    }),
  );
  assert.equal(r.bloqueia, true);
  assert.ok(r.motivos.some((x) => x.includes('ortografia (texto): "fundass"') && x.includes('fundas')));
  assert.ok(r.motivos.some((x) => x.startsWith('gramática? (linha fina)') && x.includes('da emissão')));
  assert.ok(!r.motivos.some((x) => x.includes('Inmet')));
});

test('ortografia: só gramática não bloqueia; corretor fora do ar não trava', async () => {
  const s = 'muitos carregados por familiares';
  const r = await revisarOrtografia({ manchete: 'x', subtitulo: '', corpo: s, fonteTexto: '' }, 'http://lt',
    lt({ muitos: [m(s, 'muitos', 'MUITOS_MUITO', 'GRAMMAR', ['muito'])] }));
  assert.equal(r.bloqueia, false);
  assert.equal(r.motivos.length, 1);
  const fora = await revisarOrtografia({ manchete: 'x', subtitulo: '', corpo: 'y', fonteTexto: '' }, 'http://lt',
    (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
  assert.equal(fora.bloqueia, false);
  assert.match(fora.motivos[0], /fora do ar/);
});
