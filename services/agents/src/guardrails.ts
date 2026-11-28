// Travas determinísticas (CLAUDE.md §5). Rodam DEPOIS do LLM e não confiam nele:
// o score final é o maior entre o do revisor e o destas regras.

export const CLAUSULA_CONTRADITORIO =
  'A reportagem procurou a defesa/assessoria do(s) citado(s) e o espaço permanece aberto para manifestação e devida atualização desta matéria.';

export const LIMITE_SCORE_HUMANO = 4;

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface Regra {
  motivo: string;
  score: number;
  re: RegExp;
}

// Presunção de inocência (CF art. 5º, LVII): termos condenatórios sem trânsito em julgado.
const CONDENATORIOS: Regra = {
  motivo: 'termo condenatório (presunção de inocência)',
  score: 5,
  re: /\b(culpad[oa]s?|assassin[oa]s?|corrupt[oa]s?|ladr(ao|oes|a|as)|bandid[oa]s?|criminos[oa]s?|estuprador(es)?|pedofil[oa]s?|traficantes?|golpistas?|mafios[oa]s?)\b/,
};

// Gatilhos críticos que exigem aprovação humana.
const CRITICOS: Regra[] = [
  { motivo: 'crime violento', score: 5, re: /\b(chacina|massacre|homicidios?|assassinat[oa]s?|latrocinios?|feminicidios?|estupros?|sequestros?|tiroteios?|mort[oa]s? a tiros|balead[oa]s?|esfaquead[oa]s?)\b/ },
  { motivo: 'operação policial', score: 4, re: /\b(operacao policial|confronto com a policia|troca de tiros|preso em flagrante|prisao em flagrante|flagrante)\b/ },
  { motivo: 'crime hediondo', score: 5, re: /\b(hediondo|abuso sexual|exploracao sexual|trabalho escravo|tortura)\b/ },
  { motivo: 'acusação de corrupção', score: 4, re: /\b(corrupcao|propinas?|lavagem de dinheiro|desvio de (recursos|verbas|dinheiro)|peculato|improbidade)\b/ },
];

// ECA: menor + contexto de crime na MESMA frase.
const MENOR = /\b(menor(es)? de idade|menor(es)?|criancas?|adolescentes?|bebes?|recem-nascid[oa]s?|alun[oa]s?|estudantes?|garot[oa]s?|menin[oa]s?)\b/;
const CONTEXTO_CRIME = /\b(crimes?|infracion\w*|apreendid[oa]s?|vitimas?|violencia|abus\w*|agredid[oa]s?|agress\w*|mort[oa]s?|assassinad[oa]s?|estuprad[oa]s?|desaparecid[oa]s?|sequestrad[oa]s?|policia|balead[oa]s?|esfaquead[oa]s?|tiros?)\b/;

// Palavras que indicam acusação → exige cláusula de contraditório (Lei 13.188/2015).
const ACUSACAO = /\b(investigad[oa]s?|denunciad[oa]s?|suspeit[oa]s?|acusad[oa]s?|reus?|indiciad[oa]s?|pres[oa]s?|processad[oa]s?|alvos? de (uma )?operacao|denuncia|acusacao|inquerito)\b/;

const CLICKBAIT = [
  /voce nao vai acreditar/,
  /\bveja (o que|como|quem)\b/,
  /\bchocante\b/,
  /\binacreditavel\b/,
  /ninguem esperava/,
  /\bsurpreendente\b/,
  /\bdescubra\b/,
  /o motivo vai/,
  /\bbomba\b/,
];

export function frases(texto: string): string[] {
  return texto.split(/(?<=[.!?])\s+|\n+/).filter((f) => f.trim().length > 0);
}

// Fração dos trechos de 8 palavras do texto gerado que aparecem iguais no original.
export function similaridade(original: string, gerado: string, n = 8): number {
  const palavras = (s: string) => normalizar(s).match(/[a-z0-9]+/g) ?? [];
  const shingles = (p: string[]) => {
    const set = new Set<string>();
    for (let i = 0; i + n <= p.length; i++) set.add(p.slice(i, i + n).join(' '));
    return set;
  };
  const g = shingles(palavras(gerado));
  if (g.size === 0) return 0;
  const o = shingles(palavras(original));
  let iguais = 0;
  for (const s of g) if (o.has(s)) iguais++;
  return iguais / g.size;
}

export const LIMITE_SIMILARIDADE = 0.5;

export interface EntradaGuardrails {
  manchete: string;
  subtitulo: string;
  corpo: string;
  fonte: string;
  textoOriginal: string;
  scoreLlm: number;
  llmPediuHumano: boolean;
}

export interface ResultadoGuardrails {
  score: number;
  requerHumano: boolean;
  motivos: string[];
  corpoFinal: string;
}

