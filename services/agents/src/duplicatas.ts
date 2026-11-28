// Trava de matéria repetida que NÃO depende de estado/vistos.json (27/11/2026).
// Em 26-27/11 saíram 3 pares com o MESMO link da Agência Brasil (Petrobras, turismo, Benedita), com
// 15 min de diferença: o estado em JSON não bastou (reinícios / duas cópias do robô naquele dia).
// Aqui a verdade é o que está gravado: front matter das matérias publicadas e da fila de aprovação.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Gravada {
  titulo: string;
  fonteUrl: string;
  quando: number; // ms (mtime do arquivo)
}

const campo = (fm: string, nome: string) => {
  const m = fm.match(new RegExp(`^${nome}:\\s*"?(.*?)"?\\s*$`, 'm'));
  return m ? m[1].replace(/\\"/g, '"') : '';
};

/** Matérias gravadas nas pastas (sem subpastas), lendo só o front matter. */
export function lerGravadas(...dirs: string[]): Gravada[] {
  const out: Gravada[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md') || f === '_index.md') continue;
      const p = join(d, f);
      try {
        const txt = readFileSync(p, 'utf8');
        const fm = txt.startsWith('---') ? txt.slice(3, txt.indexOf('\n---', 3)) : '';
        out.push({ titulo: campo(fm, 'title'), fonteUrl: campo(fm, 'fonte_url'), quando: statSync(p).mtimeMs });
      } catch {
        // arquivo sendo escrito/apagado: ignora
      }
    }
  }
  return out;
}

const PALAVRAS_VAZIAS = new Set(
  'a o as os de da do das dos em no na nos nas e para por com sem um uma que se ao aos sobre mais ate apos diz entre como seu sua ser tem foi sao'.split(' '),
);

export function palavras(s: string): Set<string> {
  const n = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return new Set((n.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !PALAVRAS_VAZIAS.has(w)));
}

export function parecido(a: string, b: string): number {
  const x = palavras(a), y = palavras(b);
  if (!x.size || !y.size) return 0;
  let comum = 0;
  for (const w of x) if (y.has(w)) comum++;
  return comum / (x.size + y.size - comum);
}

/**
 * Manchete nova repete alguma das últimas 48 h? ("Raio atinge plataforma Petrobras a 200 km da costa do Rio" x
 * "Raio atinge plataforma Petrobras P-77 a 200 km da costa do Rio" = 0,89.) Limite 0,6: duas matérias
 * diferentes sobre o mesmo relatório ("expectativa de vida das mulheres" x "expectativa de vida sobe") dão 0,5.
 */
export function mancheteRepetida(titulo: string, gravadas: Gravada[], agora = Date.now(), limite = 0.6): Gravada | undefined {
  const desde = agora - 48 * 3600_000;
  return gravadas.find((g) => g.quando >= desde && g.titulo && parecido(titulo, g.titulo) >= limite);
}
