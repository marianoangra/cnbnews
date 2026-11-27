// Notícias que o robô marcou como urgentes (urgencia: urgente | plantao) e já estão no site nas últimas 24 h.
// O painel mostra cada uma com "Enviar alerta por e-mail" / "Não enviar". A decisão fica em
// services/agents/fila-aprovacao/alertas.json (fora do git), para o aviso não voltar.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { filaDir, lerFrontMatter, urlPublica, type Raizes } from './fila.ts';

export interface Urgente {
  arquivo: string;
  titulo: string;
  url: string;
  urgencia: string;
  publicadaEm: string;
  decisao?: { acao: 'enviado' | 'ignorado'; em: string; enviados?: number };
}

const ARQ = /^[\w.-]+\.md$/;
const decisoesArq = (r: Raizes) => join(filaDir(r, 'nacional'), 'alertas.json');

export function decisoes(r: Raizes): Record<string, NonNullable<Urgente['decisao']>> {
  try {
    return JSON.parse(readFileSync(decisoesArq(r), 'utf8'));
  } catch {
    return {};
  }
}

export function registrarDecisao(r: Raizes, arquivo: string, d: NonNullable<Urgente['decisao']>): void {
  if (!ARQ.test(arquivo)) throw new Error('arquivo inválido');
  const todas = decisoes(r);
  todas[arquivo] = d;
  writeFileSync(decisoesArq(r), JSON.stringify(todas, null, 1));
}

export function listarUrgentes(r: Raizes, agoraIso: string, horas = 24): Urgente[] {
  const dir = join(r.repo, 'content', 'noticias');
  if (!existsSync(dir)) return [];
  const desde = Date.parse(agoraIso) - horas * 3600e3;
  const ds = decisoes(r);
  const out: Urgente[] = [];
  for (const f of readdirSync(dir)) {
    if (!ARQ.test(f) || f === '_index.md') continue;
    const { campos } = lerFrontMatter(readFileSync(join(dir, f), 'utf8'));
    const urg = String(campos.urgencia ?? '');
    if (urg !== 'urgente' && urg !== 'plantao') continue;
    const data = String(campos.date ?? '');
    const t = Date.parse(data);
    if (!Number.isFinite(t) || t < desde) continue;
    out.push({ arquivo: f, titulo: String(campos.title ?? f), url: urlPublica('nacional', f), urgencia: urg, publicadaEm: data, decisao: ds[f] });
  }
  return out.sort((a, b) => b.publicadaEm.localeCompare(a.publicadaEm));
}

/** Pede à Vercel o envio do alerta (api/alerta-urgente.mjs). */
export async function dispararAlerta(url: string, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch) {
  const segredo = env.ALERTA_SECRET;
  if (!segredo) throw new Error('ALERTA_SECRET não configurado na rig');
  const r = await fetchImpl(env.ALERTA_URL || 'https://news.cnbmobile.com/api/alerta-urgente', {
    method: 'POST',
    headers: { authorization: `Bearer ${segredo}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(55_000),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; erro?: string; enviados?: number; pulado?: string };
  if (r.status === 409) throw new Error('a notícia ainda está subindo para o site; tente de novo em 1 minuto');
  if (!r.ok || !j.ok) throw new Error(`envio falhou (${r.status} ${j.erro ?? ''})`);
  return j;
}
