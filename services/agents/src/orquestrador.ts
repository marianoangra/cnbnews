// Esteira sequencial, uma matéria por vez, dividida entre as duas GPUs:
//   1 Triagem/score de sensibilidade → fast  (RTX 2060)
//   2 Redação em Markdown            → heavy (RTX 3060)
//   3 Revisão ética/jurídica         → heavy
//   4 Manchete, SEO e metadados      → heavy
//   5 Lauda da live/rádio + GC       → fast
// Depois do LLM, as travas determinísticas (guardrails.ts) têm a palavra final.
import { aplicarGuardrails, limitarManchete, slugificar } from './guardrails.ts';
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

  // 1. Triagem (fast). Se falhar, a matéria segue: o Revisor e as travas ainda pontuam.
  const triagem = await llm('triagem')
    .gerarJson(
      PROMPT_TRIAGEM,
      promptTriagem(item.titulo_original, item.fonte, original.slice(0, 3000)),
      (x) => {
        const o = objeto(x);
        return {
          score: Math.min(5, Math.max(1, Math.round(numero(o, 'score_sensibilidade', 1)))),
          motivos: listaTexto(o, 'motivos').filter((m) => !pareceMolde(m) && m !== '...'),
        };
      },
      0.1,
    )
    .catch(() => ({ score: 1, motivos: ['triagem indisponível (score só do revisor e das travas)'] }));

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
      ...triagem.motivos.map((m) => `triagem: ${m}`),
      ...revisao.alertas.map((a) => `alerta do revisor: ${a}`),
    ],
    autor_atribuicao: AUTOR_PADRAO,
    publicado_em: new Date().toISOString(),
  };
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
