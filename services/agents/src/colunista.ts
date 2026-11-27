// Robô colunista (CLAUDE.md §4A e §7B): 1 coluna educativa por execução, assinada por
// Rafael Mariano, SEMPRE para a fila de aprovação — nunca publica sozinho.
//   node src/colunista.ts              → escreve 1 coluna em fila-aprovacao/colunas/
//   node src/colunista.ts --simular    → mostra a coluna no terminal, sem gravar
//   node src/colunista.ts --tema fe    → força o tema (financas | negocios | fe)
// Para publicar: revisar o .md e mover para content/colunas/ (o produto e a nota de
// transparência entram pelo layout, com rel="sponsored"; o texto não leva link nenhum).
// Na rig: timer systemd seg e qui, 9h BRT (CLAUDE.md §4A: 1 a 2 colunas por semana).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { slugificar } from './guardrails.ts';
import { configDoAmbiente, criarLlm, ErroLlm, objeto, texto, type Llm } from './ollama.ts';
import { dataBrt } from './publicador.ts';

export type Tema = 'financas' | 'negocios' | 'fe';

export interface Pauta {
  id: string;
  tema: Tema;
  assunto: string;
}

// Produto que cada tema pode recomendar (chaves de data/produtos.yaml).
export const PRODUTO_DO_TEMA: Record<Tema, string> = {
  financas: 'sai-do-vermelho',
  negocios: 'mentoria',
  fe: 'fe-prosperidade',
};

