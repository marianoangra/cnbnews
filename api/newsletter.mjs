// Cadastro na newsletter da CNB News (Vercel Function, sem dependências).
// Recebe {email, cidade, consentimento, site} e pede à Brevo a confirmação por e-mail (double opt-in, LGPD):
// o contato só entra na lista depois de clicar no link que a Brevo manda.
// Variáveis (Vercel, produção): BREVO_API_KEY, BREVO_LIST_ID, BREVO_DOI_TEMPLATE_ID.
// Sem elas, responde 503 "em_breve" e o formulário avisa que o cadastro abre em breve.
// A conta da Brevo NÃO pode ter restrição de IP: a Vercel muda de IP a cada execução.

const ORIGENS = /^https:\/\/([a-z0-9-]+\.)?(news\.)?cnbmobile\.com$/;
const EMAIL = /^[^\s@<>()",;]{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,24}$/i;
const SLUG = /^[a-z0-9-]{2,60}$/;

function lerCorpo(req) {
  return new Promise((ok, erro) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 4096) { erro(new Error('grande')); req.destroy(); } });
    req.on('end', () => ok(s));
    req.on('error', erro);
  });
}

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}

export default async function handler(req, res) {
  const origem = req.headers.origin || '';
  if (ORIGENS.test(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return responder(res, 204, {});
  if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo' });
  if (origem && !ORIGENS.test(origem)) return responder(res, 403, { erro: 'origem' });

  let dados = {};
  try {
    const bruto = await lerCorpo(req);
    const tipo = String(req.headers['content-type'] || '');
    dados = tipo.includes('application/json') ? JSON.parse(bruto || '{}') : Object.fromEntries(new URLSearchParams(bruto));
  } catch {
    return responder(res, 400, { erro: 'corpo' });
  }

  // "site" é campo-isca escondido: gente não preenche, robô preenche. Finge sucesso para o robô não insistir.
  if (dados.site) return responder(res, 200, { ok: true });

  const email = String(dados.email || '').trim().toLowerCase();
  const cidade = String(dados.cidade || '').trim();
  const consentiu = dados.consentimento === true || dados.consentimento === 'on' || dados.consentimento === 'true';
  if (!EMAIL.test(email) || email.length > 254) return responder(res, 400, { erro: 'email' });
  if (!consentiu) return responder(res, 400, { erro: 'consentimento' });
  if (cidade && !SLUG.test(cidade)) return responder(res, 400, { erro: 'cidade' });

  const { BREVO_API_KEY: chave, BREVO_LIST_ID: lista, BREVO_DOI_TEMPLATE_ID: modelo } = process.env;
  if (!chave || !lista || !modelo) return responder(res, 503, { erro: 'em_breve' });

  try {
    const r = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
      method: 'POST',
      headers: { 'api-key': chave, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        email,
        includeListIds: [Number(lista)],
        templateId: Number(modelo),
        redirectionUrl: 'https://news.cnbmobile.com/newsletter/confirmado/',
        attributes: {
          CIDADE: cidade || 'brasil',
          ORIGEM: 'portal',
          CONSENTIMENTO_EM: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return responder(res, 200, { ok: true });
    const txt = await r.text();
    console.error('[newsletter] brevo', r.status, txt.slice(0, 300));
    // Já cadastrado e confirmado: para o leitor, tudo certo.
    if (r.status === 400 && /already|exist/i.test(txt)) return responder(res, 200, { ok: true });
    return responder(res, 502, { erro: 'provedor' });
  } catch (e) {
    console.error('[newsletter] falha', e && e.message);
    return responder(res, 502, { erro: 'provedor' });
  }
}
