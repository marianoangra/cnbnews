// API da redação (roda na rig). O painel estático em cnbmobile.com/admin/ fala com ela
// pelo Tailscale Funnel: https://rig1660s.tail4a859f.ts.net/cnb-admin/...
//   node services/agents/src/admin/servidor.ts      (systemd: cnbnews-admin.service)
// Segurança: só escuta em 127.0.0.1; toda rota (menos /api/saude) exige o ADMIN_TOKEN do .env
// (Authorization: Bearer ...), comparado em tempo constante; 8 erros de senha em 15 min
// bloqueiam o IP por 15 min. A fila nunca vai pro git (o repositório é público).
import { execFile } from 'node:child_process';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
import { lerItem, listarFila, moverParaSite, recusar, type Raizes } from './fila.ts';
import { painel } from './painel.ts';

const run = promisify(execFile);
const AGENTS = resolve(import.meta.dirname, '..', '..');
const REPO = resolve(AGENTS, '..', '..');
dotenv.config({ path: join(AGENTS, '.env'), quiet: true });

const PORTA = Number(process.env.ADMIN_PORT) || 8790;
const PREFIXO = '/cnb-admin';
const ORIGENS = new Set([
  'https://cnbmobile.com',
  'https://www.cnbmobile.com',
  'https://news.cnbmobile.com',
  ...(process.env.ADMIN_ORIGENS_EXTRA ?? '').split(',').filter(Boolean),
]);

export function tokenConfere(recebido: string, esperado: string): boolean {
  if (!esperado || !recebido) return false;
  // hash dos dois lados: mesmo tamanho, comparação em tempo constante
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

const falhas = new Map<string, { n: number; desde: number }>();
const JANELA = 15 * 60_000;
const MAX_FALHAS = 8;

function bloqueado(ip: string, agora: number): boolean {
  const f = falhas.get(ip);
  if (!f || agora - f.desde > JANELA) return false;
  return f.n >= MAX_FALHAS;
}
function registrarFalha(ip: string, agora: number) {
  const f = falhas.get(ip);
  if (!f || agora - f.desde > JANELA) falhas.set(ip, { n: 1, desde: agora });
  else f.n++;
}

// Git em fila única: os robôs também usam este checkout; se o index.lock estiver preso, tenta de novo.
let gitFila: Promise<unknown> = Promise.resolve();
function comGit<T>(fn: () => Promise<T>): Promise<T> {
  const p = gitFila.then(fn, fn);
  gitFila = p.catch(() => undefined);
  return p;
}
const git = async (...args: string[]) => (await run('git', args, { cwd: REPO, timeout: 90_000 })).stdout.trim();

async function publicarNoGit(caminho: string, msg: string): Promise<{ enviado: boolean; aviso?: string }> {
  const rel = relative(REPO, caminho).split('\\').join('/');
  let ultimo: unknown;
  for (let i = 1; i <= 3; i++) {
    try {
      await git('add', '--', rel);
      const staged = await git('diff', '--cached', '--name-only', '--', rel);
      if (staged) await git('commit', '-m', msg, '--', rel);
      // (se o robô de cidades já tiver commitado junto no "git add content/", não há nada staged: só empurra)
      await git('fetch', '-q', 'origin');
      if ((await git('rev-list', '--count', 'origin/main..HEAD')) !== '0') {
        await git('pull', '--rebase', '--autostash', 'origin', 'main');
        await git('push', 'origin', 'HEAD:main');
      }
      return { enviado: true };
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
  const m = ultimo instanceof Error ? ultimo.message.split('\n')[0] : String(ultimo);
  return { enviado: false, aviso: `ficou gravada na rig e sobe no próximo push dos robôs (${m.slice(0, 160)})` };
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const o = req.headers.origin;
  if (o && ORIGENS.has(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function json(res: ServerResponse, status: number, dado: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(dado));
}

async function corpoJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let tam = 0;
  const partes: Buffer[] = [];
  for await (const c of req) {
    tam += (c as Buffer).length;
    if (tam > 300_000) throw new Error('corpo grande demais');
    partes.push(c as Buffer);
  }
  const t = Buffer.concat(partes).toString('utf8');
  return t ? (JSON.parse(t) as Record<string, unknown>) : {};
}

const raizes: Raizes = { repo: REPO };

export function criarServidor(token: string) {
  return createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const url = new URL(req.url ?? '/', 'http://x');
    const rota = url.pathname.startsWith(PREFIXO) ? url.pathname.slice(PREFIXO.length) || '/' : url.pathname;
    if (rota === '/api/saude') return json(res, 200, { ok: true });

    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
    const agora = Date.now();
    if (bloqueado(ip, agora)) return json(res, 429, { erro: 'muitas tentativas; espere 15 minutos' });
    const auth = String(req.headers.authorization ?? '');
    if (!tokenConfere(auth.replace(/^Bearer\s+/i, ''), token)) {
      registrarFalha(ip, agora);
      await new Promise((r) => setTimeout(r, 400));
      return json(res, 401, { erro: 'senha inválida' });
    }
    falhas.delete(ip);

    try {
      if (req.method === 'GET' && rota === '/api/painel') return json(res, 200, await painel(raizes, process.env));
      if (req.method === 'GET' && rota === '/api/fila') return json(res, 200, { itens: listarFila(raizes) });
      if (req.method === 'GET' && rota === '/api/item') return json(res, 200, lerItem(raizes, url.searchParams.get('id') ?? ''));
      if (req.method === 'POST' && rota === '/api/aprovar') {
        const b = await corpoJson(req);
        const id = String(b.id ?? '');
        const editado = typeof b.markdown === 'string' ? b.markdown : undefined;
        const r = await comGit(async () => {
          const m = moverParaSite(raizes, id, editado, new Date().toISOString());
          const g = await publicarNoGit(m.destino, `aprovação: ${m.titulo.slice(0, 70)}`);
          return { ...m, ...g };
        });
        console.log(`[admin] aprovada ${id} → ${r.url}${r.aviso ? ' · ' + r.aviso : ''}`);
        return json(res, 200, { ok: true, url: r.url, titulo: r.titulo, enviado: r.enviado, aviso: r.aviso });
      }
      if (req.method === 'POST' && rota === '/api/recusar') {
        const b = await corpoJson(req);
        recusar(raizes, String(b.id ?? ''), String(b.motivo ?? ''), new Date().toISOString());
        console.log(`[admin] recusada ${b.id}`);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { erro: 'rota não existe' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json(res, 400, { erro: msg });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const token = process.env.ADMIN_TOKEN ?? '';
  if (token.length < 24) {
    console.error('admin: ADMIN_TOKEN ausente ou curto (mín. 24 caracteres) em services/agents/.env — não vou subir sem senha');
    process.exit(1);
  }
  criarServidor(token).listen(PORTA, '127.0.0.1', () => console.log(`[admin] ouvindo em 127.0.0.1:${PORTA} (${REPO})`));
}
