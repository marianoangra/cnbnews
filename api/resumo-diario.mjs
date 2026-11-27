// Resumo diário da CNB News por e-mail (Vercel Cron, todo dia entre 7h e 8h de Brasília).
// Lê /busca.json (índice do próprio site), monta um e-mail por leitor (cidade dele + Brasil + Opinião)
// e envia pela Brevo, um envio por pessoa: cada um leva o seu link de descadastro e o cabeçalho
// List-Unsubscribe (1 clique), exigido por Gmail/Yahoo para envio em massa.
// Segurança: só roda com "Authorization: Bearer $CRON_SECRET" (a Vercel manda sozinha no cron).
//   ?teste=email  → envia só para esse e-mail (precisa estar na lista), sem a trava do "já enviado hoje".
//   ?previa=slug  → devolve o HTML do e-mail daquela cidade, sem enviar nada.
// Trava contra envio duplo: se a Brevo já registrou envios com a etiqueta resumo-AAAA-MM-DD, não envia de novo.
import { BASE, LISTA, brevo, linkSair, esc } from './_lib/newsletter.mjs';

const FUSO = 'America/Sao_Paulo';
const JANELA_H = 24;

export function hojeBRT(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}
function dataExtenso(agora) {
  const s = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long' }).format(agora);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function hora(dt) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(new Date(dt)).replace(':', 'h');
}

/** Separa o índice em blocos para uma cidade (slug ou '' = só Brasil). Puro: testável. */
export function selecionar(itens, slug, agora = new Date()) {
  const desde = agora.getTime() - JANELA_H * 3600e3;
  const recentes = itens.filter((i) => { const t = Date.parse(i.dt); return t >= desde && t <= agora.getTime() + 600e3; });
  const brasil = recentes.filter((i) => i.c === 'Brasil').slice(0, 6);
  const cidade = slug ? recentes.filter((i) => i.s === slug).slice(0, 5) : [];
  const desdeColuna = agora.getTime() - 3 * 86400e3;
  const coluna = itens.find((i) => i.c === 'Colunas' && Date.parse(i.dt) >= desdeColuna) || null;
  const nomeCidade = slug ? (itens.find((i) => i.s === slug)?.c || '') : '';
  return { brasil, cidade, coluna, nomeCidade };
}

function blocoItens(titulo, lista, cor = '#c8102e') {
  if (!lista.length) return '';
  const linhas = lista.map((i, n) => `
    <tr><td style="padding:${n ? 14 : 4}px 0 14px;border-bottom:1px solid #e3e4e8">
      <a href="${esc(i.u)}" style="color:#0f1115;text-decoration:none;font-size:18px;line-height:1.3;font-weight:bold">${esc(i.t)}</a>
      ${i.d ? `<div style="margin-top:5px;font-size:14px;line-height:1.45;color:#4a4f58">${esc(i.d)}</div>` : ''}
      <div style="margin-top:6px;font-size:12px;color:#767c87">${esc(i.e)} · ${hora(i.dt)}</div>
    </td></tr>`).join('');
  return `
  <tr><td style="padding:26px 28px 0">
    <div style="font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${cor};border-bottom:2px solid #0f1115;padding-bottom:8px">${esc(titulo)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${linhas}</table>
  </td></tr>`;
}

