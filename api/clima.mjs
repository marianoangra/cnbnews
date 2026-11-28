// Clima do cabeçalho (Vercel Function, sem dependências).
// Cidade do visitante: cabeçalhos de geolocalização por IP da Vercel (x-vercel-ip-*), sem pedir
// permissão de localização no navegador. Nas páginas de cidade, o site manda ?lat&lon&nome da própria cidade.
// Previsão: MET Norway (api.met.no), gratuita e com USO COMERCIAL permitido (CC BY 4.0, crédito no
// title do widget). O Open-Meteo gratuito proíbe uso comercial (o site tem AdSense) — por isso não ele.
// Termos do MET: User-Agent identificado, coordenadas com no máximo 4 casas e cache (aqui 20 min por
// ponto de ~11 km, em memória da função e na CDN quando a URL tem coordenadas).

const UA = 'CNBNewsClima/1.0 (+https://news.cnbmobile.com/contato/)';
const TTL = 20 * 60 * 1000;
const cache = new Map();
// Sem geolocalização (fora do Brasil, robô, IP desconhecido): São Paulo.
const PADRAO = { lat: -23.55, lon: -46.63, nome: 'São Paulo', uf: 'SP' };

// symbol_code do MET → ícone do site + texto. Sufixos _day/_night/_polartwilight saem antes.
const SIMBOLOS = [
  [/thunder/, 'tempestade', 'Tempestade'],
  [/heavyrain/, 'chuva', 'Chuva forte'],
  [/lightrain/, 'chuvisco', 'Chuva fraca'],
  [/rain/, 'chuva', 'Chuva'],
  [/sleet|snow/, 'neve', 'Neve'],
  [/fog/, 'neblina', 'Neblina'],
  [/^cloudy/, 'nuvem', 'Nublado'],
  [/partlycloudy/, 'sol-nuvem', 'Parcialmente nublado'],
  [/fair/, 'sol-nuvem', 'Poucas nuvens'],
  [/clearsky/, 'sol', 'Céu limpo'],
];

export function traduzir(codigo = '') {
  const noite = /_night$/.test(codigo);
  const base = codigo.replace(/_(day|night|polartwilight)$/, '');
  const achado = SIMBOLOS.find(([re]) => re.test(base));
  let [, icone, texto] = achado ?? [null, 'nuvem', 'Tempo instável'];
  if (noite && icone === 'sol') icone = 'lua';
  if (noite && icone === 'sol-nuvem') icone = 'lua-nuvem';
  return { icone, texto };
}

function numero(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function local(req) {
  const u = new URL(req.url, 'https://news.cnbmobile.com');
  const lat = numero(u.searchParams.get('lat'), -34, 6);
  const lon = numero(u.searchParams.get('lon'), -75, -28);
  if (lat !== null && lon !== null) {
    const nome = (u.searchParams.get('nome') || '').replace(/[^\p{L}\p{N} '().-]/gu, '').slice(0, 60);
    return { lat, lon, nome, uf: '', fixo: true };
  }
  const h = req.headers;
  const glat = numero(h['x-vercel-ip-latitude'], -34, 6);
  const glon = numero(h['x-vercel-ip-longitude'], -75, -28);
  if (h['x-vercel-ip-country'] === 'BR' && glat !== null && glon !== null) {
    let nome = '';
    try { nome = decodeURIComponent(h['x-vercel-ip-city'] || ''); } catch { nome = ''; }
    return { lat: glat, lon: glon, nome, uf: String(h['x-vercel-ip-country-region'] || '').slice(0, 2), fixo: false };
  }
  return { ...PADRAO, fixo: false };
}

// Máxima e mínima das PRÓXIMAS 24 h: "de hoje" à noite só sobravam 2 horas (máx = mín = agora).
export function resumir(json, agora = new Date()) {
  const serie = json?.properties?.timeseries ?? [];
  if (!serie.length) return null;
  const atual = serie.find((p) => Date.parse(p.time) >= agora.getTime() - 3600_000) ?? serie[0];
  const temp = atual.data?.instant?.details?.air_temperature;
  const codigo = atual.data?.next_1_hours?.summary?.symbol_code ?? atual.data?.next_6_hours?.summary?.symbol_code;
  if (!Number.isFinite(temp)) return null;
  const ate = agora.getTime() + 24 * 3600_000;
  const doDia = serie
    .filter((p) => Date.parse(p.time) >= agora.getTime() - 3600_000 && Date.parse(p.time) <= ate)
    .map((p) => p.data?.instant?.details?.air_temperature)
    .filter(Number.isFinite);
  const chuva = atual.data?.next_6_hours?.details?.precipitation_amount;
  return {
    temp: Math.round(temp),
    max: doDia.length ? Math.round(Math.max(...doDia)) : null,
    min: doDia.length ? Math.round(Math.min(...doDia)) : null,
    chuva6h: Number.isFinite(chuva) ? chuva : null,
    ...traduzir(codigo),
  };
}

async function previsao(lat, lon, f = fetch) {
  const k = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const c = cache.get(k);
  if (c && Date.now() - c.t < TTL) return c.d;
  const r = await f(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`MET ${r.status}`);
  const d = resumir(await r.json());
  if (!d) throw new Error('MET sem dados');
  if (cache.size > 500) cache.clear();
  cache.set(k, { t: Date.now(), d });
  return d;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const l = local(req);
    const p = await previsao(l.lat, l.lon);
    // Com coordenadas na URL a resposta é igual para todos: a CDN guarda. Pela geolocalização, só o navegador.
    res.setHeader('Cache-Control', l.fixo ? 'public, max-age=600, s-maxage=1200' : 'private, max-age=900');
    res.statusCode = 200;
    res.end(JSON.stringify({ cidade: l.nome, uf: l.uf, ...p, fonte: 'MET Norway' }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ erro: 'sem_previsao' }));
  }
}
