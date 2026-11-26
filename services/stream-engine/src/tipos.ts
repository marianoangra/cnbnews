export interface Lauda {
  textoGc: string;
  textoLocucao: string;
  palavrasChaveVisuais: string[];
}

export interface Materia {
  /** Caminho relativo a `content/`, sem `.md` (ex.: `cidades/pelotas/2026-11-26-x`). */
  id: string;
  titulo: string;
  resumo: string;
  fonte: string;
  /** Slug da cidade, ou `null` para matéria nacional (`content/noticias/`). */
  cidade: string | null;
  publicadaEm: Date;
  caminho: string;
  /** `lauda_youtube` do robô nacional; `null` se ausente ou incompleta. */
  lauda: Lauda | null;
}

export interface BlocoPronto {
  id: string;
  arquivo: string;
  duracao: number;
  criadoEm: Date;
  tipo: 'noticia' | 'vinheta' | 'institucional';
  cidade: string | null;
}
