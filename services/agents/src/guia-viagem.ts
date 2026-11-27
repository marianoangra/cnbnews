// Robô de Viagens (editoria Viagens, leva 2 · 27/11/2026): 1 guia atemporal de uma cidade do
// portal por execução, escrito SÓ com o que está no verbete da Wikipédia (CC BY-SA 4.0), e
// SEMPRE para a fila de aprovação — nunca publica sozinho (risco de fato inventado: ROADMAP.md).
//   node src/guia-viagem.ts                    → escreve 1 guia em fila-aprovacao/viagens/
//   node src/guia-viagem.ts --simular          → mostra no terminal, sem gravar
//   node src/guia-viagem.ts --cidade paraty    → força a cidade
// Aprovar no /admin move para content/viagens/<slug>.md. O texto é obra derivada da Wikipédia:
// o layout credita o verbete e a licença CC BY-SA 4.0 (obrigatório pela licença).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { configDoAmbiente, criarLlm, ErroLlm, objeto, texto, type Llm } from './ollama.ts';
import { dataBrt } from './publicador.ts';
import { semLinks, semTituloRepetido, contarPalavras, descarregar, MODELO_COLUNISTA } from './colunista.ts';

export const ESTADOS: Record<string, string> = {
  SP: 'São Paulo', RJ: 'Rio de Janeiro', PR: 'Paraná', MG: 'Minas Gerais', RS: 'Rio Grande do Sul',
  ES: 'Espírito Santo', SC: 'Santa Catarina',
};

export interface Cidade {
  slug: string;
  nome: string; // "Lorena"
  uf: string; // "SP"
}

// content/cidades/<slug>/_index.md → title: "Lorena (SP)"
export function cidadesDoPortal(repo: string): Cidade[] {
  const dir = join(repo, 'content', 'cidades');
  if (!existsSync(dir)) return [];
  const out: Cidade[] = [];
  for (const slug of readdirSync(dir).sort()) {
    const idx = join(dir, slug, '_index.md');
    if (!existsSync(idx)) continue;
    const m = readFileSync(idx, 'utf8').match(/^title:\s*"?(.+?)\s*\((\w{2})\)"?\s*$/m);
    if (m) out.push({ slug, nome: m[1].trim(), uf: m[2].toUpperCase() });
  }
  return out;
}

// Cidades que já têm guia (publicado, na fila ou recusado — recusar não apaga o arquivo da fila).
export function cidadesComGuia(...dirs: string[]): Set<string> {
  const s = new Set<string>();
  for (const d of dirs) if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.md') && f !== '_index.md') s.add(f.replace(/\.md$/, ''));
  return s;
}

// ---------- Wikipédia ----------
const UA = 'CNBNewsViagens/1.0 (https://news.cnbmobile.com/contato/)';

export interface Verbete {
  titulo: string;
  url: string;
  texto: string; // trecho escolhido (introdução + seções úteis para quem viaja)
}

async function extrato(titulo: string, f: typeof fetch): Promise<{ titulo: string; texto: string } | undefined> {
  const u = 'https://pt.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', format: 'json', titles: titulo,
  });
  const r = await f(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return undefined;
  const d = (await r.json()) as { query?: { pages?: Record<string, { title: string; extract?: string; missing?: string }> } };
  const pg = Object.values(d.query?.pages ?? {})[0];
  if (!pg || pg.missing !== undefined || !pg.extract) return undefined;
  return { titulo: pg.title, texto: pg.extract };
}

// Seções que ajudam quem viaja, em ordem de prioridade (o limite de tamanho enchia com clima e
// relevo antes de chegar em Turismo). Política, demografia, religião e listas ficam de fora.
const PRIORIDADE: RegExp[] = [
  /turismo|atra[cç]|pontos? tur|patrim[oô]nio|praias?|ilhas?|parques?|natureza/i,
  /cultura|festas?|eventos|festejos|culin[aá]ri|gastronomi|museus|arquitetur|lazer/i,
  /hist[oó]ri|marcos/i,
  /transport|rodovi|acesso|aeroport/i,
  /geografi|clima|relevo|hidrografi/i,
];
const SECAO_FORA = /pol[ií]tica|administra|prefeit|demografi|popula|economia|educa|sa[uú]de|religi|etnias|refer[eê]ncias|bibliografia|liga[cç][oõ]es externas|ver tamb[eé]m|notas|filhos ilustres|personalidades|normal climatol/i;

