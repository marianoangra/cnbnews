// Peças comuns da newsletter (resumo diário e descadastro). Pasta _lib: a Vercel não expõe como rota.
import crypto from 'node:crypto';

export const BASE = 'https://news.cnbmobile.com';
export const LISTA = () => Number(process.env.BREVO_LIST_ID || 0);

export async function brevo(caminho, { method = 'GET', body } = {}) {
  const r = await fetch(`https://api.brevo.com/v3${caminho}`, {
    method,
    headers: { 'api-key': process.env.BREVO_API_KEY || '', 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = null; }
  if (!r.ok) throw Object.assign(new Error(`brevo ${method} ${caminho} → ${r.status} ${txt.slice(0, 200)}`), { status: r.status });
  return json;
}

// Token do link de descadastro: HMAC do e-mail. Sem ele, ninguém descadastra o e-mail de outra pessoa.
export function token(email) {
  return crypto.createHmac('sha256', process.env.NEWSLETTER_SEGREDO || '').update(email.toLowerCase()).digest('base64url').slice(0, 24);
}
export function tokenConfere(email, t) {
  const a = Buffer.from(token(email)), b = Buffer.from(String(t || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function linkSair(email) {
  return `${BASE}/api/descadastrar?e=${encodeURIComponent(email)}&t=${token(email)}`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
