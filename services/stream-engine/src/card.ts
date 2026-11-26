import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { nomeCidade } from './cidades.ts';
import { horaBrasilia } from './coletor.ts';
import type { Materia } from './tipos.ts';

export const LARGURA = 1920;
export const ALTURA = 1080;
export const ALTURA_TICKER = 110;
/** Onde a faixa de manchetes começa (à esquerda fica o rótulo fixo "ÚLTIMAS"). */
export const X_TICKER = 260;

export const CORES = {
  fundoA: '#0B0F1A',
  fundoB: '#141B2E',
  texto: '#FFFFFF',
  textoSuave: '#C9D1E3',
  roxo: '#7C3AED',
  amarelo: '#FFC83D',
  vermelho: '#E11D48',
  faixa: '#070A12',
} as const;

const DIR_FONTES = join(import.meta.dirname, '..', 'assets', 'fonts');
const FONTES = (
  [
    [400, 'Regular'],
    [600, 'SemiBold'],
    [700, 'Bold'],
    [800, 'ExtraBold'],
  ] as const
).map(([weight, nome]) => ({
  name: 'Montserrat',
  data: readFileSync(join(DIR_FONTES, `Montserrat-${nome}.ttf`)),
  weight,
  style: 'normal' as const,
}));

type No = { type: string; props: Record<string, unknown> };
type Filho = No | string | null;

function el(type: string, style: Record<string, unknown>, ...children: Filho[]): No {
  const filhos = children.filter((c): c is No | string => c !== null);
  return { type, props: { style, children: filhos.length === 1 ? filhos[0] : filhos } };
}

/** Tira emoji e símbolos que a fonte não tem; normaliza espaços. */
export function limparTexto(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cortar(s: string, max: number): string {
  if (s.length <= max) return s;
  const corte = s.slice(0, max - 1);
  const espaco = corte.lastIndexOf(' ');
  return (espaco > max * 0.6 ? corte.slice(0, espaco) : corte).replace(/[\s,.;:—-]+$/, '') + '…';
}

/** Primeira palavra com 5+ letras ou com número — vai em amarelo na manchete. */
export function escolherDestaque(titulo: string): string | null {
  for (const p of titulo.split(/\s+/)) {
    const limpa = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (/\p{N}/u.test(limpa) || [...limpa].filter((c) => /\p{L}/u.test(c)).length >= 5) return limpa;
  }
  return null;
}

async function paraPng(arvore: No, largura: number, altura: number): Promise<Buffer> {
  const svg = await satori(arvore as never, { width: largura, height: altura, fonts: FONTES });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
}

function marca(tamanho: number): No {
  return el(
    'div',
    { display: 'flex', alignItems: 'center', gap: 18 },
    el(
      'div',
      { display: 'flex', fontSize: tamanho, fontWeight: 800, color: CORES.texto, letterSpacing: 2 },
      'CNB',
    ),
    el('div', { display: 'flex', fontSize: tamanho, fontWeight: 400, color: CORES.amarelo, letterSpacing: 2 }, 'NEWS'),
  );
}

/** Fundo opaco: gradiente, barra superior com marca e "AO VIVO", faixa inferior com rótulo "ÚLTIMAS". */
export async function renderizarFundo(): Promise<Buffer> {
  const arvore = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: LARGURA,
      height: ALTURA,
      backgroundImage: `linear-gradient(135deg, ${CORES.fundoA} 0%, ${CORES.fundoB} 60%, #1D1446 100%)`,
      fontFamily: 'Montserrat',
    },
    el(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 110,
        padding: '0 80px',
        borderBottom: `2px solid ${CORES.roxo}`,
      },
      marca(46),
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          backgroundColor: CORES.vermelho,
          color: CORES.texto,
          fontSize: 28,
          fontWeight: 800,
          padding: '10px 26px',
          borderRadius: 8,
          letterSpacing: 3,
        },
        el('div', { display: 'flex', width: 16, height: 16, borderRadius: 8, backgroundColor: CORES.texto }),
        'AO VIVO',
      ),
    ),
    el('div', { display: 'flex', flexGrow: 1 }),
    el(
      'div',
      { display: 'flex', height: ALTURA_TICKER, backgroundColor: CORES.faixa, borderTop: `4px solid ${CORES.amarelo}` },
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: X_TICKER,
          backgroundColor: CORES.amarelo,
          color: CORES.faixa,
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: 2,
        },
        'ÚLTIMAS',
      ),
    ),
  );
  return paraPng(arvore, LARGURA, ALTURA);
}

