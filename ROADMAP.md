# Roadmap · CNB News Brasil

## Fase 1: Rede de Portais Municipais (Concluída)
- Portal nacional (`cnbmobile.com`) e subdomínios dinâmicos (`*.news.cnbmobile.com`) via Hugo + Vercel.
- Automação local na rig (`qwen3:4b` via Ollama) gerando notícias de utilidade pública por município.
- SEO (`sitemap.xml`, `robots.txt`, JSON-LD `NewsArticle`), Google Analytics 4 (`G-J3TJ3KJNNE`) e Google AdSense (`ca-pub-3552150640937820`).

## Fase 2 (Futura): Canal YouTube 24/7 Estilo Bloomberg (Telão de Manchetes)
- **Conceito:** Transmissão contínua ao vivo no YouTube sem vídeo pesado, exibindo apenas o painel gráfico limpo em Full HD (1920x1080) com:
  - Manchete principal e resumo da cidade em destaque rotacionando automaticamente a cada 20–30 segundos.
  - Barra inferior (ticker) estilo Bloomberg com últimas horas de todas as cidades + cotações USD/EUR e hora oficial.
  - Áudio ambiente de redação ou trilha instrumental livre de direitos autorais (e opção futura de locução TTS local).
- **Arquitetura prevista:**
  1. Criar rota `/tv/` (layout fullscreen 16:9 no Hugo lendo um `/feed-tv.json` gerado pelo robô a cada ciclo).
  2. Rodar navegador headless / FFmpeg na rig transmitindo a tela `/tv/` via RTMP direto para a chave de transmissão do YouTube Live com consumo mínimo de CPU/GPU.

## Fase 3: Portal completo por editorias (pedido em 27/11/2026, layout atual mantido)
Menu alvo: Esportes · Entretenimento · Influencers · Saúde · Política · Guia de Compras · Natureza · Viagens · Tecnologia (+ Brasil, Economia, Agro, Mundo, Opinião, Cidades).
Regra: editoria só entra no menu quando tiver fonte licenciada e volume diário; menu vazio derruba a confiança (e o AdSense).

| Editoria | Fonte | Situação |
|---|---|---|
| Esportes | Agência Brasil `rss/esportes/feed.xml` (CC BY) | pronta para ligar no robô nacional |
| Saúde | Agência Brasil `rss/saude/feed.xml` | pronta |
| Política | Agência Brasil `rss/politica/feed.xml` + Agência Senado/Câmara (checar licença) | pronta |
| Natureza | Agência Brasil `rss/meio-ambiente/feed.xml` | pronta |
| Entretenimento | Agência Brasil `rss/cultura/feed.xml` | pronta (cultura; celebridade fica de fora) |
| Tecnologia | sem feed próprio na Agência Brasil; avaliar fontes com licença | pesquisar |
| Influencers | conteúdo próprio: entrevistas do @rafaelmariano (editoria `entrevistas` do §3) | pauta humana |
| Viagens | conteúdo próprio/evergreen; risco de fato inventado → revisão humana sempre | desenhar |
| Guia de Compras | afiliados (link `rel="sponsored"`, nota de transparência, regra 90/10 do §4) | desenhar |

Ordem sugerida: (1) `data/editorias.yaml` como fonte única do menu, do rótulo e da cor (só `ativa: true` aparece);
(2) feeds novos no robô nacional com `categoria` por feed (o robô já é o gargalo: medir antes, talvez 2ª rig);
(3) páginas `/editoria/<slug>/` reaproveitando os componentes da capa (lead + cards + Últimas);
(4) bancos de foto por editoria (`data/fotos/brasil-<editoria>.json`).

## Newsletter e alertas
- Cadastro no portal no ar (27/11/2026): `api/newsletter.mjs` → Brevo com confirmação por e-mail. Falta a conta Brevo da CNB + variáveis na Vercel.
- Próximo: resumo diário às 7h (agente "Resumo da manhã") e, depois, disparo de notícias URGENTES (`urgencia: urgente|plantao`).
