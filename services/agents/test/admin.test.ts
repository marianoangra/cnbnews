import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lerFrontMatter, listarFila, moverParaSite, prepararParaPublicar, recusar, resolverId, urlPublica } from '../src/admin/fila.ts';
import { equipe, producao } from '../src/admin/painel.ts';
import { tokenConfere } from '../src/admin/servidor.ts';

function repoFalso() {
  const repo = mkdtempSync(join(tmpdir(), 'cnb-admin-'));
  const nac = join(repo, 'services', 'agents', 'fila-aprovacao');
  mkdirSync(join(nac, 'colunas'), { recursive: true });
  mkdirSync(join(repo, 'fila-aprovacao', 'cidades', 'pelotas'), { recursive: true });
  mkdirSync(join(repo, 'content', 'noticias'), { recursive: true });
  mkdirSync(join(repo, 'content', 'colunas'), { recursive: true });
  mkdirSync(join(repo, 'content', 'cidades', 'pelotas'), { recursive: true });
  writeFileSync(join(repo, 'content', 'cidades', 'pelotas', '_index.md'), '---\ntitle: "Pelotas (RS)"\n---\n');
  writeFileSync(
    join(nac, '2026-11-26-bolsa-sobe.md'),
    '---\ntitle: "Bolsa sobe 6%"\ndate: 2026-11-26T20:13:39-03:00\ndescription: "Ibovespa"\nfonte: "Agência Brasil"\nscore_sensibilidade: 2\nrequer_aprovacao_humana: true\nmotivos_revisao:\n  - "revisor LLM pediu aprovação humana"\ndraft: false\n---\n\nTexto da bolsa.\n',
  );
  writeFileSync(
    join(nac, 'colunas', '2026-11-27-reserva.md'),
    '---\ntitle: "Reserva"\ndate: 2026-11-27T09:00:00-03:00\ntema: "financas"\nalertas_revisao:\n  - "curta"\n  - "cita versículo"\ndraft: false\n---\n\n## Comece\n\nTexto.\n',
  );
  writeFileSync(
    join(repo, 'fila-aprovacao', 'cidades', 'pelotas', '2026-11-24-pm-apreende.md'),
    '---\ntitle: "PM apreende drogas"\ndate: 2026-11-24T17:10:23-03:00\nscore_sensibilidade: 4\nrequer_aprovacao_humana: true\nmotivos_revisao:\n  - "ocorrência policial"\nretirada_do_site: "2026-11-27 (publicada antes das travas)"\n---\nCorpo.\n',
  );
  return repo;
}

test('lista as três filas com cidade, score e motivos', () => {
  const repo = repoFalso();
  const itens = listarFila({ repo });
  assert.deepEqual(itens.map((i) => i.tipo).sort(), ['cidades', 'colunas', 'nacional']);
  const cid = itens.find((i) => i.tipo === 'cidades')!;
  assert.equal(cid.cidade, 'Pelotas (RS)');
  assert.equal(cid.score, 4);
  assert.deepEqual(cid.motivos, ['ocorrência policial']);
  assert.deepEqual(itens.find((i) => i.tipo === 'colunas')!.motivos, ['curta', 'cita versículo']);
});

test('id só aceita nomes simples (sem sair da fila)', () => {
  const r = { repo: '/x' };
  for (const ruim of ['nacional/../.env', 'nacional/a/b.md', 'cidades/../x/a.md', 'outra/a.md', 'nacional/.env', 'nacional/a.txt', '/etc/passwd']) {
    assert.throws(() => resolverId(r, ruim), /id inválido/, ruim);
  }
  assert.equal(resolverId(r, 'cidades/pelotas/a.md').slug, 'pelotas');
});

test('prepararParaPublicar: data de agora, tira alertas e marcas da fila, registra aprovação', () => {
  const md = '---\ntitle: "X"\ndate: 2026-11-24T17:10:23-03:00\nrequer_aprovacao_humana: true\nalertas_revisao:\n  - "a"\n  - "b"\nretirada_do_site: "y"\ndraft: false\n---\n\nCorpo.\n';
  const out = prepararParaPublicar(md, '2026-11-27T15:00:00Z');
  const { campos, corpo } = lerFrontMatter(out);
  assert.equal(campos.date, '2026-11-27T12:00:00-03:00');
  assert.equal(campos.criado_em, '2026-11-24T17:10:23-03:00');
  assert.equal(campos.requer_aprovacao_humana, 'false');
  assert.equal(campos.aprovado_por, 'Rafael Mariano');
  assert.equal(campos.alertas_revisao, undefined);
  assert.equal(campos.retirada_do_site, undefined);
  assert.equal(campos.draft, 'false');
  assert.equal(corpo.trim(), 'Corpo.');
  assert.throws(() => prepararParaPublicar('sem front matter', '2026-11-27T15:00:00Z'));
  assert.throws(() => prepararParaPublicar('---\ndate: x\n---\nsem título', '2026-11-27T15:00:00Z'), /título/);
});

