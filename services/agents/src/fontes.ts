import type { Fonte } from './tipos.ts';

// Só fontes com licença de reprodução com atribuição (Agência Brasil = CC BY 4.0).
// Feeds verificados em 2026-11-25. Agro/tecnologia/cristão ainda sem fonte confiável
// (o RSS da Embrapa fecha a conexão) — adicionar aqui quando houver.
export const FONTES_RSS: Fonte[] = [
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', categoria_padrao: 'brasil' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', categoria_padrao: 'economia' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml', categoria_padrao: 'politica' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/geral/feed.xml', categoria_padrao: 'brasil' },
  { nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/internacional/feed.xml', categoria_padrao: 'mundo' },
];