// limite 6000: o qwen3:4b roda com num_ctx 4096 (texto + prompt + resposta); com 9000 o guia saía curto.
export function escolherTrechos(extract: string, limite = 6000, porSecao = 2000): string {
  // Seções de nível 2 ("== X ==") com as subseções ("=== Y ===") dentro, como texto corrido.
  const partes = extract.split(/\n(?=== [^=\n]+ ==\s*\n)/);
  const intro = partes[0].replace(/\n=+ [^=\n]+ =+\s*\n/g, '\n').trim().slice(0, 2500);
  const secoes = partes.slice(1).map((p) => {
    const tit = ((p.match(/^== ([^=\n]+) ==/) ?? [])[1] ?? '').trim();
    const corpo = p.replace(/^== [^=\n]+ ==\s*/, '').replace(/^=+ ([^=\n]+) =+\s*$/gm, '$1:').replace(/\n{3,}/g, '\n\n').trim();
    const prio = SECAO_FORA.test(tit) ? -1 : PRIORIDADE.findIndex((re) => re.test(tit));
    return { tit, corpo, prio };
  }).filter((x) => x.prio >= 0 && x.corpo.length >= 80);
  secoes.sort((a, b) => a.prio - b.prio);
  let out = intro;
  for (const x of secoes) {
    const bloco = `\n\n## ${x.tit}\n${x.corpo.slice(0, porSecao)}`;
    if (out.length + bloco.length > limite) {
      if (limite - out.length > 300) out += bloco.slice(0, limite - out.length);
      break;
    }
    out += bloco;
  }
  return out.trim();
}

// O verbete certo é o do município: "Lorena (São Paulo)" antes de "Lorena" (que é cidade do Peru).
export async function buscarVerbete(c: Cidade, f: typeof fetch = fetch): Promise<Verbete | undefined> {
  const estado = ESTADOS[c.uf] ?? c.uf;
  for (const t of [`${c.nome} (${estado})`, c.nome]) {
    const e = await extrato(t, f);
    if (!e) continue;
    const ini = e.texto.slice(0, 1500);
    if (!/munic[ií]pio|cidade brasileira/i.test(ini) || !ini.includes(estado)) continue;
    return {
      titulo: e.titulo,
      url: 'https://pt.wikipedia.org/wiki/' + encodeURIComponent(e.titulo.replaceAll(' ', '_')),
      texto: escolherTrechos(e.texto),
    };
  }
  return undefined;
}

// ---------- Redação ----------
export const SYSTEM_GUIA = `Você escreve guias de viagem para a editoria Viagens do portal CNB News.
Público: brasileiros comuns planejando um passeio. Linguagem simples, acolhedora e direta, português do Brasil.
Regras obrigatórias:
- Use SOMENTE fatos que estão no TEXTO DE REFERÊNCIA. Não acrescente nada que não esteja lá: nada de nomes de lugares, restaurantes, hotéis, datas, distâncias, preços ou horários de fora do texto.
- Se o texto não fala de um assunto (como chegar, festas, praias), NÃO escreva sobre ele.
- Escreva com SUAS palavras: não copie frases do texto de referência.
- NÃO invente números. Só use um número se ele estiver no texto.
- Sem preços, sem horários de funcionamento, sem telefone, sem links.
- Markdown com 3 a 5 subtítulos "## " (por exemplo: Onde fica, Um pouco de história, O que visitar, Festas e tradições, Como chegar), 1 a 3 parágrafos em cada.
- Entre 450 e 700 palavras: desenvolva cada seção com detalhes do texto de referência.
- Último parágrafo: uma dica prática para aproveitar a visita, sem fato novo.
Responda SOMENTE com JSON: {"manchete": "...", "subtitulo": "...", "corpo": "..."}
- manchete: até 80 caracteres, sem ponto final, no formato "O que fazer em <cidade>: <2 ou 3 atrativos citados no texto>".
- subtitulo: 1 frase de 100 a 160 caracteres.
- corpo: o guia em Markdown, sem repetir a manchete como título.`;

