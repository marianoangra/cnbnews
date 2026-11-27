# services/stream-engine — live 24h da CNB News no YouTube

Cada notícia publicada vira um **bloco de vídeo** (card + locução + trilha) e um transmissor emenda os
blocos sem parar numa live do YouTube. Sem pessoas em vídeo. Desenho completo em
`docs/superpowers/specs/2026-11-26-live-youtube-design.md`.

```
clone do repo (data/repo) → coletor → filtro editorial → fábrica (card satori + voz Edge TTS + FFmpeg NVENC)
   → data/blocos/*.ts → programador → transmissor (1 FFmpeg -c copy) → RTMP do YouTube
```

## Pré-requisitos

- Node >= 23.6 (TypeScript nativo, sem build) e `npm install` na raiz do monorepo.
- FFmpeg com `h264_nvenc` e `nvidia-smi` no PATH (driver NVIDIA).
- Internet (voz Edge TTS e `git` do repo público).

## Configuração (`.env` nesta pasta, nunca commitado)

Copie `.env.example` para `.env`:

| Variável | O que é |
|---|---|
| `YOUTUBE_STREAM_KEY` | Chave da transmissão (YouTube Studio → Transmitir). |
| `DESTINO` | Opcional. Sobrescreve o destino (ex.: `data/teste.flv` para testar sem YouTube). |
| `FFMPEG_GPU_DEVICE` | Índice da GPU do NVENC, na ordem do `nvidia-smi -L`. **Rig dual-GPU: `1`** (RTX 2060; a 3060 = 0 fica para o LLM). **PC do Rafael: `0`** (só tem a 2060). |
| `TTS_VOZ` | Voz da locução. Padrão `pt-BR-FranciscaNeural` (alternativa: `pt-BR-AntonioNeural`). |

Na largada a live confere se a GPU existe e abre o NVENC; se não, sai com erro claro.

## Comandos

```bash
npm run gerar -w services/stream-engine -- 30      # um ciclo de produção (até 30 blocos novos) e sai
npm run amostra -w services/stream-engine -- 5     # PNGs de amostra em data/amostras/
npm run ao-vivo -w services/stream-engine           # NO AR (YouTube)
DESTINO=data/teste.flv npm run ao-vivo -w services/stream-engine -- --por 180   # teste local de 3 min
npm test -w services/stream-engine
```

`npm run live` na raiz é atalho para `ao-vivo`. Ctrl+C encerra limpo.

## Como a live se comporta

- **Produção a cada 5 min**, em paralelo à exibição: sincroniza o repo, coleta as matérias das últimas 48 h,
  filtra e gera até 20 blocos novos por ciclo (mais novos primeiro). Falha de rede não derruba nada.
- **Programação**: notícia inédita primeiro; sem repetir em 60 min; alterna cidades; vinheta a cada 5 blocos;
  sem notícia disponível → loop institucional (`data/fixos/`). A tela nunca fica preta.
- **Queda do FFmpeg/rede**: reinicia sozinho (5 s, 10 s, 20 s… até 60 s) e avisa `⚠ QUEDA` no console.
- **Estado** em `data/status.json` (bloco no ar, quedas, minutos de notícia pronta, último ciclo).
- **Limpeza**: blocos de notícia com mais de 48 h são apagados; os fixos nunca.

## Regras editoriais e do YouTube

- Vão ao ar só **título + resumo** (ou a `lauda_youtube` do robô nacional) e a **fonte**; nunca o corpo.
- `config/bloqueio.txt`: palavras que tiram a matéria da LIVE (violência, crime, morte…). Ela segue no site.
- Sem fotos de terceiros nos cards. Fonte Montserrat (OFL) em `assets/fonts/`.
- Trilha: coloque em `trilhas/` só faixas da **Biblioteca de Áudio do YouTube marcadas "sem atribuição"**
  (mp3/m4a/wav). Pasta vazia = só voz. Música sem licença derruba a live por Content ID.
- A voz é sintética: manter ligada a opção "conteúdo alterado ou sintético" na live (ver `docs/roteiro-youtube.md`).

## Trocar a voz para Azure (quando monetizar)

O Edge TTS é grátis mas não oficial. Para uso comercial licenciado, implemente outro `Locutor`
(`src/locutor.ts`) chamando o Azure Speech com a mesma voz `pt-BR-FranciscaNeural` e troque em `ao-vivo.ts`/`gerar.ts`.

## Rodar na rig (Linux)

Mesmos comandos. Para ficar no ar após reboot, crie um serviço systemd com
`WorkingDirectory=<repo>/services/stream-engine`, `ExecStart=/usr/bin/node src/ao-vivo.ts` e `Restart=always`.
