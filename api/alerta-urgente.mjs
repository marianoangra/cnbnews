// Alerta de notícia URGENTE por e-mail. Quem chama é o painel da redação (rig), depois que o
// editor-chefe clica "Enviar alerta" — nunca sozinho. Protegido por "Authorization: Bearer $ALERTA_SECRET".
// POST {url} → acha a matéria em /busca.json; nacional vai para todos os inscritos, de cidade só para
// os inscritos daquela cidade. Um envio por pessoa (link de descadastro próprio + List-Unsubscribe).
// Trava: a mesma matéria nunca é enviada duas vezes (etiqueta alerta-<hash da URL> na Brevo).
import crypto from 'node:crypto';
import { BASE, LISTA, brevo, linkSair, esc } from './_lib/newsletter.mjs';

function lerCorpo(req) {
  return new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); }); req.on('end', () => ok(s)); req.on('error', () => ok('')); });
}

export function montarAlerta(item, sair) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Urgente · CNB News</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#0f1115">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(item.d || item.t)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:20px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
  <tr><td style="background:#0c0d10;padding:16px 28px">
    <span style="display:inline-block;background:#c8102e;color:#fff;font-weight:900;font-size:16px;padding:5px 7px;border-radius:4px">CNB</span> <span style="color:#fff;font-weight:900;font-size:20px;letter-spacing:-1px;vertical-align:middle">NEWS</span>
  </td></tr>
  <tr><td style="background:#c8102e;padding:10px 28px;color:#ffffff;font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">● Urgente${item.s ? ` · ${esc(item.c)}` : ''}</td></tr>
  <tr><td style="padding:26px 28px 8px">
    <a href="${esc(item.u)}" style="color:#0f1115;text-decoration:none;font-size:26px;line-height:1.2;font-weight:bold;letter-spacing:-0.5px">${esc(item.t)}</a>
    ${item.d ? `<p style="margin:14px 0 0;font-size:16px;line-height:1.5;color:#353a43">${esc(item.d)}</p>` : ''}
  </td></tr>
  <tr><td style="padding:18px 28px 26px"><a href="${esc(item.u)}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 22px;border-radius:6px">Ler a notícia completa</a></td></tr>
  <tr><td style="padding:18px 28px 22px;font-size:12px;line-height:1.55;color:#767c87;border-top:1px solid #e3e4e8">
    Você recebe alertas urgentes porque se inscreveu na newsletter da CNB News.<br>
    <a href="${esc(sair)}" style="color:#767c87">Descadastrar</a> · <a href="${BASE}/privacidade/#newsletter" style="color:#767c87">Privacidade</a> · CNB Mobile LTDA · CNPJ 64.471.793/0001-00
  </td></tr>
</table></td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  const responder = (s, b) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(b)); };
  const segredo = process.env.ALERTA_SECRET;
  if (req.method !== 'POST') return responder(405, { erro: 'metodo' });
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) return responder(401, { erro: 'nao_autorizado' });
  if (!process.env.BREVO_API_KEY || !LISTA() || !process.env.NEWSLETTER_SEGREDO) return responder(503, { erro: 'config' });

  let corpo = {};
  try { corpo = JSON.parse((await lerCorpo(req)) || '{}'); } catch { return responder(400, { erro: 'corpo' }); }
  const alvo = String(corpo.url || '');
  const teste = String(corpo.teste || '').toLowerCase();
  if (!/^https:\/\/([a-z0-9-]+\.)?news\.cnbmobile\.com\//.test(alvo)) return responder(400, { erro: 'url' });

  const r = await fetch(`${BASE}/busca.json`, { signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) return responder(502, { erro: 'indice' });
  const item = (await r.json()).find((i) => i.u === alvo);
  // Recém-aprovada: o site leva ~1 min para publicar. O painel avisa para tentar de novo.
  if (!item) return responder(409, { erro: 'ainda_nao_publicada' });

  const etiqueta = `alerta-${crypto.createHash('sha1').update(alvo).digest('hex').slice(0, 12)}`;
  if (!teste) {
    try {
      const hoje = new Date().toISOString().slice(0, 10), antes = new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10);
      const ag = await brevo(`/smtp/statistics/aggregatedReport?startDate=${antes}&endDate=${hoje}&tag=${etiqueta}`);
      if ((ag?.requests || 0) > 0) return responder(200, { ok: true, pulado: 'ja_enviado', etiqueta });
    } catch { /* sem relatório: segue */ }
  }

  const inscritos = [];
  for (let off = 0; off < 20000; off += 500) {
    const pg = await brevo(`/contacts/lists/${LISTA()}/contacts?limit=500&offset=${off}`);
    for (const c of pg?.contacts || []) {
      if (c.emailBlacklisted) continue;
      const cid = c.attributes?.CIDADE || '';
      if (item.s && cid !== item.s) continue; // notícia de cidade: só quem é de lá
      if (teste && c.email.toLowerCase() !== teste) continue;
      inscritos.push(c.email);
    }
    if ((pg?.contacts || []).length < 500) break;
  }

  let enviados = 0, falhas = 0;
  for (let i = 0; i < inscritos.length; i += 8) {
    const lote = await Promise.allSettled(inscritos.slice(i, i + 8).map((email) => {
      const sair = linkSair(email);
      return brevo('/smtp/email', {
        method: 'POST',
        body: {
          sender: { name: 'CNB News', email: 'noticias@cnbmobile.com' },
          replyTo: { email: 'contato@rafaelmariano.com.br', name: 'Redação CNB News' },
          to: [{ email }],
          subject: `URGENTE: ${item.t}`.slice(0, 120),
          htmlContent: montarAlerta(item, sair),
          tags: [teste ? `${etiqueta}-teste` : etiqueta],
          headers: { 'List-Unsubscribe': `<${sair}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        },
      });
    }));
    for (const x of lote) x.status === 'fulfilled' ? enviados++ : falhas++;
  }
  if (falhas) console.error('[alerta] falhas', falhas);
  return responder(200, { ok: true, titulo: item.t, publico: item.s ? item.c : 'Brasil', enviados, falhas, teste: !!teste });
}