/** HTML do e-mail. sair = link de descadastro (ou marcador na prévia). */
export function montarEmail(sel, agora, sair) {
  const { brasil, cidade, coluna, nomeCidade } = sel;
  const destaque = cidade[0] || brasil[0];
  const preheader = destaque ? destaque.t : 'As notícias da manhã';
  const opiniao = coluna ? `
  <tr><td style="padding:26px 28px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0d10;border-radius:6px"><tr><td style="padding:18px 20px">
      <div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ff8a9b">Opinião</div>
      <a href="${esc(coluna.u)}" style="display:block;margin-top:6px;color:#ffffff;text-decoration:none;font-size:19px;line-height:1.25;font-weight:bold">${esc(coluna.t)}</a>
      <div style="margin-top:6px;font-size:13px;color:#b9bcc4">Por Rafael Mariano</div>
    </td></tr></table>
  </td></tr>` : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resumo CNB News</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#0f1115">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:20px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
  <tr><td style="background:#0c0d10;padding:18px 28px">
    <a href="${BASE}/" style="text-decoration:none"><span style="display:inline-block;background:#c8102e;color:#fff;font-weight:900;font-size:18px;padding:6px 8px;border-radius:5px">CNB</span> <span style="color:#fff;font-weight:900;font-size:24px;letter-spacing:-1px;vertical-align:middle">NEWS</span></a>
    <div style="margin-top:10px;color:#c9ccd3;font-size:13px">${esc(dataExtenso(agora))} · Resumo da manhã</div>
  </td></tr>
  <tr><td style="padding:24px 28px 0;font-size:16px;line-height:1.5;color:#353a43">Bom dia! Estas são as notícias das últimas 24 horas${nomeCidade ? ` em ${esc(nomeCidade)} e no Brasil` : ' no Brasil'}.</td></tr>
  ${blocoItens(nomeCidade ? `Em ${nomeCidade}` : '', cidade)}
  ${blocoItens('Brasil', brasil)}
  ${opiniao}
  <tr><td style="padding:26px 28px 6px" align="center">
    <a href="${BASE}/" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 20px;border-radius:6px">Ver todas as notícias</a>
  </td></tr>
  <tr><td style="padding:20px 28px 24px;font-size:12px;line-height:1.55;color:#767c87;border-top:1px solid #e3e4e8">
    Você recebe este e-mail porque se inscreveu na newsletter da CNB News. Textos produzidos com apoio de inteligência artificial, sempre com a fonte citada.<br>
    <a href="${esc(sair)}" style="color:#767c87">Descadastrar</a> · <a href="${BASE}/privacidade/#newsletter" style="color:#767c87">Privacidade</a><br>
    CNB News · CNB Mobile LTDA · CNPJ 64.471.793/0001-00
  </td></tr>
</table></td></tr></table></body></html>`;
}

export function assunto(sel) {
  const d = sel.cidade[0] || sel.brasil[0];
  const t = d ? d.t : 'as notícias da manhã';
  return `Bom dia! ${t}`.slice(0, 120);
}

async function todosInscritos() {
  const out = [];
  for (let off = 0; off < 20000; off += 500) {
    const r = await brevo(`/contacts/lists/${LISTA()}/contacts?limit=500&offset=${off}`);
    const cs = r?.contacts || [];
    for (const c of cs) if (!c.emailBlacklisted) out.push({ email: c.email, cidade: c.attributes?.CIDADE || '' });
    if (cs.length < 500) break;
  }
  return out;
}

async function jaEnviadoHoje(etiqueta, dia) {
  try {
    const r = await brevo(`/smtp/statistics/aggregatedReport?startDate=${dia}&endDate=${dia}&tag=${etiqueta}`);
    return (r?.requests || 0) > 0;
  } catch { return false; }
}

async function emLotes(lista, n, fn) {
  const res = [];
  for (let i = 0; i < lista.length; i += n) res.push(...(await Promise.allSettled(lista.slice(i, i + n).map(fn))));
  return res;
}

export default async function handler(req, res) {
  const responder = (s, b) => { res.statusCode = s; res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', typeof b === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'); res.end(typeof b === 'string' ? b : JSON.stringify(b)); };
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) return responder(401, { erro: 'nao_autorizado' });
  if (!process.env.BREVO_API_KEY || !LISTA() || !process.env.NEWSLETTER_SEGREDO) return responder(503, { erro: 'config' });

  const url = new URL(req.url, BASE);
  const agora = new Date();
  const dia = hojeBRT(agora);
  const etiqueta = `resumo-${dia}`;

  const r = await fetch(`${BASE}/busca.json`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return responder(502, { erro: 'indice', status: r.status });
  const itens = await r.json();

  const previa = url.searchParams.get('previa');
  if (previa !== null) return responder(200, montarEmail(selecionar(itens, previa, agora), agora, '#descadastrar'));

  const teste = (url.searchParams.get('teste') || '').toLowerCase();
  if (!teste && await jaEnviadoHoje(etiqueta, dia)) return responder(200, { ok: true, pulado: 'ja_enviado_hoje', dia });

  let inscritos = await todosInscritos();
  if (teste) inscritos = inscritos.filter((c) => c.email.toLowerCase() === teste);

  const cache = new Map();
  const envios = [];
  for (const c of inscritos) {
    const slug = c.cidade && c.cidade !== 'brasil' ? c.cidade : '';
    if (!cache.has(slug)) cache.set(slug, selecionar(itens, slug, agora));
    const sel = cache.get(slug);
    if (!sel.brasil.length && !sel.cidade.length) continue; // dia sem notícia: não manda e-mail vazio
    envios.push({ c, sel });
  }

  const resultado = await emLotes(envios, 8, ({ c, sel }) => {
    const sair = linkSair(c.email);
    return brevo('/smtp/email', {
      method: 'POST',
      body: {
        sender: { name: 'CNB News', email: 'noticias@cnbmobile.com' },
        replyTo: { email: 'contato@rafaelmariano.com.br', name: 'Redação CNB News' },
        to: [{ email: c.email }],
        subject: assunto(sel),
        htmlContent: montarEmail(sel, agora, sair),
        tags: [teste ? `${etiqueta}-teste` : etiqueta],
        headers: { 'List-Unsubscribe': `<${sair}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      },
    });
  });
  const falhas = resultado.filter((x) => x.status === 'rejected');
  if (falhas.length) console.error('[resumo] falhas', falhas.slice(0, 3).map((f) => f.reason?.message));
  return responder(200, { ok: true, dia, inscritos: inscritos.length, enviados: resultado.length - falhas.length, falhas: falhas.length, teste: !!teste });
}
