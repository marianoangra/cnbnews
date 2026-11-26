// Esteira sequencial, uma matéria por vez, dividida entre as duas GPUs:
//   1 Triagem/score de sensibilidade → fast  (RTX 2060)
//   2 Redação em Markdown            → heavy (RTX 3060)
//   3 Revisão ética/jurídica         → heavy
//   4 Manchete, SEO e metadados      → heavy
//   5 Lauda da live/rádio + GC       → fast
// Depois do LLM, as travas determinísticas (guardrails.ts) têm a palavra final.
import { aplicarGuardrails, limitarManchete, normalizar, slugificar } from './guardrails.ts';
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

function categoriaValida(v: string | undefined, padrao: Categoria): Categoria {
  const c = (v ?? '').trim().toLowerCase();
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
        corpo: texto(o, 'corpo_artigo_markdown', 200),
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
      // Plano B: se o revisor não devolver um texto utilizável, segue o do redator,
      // mas a nota de risco e os alertas dele continuam valendo.
      let corpo: string;
      const alertas = listaTexto(o, 'alertas_ao_editor').filter((a) => !pareceMolde(a) && a !== '...');
      try {
        corpo = texto(o, 'texto_final_revisado', 200);
      } catch {
        corpo = redacao.corpo;
        alertas.push('revisor não devolveu o texto revisado; publicado o texto do redator');
      }
      return {
        corpo,
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
  const manchete = limitarManchete(seo.manchete, 70);
  const subtitulo = limitarManchete(seo.subtitulo, 155);

  // Score final = maior entre triagem, revisor e travas determinísticas.
  const g = aplicarGuardrails({
    manchete,
    subtitulo,
    corpo: revisao.corpo,
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
    categoria: categoriaValida(redacao.categoria, item.categoria_padrao),
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