// Pautas atemporais. O robô pega a primeira que ainda não virou coluna (nem está na fila).
export const PAUTAS: Pauta[] = [
  { id: 'reserva-emergencia', tema: 'financas', assunto: 'Como montar uma reserva de emergência começando com pouco dinheiro' },
  { id: 'cartao-rotativo', tema: 'financas', assunto: 'Por que o rotativo do cartão de crédito é a dívida mais cara e como sair dele' },
  { id: 'orcamento-50-30-20', tema: 'financas', assunto: 'A regra 50-30-20 para organizar o salário: como adaptar à realidade brasileira' },
  { id: 'negociar-dividas', tema: 'financas', assunto: 'Passo a passo para negociar dívidas atrasadas sem cair em golpe' },
  { id: 'gastos-invisiveis', tema: 'financas', assunto: 'Gastos invisíveis: assinaturas, taxas e pequenas compras que somem com o salário' },
  { id: 'decimo-terceiro', tema: 'financas', assunto: 'O que fazer com o 13º salário: quitar dívida, reservar ou gastar?' },
  { id: 'financas-casal', tema: 'financas', assunto: 'Dinheiro no casamento: como o casal pode conversar sobre contas sem brigar' },
  { id: 'golpes-pix', tema: 'financas', assunto: 'Golpes mais comuns no Pix e no WhatsApp e como se proteger' },
  { id: 'primeiro-negocio-digital', tema: 'negocios', assunto: 'Primeiros passos para quem quer começar um negócio pela internet sem cair em promessas fáceis' },
  { id: 'nicho', tema: 'negocios', assunto: 'Como escolher um nicho: conhecimento que você já tem pode virar serviço' },
  { id: 'mei', tema: 'negocios', assunto: 'MEI para quem vende pela internet: o que é, quanto custa e quando vale a pena' },
  { id: 'preco-servico', tema: 'negocios', assunto: 'Como definir o preço de um serviço ou produto digital sem se desvalorizar' },
  { id: 'consistencia-redes', tema: 'negocios', assunto: 'Constância nas redes sociais: por que postar todo dia importa mais que viralizar' },
  { id: 'atendimento-whatsapp', tema: 'negocios', assunto: 'Atendimento pelo WhatsApp que vende: respostas rápidas, educação e acompanhamento' },
  { id: 'mordomia', tema: 'fe', assunto: 'Mordomia cristã: cuidar bem do que se recebe, do salário ao tempo' },
  { id: 'gratidao-ansiedade', tema: 'fe', assunto: 'Gratidão como prática diária contra a ansiedade com dinheiro' },
  { id: 'generosidade', tema: 'fe', assunto: 'Generosidade com responsabilidade: ajudar o próximo sem se endividar' },
  { id: 'trabalho-proposito', tema: 'fe', assunto: 'Trabalho com propósito: a visão cristã sobre esforço, descanso e sustento' },
  { id: 'contentamento', tema: 'fe', assunto: 'Contentamento num mundo de comparação: redes sociais, consumo e paz interior' },
  { id: 'familia-financas-fe', tema: 'fe', assunto: 'Ensinar os filhos sobre dinheiro com valores cristãos' },
  { id: 'lista-mercado', tema: 'financas', assunto: 'Como economizar no supermercado sem passar vontade: lista, marcas e horários' },
  { id: 'conta-luz', tema: 'financas', assunto: 'Conta de luz alta: hábitos simples que reduzem o consumo em casa' },
  { id: 'emprestimo-consignado', tema: 'financas', assunto: 'Empréstimo consignado: quando ajuda e quando vira armadilha' },
  { id: 'nome-sujo', tema: 'financas', assunto: 'Nome negativado: como consultar, negociar e limpar o nome com segurança' },
  { id: 'compras-parceladas', tema: 'financas', assunto: 'Parcelado sem juros não é de graça: como as parcelas comem o orçamento' },
  { id: 'planilha-mensal', tema: 'financas', assunto: 'Como fazer o orçamento do mês em 15 minutos, com papel ou celular' },
  { id: 'renda-variavel-autonomo', tema: 'financas', assunto: 'Orçamento para quem tem renda variável: autônomos, motoristas e vendedores' },
  { id: 'aposentadoria-cedo', tema: 'financas', assunto: 'Pensar na aposentadoria cedo: por que pequenos valores hoje fazem diferença' },
  { id: 'compras-impulso', tema: 'financas', assunto: 'Compra por impulso: a regra das 48 horas e outros freios práticos' },
  { id: 'financiamento-carro', tema: 'financas', assunto: 'Financiar ou juntar para comprar o carro? O que colocar na conta antes de decidir' },
  { id: 'aluguel-casa-propria', tema: 'financas', assunto: 'Aluguel ou casa própria: perguntas para fazer antes de assumir um financiamento' },
  { id: 'filhos-mesada', tema: 'financas', assunto: 'Mesada: como usar para ensinar as crianças a lidar com dinheiro' },
  { id: 'fim-de-ano', tema: 'financas', assunto: 'Gastos de fim de ano: como aproveitar as festas sem começar janeiro no vermelho' },
  { id: 'inicio-de-ano', tema: 'financas', assunto: 'Contas de começo de ano: IPVA, IPTU e material escolar sem aperto' },
  { id: 'seguro-necessario', tema: 'financas', assunto: 'Seguros: quais fazem sentido para a família e quais podem esperar' },
  { id: 'apostas-online', tema: 'financas', assunto: 'Apostas online e o orçamento da família: sinais de alerta e como buscar ajuda' },
  { id: 'vender-whatsapp', tema: 'negocios', assunto: 'Como vender pelo WhatsApp sem ser chato: catálogo, status e listas' },
  { id: 'instagram-negocio-local', tema: 'negocios', assunto: 'Instagram para negócio de bairro: o básico que traz cliente de verdade' },
  { id: 'primeiro-cliente', tema: 'negocios', assunto: 'Como conseguir o primeiro cliente de um serviço novo' },
  { id: 'separar-contas', tema: 'negocios', assunto: 'Separar o dinheiro da empresa do dinheiro de casa: por que e como começar' },
  { id: 'fluxo-de-caixa', tema: 'negocios', assunto: 'Fluxo de caixa simples para pequeno negócio: o que entra, o que sai e quando' },
  { id: 'marketplace', tema: 'negocios', assunto: 'Vender em marketplace: cuidados com taxas, frete e reputação' },
  { id: 'depoimentos-clientes', tema: 'negocios', assunto: 'Depoimentos de clientes: como pedir e usar para ganhar confiança' },
  { id: 'produto-digital-ideia', tema: 'negocios', assunto: 'Como validar a ideia de um produto digital antes de gastar tempo produzindo' },
  { id: 'foto-celular', tema: 'negocios', assunto: 'Fotos de produto com o celular: luz, fundo e enquadramento' },
  { id: 'golpes-empreendedor', tema: 'negocios', assunto: 'Golpes que miram pequenos empreendedores e como se proteger' },
  { id: 'ia-pequeno-negocio', tema: 'negocios', assunto: 'Inteligência artificial no pequeno negócio: usos práticos e limites' },
  { id: 'rotina-empreendedor', tema: 'negocios', assunto: 'Rotina de quem trabalha por conta própria: horário, foco e descanso' },
  { id: 'pos-venda', tema: 'negocios', assunto: 'Pós-venda: o atendimento que faz o cliente voltar e indicar' },
  { id: 'nota-fiscal-mei', tema: 'negocios', assunto: 'Nota fiscal para MEI: quando emitir e como fazer sem complicação' },
  { id: 'dizimo-oferta', tema: 'fe', assunto: 'Dízimo e oferta no orçamento: como organizar com planejamento e sem culpa' },
  { id: 'descanso-sabado', tema: 'fe', assunto: 'Descanso como princípio: por que parar também é obediência' },
  { id: 'perdao-dividas', tema: 'fe', assunto: 'Perdão e dívidas na família: como lidar com empréstimos entre parentes' },
  { id: 'fe-desemprego', tema: 'fe', assunto: 'Fé no desemprego: como atravessar a fase de busca com esperança e ação' },
  { id: 'honestidade-trabalho', tema: 'fe', assunto: 'Honestidade no trabalho e nos negócios: pequenas escolhas que constroem reputação' },
  { id: 'oracao-decisoes', tema: 'fe', assunto: 'Oração e decisões financeiras: buscar sabedoria antes de assumir compromissos' },
  { id: 'comunidade-igreja', tema: 'fe', assunto: 'A igreja como rede de apoio: ajuda mútua, mentoria e trabalho voluntário' },
  { id: 'ansiedade-futuro', tema: 'fe', assunto: 'Ansiedade com o futuro: confiança e planejamento podem andar juntos' },
  { id: 'casamento-proposito', tema: 'fe', assunto: 'Casamento e propósito: decidir juntos sobre dinheiro, tempo e sonhos' },
  { id: 'servir-com-talentos', tema: 'fe', assunto: 'Servir com os talentos: usar o que você sabe fazer para ajudar o próximo' },
];