test('aprovar move pro content certo (com texto editado) e tira da fila', () => {
  const repo = repoFalso();
  const r = moverParaSite({ repo }, 'cidades/pelotas/2026-11-24-pm-apreende.md', undefined, '2026-11-27T15:00:00Z');
  assert.ok(existsSync(join(repo, 'content', 'cidades', 'pelotas', '2026-11-24-pm-apreende.md')));
  assert.equal(r.url, 'https://pelotas.news.cnbmobile.com/2026-11-24-pm-apreende/');
  assert.equal(listarFila({ repo }).some((i) => i.tipo === 'cidades'), false);
  const editado = '---\ntitle: "Bolsa sobe 6% (editado)"\ndate: 2026-11-26T20:13:39-03:00\n---\n\nNovo texto.\n';
  moverParaSite({ repo }, 'nacional/2026-11-26-bolsa-sobe.md', editado, '2026-11-27T15:00:00Z');
  const pub = readFileSync(join(repo, 'content', 'noticias', '2026-11-26-bolsa-sobe.md'), 'utf8');
  assert.match(pub, /Bolsa sobe 6% \(editado\)/);
  assert.match(pub, /Novo texto\./);
  assert.throws(() => moverParaSite({ repo }, 'nacional/2026-11-26-bolsa-sobe.md', undefined, '2026-11-27T15:00:00Z'), /não está mais na fila/);
});

test('recusar esconde da lista mas mantém o arquivo (robô não regera a pauta)', () => {
  const repo = repoFalso();
  recusar({ repo }, 'colunas/2026-11-27-reserva.md', 'tema repetido', '2026-11-27T15:00:00Z');
  assert.equal(listarFila({ repo }).some((i) => i.tipo === 'colunas'), false);
  assert.ok(existsSync(join(repo, 'services', 'agents', 'fila-aprovacao', 'colunas', '2026-11-27-reserva.md')));
});

test('urlPublica de cada tipo', () => {
  assert.equal(urlPublica('nacional', '2026-11-27-a.md'), 'https://news.cnbmobile.com/noticias/2026-11-27-a/');
  assert.equal(urlPublica('colunas', '2026-11-27-b.md'), 'https://news.cnbmobile.com/colunas/2026-11-27-b/');
});

test('produção conta por dia de Brasília e equipe reflete serviço parado', () => {
  const repo = repoFalso();
  writeFileSync(join(repo, 'content', 'noticias', '2026-11-27-x.md'), '---\ntitle: x\n---\n');
  writeFileSync(join(repo, 'content', 'cidades', 'pelotas', '2026-11-27-y.md'), '---\ntitle: y\n---\n');
  const p = producao({ repo }, '2026-11-27T15:00:00Z', 3);
  assert.deepEqual(p.dias, ['2026-11-25', '2026-11-26', '2026-11-27']);
  assert.deepEqual(p.nacional, [0, 0, 1]);
  assert.deepEqual(p.cidades, [0, 0, 1]);
  const setores = equipe(
    { servicos: { ollama: 'active', cidades: 'inactive', nacional: 'active', colunista: 'active' }, pesada: { online: true, modelos: [] }, rapida: { online: false, modelos: [], url: '' } },
    72,
  );
  const todos = setores.flatMap((s) => s.funcionarios);
  assert.equal(todos.find((f) => f.nome === 'Repórter das cidades')!.estado, 'parado');
  assert.equal(todos.find((f) => f.nome === 'Triagem')!.estado, 'reserva');
});

test('token em tempo constante', () => {
  assert.equal(tokenConfere('abc', 'abc'), true);
  assert.equal(tokenConfere('abd', 'abc'), false);
  assert.equal(tokenConfere('', 'abc'), false);
  assert.equal(tokenConfere('abc', ''), false);
});

test('ao vivo: só com isLiveNow + vídeo; erro de rede segura 10 min e depois cai', async () => {
  const { analisarPaginaLive, criarVigiaAoVivo } = await import('../src/admin/aovivo.ts');
  const live = '<link rel="canonical" href="https://www.youtube.com/watch?v=4t4AQ15yj1M">..."liveBroadcastDetails":{"isLiveNow":true,"startTimestamp":"x"}';
  const fora = '<link rel="canonical" href="https://www.youtube.com/channel/UC8JfkO0NzxMHi-X42lMdEpg">';
  const agendada = '<link rel="canonical" href="https://www.youtube.com/watch?v=4t4AQ15yj1M">"isLiveNow":false,"isUpcoming":true';
  assert.deepEqual(analisarPaginaLive(live), { aoVivo: true, videoId: '4t4AQ15yj1M' });
  assert.deepEqual(analisarPaginaLive(fora), { aoVivo: false });
  assert.deepEqual(analisarPaginaLive(agendada), { aoVivo: false });
  let resposta: string | Error = live;
  const fakeFetch = (async () => {
    if (resposta instanceof Error) throw resposta;
    return new Response(resposta, { status: 200 });
  }) as typeof fetch;
  const v = criarVigiaAoVivo('https://www.youtube.com/@x/live', fakeFetch, () => {});
  const t0 = Date.parse('2026-11-27T15:00:00Z');
  assert.equal((await v.checar(t0)).url, 'https://www.youtube.com/watch?v=4t4AQ15yj1M');
  resposta = new Error('rede');
  assert.equal((await v.checar(t0 + 5 * 60_000)).aoVivo, true); // segura
  assert.equal((await v.checar(t0 + 11 * 60_000)).aoVivo, false); // desiste
  resposta = fora;
  const s = await v.checar(t0 + 12 * 60_000);
  assert.equal(s.aoVivo, false);
  assert.equal(s.url, 'https://www.youtube.com/@x/live');
});
