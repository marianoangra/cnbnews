// Esteira sequencial, uma matéria por vez, dividida entre as duas GPUs:
//   1 Triagem/score de sensibilidade → fast  (RTX 2060)
//   2 Redação em Markdown            → heavy (RTX 3060)
//   3 Revisão ética/jurídica         → heavy
//   4 Manchete, SEO e metadados      → heavy
//   5 Lauda da live/rádio + GC       → fast
// Depois do LLM, as travas determinísticas (guardrails.ts) têm a palavra final.
import { aplicarGuardrails, corrigirMeses, limitarLinhaFina, limitarManchete, normalizar, slugificar } from './guardrails.ts';
import { booleano, listaTexto, numero, objeto, pareceMolde, texto, textoOpcional, type Llm } from './ollama.ts';
import {
  PROMPT_EDITOR_SEO,
  PROMPT_LAUDA,
  PROMPT_REDATOR,
  PROMPT_REVISOR,
  PROMPT_TRIAGEM,
  promptLauda,
  promptRedacao,
  promptRevisao,
  promptSeo,
  promptTriagem,
} from './prompts.ts';
import {
  AUTOR_PADRAO,
  CATEGORIAS,
  type ArticlePayload,
  type Categoria,
  type ItemBruto,
  type LaudaYoutube,
  type Urgencia,
} from './tipos.ts';

export interface Llms {
  heavy: Llm; // RTX 3060 — qwen2.5:14b
  fast: Llm; // RTX 2060 — qwen2.5:3b
}

// Qual GPU faz cada etapa. Colunista (Kiwify) fica na pesada quando a esteira dele existir.
export const ROTAS = {
  triagem: 'fast',
  redacao: 'heavy',
  revisao: 'heavy',
  seo: 'heavy',
  lauda: 'fast',
  colunista: 'heavy',
} as const satisfies Record<string, keyof Llms>;

export interface OpcoesEsteira {
  // Caracteres do texto da agência que entram no prompt. O Revisor recebe original +
  // matéria + resposta, então isso acompanha o num_ctx da GPU pesada.
  maxEntrada?: number;
}

export function maxEntradaPara(numCtx: number): number {
  return numCtx >= 8192 ? 9000 : 4500; // ~2.600 / ~1.300 tokens
}

