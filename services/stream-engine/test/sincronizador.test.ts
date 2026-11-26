import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sincronizar } from '../src/sincronizador.ts';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

async function origem(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cnb-origem-'));
  git(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'a.md'), 'um');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'um');
  return dir;
}

test('sincronizar: clona na primeira vez e traz commits novos depois', async () => {
  const src = await origem();
  const destino = join(await mkdtemp(join(tmpdir(), 'cnb-dest-')), 'repo');
  assert.deepEqual(await sincronizar(src, destino), { ok: true });
  assert.equal(await readFile(join(destino, 'a.md'), 'utf8'), 'um');

  await writeFile(join(src, 'b.md'), 'dois');
  git(src, 'add', '.');
  git(src, 'commit', '-qm', 'dois');
  assert.deepEqual(await sincronizar(src, destino), { ok: true });
  assert.equal(await readFile(join(destino, 'b.md'), 'utf8'), 'dois');
});

test('sincronizar: origem inacessível não lança e mantém o conteúdo antigo', async () => {
  const src = await origem();
  const destino = join(await mkdtemp(join(tmpdir(), 'cnb-dest-')), 'repo');
  await sincronizar(src, destino);
  git(destino, 'remote', 'set-url', 'origin', join(tmpdir(), 'nao-existe-cnb'));
  const r = await sincronizar(src.replace(/.$/, 'X'), destino);
  assert.equal(r.ok, false);
  assert.ok(r.erro);
  assert.equal(await readFile(join(destino, 'a.md'), 'utf8'), 'um');
});

test('sincronizar: clone de origem inexistente devolve ok=false', async () => {
  const destino = join(await mkdtemp(join(tmpdir(), 'cnb-dest-')), 'repo');
  const r = await sincronizar(join(tmpdir(), 'nao-existe-cnb'), destino);
  assert.equal(r.ok, false);
});
