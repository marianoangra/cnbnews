// Esteira sequencial: Redator → Revisor → Editor/SEO → travas determinísticas.
// Uma matéria por vez, um modelo só na VRAM (CLAUDE.md §2).
import { aplicarGuardrails, limitarManchete, slugificar } from './guardrails.ts';
import { booleano, listaTexto, numero, objeto, texto, textoOpcional, type Llm } from './ollama.ts';
import {
  PROMPT_EDITOR_SEO,
  PROMPT_REDATOR,
  PROMPT_REVISOR,
  promptRedacao,
  promptRevisao,
  promptSeo,
} from './prompts.ts';
import { AUTOR_PADRAO, CATEGORIAS, type ArticlePayload, type Categoria, type ItemBruto, type Urgencia } from './tipos.ts';

// ~9 mil caracteres de entrada cabem com folga no num_ctx 8192 junto com a resposta.
const MAX_ENTRADA = 9000;

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

export async function processarItem(item: ItemBruto, llm: Llm): Promise<ArticlePayload> {
  const original = item.conteudo_bruto.slice(0, MAX_ENTRADA);

  const redacao = await llm.gerarJson(
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

  const revisao = await llm.gerarJson(
    PROMPT_REVISOR,
    promptRevisao(original, redacao.corpo),
    (x) => {
      const o = objeto(x);
      return {
        corpo: texto(o, 'texto_final_revisado', 200),
        score: numero(o, 'score_risco_juridico', 3),
        humano: booleano(o, 'requer_aprovacao_humana'),
        alertas: listaTexto(o, 'alertas_ao_editor'),
      };
    },
    0.1,
  );

  const validarSeo = (x: unknown) => {
    const o = objeto(x);
    return { manchete: texto(o, 'manchete_home', 10), subtitulo: texto(o, 'subtitulo', 10) };
  };
  let seo = await llm.gerarJson(PROMPT_EDITOR_SEO, promptSeo(revisao.corpo), validarSeo, 0.3);
  if (seo.manchete.length > 70) {
    seo = await llm.gerarJson(PROMPT_EDITOR_SEO, promptSeo(revisao.corpo, seo.manchete), validarSeo, 0.3);
  }
  const manchete = limitarManchete(seo.manchete, 70);
  const subtitulo = limitarManchete(seo.subtitulo, 155);

  const g = aplicarGuardrails({
    manchete,
    subtitulo,
    corpo: revisao.corpo,
    fonte: item.fonte,
    textoOriginal: item.conteudo_bruto,
    scoreLlm: revisao.score,
    llmPediuHumano: revisao.humano,
  });

  const fontes = [...new Set([item.fonte, ...redacao.fontes])];
  return {
    id: item.id,
    categoria: categoriaValida(redacao.categoria, item.categoria_padrao),
    urgencia: urgenciaValida(redacao.urgencia),
    manchete_home: manchete,
    subtitulo,
    slug: slugificar(manchete) || item.id,
    corpo_artigo_md: g.corpoFinal,
    fontes_verificadas: fontes,
    fonte_url: item.link_original,
    score_sensibilidade: g.score,
    requer_aprovacao_humana: g.requerHumano,
    motivos_revisao: [...g.motivos, ...revisao.alertas.map((a) => `alerta do revisor: ${a}`)],
    autor_atribuicao: AUTOR_PADRAO,
    publicado_em: new Date().toISOString(),
  };
}
