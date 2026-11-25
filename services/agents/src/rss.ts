// Leitor de RSS 2.0 sem dependências (o guia pede evitar pacotes pesados).
import { createHash } from 'node:crypto';
import type { Fonte, ItemBruto } from './tipos.ts';

export interface ItemRss {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ordm: 'º', ordf: 'ª',
};

export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

function campo(bloco: string, tag: string): string {
  const m = bloco.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  const bruto = m[1].trim();
  const cdata = bruto.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodificarEntidades(bruto);
}

export function extrairItens(xml: string): ItemRss[] {
  const itens: ItemRss[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    itens.push({
      title: htmlParaTexto(campo(b, 'title')),
      link: campo(b, 'link').trim(),
      description: campo(b, 'description'),
      pubDate: campo(b, 'pubDate').trim(),
    });
  }
  return itens;
}

export function htmlParaTexto(html: string): string {
  return decodificarEntidades(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Remove o bloco "Notícias relacionadas:" (títulos curtos de outras matérias) que a
// Agência Brasil injeta no meio do texto — senão o LLM trata como fato desta matéria.
export function limparRelacionadas(texto: string): string {
  const linhas = texto.split('\n');
  const saida: string[] = [];
  let pulando = false;
  for (const l of linhas) {
    if (/^\s*(notícias|leia) relacionadas?:?\s*$/i.test(l) || /^\s*leia também:?\s*$/i.test(l)) {
      pulando = true;
      continue;
    }
    if (pulando && (l.trim() === '' || l.trim().length < 120)) continue;
    pulando = false;
    saida.push(l);
  }
  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function idDoLink(link: string): string {
  return createHash('sha1').update(link).digest('hex').slice(0, 16);
}

export interface OpcoesColeta {
  maxIdadeHoras: number;
  minCaracteres: number;
  agora?: Date;
  fetchImpl?: typeof fetch;
}

export async function coletarFonte(fonte: Fonte, op: OpcoesColeta): Promise<ItemBruto[]> {
  const f = op.fetchImpl ?? fetch;
  const res = await f(fonte.url, {
    headers: { 'User-Agent': 'CNB-News-Bot/1.0 (+https://cnbmobile.com)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${fonte.url}`);
  const xml = await res.text();
  const agora = (op.agora ?? new Date()).getTime();
  const limite = agora - op.maxIdadeHoras * 3_600_000;

  const saida: ItemBruto[] = [];
  for (const it of extrairItens(xml)) {
    if (!it.link || !it.title) continue;
    const data = new Date(it.pubDate);
    if (Number.isNaN(data.getTime()) || data.getTime() < limite) continue;
    const texto = limparRelacionadas(htmlParaTexto(it.description));
    if (texto.length < op.minCaracteres) continue;
    saida.push({
      id: idDoLink(it.link),
      fonte: fonte.nome,
      titulo_original: it.title,
      link_original: it.link,
      conteudo_bruto: texto,
      publicado_em: data.toISOString(),
      categoria_padrao: fonte.categoria_padrao,
    });
  }
  return saida;
}