export function promptGuia(c: Cidade, v: Verbete): string {
  return `Cidade: ${c.nome} (${ESTADOS[c.uf] ?? c.uf})\n\nTEXTO DE REFERÊNCIA (Wikipédia):\n${v.texto}`;
}

export interface Guia {
  manchete: string;
  subtitulo: string;
  corpo: string;
}

export function validarGuia(x: unknown): Guia {
  const o = objeto(x);
  const manchete = texto(o, 'manchete', 15).replace(/\.$/, '');
  const subtitulo = texto(o, 'subtitulo', 50);
  const corpo = texto(o, 'corpo', 1200).replaceAll('\\"', '"');
  const n = contarPalavras(corpo);
  if (n < 330) throw new ErroLlm(`guia curto demais (${n} palavras)`);
  return { manchete, subtitulo, corpo };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Números do guia que não aparecem no verbete = provável fato inventado (o editor confere).
export function numerosForaDaFonte(guia: string, fonte: string): string[] {
  const f = norm(fonte).replace(/(\d)\.(\d{3})/g, '$1$2');
  const achados = new Set<string>();
  for (const m of norm(guia).replace(/(\d)\.(\d{3})/g, '$1$2').matchAll(/\b\d+(?:[.,]\d+)?\b/g)) {
    if (!f.includes(m[0])) achados.add(m[0]);
  }
  return [...achados];
}

// Frase longa idêntica ao verbete = cópia (a licença permite, mas o Google pune texto duplicado).
export function trechosCopiados(guia: string, fonte: string, janela = 12): number {
  const p = norm(guia).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const f = ' ' + norm(fonte).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).join(' ') + ' ';
  let n = 0;
  for (let i = 0; i + janela <= p.length; i += janela) if (f.includes(' ' + p.slice(i, i + janela).join(' ') + ' ')) n++;
  return n;
}

export function alertasDoGuia(g: Guia, v: Verbete): string[] {
  const tudo = `${g.manchete}\n${g.subtitulo}\n${g.corpo}`;
  const a: string[] = [];
  const nums = numerosForaDaFonte(tudo, v.texto);
  if (nums.length) a.push(`números que não estão na Wikipédia: ${nums.slice(0, 8).join(', ')} (conferir)`);
  const cop = trechosCopiados(g.corpo, v.texto);
  if (cop >= 2) a.push(`${cop} trechos iguais ao verbete (reescrever)`);
  if (/R\$\s?\d|\b\d{1,2}h\d{0,2}\b|\(\d{2}\)\s?\d{4}/.test(tudo)) a.push('preço, horário ou telefone (tirar: muda com o tempo)');
  if (/\b(hotel|pousada|restaurante)\s+[A-Z]/.test(g.corpo)) a.push('cita hotel/pousada/restaurante pelo nome (conferir se existe)');
  const n = contarPalavras(g.corpo);
  if (n > 800) a.push(`longo (${n} palavras)`);
  if (n < 420) a.push(`curto (${n} palavras)`);
  return a;
}

const q = (s: string) => JSON.stringify(s);

export function paraMarkdownGuia(c: Cidade, v: Verbete, g: Guia, iso: string, alertas: string[]): string {
  const l = [
    '---',
    `title: ${q(g.manchete)}`,
    `date: ${dataBrt(iso).carimbo}`,
    `description: ${q(g.subtitulo)}`,
    `cidade: ${q(c.slug)}`,
    `cidade_nome: ${q(`${c.nome} (${c.uf})`)}`,
    `fonte: "Wikipédia"`,
    `fonte_url: ${q(v.url)}`,
    `fonte_titulo: ${q(v.titulo)}`,
    `licenca_texto: "CC BY-SA 4.0"`,
    `gerado_por_ia: true`,
  ];
  if (alertas.length) l.push('alertas_revisao:', ...alertas.map((x) => `  - ${q(x)}`));
  l.push('draft: false', '---', '', semTituloRepetido(semLinks(g.corpo)).trim(), '');
  return l.join('\n');
}