// Feed de editoria (esportes, política...) = a Agência Brasil já classificou: vale a dela.
// O modelo só decide o que vem dos feeds gerais (categoria_padrao 'brasil') — antes ele jogava
// quase tudo em "brasil" e Política tinha 1 matéria em 53.
// Do feed geral, o modelo errava (festival de cinema em "agro"). Só aceita a editoria se o título ou o
// começo do texto tiver palavras do assunto; senão fica "brasil".
const CONFIRMA: Partial<Record<Categoria, { test(s: string): boolean }>> = {
  agro: /\b(agro\w*|safra|soja|milho|caf[eé]|boi|gado|pecu[aá]ri\w*|rural|produtor\w* rura\w*|lavoura|colheita|pesca|pesqueir\w*|aquicultura|embrapa|conab|fertiliz\w*|agr[ií]col\w*)\b/i,
  esportes: /\b(futebol|jogo|partida|campeonato|copa|sele[cç][aã]o|atleta|olimp\w*|paral[ií]mp\w*|medalha|t[eé]cnico|gol|v[oô]lei|basquete|t[eê]nis|corrida|brasileir[aã]o|libertadores|clube)\b/i,
  saude: /\b(sa[uú]de|sus|hospita\w*|vacina\w*|doen[cç]a\w*|m[eé]dic\w*|anvisa|dengue|covid|epidemi\w*|tratamento|paciente\w*|ubs|minist[eé]rio da sa[uú]de)\b/i,
  natureza: /\b(ambient\w*|clima\w*|floresta|desmatamento|amaz[oô]nia|cerrado|pantanal|rio|chuva|seca|queimada\w*|inc[eê]ndio florestal|esp[eé]cie|fauna|flora|cop\d*|ibama|icmbio|carbono)\b/i,
  entretenimento: /\b(m[uú]sic\w*|cinema|filme\w*|festival|show|novela|s[eé]rie|teatro|livro\w*|artista\w*|cultura\w*|exposi[cç][aã]o|carnaval|cantor\w*|[aá]lbum)\b/i,
  politica: /\b(lula|congresso|c[aâ]mara|senado|deputad\w*|senador\w*|stf|ministro\w*|governo|presidente|elei[cç]\w*|partido|pol[ií]tic\w*|planalto|tse)\b/i,
  // "IA" só em maiúsculas ("ele ia" não é tecnologia); "golpe" sozinho é golpe de Estado, então só golpe digital.
  tecnologia: { test: (s: string) => /\bIA\b/.test(s) || /\b(tecnolog\w*|digita(l|is)|intelig[eê]ncia artificial|internet|celular\w*|smartphone\w*|5g|anatel|aplicativo\w*|ciber\w*|hacker\w*|golpes? (digita\w*|virtua\w*|pelo (celular|whatsapp)|do pix)|vazamento de dados|dados pessoais|lgpd|big techs?|redes sociais|plataformas? digita\w*|algoritmo\w*|computa\w*|semicondutor\w*|chips?|startups?|sat[eé]lite\w*|software|rob[oô]\w*|inova[cç][aã]o|ci[eê]ncia e tecnologia|mcti)\b/i.test(s) },
  economia: /\b(econom\w*|infla[cç][aã]o|juros|selic|pib|d[oó]lar|bolsa|ibovespa|emprego|desemprego|renda|imposto\w*|receita federal|banco central|mercado)\b/i,
};

export function categoriaValida(v: string | undefined, padrao: Categoria, texto = ''): Categoria {
  if (padrao !== 'brasil') return padrao;
  const c0 = (v ?? '').trim().toLowerCase() as Categoria;
  const conf = CONFIRMA[c0];
  if (conf && texto && !conf.test(texto)) return 'brasil';
  const c = c0 as string;
  return (CATEGORIAS as readonly string[]).includes(c) && c !== 'entrevistas' ? (c as Categoria) : padrao;
}

function urgenciaValida(v: string | undefined): Urgencia {
  const u = (v ?? '').trim().toLowerCase();
  if (u === 'urgente') return 'urgente';
  if (u === 'plantao' || u === 'plantao_urgente' || u === 'plantão') return 'plantao';
  return 'normal';
}

// Aceita um Llm só (as duas etapas no mesmo modelo, como antes do dual-GPU) ou o par.
function normalizarLlms(l: Llm | Llms): Llms {
  return 'gerarJson' in l ? { heavy: l, fast: l } : l;
}

