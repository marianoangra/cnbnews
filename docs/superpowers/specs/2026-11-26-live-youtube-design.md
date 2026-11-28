# CNB News TV — live 24h no YouTube (design)

Data: 2026-11-26 · Status: aguardando aprovação do Rafael

## 1. Intenção

Canal "CNB News" no YouTube com uma live contínua no estilo telão de notícias (referências: Bloomberg/CNN —
manchete grande + tarja inferior), **sem pessoas em vídeo**: só cards gráficos com as principais notícias do
portal. Dois objetivos, nesta ordem de peso igual:

1. **Ganhar dinheiro com anúncios** (Programa de Parcerias do YouTube).
2. **Levar gente para o site** (cnbmobile.com).

Depois virão Instagram e TikTok do portal — o design já produz material reaproveitável para isso, mas a
publicação nessas redes **não** faz parte desta fase.

Máquina: **este PC** (RTX 2060, Ryzen 5 5500, 16 GB, Windows 11, FFmpeg 8.1 e Node já instalados) por enquanto;
depois uma rig dedicada só à transmissão. Tudo tem que rodar também em Linux.

## 2. Metas, não-metas, anti-metas

**Metas**
- Live 24h estável no YouTube, 1080p30, com tela nunca preta.
- Cada notícia vira um **bloco** de ~30–60 s: card animado + locução lendo o resumo + trilha liberada +
  chamada "leia em cnbmobile.com".
- Alimentação automática a partir das matérias que o robô já publica.
- Passar na revisão de monetização (conteúdo com valor agregado, não "slideshow repetitivo").

**Não-metas (agora)**
- Upload automático de Shorts/Reels/TikTok (a versão vertical de cada bloco fica para a fase 2).
- Vídeo de apresentador, avatar ou rosto sintético.
- Chat bot / moderação automática da live.
- Gerenciar a live pela API do YouTube (a live é criada à mão no YouTube Studio, só a chave vai no `.env`).

**Anti-metas (falha mesmo que funcione)**
- Strike de direitos autorais (música, foto ou trecho de vídeo de terceiros).
- Canal recusado na monetização por "conteúdo repetitivo/produzido em massa".
- Notícia errada ou sensacionalista no ar com a marca CNB News.
- Tela preta ou live caindo e ficando fora do ar sem ninguém perceber.

## 3. Restrições e diretrizes do YouTube (o que molda o design)

| Diretriz | Como o design atende |
|---|---|
| Direitos autorais / Content ID | Sem fotos das fontes. Cards 100% tipográficos/gráficos próprios. Música só de pasta `trilhas/` com faixas da Biblioteca de Áudio do YouTube marcadas "sem atribuição" ou sem trilha. |
| Conteúdo repetitivo / produzido em massa (monetização) | Cada bloco tem locução de resumo próprio, variação de layout por editoria e cidade, vinhetas entre blocos. Nenhum bloco repete mais de 1x por hora quando houver material. |
| Conteúdo sintético | Voz sintética. Flag "conteúdo alterado ou sintético" ligada na live (conforme CLAUDE.md §4C), e a descrição diz "narração gerada por voz sintética". |
| Diretrizes para anunciantes | Filtro editorial tira da live matérias de violência, morte, crime, tragédia (palavras-chave + editoria). Elas seguem no site, só não vão para o telão. |
| Spam / metadados enganosos | Título e descrição fixos e honestos ("CNB News AO VIVO — notícias das cidades 24h"), sem clickbait. Link do site na descrição. |
| Informação errada | Só vai ao ar título + descrição (`description`) da matéria, nunca o corpo inteiro. Todo card mostra "Fonte: <fonte>". |

## 4. Abordagens consideradas

1. **Telão web + OBS** — página `/tv/` animada capturada pelo OBS. Mais bonito e mais rápido de pôr no ar, mas
   depende do OBS aberto no Windows, pede máquina boa na futura rig e não gera nada para Instagram/TikTok.
2. **Telão web + captura headless** — mesmo visual sem OBS, mas captura de navegador 24h é instável.
3. **Fábrica de blocos + transmissor contínuo** ✅ escolhida — gera um vídeo curto por notícia e um
   transmissor emenda os blocos sem parar. Leve (roda na rig fraca), resiliente (fila + loop de contingência),
   e cada bloco já é matéria-prima de Shorts/Reels/TikTok. Custo: animação mais simples que a de navegador e
   mais trabalho inicial.

Rafael escolheu a 3 ("continue" após a recomendação).

## 5. Arquitetura

Fica em `services/stream-engine/` (monorepo cnbnews), Node 24 + TypeScript nativo do Node, como o
`services/agents`.

```
 GitHub marianoangra/cnbnews (clone próprio em data/repo, git pull a cada 5 min)
        │  content/cidades/*/ *.md  +  content/noticias/*.md
        ▼
 [1] coletor ──► [2] filtro editorial ──► [3] fábrica de blocos ──► data/blocos/*.ts
                                              │ card PNG (satori + resvg)
                                              │ locução (TTS)
                                              │ FFmpeg NVENC: card animado + voz + trilha
                                              ▼
 [4] programador (escolhe o próximo bloco) ──► [5] transmissor: 1 FFmpeg vivo, -c copy ──► RTMP YouTube
                                              ▲
                     loop institucional + vinhetas (contingência)
```

### [1] Coletor
- Mantém um clone **próprio** do repo público (não usa o checkout de `~/Desktop/cnbnews`, que outro terminal e
  o robô da rig usam).
- Lê o front matter: `title`, `date`, `description`, `fonte`, cidade (= pasta). Matérias nacionais de
  `content/noticias/`.