export async function escreverGuia(llm: Llm, c: Cidade, v: Verbete, iso = new Date().toISOString()) {
  const g = await llm.gerarJson(SYSTEM_GUIA, promptGuia(c, v), validarGuia, 0.5);
  const alertas = alertasDoGuia(g, v);
  return { guia: g, alertas, markdown: paraMarkdownGuia(c, v, g, iso, alertas), arquivo: `${c.slug}.md` };
}

async function main(): Promise<void> {
  const AGENTS = resolve(import.meta.dirname, '..');
  const REPO = resolve(AGENTS, '..', '..');
  dotenv.config({ path: join(AGENTS, '.env'), quiet: true });
  const fila = join(AGENTS, 'fila-aprovacao', 'viagens');
  const publicadas = join(REPO, 'content', 'viagens');
  const simular = process.argv.includes('--simular');
  const i = process.argv.indexOf('--cidade');
  const forcada = i >= 0 ? process.argv[i + 1] : undefined;

  const feitas = cidadesComGuia(fila, publicadas);
  const todas = cidadesDoPortal(REPO);
  const candidatas = forcada ? todas.filter((c) => c.slug === forcada) : todas.filter((c) => !feitas.has(c.slug));
  if (!candidatas.length) {
    console.log(forcada ? `guia: cidade "${forcada}" não existe no portal` : 'guia: todas as cidades já têm guia');
    return;
  }
  const heavy = configDoAmbiente(process.env, 'heavy');
  // qwen2.5:7b (o do colunista): o qwen3:4b entregava 250-300 palavras mesmo pedindo 450+ (testado em 27/11).
  // Cópia do verbete, o defeito do 7b, vira alerta (trechosCopiados) e o editor reescreve.
  const cfg = { ...heavy, modelo: process.env.OLLAMA_GUIA_MODEL || MODELO_COLUNISTA, timeoutMs: Math.max(heavy.timeoutMs, 600_000) };
  const llm = criarLlm(cfg);
  try {
    // Verbete fraco (sem seção de turismo/história) não rende guia: tenta a próxima cidade, até 5.
    for (const c of candidatas.slice(0, 5)) {
      const v = await buscarVerbete(c);
      if (!v || v.texto.length < 1500) {
        console.log(`guia: ${c.nome} (${c.uf}) sem verbete útil na Wikipédia (${v?.texto.length ?? 0} caracteres), pulando`);
        continue;
      }
      console.log(`guia: ${c.nome} (${c.uf}) · verbete "${v.titulo}" · ${v.texto.length} caracteres (${cfg.modelo})`);
      const t0 = Date.now();
      const r = await escreverGuia(llm, c, v);
      console.log(`guia: "${r.guia.manchete}" · ${contarPalavras(r.guia.corpo)} palavras · ${Math.round((Date.now() - t0) / 1000)}s`);
      if (r.alertas.length) console.log(`guia: alertas → ${r.alertas.join('; ')}`);
      if (simular) {
        console.log('\n' + r.markdown);
        return;
      }
      mkdirSync(fila, { recursive: true });
      writeFileSync(join(fila, r.arquivo), r.markdown, 'utf8');
      console.log(`guia: na fila de aprovação → ${join(fila, r.arquivo)}`);
      return;
    }
    console.log('guia: nenhuma das 5 próximas cidades tinha verbete útil');
  } finally {
    // criarLlm fixa keep_alive -1: tira o 7b da VRAM para devolver a 3060 ao robô de notícias.
    if (cfg.modelo !== heavy.modelo) await descarregar(cfg.endpoint, cfg.modelo);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error('guia: falhou —', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
