import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const TIMEOUT = 120_000;

export const REPO_PADRAO = 'https://github.com/marianoangra/cnbnews.git';

async function git(args: string[], cwd?: string): Promise<void> {
  await exec('git', args, { cwd, timeout: TIMEOUT, windowsHide: true });
}

/**
 * Mantém um clone raso e SÓ DE LEITURA do repo público em `destino`.
 * Clona na primeira vez; depois busca o último commit e alinha o clone a ele
 * (fetch + reset, em vez de pull, porque ninguém edita esse clone).
 * Nunca lança: falha de rede devolve `{ ok: false }` e o conteúdo antigo fica.
 */
export async function sincronizar(urlRepo: string, destino: string): Promise<{ ok: boolean; erro?: string }> {
  try {
    if (!existsSync(join(destino, '.git'))) {
      await git(['clone', '--depth', '1', '--single-branch', urlRepo, destino]);
      return { ok: true };
    }
    await git(['remote', 'set-url', 'origin', urlRepo], destino);
    await git(['fetch', '--depth', '1', 'origin', 'HEAD'], destino);
    await git(['reset', '--hard', '-q', 'FETCH_HEAD'], destino);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
}
