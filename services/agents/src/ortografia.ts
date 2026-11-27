// Corretor ortográfico (LanguageTool 6.6 local na rig, 127.0.0.1:8081, serviço languagetool.service).
// Medido em 27/11/2026 nas 223 matérias no ar: pega erro real que o revisor LLM deixa passar
// ("spriomais", "fundass", "doCampo", "reintroduce", "do emissão"), mas a SUGESTÃO dele erra
// (taubatenses → "taubateenses") e nomes/siglas dão 285 falsos alarmes. Por isso:
//  - NÃO corrige sozinho: aponta, e a matéria vai para a fila de aprovação;
//  - ortografia só de palavra minúscula que não está na fonte (nome e sigla ficam de fora);
//  - gramática só vira aviso (4 de 5 alarmes eram falsos);
//  - corretor fora do ar = matéria segue, com aviso (nunca trava a esteira).

export interface TextoRevisao {
  manchete: string;
  subtitulo: string;
  corpo: string;
  fonteTexto: string; // texto original (Agência Brasil) ou manchete original (cidades)
}

export interface ResultadoOrtografia {
  bloqueia: boolean; // erro de ortografia: vai para a fila
  motivos: string[];
}

interface Match {
  rule: { id: string; category: { id: string } };
  context: { text: string; offset: number; length: number };
  replacements: { value: string }[];
}

// Palavras certas que o dicionário do LanguageTool não conhece (achadas na medição de 27/11).
const CONHECIDAS = new Set([
  'covid', 'nanoempreendedor', 'nanoempreendedores', 'afroindígena', 'afroindígenas', 'metapneumovírus',
  'sublimite', 'sublimites', 'sobrepescada', 'sobrepesca', 'taubatenses', 'pix', 'app', 'apps', 'online',
  'offline', 'podcast', 'streaming', 'bets', 'bet', 'site', 'sites', 'e-mail', 'e-mails', 'link', 'links',
]);

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function palavraSuspeita(w: string, fonteNorm: string): boolean {
  if (!w || !/^\p{Ll}/u.test(w)) return false; // começa em maiúscula = nome/sigla/início de frase
  if (/\d/.test(w)) return false;
  if (CONHECIDAS.has(w.toLowerCase())) return false;
  if (fonteNorm.includes(norm(w))) return false; // veio da fonte: termo técnico ou nome
  return true;
}

function limpar(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split('\n')
    .filter((l) => !l.startsWith('#') && !/^\*Com informações/.test(l))
    .join('\n');
}

async function checar(texto: string, endpoint: string, f: typeof fetch): Promise<Match[]> {
  const corpo = new URLSearchParams({ text: texto, language: 'pt-BR', enabledCategories: 'TYPOS,GRAMMAR', enabledOnly: 'true' });
  const r = await f(`${endpoint}/v2/check`, { method: 'POST', body: corpo, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`LanguageTool HTTP ${r.status}`);
  return ((await r.json()) as { matches: Match[] }).matches;
}

export async function revisarOrtografia(
  t: TextoRevisao,
  endpoint = process.env.LANGUAGETOOL_URL || 'http://127.0.0.1:8081',
  f: typeof fetch = fetch,
): Promise<ResultadoOrtografia> {
  const fonteNorm = norm(t.fonteTexto);
  const motivos: string[] = [];
  let bloqueia = false;
  const campos: [string, string][] = [['manchete', t.manchete], ['linha fina', t.subtitulo], ['texto', limpar(t.corpo)]];
  try {
    for (const [campo, texto] of campos) {
      if (!texto.trim()) continue;
      for (const m of await checar(texto, endpoint, f)) {
        const w = m.context.text.slice(m.context.offset, m.context.offset + m.context.length);
        const sug = m.replacements.slice(0, 2).map((r) => r.value).join(' / ');
        if (m.rule.id.startsWith('MORFOLOGIK')) {
          if (!palavraSuspeita(w, fonteNorm)) continue;
          bloqueia = true;
          motivos.push(`ortografia (${campo}): "${w}"${sug ? ` → ${sug}?` : ''}`);
        } else if (m.rule.category.id === 'GRAMMAR') {
          const trecho = m.context.text.slice(Math.max(0, m.context.offset - 15), m.context.offset + m.context.length + 15).trim();
          motivos.push(`gramática? (${campo}): "…${trecho}…"${sug ? ` → ${sug}` : ''}`);
        }
      }
    }
  } catch (err) {
    return { bloqueia: false, motivos: [`corretor ortográfico fora do ar (${err instanceof Error ? err.message : err})`] };
  }
  return { bloqueia, motivos: [...new Set(motivos)].slice(0, 8) };
}
