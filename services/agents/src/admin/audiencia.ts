// Audiência do portal no painel: Google Analytics 4 (Data API), sem dependências.
// Credencial: conta de serviço do Google Cloud com acesso de LEITOR na propriedade GA4.
//   GA4_PROPERTY_ID   = número da propriedade (Admin do GA4 → Detalhes da propriedade)
//   GA4_CREDENCIAIS   = caminho do JSON da conta de serviço na rig (chmod 600, fora do git)
// Sem essas variáveis o painel mostra "falta configurar". Resultado guardado 60 s (cota da API).
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface Audiencia {
  configurado: boolean;
  agora?: number; // usuários ativos nos últimos 30 min
  paginasAgora?: { pagina: string; usuarios: number }[];
  hoje?: { usuarios: number; visualizacoes: number };
  ontem?: { usuarios: number; visualizacoes: number };
  semana?: { usuarios: number; visualizacoes: number };
  atualizadoEm?: string;
  erro?: string;
}

interface Credencial { client_email: string; private_key: string }
let tokenCache: { valor: string; expira: number } | null = null;
let cache: { em: number; dados: Audiencia } | null = null;

const b64 = (x: string | Buffer) => Buffer.from(x).toString('base64url');

export function jwtAssinado(c: Credencial, agoraSeg: number): string {
  const cab = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64(JSON.stringify({
    iss: c.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agoraSeg,
    exp: agoraSeg + 3600,
  }));
  const ass = createSign('RSA-SHA256').update(`${cab}.${corpo}`).sign(c.private_key);
  return `${cab}.${corpo}.${b64(ass)}`;
}

async function tokenGoogle(c: Credencial, f: typeof fetch): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expira > agora + 60) return tokenCache.valor;
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwtAssinado(c, agora) }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google recusou a credencial: ${j.error_description ?? r.status}`);
  tokenCache = { valor: j.access_token, expira: agora + (j.expires_in ?? 3600) };
  return j.access_token;
}

type Linha = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };

async function relatorio(tipo: 'runReport' | 'runRealtimeReport', prop: string, corpo: object, token: string, f: typeof fetch) {
  const r = await f(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:${tipo}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { rows?: Linha[]; error?: { message?: string } };
  if (!r.ok) throw new Error(`GA4: ${j.error?.message ?? r.status}`);
  return j.rows ?? [];
}

const num = (l: Linha | undefined, i = 0) => Number(l?.metricValues?.[i]?.value ?? 0);

export async function audiencia(env: NodeJS.ProcessEnv, f: typeof fetch = fetch, agoraMs = Date.now()): Promise<Audiencia> {
  const prop = env.GA4_PROPERTY_ID, arq = env.GA4_CREDENCIAIS;
  if (!prop || !arq) return { configurado: false };
  if (cache && agoraMs - cache.em < 60_000) return cache.dados;
  try {
    const c = JSON.parse(readFileSync(arq, 'utf8')) as Credencial;
    const t = await tokenGoogle(c, f);
    const [rt, pags, dias] = await Promise.all([
      relatorio('runRealtimeReport', prop, { metrics: [{ name: 'activeUsers' }] }, t, f),
      relatorio('runRealtimeReport', prop, { dimensions: [{ name: 'unifiedScreenName' }], metrics: [{ name: 'activeUsers' }], limit: 5 }, t, f),
      relatorio('runReport', prop, {
        dateRanges: [{ startDate: 'today', endDate: 'today', name: 'hoje' }, { startDate: 'yesterday', endDate: 'yesterday', name: 'ontem' }, { startDate: '6daysAgo', endDate: 'today', name: 'semana' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
      }, t, f),
    ]);
    // Com várias faixas de data, cada linha traz a faixa na última dimensão ("dateRange").
    const faixa = (n: string) => dias.find((l) => l.dimensionValues?.some((d) => d.value === n));
    const par = (n: string) => ({ usuarios: num(faixa(n), 0), visualizacoes: num(faixa(n), 1) });
    const dados: Audiencia = {
      configurado: true,
      agora: num(rt[0]),
      paginasAgora: pags.map((l) => ({ pagina: (l.dimensionValues?.[0]?.value ?? '').replace(/ · CNB News$/, ''), usuarios: num(l) })),
      hoje: par('hoje'),
      ontem: par('ontem'),
      semana: par('semana'),
      atualizadoEm: new Date(agoraMs).toISOString(),
    };
    cache = { em: agoraMs, dados };
    return dados;
  } catch (e) {
    return { configurado: true, erro: e instanceof Error ? e.message : String(e) };
  }
}