export async function processarItem(item: ItemBruto, llms: Llm | Llms, opcoes: OpcoesEsteira = {}): Promise<ArticlePayload> {
  const gpu = normalizarLlms(llms);
  const llm = (etapa: keyof typeof ROTAS) => gpu[ROTAS[etapa]];
  const original = item.conteudo_bruto.slice(0, opcoes.maxEntrada ?? 4500);

  // 1. Triagem (fast)
  const triagem = await triar(llm('triagem'), item, original);

  // 2. Redação (heavy)
  const redacao = await llm('redacao').gerarJson(
    PROMPT_REDATOR,
    promptRedacao(item.titulo_original, item.fonte, original),
    (x) => {
      const o = objeto(x);
      return {
        categoria: textoOpcional(o, 'categoria'),
        urgencia: textoOpcional(o, 'urgencia'),
        corpo: corrigirAnos(texto(o, 'corpo_artigo_markdown', 200)),
        fontes: listaTexto(o, 'fontes_creditadas'),
      };
    },
    0.2,
  );

  // 3. Revisão ética/jurídica e fact-checking (heavy)
  const revisao = await llm('revisao').gerarJson(
    PROMPT_REVISOR,
    promptRevisao(original, redacao.corpo),
    (x) => {
      const o = objeto(x);
      // O revisor NÃO reescreve a matéria (o modelo pequeno falhava em devolver o texto
      // inteiro): aponta correções pontuais e o código aplica só as que batem com o texto.
      const alertas = listaTexto(o, 'alertas_ao_editor').filter((a) => !pareceMolde(a) && a !== '...');
      const r = aplicarCorrecoes(redacao.corpo, lerCorrecoes(o.correcoes), item.fonte);
      if (r.ignoradas > 0) alertas.push(`revisor: ${r.ignoradas} correção(ões) ignorada(s) (trecho inexistente ou que tirava a fonte)`);
      // Reescrever demais é verbosidade do modelo, não sinal de risco: segue o texto do
      // redator (a nota de risco do revisor e as travas continuam valendo).
      if (r.excedeu) alertas.push('revisor tentou alterar mais de 40% da matéria; correções não aplicadas');
      return {
        corpo: r.corpo,
        score: numero(o, 'score_risco_juridico', 3),
        humano: booleano(o, 'requer_aprovacao_humana'),
        alertas,
      };
    },
    0.1,
  );

  // 4. Manchete, SEO e metadados (heavy)
  const validarSeo = (x: unknown) => {
    const o = objeto(x);
    return { manchete: texto(o, 'manchete_home', 10), subtitulo: texto(o, 'subtitulo', 10) };
  };
  let seo = await llm('seo').gerarJson(PROMPT_EDITOR_SEO, promptSeo(revisao.corpo), validarSeo, 0.3);
  if (seo.manchete.length > 70) {
    seo = await llm('seo').gerarJson(PROMPT_EDITOR_SEO, promptSeo(revisao.corpo, seo.manchete), validarSeo, 0.3);
  }
  const manchete = limitarManchete(corrigirMeses(seo.manchete), 70);
  const subtitulo = limitarLinhaFina(corrigirMeses(seo.subtitulo), 155);

  // Score final = maior entre triagem, revisor e travas determinísticas.
  const g = aplicarGuardrails({
    manchete,
    subtitulo,
    corpo: corrigirMeses(revisao.corpo),
    fonte: item.fonte,
    textoOriginal: item.conteudo_bruto,
    scoreLlm: Math.max(triagem.score, revisao.score),
    llmPediuHumano: revisao.humano,
  });
  const motivosTriagem = triagem.score >= 4 ? [`triagem deu score ${triagem.score}`] : [];

  // 5. Lauda da live/rádio (fast) — só para o que vai ao ar sem revisão humana.
  const lauda = g.requerHumano ? undefined : await gerarLauda(llm('lauda'), manchete, g.corpoFinal, item.fonte);

  const fontes = [...new Set([item.fonte, ...redacao.fontes])];
  return {
    id: item.id,
    categoria: categoriaValida(redacao.categoria, item.categoria_padrao, `${item.titulo_original} ${item.conteudo_bruto.slice(0, 600)}`),
    urgencia: urgenciaValida(redacao.urgencia),
    manchete_home: manchete,
    subtitulo,
    slug: slugificar(manchete) || item.id,
    corpo_artigo_md: g.corpoFinal,
    ...(lauda ? { lauda_youtube: lauda } : {}),
    fontes_verificadas: fontes,
    fonte_url: item.link_original,
    score_sensibilidade: g.score,
    requer_aprovacao_humana: g.requerHumano,
    motivos_revisao: [
      ...motivosTriagem,
      ...g.motivos,
      ...triagem.motivos,
      ...revisao.alertas.map((a) => `alerta do revisor: ${a}`),
    ],
    autor_atribuicao: AUTOR_PADRAO,
    publicado_em: new Date().toISOString(),
  };
}

