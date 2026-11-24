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