export function aplicarGuardrails(e: EntradaGuardrails): ResultadoGuardrails {
  const motivos: string[] = [];
  let score = Math.min(5, Math.max(1, Math.round(Number.isFinite(e.scoreLlm) ? e.scoreLlm : 1)));
  if (score >= LIMITE_SCORE_HUMANO) motivos.push(`revisor LLM deu score ${score}`);
  if (e.llmPediuHumano) motivos.push('revisor LLM pediu aprovação humana');

  const tudo = `${e.manchete}\n${e.subtitulo}\n${e.corpo}`;
  const norm = normalizar(tudo);

  const subir = (r: Regra) => {
    if (r.re.test(norm)) {
      score = Math.max(score, r.score);
      motivos.push(r.motivo);
    }
  };
  subir(CONDENATORIOS);
  CRITICOS.forEach(subir);

  if (frases(norm).some((f) => MENOR.test(f) && CONTEXTO_CRIME.test(f))) {
    score = 5;
    motivos.push('menor de idade em contexto de crime/vítima (ECA)');
  }

  const titulos = normalizar(`${e.manchete}\n${e.subtitulo}`);
  if (CLICKBAIT.some((re) => re.test(titulos))) {
    score = Math.max(score, 4);
    motivos.push('manchete com padrão de clickbait');
  }

  const sim = similaridade(e.textoOriginal, e.corpo);
  if (sim > LIMITE_SIMILARIDADE) {
    score = Math.max(score, 4);
    motivos.push(`texto ${Math.round(sim * 100)}% igual à fonte (cópia, não reescrita)`);
  }

  let corpo = e.corpo.trim();

  // Fonte primária sempre citada no corpo.
  if (!normalizar(corpo).includes(normalizar(e.fonte))) {
    corpo += `\n\n*Com informações da ${e.fonte}.*`;
  }

  // Contraditório sempre que houver acusação/investigação.
  if (ACUSACAO.test(norm) && !corpo.includes(CLAUSULA_CONTRADITORIO)) {
    corpo += `\n\n*${CLAUSULA_CONTRADITORIO}*`;
  }

  const requerHumano = score >= LIMITE_SCORE_HUMANO || e.llmPediuHumano;
  return { score, requerHumano, motivos: [...new Set(motivos)], corpoFinal: corpo };
}

export function slugificar(s: string, max = 60): string {
  const base = normalizar(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length <= max) return base;
  const corte = base.slice(0, max);
  const ultimo = corte.lastIndexOf('-');
  return (ultimo > 20 ? corte.slice(0, ultimo) : corte).replace(/-+$/, '');
}

/**
 * Linha fina cabendo em `max` sem deixar frase pela metade. Cortar na última palavra gerava
 * "Dados revelam perfil de meninas, pretas" (o original dizia "pretas ou pardas"): o pedaço
 * distorce o dado. Corta na última frase completa; sem frase longa o bastante, corta na palavra e põe "…".
 */
export function limitarLinhaFina(s: string, max = 155): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max + 1);
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '));
  if (fim >= 60) return corte.slice(0, fim + 1);
  const ultimo = corte.slice(0, max).lastIndexOf(' ');
  return (ultimo > 30 ? corte.slice(0, ultimo) : t.slice(0, max - 1)).replace(/[\s,;:–—-]+$/, '') + '…';
}

export function limitarManchete(s: string, max = 70): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max + 1);
  const ultimo = corte.lastIndexOf(' ');
  let m = (ultimo > 30 ? corte.slice(0, ultimo) : t.slice(0, max)).replace(/[\s,;:–—-]+$/, '');
  // Corte na palavra ainda pode deixar preposição/artigo solto no fim ("…no Ministério da", 27/11/2026).
  const SOLTA = /\s+(da|de|do|das|dos|na|no|nas|nos|em|com|para|pra|por|pelo|pela|ao|aos|à|às|a|o|as|os|e|ou|que|um|uma|sobre|entre|após|sem|contra)$/i;
  while (SOLTA.test(m) && m.length > 30) m = m.replace(SOLTA, '').replace(/[\s,;:–—-]+$/, '');
  return m;
}

// O qwen3:4b às vezes mistura o mês em inglês/espanhol com o português ("Decembro" na manchete
// de 27/11/2026). Troca determinística, preservando a maiúscula inicial. Fora: "Julio"/"Junio" (nomes de gente).
const MESES_ERRADOS: [RegExp, string][] = [
  [/\b(january|janeiro?u|enero)\b/gi, 'janeiro'],
  [/\b(february|febrero|feverero)\b/gi, 'fevereiro'],
  [/\b(march|marzo)\b/gi, 'março'],
  [/\b(june)\b/gi, 'junho'],
  [/\b(july)\b/gi, 'julho'],
  [/\b(august)\b/gi, 'agosto'],
  [/\b(september|septiembre|setiembre|setembre)\b/gi, 'setembro'],
  [/\b(october|octubre|octubro|otubro)\b/gi, 'outubro'],
  [/\b(november|noviembre|novembre)\b/gi, 'novembro'],
  [/\b(december|diciembre|decembro|dezember)\b/gi, 'dezembro'],
];

export function corrigirMeses(s: string): string {
  let t = s;
  for (const [re, certo] of MESES_ERRADOS) {
    t = t.replace(re, (m) => (m[0] === m[0].toUpperCase() ? certo[0].toUpperCase() + certo.slice(1) : certo));
  }
  return t;
}
