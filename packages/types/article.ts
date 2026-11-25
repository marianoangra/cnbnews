// Contratos de dados compartilhados da CNB News (CLAUDE.md §7).
// Usado por services/agents hoje e por apps/web quando o portal migrar para Next.js.

export const CATEGORIAS = [
  'politica',
  'economia',
  'agro',
  'tecnologia',
  'cristao',
  'brasil',
  'mundo',
  'entrevistas',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export type Urgencia = 'normal' | 'urgente' | 'plantao';

export const AUTOR_PADRAO = 'Redação CNB News (Editor-Chefe: Rafael Mariano)';

export interface LaudaYoutube {
  texto_locucao: string; // 45-60s de locução
  texto_gc: string; // tarja em caixa alta, máx 45 caracteres
  palavras_chave_visuais: string[];
}

export interface ArticlePayload {
  id: string;
  categoria: Categoria;
  urgencia: Urgencia;
  manchete_home: string; // máx 70 caracteres
  subtitulo: string;
  slug: string; // kebab-case
  corpo_artigo_md: string;
  lauda_youtube?: LaudaYoutube; // preenchida quando o stream-engine existir
  fontes_verificadas: string[];
  fonte_url: string;
  score_sensibilidade: number; // 1 (seguro) a 5 (crítico)
  requer_aprovacao_humana: boolean; // true se score >= 4
  motivos_revisao: string[];
  autor_atribuicao: string;
  publicado_em: string; // ISO 8601
}

export interface ColumnistArticlePayload {
  id: string;
  tema_central: string;
  autor_nome: string;
  autor_bio: string;
  manchete: string;
  subtitulo: string;
  slug: string;
  corpo_artigo_md: string; // 600-800 palavras, link com rel="sponsored noopener"
  nota_transparencia: string;
  produto_recomendado: {
    nome: string;
    link_kiwify: string;
  };
  lauda_minuto_bolso?: {
    texto_locucao: string;
    texto_gc: string;
  };
  publicado_em: string;
}

// Itens brutos vindos das fontes (RSS), antes da esteira de agentes.
export interface Fonte {
  nome: string;
  url: string;
  categoria_padrao: Categoria;
}

export interface ItemBruto {
  id: string;
  fonte: string;
  titulo_original: string;
  link_original: string;
  conteudo_bruto: string;
  publicado_em: string;
  categoria_padrao: Categoria;
}
