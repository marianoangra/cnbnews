import type { BlocoPronto } from './tipos.ts';

/** Decide o próximo bloco da live. Guarda o histórico de exibição em memória. */
export class Programador {
  private readonly vinhetaACada: number;
  private readonly semRepetirMs: number;
  private readonly pisoRepriseMs: number;
  private readonly exibidoEm = new Map<string, number>();
  private desdeVinheta = 0;
  private ultimaCidade: string | null = null;
  private ultimoId: string | null = null;

  constructor(opts: { vinhetaACada?: number; semRepetirMin?: number; pisoRepriseMin?: number } = {}) {
    this.vinhetaACada = opts.vinhetaACada ?? 5;
    this.semRepetirMs = (opts.semRepetirMin ?? 60) * 60_000;
    this.pisoRepriseMs = (opts.pisoRepriseMin ?? 15) * 60_000;
  }

  proximo(blocos: BlocoPronto[], agora: Date): BlocoPronto {
    if (blocos.length === 0) throw new Error('nenhum bloco disponível');
    const vinheta = blocos.find((b) => b.tipo === 'vinheta');
    if (vinheta && this.desdeVinheta >= this.vinhetaACada) return vinheta;

    const noticias = blocos.filter((b) => b.tipo === 'noticia');
    const ineditas = noticias
      .filter((b) => !this.exibidoEm.has(b.id))
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
    if (ineditas[0]) return ineditas[0];

    const quando = (b: BlocoPronto) => this.exibidoEm.get(b.id) ?? 0;
    const reprise = (minimoMs: number) => {
      const r = noticias.filter((b) => agora.getTime() - quando(b) >= minimoMs).sort((a, b) => quando(a) - quando(b));
      return r.find((b) => b.cidade !== this.ultimaCidade) ?? r[0];
    };
    // 60 min sem repetir quando dá; senão reprisa a notícia mais antiga (>= 15 min) antes do loop
    // institucional, que com pouco volume ocuparia a maior parte da hora (conteúdo repetitivo).
    const r = reprise(this.semRepetirMs) ?? reprise(this.pisoRepriseMs);
    if (r) return r;

    const institucionais = blocos.filter((b) => b.tipo === 'institucional').sort((a, b) => quando(a) - quando(b));
    if (institucionais[0]) return institucionais[0];

    const qualquer = [...noticias, ...blocos].sort((a, b) => quando(a) - quando(b));
    return qualquer.find((b) => b.id !== this.ultimoId) ?? qualquer[0]!;
  }

  registrarExibicao(id: string, quando: Date, bloco?: BlocoPronto): void {
    this.exibidoEm.set(id, quando.getTime());
    this.ultimoId = id;
    if (id === 'vinheta' || bloco?.tipo === 'vinheta') {
      this.desdeVinheta = 0;
      return;
    }
    this.desdeVinheta++;
    if (bloco) this.ultimaCidade = bloco.cidade;
  }

  /** Minutos de notícia ainda não exibida na última hora (buffer da live). */
  minutosProntosAFrente(blocos: BlocoPronto[], agora: Date): number {
    const seg = blocos
      .filter((b) => b.tipo === 'noticia')
      .filter((b) => agora.getTime() - (this.exibidoEm.get(b.id) ?? 0) >= this.semRepetirMs)
      .reduce((s, b) => s + b.duracao, 0);
    return seg / 60;
  }
}
