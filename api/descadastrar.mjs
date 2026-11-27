// Descadastro da newsletter. Link: /api/descadastrar?e=<email>&t=<token HMAC>.
// GET  → página com botão "Confirmar" (robôs de antivírus abrem links sozinhos; não descadastra só por abrir).
// POST → tira o e-mail da lista na Brevo. Também atende o "cancelar inscrição" de 1 clique do Gmail (RFC 8058).
import { LISTA, brevo, tokenConfere, esc } from './_lib/newsletter.mjs';

function pagina(titulo, corpo) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)} · CNB News</title>
<style>body{margin:0;background:#f4f4f5;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f1115}main{max-width:520px;margin:12vh auto;background:#fff;border-radius:8px;padding:32px 28px;border-left:6px solid #c8102e}
h1{margin:0 0 12px;font-size:1.6rem;letter-spacing:-.02em}p{line-height:1.5;color:#353a43}button,a.b{display:inline-block;font:inherit;font-weight:700;border:0;border-radius:6px;padding:12px 18px;background:#c8102e;color:#fff;cursor:pointer;text-decoration:none}a{color:#b30d28}</style></head>
<body><main><p style="margin:0 0 14px;font-weight:800;letter-spacing:.06em;font-size:.75rem;color:#b30d28">CNB NEWS · NEWSLETTER</p>${corpo}</main></body></html>`;
}

function lerCorpo(req) {
  return new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 2048) req.destroy(); }); req.on('end', () => ok(s)); req.on('error', () => ok('')); });
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://news.cnbmobile.com');
  const email = String(url.searchParams.get('e') || '').trim().toLowerCase();
  const t = url.searchParams.get('t') || '';
  const html = (s, b) => { res.statusCode = s; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(b); };

  if (!email || !tokenConfere(email, t)) return html(400, pagina('Link inválido', '<h1>Link inválido</h1><p>Este link de descadastro não está completo. Use o link do rodapé do e-mail ou escreva para <a href="mailto:contato@rafaelmariano.com.br">contato@rafaelmariano.com.br</a>.</p>'));

  if (req.method === 'GET') {
    return html(200, pagina('Descadastrar', `<h1>Sair da newsletter?</h1><p>O e-mail <b>${esc(email)}</b> deixa de receber o resumo diário da CNB News.</p>
      <form method="post"><button type="submit">Confirmar descadastro</button></form>`));
  }
  if (req.method !== 'POST') return html(405, pagina('Erro', '<h1>Método não permitido</h1>'));

  await lerCorpo(req);
  try {
    await brevo(`/contacts/lists/${LISTA()}/contacts/remove`, { method: 'POST', body: { emails: [email] } });
  } catch (e) {
    // Já fora da lista: para quem pediu, o resultado é o mesmo.
    if (!(e.status === 400 && /already|not.*(exist|found|in list)/i.test(e.message))) {
      console.error('[descadastrar]', e.message);
      return html(502, pagina('Tente de novo', '<h1>Não deu certo agora</h1><p>Tente de novo em instantes ou escreva para <a href="mailto:contato@rafaelmariano.com.br">contato@rafaelmariano.com.br</a>.</p>'));
    }
  }
  return html(200, pagina('Descadastrado', `<h1>Pronto, você saiu da lista</h1><p>O e-mail <b>${esc(email)}</b> não recebe mais a newsletter. Se mudar de ideia, é só se inscrever de novo no portal.</p><p><a class="b" href="https://news.cnbmobile.com/">Voltar para a CNB News</a></p>`));
}