- Só considera matérias das últimas 48 h.

### [2] Filtro editorial
- Descarta: violência/crime/morte/tragédia (lista de palavras no título e descrição), descrição vazia ou com
  menos de 80 caracteres, títulos duplicados entre cidades (normalizados).
- Lista de palavras fica num arquivo editável (`config/bloqueio.txt`).

### [3] Fábrica de blocos (1 por notícia, gerado uma vez, reaproveitado)
- **Card 1920×1080** desenhado em JSX → SVG → PNG com `satori` + `@resvg/resvg-js` (sem navegador, leve).
  Layout no espírito das referências: faixa de marca "CNB NEWS • AO VIVO", selo da cidade/editoria,
  manchete grande com destaque de cor numa palavra-chave, resumo, "Fonte: …", e a chamada
  "Leia a matéria completa em cnbmobile.com". Tarja inferior (ticker) com as outras manchetes do momento,
  rolando via FFmpeg.
- **Locução**: lê "manchete. resumo. Fonte: X. Mais em cnbmobile ponto com." TTS atrás de uma
  interface trocável. Ver decisão em §7.
- **Vídeo**: FFmpeg com `h264_nvenc`, 1080p30, GOP 2 s, AAC 48 kHz 160 kbps, contêiner MPEG-TS — parâmetros
  **idênticos** em todos os blocos para o transmissor poder emendar sem reencodar. Animação: entrada da
  manchete (fade/slide), zoom lento no fundo, ticker rolando. Duração = locução + 2 s.
- Trilha da pasta `trilhas/` mixada baixo (−22 dB) sob a voz; sem pasta, sai só a voz.
- Saída em `data/blocos/<id>.ts` + `<id>.json` (metadados). Limpeza automática do que tem mais de 48 h.

### [4] Programador
- Ordem: notícias novas primeiro; depois rodízio das últimas 48 h alternando cidades; nenhum bloco repete
  dentro de 60 min se houver alternativa.
- A cada 5 blocos, uma **vinheta** de 5–8 s ("Você está na CNB News • cnbmobile.com").
- Buffer mínimo de 15 min de blocos prontos à frente (CLAUDE.md §5C). Fila vazia → **loop institucional** (blocos pré-gerados: o que é a CNB News, cidades cobertas, chamada
  para o site). A tela nunca fica preta.

### [5] Transmissor
- Um processo FFmpeg de vida longa: lê MPEG-TS pela entrada padrão (`-re -i pipe:0 -c copy -f flv rtmp://…`).
  O programador vai escrevendo os bytes dos blocos nessa entrada, um atrás do outro.
- Se o FFmpeg ou a rede cair: reinicia sozinho com espera crescente (5 s → 60 s) e registra em log.
- Chave em `.env` (`YOUTUBE_STREAM_KEY`), nunca no git. Ingestão `rtmp://a.rtmp.youtube.com/live2`.
- Um comando `npm run ao-vivo` sobe tudo; em Windows roda numa janela; na rig vira serviço systemd.

### Monitor
- Arquivo `data/status.json` (último bloco, horário, quedas) e alerta simples no console. Alerta externo
  (WhatsApp/Telegram) fica para depois.

## 6. Configuração do YouTube (passo manual do Rafael, com roteiro meu)
1. Criar o canal "CNB News" como **conta de marca** (não misturar com o canal pessoal).
2. Verificar o canal por telefone e pedir o recurso de live (o YouTube libera em até 24 h).
3. YouTube Studio → Transmitir → live com chave persistente; marcar "conteúdo alterado ou sintético"; título,
   descrição com link do site, categoria Notícias e Política; "não é conteúdo para crianças".
4. Copiar a chave para o `.env`.
5. (Opcional) Baixar 5–10 faixas "sem atribuição" da Biblioteca de Áudio para `trilhas/`.

## 7. Decisões tomadas por mim (corrigir se discordar)
- **Voz (TTS)**: começar com **Microsoft Edge TTS** (`edge-tts`, vozes neurais pt-BR Francisca/Antônio, grátis,
  já previsto no CLAUDE.md). Risco: é um serviço não oficial, sem contrato de uso comercial. Por isso o TTS fica
  atrás de uma interface, e a troca para **Azure Speech** (mesmas vozes, licenciado, ~US$ 16 por milhão de
  caracteres, que dá uns US$ 5–15/mês no nosso volume) é só uma configuração quando o canal começar a monetizar.
- **Sem fotos** nos cards (risco de direitos autorais); identidade 100% tipográfica.
- **Só título + resumo** vão ao ar, nunca o corpo da matéria.
- **Sem relógio ao vivo** no card (o bloco é gravado antes e repetido; o horário ficaria errado). Mostra
  "Publicado às HH:MM".
- **Matérias de violência fora da live** (amigável para anunciante).
- **Nada commitado enquanto o outro terminal mexe no repo**: os arquivos ficam em `services/stream-engine/` e
  `docs/`, sem `git add`, até o outro terminal liberar.

## 8. Fica para quem constrói
- Paleta e tipografia exatas (seguir a cor da marca do site; fonte livre tipo Inter/Montserrat embutida).
- Nomes de arquivos internos, estrutura de testes, limiares exatos do filtro.

## 9. Critério de pronto (fase 1)
- `npm run ao-vivo` transmitindo para uma live **não listada** de teste por 2 h sem queda nem tela preta.
- Pelo menos 20 blocos reais gerados a partir das matérias do repo, revisados visualmente pelo Rafael.
- Filtro editorial barrando as matérias de violência atuais (ex.: "adolescente baleada…").
- Derrubar a internet por 1 min → a live volta sozinha.
