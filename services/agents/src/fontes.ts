import type { Fonte } from './tipos.ts';

// Só fontes com licença de reprodução com atribuição (Agência Brasil = CC BY 4.0).
// Feeds verificados em 2026-11-25. Agro/tecnologia/cristão ainda sem fonte confiável
// (o RSS da Embrapa fecha a conexão) — adicionar aqui quando houver.
// Ordem importa: o mesmo link aparece em "últimas notícias" e na editoria; vale a PRIMEIRA fonte
// que o trouxe (categoria_padrao). Editorias específicas primeiro, feeds gerais por último.
// Leva 1 das editorias (27/11/2026): esportes, saúde, meio ambiente → natureza, cultura → entretenimento.
export const FONTES_RSS: Fonte[] = [
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/esportes/feed.xml', categoria_padrao: 'esportes' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/saude/feed.xml', categoria_padrao: 'saude' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/meio-ambiente/feed.xml', categoria_padrao: 'natureza' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/cultura/feed.xml', categoria_padrao: 'entretenimento' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', categoria_padrao: 'economia' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml', categoria_padrao: 'politica' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/internacional/feed.xml', categoria_padrao: 'mundo' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', categoria_padrao: 'brasil' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/geral/feed.xml', categoria_padrao: 'brasil' },
];
