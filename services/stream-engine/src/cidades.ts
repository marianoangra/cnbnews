/** Nomes com acento das cidades cobertas (pastas de `content/cidades/`). */
const NOMES: Record<string, string> = {
  'almirante-tamandare': 'Almirante Tamandaré',
  'angra-dos-reis': 'Angra dos Reis',
  'armacao-dos-buzios': 'Armação dos Búzios',
  'arraial-do-cabo': 'Arraial do Cabo',
  'cabo-frio': 'Cabo Frio',
  'cachoeira-paulista': 'Cachoeira Paulista',
  'campo-largo': 'Campo Largo',
  'campos-dos-goytacazes': 'Campos dos Goytacazes',
  capanema: 'Capanema',
  caraguatatuba: 'Caraguatatuba',
  cascavel: 'Cascavel',
  'cruzeiro-sp': 'Cruzeiro',
  curitiba: 'Curitiba',
  'foz-do-iguacu': 'Foz do Iguaçu',
  'francisco-beltrao': 'Francisco Beltrão',
  guaira: 'Guaíra',
  ilhabela: 'Ilhabela',
  itaguai: 'Itaguaí',
  'lavras-mg': 'Lavras',
  londrina: 'Londrina',
  lorena: 'Lorena',
  macae: 'Macaé',
  mangaratiba: 'Mangaratiba',
  'manoel-ribas': 'Manoel Ribas',
  maringa: 'Maringá',
  paranagua: 'Paranaguá',
  paraty: 'Paraty',
  pelotas: 'Pelotas',
  pitanga: 'Pitanga',
  'ponta-grossa': 'Ponta Grossa',
  prudentopolis: 'Prudentópolis',
  quissama: 'Quissamã',
  reboucas: 'Rebouças',
  resende: 'Resende',
  'rio-das-ostras': 'Rio das Ostras',
  'sao-joao-da-barra': 'São João da Barra',
  'sao-jose-dos-campos': 'São José dos Campos',
  'sao-pedro-da-aldeia': 'São Pedro da Aldeia',
  'sao-sebastiao': 'São Sebastião',
  taubate: 'Taubaté',
  ubatuba: 'Ubatuba',
  'vitoria-es': 'Vitória',
};

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export function nomeCidade(slug: string): string {
  const conhecido = NOMES[slug];
  if (conhecido) return conhecido;
  return slug
    .split('-')
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

export function todasAsCidades(): string[] {
  return Object.values(NOMES);
}
