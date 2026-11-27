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

export function limitarManchete(s: string, max = 70): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max + 1);
  const ultimo = corte.lastIndexOf(' ');
  return (ultimo > 30 ? corte.slice(0, ultimo) : t.slice(0, max)).replace(/[\s,;:–—-]+$/, '');
}