export const SYSTEM_COLUNISTA = `Você escreve colunas para o portal de notícias CNB News, assinadas por Rafael Mariano.
Público: brasileiros comuns, linguagem simples, direta e respeitosa, português do Brasil.
Regras obrigatórias:
- Texto EDUCATIVO e PRÁTICO: o leitor precisa sair sabendo fazer algo, sem precisar comprar nada.
- Texto LONGO: no mínimo 750 palavras, em Markdown, com 4 ou 5 subtítulos "## " e 2 ou 3 parágrafos em cada um, com exemplos do dia a dia.
- NÃO prometa ganho, renda, enriquecimento ou resultado garantido. NÃO recomende ação, criptomoeda, banco ou investimento específico.
- NÃO invente números, pesquisas, leis, datas ou citações de pessoas. Se não tiver certeza de um dado, não use.
- Versículos bíblicos: SÓ quando o assunto for de fé, e no máximo 1, com a referência. Fora desse caso, não cite a Bíblia. Nunca prometa prosperidade material.
- NÃO escreva links, URLs nem nomes de produtos ou cursos. NÃO faça propaganda.
- Último parágrafo: um resumo prático do que fazer a partir de hoje.
Responda SOMENTE com JSON: {"manchete": "...", "subtitulo": "...", "corpo": "..."}
- manchete: até 80 caracteres, sem ponto final.
- subtitulo: 1 frase de 100 a 160 caracteres que resume a coluna.
- corpo: a coluna completa em Markdown (sem repetir a manchete como título).`;

export function promptColuna(p: Pauta): string {
  const fe = p.tema === 'fe' ? 'Assunto de fé.' : 'Assunto que NÃO é de fé: sem versículos.';
  return `Escreva a coluna desta semana sobre: ${p.assunto}\n${fe}`;
}

export interface Coluna {
  manchete: string;
  subtitulo: string;
  corpo: string;
}