// O modelo formata anos como milhar ("2.027"). Mesmo ajuste do limpar_texto_ia do robo_cnb.py.
export function corrigirAnos(s: string): string {
  // "2.027" -> "2027" (anos 2020-2039); não mexe em dinheiro ("R$ 2.030") nem em
  // números maiores ("1.2.030" / "12.030")
  return s.replace(/(^|[^\d.,$])(\s*)2\.0([23]\d)(?![\d.,])/g, (m, antes: string, esp: string, ano: string, i: number, all: string) =>
    /R\$\s*$/.test(all.slice(Math.max(0, i - 3), i + antes.length + esp.length)) ? m : `${antes}${esp}20${ano}`,
  );
}

export interface Correcao {
  trecho: string;
  correcao: string;
}

export function lerCorrecoes(v: unknown): Correcao[] {
  if (!Array.isArray(v)) return [];
  const out: Correcao[] = [];
  for (const c of v.slice(0, 8)) {
    if (typeof c !== 'object' || c === null) continue;
    const { trecho, correcao } = c as Record<string, unknown>;
    if (typeof trecho !== 'string' || typeof correcao !== 'string') continue;
    out.push({ trecho: trecho.trim(), correcao: correcao.trim() });
  }
  return out;
}

const LIMITE_ALTERACAO = 0.4;

// Aplica só correções cujo trecho existe literalmente no texto. Apagar = correcao vazia.
// Se a soma do que mudaria passar de 40% do texto, não aplica nada (vai para revisão humana).
export function aplicarCorrecoes(
  corpo: string,
  correcoes: Correcao[],
  fonte = '',
): { corpo: string; aplicadas: number; ignoradas: number; excedeu: boolean } {
  const validas: Correcao[] = [];
  let ignoradas = 0;
  const f = normalizar(fonte);
  for (const c of correcoes) {
    const util = c.trecho.length >= 8 && c.trecho !== c.correcao && !pareceMolde(c.trecho) && !pareceMolde(c.correcao);
    // nunca deixa o revisor apagar o crédito da fonte primária (CLAUDE.md §5B)
    const tiraFonte = f !== '' && normalizar(c.trecho).includes(f) && !normalizar(c.correcao).includes(f);
    if (util && !tiraFonte && corpo.includes(c.trecho)) validas.push(c);
    else if (c.trecho) ignoradas++;
  }
  const alterado = validas.reduce((n, c) => n + c.trecho.length, 0);
  if (alterado > corpo.length * LIMITE_ALTERACAO) return { corpo, aplicadas: 0, ignoradas, excedeu: true };
  let novo = corpo;
  for (const c of validas) novo = novo.replace(c.trecho, c.correcao);
  // apagar um trecho pode deixar espaço duplo ou espaço antes de pontuação
  novo = novo.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1');
  return { corpo: novo, aplicadas: validas.length, ignoradas, excedeu: false };
}

// O trecho citado pela triagem existe mesmo no texto? (citação, não paráfrase nem invenção)
export function trechoNoTexto(trecho: string, texto: string): boolean {
  const palavras = (s: string) => normalizar(s).match(/[a-z0-9]+/g) ?? [];
  const t = palavras(trecho);
  if (t.length === 0) return false;
  const alvo = ` ${palavras(texto).join(' ')} `;
  if (t.length <= 4) return alvo.includes(` ${t.join(' ')} `);
  let achou = 0;
  let total = 0;
  for (let i = 0; i + 4 <= t.length; i++) {
    total++;
    if (alvo.includes(` ${t.slice(i, i + 4).join(' ')} `)) achou++;
  }
  return achou / total >= 0.7;
}

