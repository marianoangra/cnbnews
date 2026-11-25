// Memória de links já processados (sobrevive a reinício, ao contrário do Set em RAM do guia).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Registro {
  em: string; // ISO
  status: 'publicada' | 'fila' | 'falhou';
  tentativas: number;
}

export const MAX_TENTATIVAS = 3;
const MAX_REGISTROS = 5000;

export class Estado {
  private dados: Record<string, Registro>;
  private readonly arquivo: string;

  constructor(arquivo: string) {
    this.arquivo = arquivo;
    this.dados = existsSync(arquivo) ? (JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, Registro>) : {};
  }

  pendente(link: string): boolean {
    const r = this.dados[link];
    return !r || (r.status === 'falhou' && r.tentativas < MAX_TENTATIVAS);
  }

  marcar(link: string, status: Registro['status']): void {
    const antes = this.dados[link];
    this.dados[link] = { em: new Date().toISOString(), status, tentativas: (antes?.tentativas ?? 0) + 1 };
  }

  salvar(): void {
    const entradas = Object.entries(this.dados).sort((a, b) => b[1].em.localeCompare(a[1].em));
    this.dados = Object.fromEntries(entradas.slice(0, MAX_REGISTROS));
    mkdirSync(dirname(this.arquivo), { recursive: true });
    writeFileSync(this.arquivo, JSON.stringify(this.dados, null, 1), 'utf8');
  }
}