export function validarColuna(x: unknown): Coluna {
  const o = objeto(x);
  const manchete = texto(o, 'manchete', 15).replace(/\.$/, '');
  const subtitulo = texto(o, 'subtitulo', 60);
  const corpo = texto(o, 'corpo', 1500).replaceAll('\\"', '"'); // o modelo às vezes devolve \" dentro do texto
  const palavras = contarPalavras(corpo);
  if (palavras < 350) throw new ErroLlm(`coluna curta demais (${palavras} palavras)`);
  return { manchete, subtitulo, corpo };
}

export const contarPalavras = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Tira qualquer link que o modelo tenha escrito: link comercial só pelo layout, com rel="sponsored".
export function semLinks(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '');
}

const ALERTAS: [RegExp, string][] = [
  [/\b(garantid[oa]s?|sem risco|risco zero)\b/i, 'promessa de garantia ou "sem risco"'],
  [/\b(fique rico|ficar rico|enriquec|renda extra garantida|dinheiro f[aá]cil|liberdade financeira em)\b/i, 'promessa de enriquecimento'],
  [/\b\d{1,3}\s?% ao (m[eê]s|ano)\b/i, 'percentual de rendimento citado (conferir)'],
  [/\b(bitcoin|ethereum|criptomoeda|a[cç][oõ]es da|tesouro direto|cdb|fii)\b/i, 'cita investimento específico'],
  [/\b(segundo (uma )?pesquisa|estudo (da|do|de)|de acordo com (o|a) (ibge|banco central|serasa))\b/i, 'cita pesquisa ou dado (conferir a fonte)'],
  [/\b(lei n?º?\s?\d|artigo \d+)/i, 'cita lei ou artigo (conferir)'],
  [/R\$\s?\d/, 'traz contas em reais (conferir os cálculos: o modelo erra conta)'],
  // O 4b inventa versículo (escreveu "Provérbios 11:25" com um texto que não existe): sempre conferir.
  [/\b(G[eê]nesis|[EÊ]xodo|Salmos?|Prov[eé]rbios|Eclesiastes|Isa[ií]as|Jeremias|Mateus|Marcos|Lucas|Jo[aã]o|Atos|Romanos|Cor[ií]ntios|G[aá]latas|Ef[eé]sios|Filipenses|Colossenses|Tim[oó]teo|Hebreus|Tiago|Pedro)\s+\d+:\d+/i, 'cita versículo bíblico (CONFERIR o texto exato na Bíblia)'],
];

export function alertasDaColuna(c: Coluna): string[] {
  const tudo = `${c.manchete}\n${c.subtitulo}\n${c.corpo}`;
  const achados = ALERTAS.filter(([re]) => re.test(tudo)).map(([, m]) => m);
  const n = contarPalavras(c.corpo);
  if (n > 1000) achados.push(`longa demais (${n} palavras)`);
  if (n < 550) achados.push(`curta (${n} palavras; o alvo é 600 a 800)`);
  return achados;
}

const q = (s: string) => JSON.stringify(s);

// O título já vem do front matter: tira um "# Título" que o modelo repita no começo do corpo.
export function semTituloRepetido(md: string): string {
  return md.replace(/^\s*# [^\n]*\n+/, '');
}

export function paraMarkdownColuna(p: Pauta, c: Coluna, iso: string, alertas: string[]): string {
  const linhas = [
    '---',
    `title: ${q(c.manchete)}`,
    `date: ${dataBrt(iso).carimbo}`,
    `description: ${q(c.subtitulo)}`,
    `tema: ${q(p.tema)}`,
    `pauta: ${q(p.id)}`,
    `autor: "Rafael Mariano"`,
    `produto: ${q(PRODUTO_DO_TEMA[p.tema])}`,
    `gerado_por_ia: true`,
  ];
  if (alertas.length) linhas.push('alertas_revisao:', ...alertas.map((a) => `  - ${q(a)}`));
  linhas.push('draft: false', '---', '', semTituloRepetido(semLinks(c.corpo)).trim(), '');
  return linhas.join('\n');
}

// Pautas já usadas: front matter "pauta:" das colunas publicadas e das que estão na fila.
export function pautasUsadas(...dirs: string[]): Set<string> {
  const usadas = new Set<string>();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md')) continue;
      const m = readFileSync(join(d, f), 'utf8').match(/^pauta:\s*"?([^"\n]+)"?/m);
      if (m) usadas.add(m[1].trim());
    }
  }
  return usadas;
}