// Vocabulário que torna PLAUSÍVEL uma notícia ser sensível. Mais largo que as travas de
// guardrails.ts (que sozinhas já sobem o score): aqui só serve de prova para aceitar o
// score alto da triagem quando o modelo não cita o trecho literal.
const LEXICO_SENSIVEL =
  /\b(mort[oa]s?|morte|morreu|morreram|obitos?|homicid\w*|assassin\w*|feminicid\w*|latrocin\w*|chacina|tiros?|baleado\w*|esfaque\w*|agredid\w*|agress\w*|violen\w*|estupr\w*|abusos?|sequestr\w*|assalt\w*|roub\w*|furt\w*|crimes?|criminos\w*|infracion\w*|pres[oa]s?|prisao|prend\w*|apreend\w*|detid[oa]s?|flagrante|suspeit\w*|investigad\w*|investigac\w*|inquerito|denunci\w*|acusad\w*|acusac\w*|indiciad\w*|reus?|condenad\w*|operacao|policia\w*|delegacia|fraudes?|desvi\w*|propinas?|corrupc\w*|lavagem|contraband\w*|trafic\w*|falsificad\w*|vitimas?|ferid[oa]s?|tragedia|acidentes?)\b/;

export function termoSensivel(texto: string): string | undefined {
  return normalizar(texto).match(LEXICO_SENSIVEL)?.[0];
}

export interface Triagem {
  score: number;
  motivos: string[];
}

// Triagem só pode SUBIR o score com prova — o modelo de 3b inventa motivo e copia o prompt.
// Prova = trecho citado que existe no texto OU termo do vocabulário sensível no texto.
// Sem prova, score >= 3 é ignorado. Se o modelo falhar, a matéria segue: o Revisor e as
// travas determinísticas continuam pontuando.
export async function triar(llm: Llm, item: ItemBruto, original: string): Promise<Triagem> {
  try {
    const r = await llm.gerarJson(
      PROMPT_TRIAGEM,
      promptTriagem(item.titulo_original, item.fonte, original.slice(0, 3000)),
      (x) => {
        const o = objeto(x);
        return {
          score: Math.min(5, Math.max(1, Math.round(numero(o, 'score', 1)))),
          trecho: textoOpcional(o, 'trecho') ?? '',
        };
      },
      0.1,
    );
    if (r.score < 3) return { score: r.score, motivos: [] };
    const texto = `${item.titulo_original}\n${original}`;
    if (trechoNoTexto(r.trecho, texto)) return { score: r.score, motivos: [`triagem: "${r.trecho.slice(0, 120)}"`] };
    // termo sensível só vale no título + lead (pirâmide invertida): "sites suspeitos" no
    // 8º parágrafo de uma pesquisa de consumo não torna a pauta policial
    const termo = termoSensivel(`${item.titulo_original}\n${original.slice(0, 600)}`);
    if (termo) return { score: r.score, motivos: [`triagem: score ${r.score} (termo sensível no texto: "${termo}")`] };
    const citado = r.trecho ? `"${r.trecho.slice(0, 80)}"` : 'nenhum';
    return { score: 1, motivos: [`triagem deu score ${r.score} sem prova no texto (citou ${citado}; ignorada)`] };
  } catch {
    return { score: 1, motivos: ['triagem indisponível (score só do revisor e das travas)'] };
  }
}

// Lauda é acessória: se o modelo falhar ou escrever algo que as travas barram, a matéria
// sai sem ela (nunca segura a publicação nem vai ao ar com termo proibido).
export async function gerarLauda(llm: Llm, manchete: string, corpo: string, fonte: string): Promise<LaudaYoutube | undefined> {
  try {
    const l = await llm.gerarJson(
      PROMPT_LAUDA,
      promptLauda(manchete, corpo),
      (x) => {
        const o = objeto(x);
        return {
          texto_locucao: texto(o, 'texto_locucao', 120),
          texto_gc: limitarManchete(texto(o, 'texto_gc', 5).replace(/[.!]+$/, ''), 45).toUpperCase(),
          palavras_chave_visuais: listaTexto(o, 'palavras_chave_visuais').slice(0, 5),
        };
      },
      0.3,
    );
    const trava = aplicarGuardrails({
      manchete: l.texto_gc,
      subtitulo: '',
      corpo: l.texto_locucao,
      fonte,
      textoOriginal: '',
      scoreLlm: 1,
      llmPediuHumano: false,
    });
    return trava.requerHumano ? undefined : l;
  } catch {
    return undefined;
  }
}
