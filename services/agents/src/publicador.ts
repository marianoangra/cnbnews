// Grava a matéria como Markdown do Hugo.
// Aprovada → content/noticias/ (vai pro ar no próximo push).
// Score >= 4 → services/agents/fila-aprovacao/ (fora do git; Rafael revisa e move à mão).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArticlePayload } from './tipos.ts';

const q = (s: string) => JSON.stringify(s); // string JSON é YAML válido

// Data/hora no fuso de Brasília (UTC-3, sem horário de verão desde 2019).
export function dataBrt(iso: string): { dia: string; carimbo: string } {
  const d = new Date(new Date(iso).getTime() - 3 * 3_600_000);
  const s = d.toISOString(); // AAAA-MM-DDTHH:MM:SS.sssZ, já deslocado
  return { dia: s.slice(0, 10), carimbo: `${s.slice(0, 19)}-03:00` };
}

export function paraMarkdownHugo(a: ArticlePayload): string {
  const { carimbo } = dataBrt(a.publicado_em);
  const linhas = [
    '---',
    `title: ${q(a.manchete_home)}`,
    `date: ${carimbo}`,
    `description: ${q(a.subtitulo)}`,
    `fonte: ${q(a.fontes_verificadas[0] ?? '')}`,
    `fonte_url: ${q(a.fonte_url)}`,
    `categoria: ${q(a.categoria)}`,
    `urgencia: ${q(a.urgencia)}`,
    `autor: ${q(a.autor_atribuicao)}`,
    `score_sensibilidade: ${a.score_sensibilidade}`,
    `requer_aprovacao_humana: ${a.requer_aprovacao_humana}`,
  ];
  if (a.motivos_revisao.length) {
    linhas.push('motivos_revisao:', ...a.motivos_revisao.map((m) => `  - ${q(m)}`));
  }
  // Lauda da live/rádio: o stream-engine lê do front matter (o Hugo ignora campos extras).
  if (a.lauda_youtube) {
    const l = a.lauda_youtube;
    linhas.push(
      'lauda_youtube:',
      `  texto_gc: ${q(l.texto_gc)}`,
      `  texto_locucao: ${q(l.texto_locucao)}`,
      `  palavras_chave_visuais: [${l.palavras_chave_visuais.map(q).join(', ')}]`,
    );
  }
  // O layout já põe a manchete como H1; um "# título" no começo do corpo virava 2º H1 (SEO).
  linhas.push('draft: false', '---', '', a.corpo_artigo_md.trim().replace(/^#\s[^\n]*\n+/, ''), '');
  return linhas.join('\n');
}

export interface Destinos {
  publicadas: string;
  fila: string;
}

export interface ResultadoGravacao {
  caminho: string;
  destino: 'publicada' | 'fila';
  novo: boolean;
}

export function gravar(a: ArticlePayload, destinos: Destinos, simular = false): ResultadoGravacao {
  const destino = a.requer_aprovacao_humana ? 'fila' : 'publicada';
  const dir = destino === 'fila' ? destinos.fila : destinos.publicadas;
  const caminho = join(dir, `${dataBrt(a.publicado_em).dia}-${a.slug}.md`);
  if (existsSync(caminho)) return { caminho, destino, novo: false };
  if (!simular) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(caminho, paraMarkdownHugo(a), 'utf8');
  }
  return { caminho, destino, novo: true };
}