// Alterna os temas: escolhe o tema com menos colunas usadas e, nele, a 1ª pauta livre.
export function escolherPauta(usadas: Set<string>, tema?: Tema): Pauta | undefined {
  const livres = PAUTAS.filter((p) => !usadas.has(p.id) && (!tema || p.tema === tema));
  if (!livres.length) return undefined;
  const usoPorTema = (t: Tema) => PAUTAS.filter((p) => p.tema === t && usadas.has(p.id)).length;
  return [...livres].sort((a, b) => usoPorTema(a.tema) - usoPorTema(b.tema))[0];
}

export const MODELO_COLUNISTA = 'qwen2.5:7b-instruct';

async function descarregar(endpoint: string, modelo: string): Promise<void> {
  try {
    await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: modelo, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // melhor esforço: se falhar, o Ollama descarrega quando precisar de espaço
  }
}

export async function escreverColuna(llm: Llm, p: Pauta, iso = new Date().toISOString()) {
  const c = await llm.gerarJson(SYSTEM_COLUNISTA, promptColuna(p), validarColuna, 0.6);
  const alertas = alertasDaColuna(c);
  const slug = slugificar(c.manchete);
  return { coluna: c, alertas, slug, markdown: paraMarkdownColuna(p, c, iso, alertas), arquivo: `${dataBrt(iso).dia}-${slug}.md` };
}

async function main(): Promise<void> {
  const AGENTS = resolve(import.meta.dirname, '..');
  const REPO = resolve(AGENTS, '..', '..');
  dotenv.config({ path: join(AGENTS, '.env'), quiet: true });
  const fila = join(AGENTS, 'fila-aprovacao', 'colunas');
  const publicadas = join(REPO, 'content', 'colunas');
  const i = process.argv.indexOf('--tema');
  const tema = i >= 0 ? (process.argv[i + 1] as Tema) : undefined;
  const simular = process.argv.includes('--simular');

  const pauta = escolherPauta(pautasUsadas(fila, publicadas), tema);
  if (!pauta) {
    console.log('colunista: todas as pautas já foram usadas — adicionar novas em PAUTAS (colunista.ts)');
    return;
  }
  const heavy = configDoAmbiente(process.env, 'heavy');
  // Coluna usa o qwen2.5:7b: escreve bem melhor que o 4b das notícias (o 4b repetia frases
  // e inventou versículo). Sem fonte para copiar, o defeito do 7b na esteira (cópia) não pesa.
  const cfg = {
    ...heavy,
    modelo: process.env.OLLAMA_COLUNISTA_MODEL || MODELO_COLUNISTA,
    timeoutMs: Math.max(heavy.timeoutMs, 600_000), // coluna é longa
  };
  const llm = criarLlm(cfg);
  console.log(`colunista: ${pauta.tema} · ${pauta.assunto} (${cfg.modelo})`);
  const t0 = Date.now();
  let r: Awaited<ReturnType<typeof escreverColuna>>;
  try {
    r = await escreverColuna(llm, pauta);
  } finally {
    // criarLlm fixa keep_alive -1: tira o 7b da VRAM para não ocupar a 3060 até a próxima coluna.
    if (cfg.modelo !== heavy.modelo) await descarregar(cfg.endpoint, cfg.modelo);
  }
  const seg = Math.round((Date.now() - t0) / 1000);
  console.log(`colunista: "${r.coluna.manchete}" · ${contarPalavras(r.coluna.corpo)} palavras · ${seg}s`);
  if (r.alertas.length) console.log(`colunista: alertas → ${r.alertas.join('; ')}`);
  if (simular) {
    console.log('\n' + r.markdown);
    return;
  }
  mkdirSync(fila, { recursive: true });
  const caminho = join(fila, r.arquivo);
  writeFileSync(caminho, r.markdown, 'utf8');
  console.log(`colunista: na fila de aprovação → ${caminho}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error('colunista: falhou —', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