function manchete(titulo: string): No {
  const texto = cortar(limparTexto(titulo), 120);
  const destaque = escolherDestaque(texto);
  const palavras = texto.split(' ');
  let usado = false;
  const spans = palavras.map((p, i) => {
    const eDestaque = !usado && destaque !== null && p.includes(destaque);
    if (eDestaque) usado = true;
    return el('span', { color: eDestaque ? CORES.amarelo : CORES.texto }, p + (i < palavras.length - 1 ? ' ' : ''));
  });
  return {
    type: 'div',
    props: {
      style: {
        display: 'block',
        width: LARGURA_TEXTO,
        fontSize: 72,
        fontWeight: 800,
        lineHeight: 1.12,
        lineClamp: 3,
        maxHeight: 72 * 1.12 * 3 + 4,
        overflow: 'hidden',
      },
      children: spans,
    },
  };
}

const TOPO_CONTEUDO = 160;
/** Altura útil entre a barra superior e a faixa de manchetes (com folga de 40 px). */
const ALTURA_CONTEUDO = ALTURA - TOPO_CONTEUDO - ALTURA_TICKER - 40;
/** Largura útil do texto: tela menos margens (80 + 120), barra roxa (14) e respiro (50). */
const LARGURA_TEXTO = LARGURA - 80 - 120 - 14 - 50;

/** Camada transparente com a notícia (entra animada sobre o fundo). */
export async function renderizarConteudo(m: Materia): Promise<Buffer> {
  const selo = m.cidade ? nomeCidade(m.cidade).toUpperCase() : 'BRASIL';
  const resumo = cortar(limparTexto(m.resumo), 260);
  const credito = `Fonte: ${limparTexto(m.fonte) || 'Redação CNB News'}  •  Publicado às ${horaBrasilia(m.publicadaEm)}`;
  const arvore = el(
    'div',
    {
      display: 'flex',
      width: LARGURA,
      height: ALTURA,
      padding: `${TOPO_CONTEUDO}px 120px 0 80px`,
      fontFamily: 'Montserrat',
      color: CORES.texto,
    },
    el('div', { display: 'flex', width: 14, height: ALTURA_CONTEUDO, backgroundColor: CORES.roxo, borderRadius: 4, marginRight: 50 }),
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: ALTURA_CONTEUDO,
        justifyContent: 'center',
        gap: 28,
        overflow: 'hidden',
      },
      el(
        'div',
        { display: 'flex' },
        el(
          'div',
          {
            display: 'flex',
            backgroundColor: CORES.roxo,
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 3,
            padding: '10px 24px',
            borderRadius: 6,
          },
          selo,
        ),
      ),
      manchete(m.titulo),
      el(
        'div',
        {
          display: 'block',
          width: LARGURA_TEXTO,
          fontSize: 36,
          fontWeight: 400,
          lineHeight: 1.4,
          color: CORES.textoSuave,
          lineClamp: 3,
          maxHeight: 36 * 1.4 * 3 + 4,
          overflow: 'hidden',
        },
        resumo,
      ),
      el('div', { display: 'flex', fontSize: 28, fontWeight: 600, color: CORES.textoSuave }, credito),
      el(
        'div',
        { display: 'flex', fontSize: 32, fontWeight: 700, color: CORES.amarelo },
        'Leia a matéria completa em cnbmobile.com  →',
      ),
    ),
  );
  return paraPng(arvore, LARGURA, ALTURA);
}

const PX_POR_CARACTERE = 23;
const MAX_TICKER = 16_000;

/** Faixa de manchetes que rola no rodapé. Largura estimada pelo número de caracteres. */
export async function renderizarTicker(manchetes: string[]): Promise<{ png: Buffer; largura: number }> {
  const texto = manchetes.map((t) => cortar(limparTexto(t), 110)).join('   •   ');
  const largura = Math.min(MAX_TICKER, Math.max(400, Math.ceil(texto.length * PX_POR_CARACTERE) + 120));
  const arvore = el(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
      width: largura,
      height: ALTURA_TICKER,
      padding: '0 60px',
      fontFamily: 'Montserrat',
      fontSize: 38,
      fontWeight: 600,
      color: CORES.texto,
      whiteSpace: 'nowrap',
    },
    texto,
  );
  return { png: await paraPng(arvore, largura, ALTURA_TICKER), largura };
}

/** Tela cheia da marca, para vinhetas e loop institucional. */
export async function renderizarVinheta(texto: string): Promise<Buffer> {
  const arvore = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 40,
      width: LARGURA,
      height: ALTURA,
      backgroundImage: `linear-gradient(135deg, ${CORES.fundoA} 0%, #1D1446 100%)`,
      fontFamily: 'Montserrat',
      color: CORES.texto,
    },
    marca(140),
    el('div', { display: 'flex', width: 420, height: 8, backgroundColor: CORES.roxo, borderRadius: 4 }),
    el(
      'div',
      { display: 'flex', fontSize: 52, fontWeight: 600, textAlign: 'center', maxWidth: 1500, justifyContent: 'center' },
      cortar(limparTexto(texto), 140),
    ),
    el('div', { display: 'flex', fontSize: 40, fontWeight: 700, color: CORES.amarelo }, 'cnbmobile.com'),
  );
  return paraPng(arvore, LARGURA, ALTURA);
}
