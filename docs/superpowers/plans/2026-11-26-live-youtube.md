# CNB News TV (live 24h no YouTube) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar as matérias publicadas da CNB News em blocos de vídeo (card + locução + trilha) e transmiti-los sem parar numa live do YouTube.

**Architecture:** Pacote Node 24 em `services/stream-engine/`. Um coletor lê um clone próprio do repo público, um filtro tira o que não é amigável a anunciante, uma fábrica gera um `.ts` (MPEG-TS, NVENC) por notícia, um programador escolhe a ordem e um transmissor mantém um único FFmpeg vivo (`-c copy`) empurrando os bytes para o RTMP.

**Tech Stack:** Node 24 (TypeScript nativo, `node --test`), `satori` + `@resvg/resvg-js` (cards), `edge-tts` (CLI Python, locução), FFmpeg 8 com `h264_nvenc`, `gray-matter` (front matter).

**Spec:** `docs/superpowers/specs/2026-11-26-live-youtube-design.md`

## Global Constraints

- Node >= 23.6, TypeScript nativo sem build, `tsconfig` igual ao de `services/agents` (strict, `allowImportingTsExtensions`, `erasableSyntaxOnly`). Imports com extensão `.ts`.
- Testes: `node --test "test/*.test.ts"` dentro de `services/stream-engine`.
- **Worktree próprio**: todo o trabalho acontece em `C:\Users\Pichau\Desktop\cnbnews-live` (branch `live-24h`, saindo de `main` d16f841). Nunca escrever no checkout `~/Desktop/cnbnews` (branch `redesign-visual`, compartilhado com outros terminais). Commit local no `live-24h` ao fim de cada task; push e merge em `main` só com OK do Rafael. O pacote entra no `workspaces` da raiz já na Task 1.
- Vídeo de todo bloco: 1920×1080, 30 fps, `h264_nvenc`, `-g 60`, `-bf 0`, `-pix_fmt yuv420p`, CBR 4500k; áudio AAC 48 kHz estéreo 160k; contêiner `mpegts`. Parâmetros idênticos em todo bloco, vinheta e loop.
- **GPU do encoder (dual-GPU, pedido do Rafael):** todo `h264_nvenc` leva `-gpu <FFMPEG_GPU_DEVICE>` e o processo FFmpeg roda com `CUDA_DEVICE_ORDER=PCI_BUS_ID`. `FFMPEG_GPU_DEVICE` padrão `1` (RTX 2060 na rig, ao lado da RTX 3060 = GPU 0 reservada ao LLM). **Neste PC só há uma GPU (RTX 2060 = índice 0): o `.env` local usa `FFMPEG_GPU_DEVICE=0`.** Codificação só acontece no montador; o transmissor é `-c copy` e não usa GPU. Entradas são PNG/MP3, então `-hwaccel cuda` não se aplica (não usar). Na largada, validar o índice com `nvidia-smi -L` e sair com erro claro se não existir.
- Cards: sem fotos de terceiros; fonte Montserrat (OFL) embutida em `assets/fonts/`.
- Só vão ao ar `title` + `description` + `fonte`; nunca o corpo.
- Chamada fixa: "Leia a matéria completa em cnbmobile.com". Locução termina com "Mais em cnbmobile ponto com."
- Horário mostrado: "Publicado às HH:MM" em `America/Sao_Paulo`. Sem relógio ao vivo.
- Matérias consideradas: últimas 48 h. Bloco não repete dentro de 60 min se houver alternativa. Vinheta a cada 5 blocos. Buffer mínimo de 15 min de blocos prontos.
- Trilha: arquivos de `trilhas/` mixados a −22 dB; pasta vazia ⇒ só voz.
- Segredo `YOUTUBE_STREAM_KEY` só em `.env` (gitignored). Ingestão `rtmp://a.rtmp.youtube.com/live2/<chave>`.
- Limpeza: blocos com mais de 48 h apagados.
- Tudo roda em Windows e Linux (caminhos com `node:path`, nada de shell específico).

## Review Focus

1. Manchete enorme, aspas, acentos, travessão ou emoji → card não estoura a área nem quebra a renderização (trunca com "…" em 3 linhas). Teste na Task 4.
2. `edge-tts` falha ou está sem internet → a notícia NÃO vai ao ar muda; fica para a próxima rodada e a live continua com o que já existe. Teste na Task 5/6.
3. Blocos emendados com parâmetros diferentes (ex.: vinheta 44,1 kHz) → travadas na live. Teste de `ffprobe` comparando todos os tipos de bloco na Task 6.
4. `git pull` falha (sem internet / GitHub fora) → segue com o último conteúdo, sem derrubar nada. Teste na Task 3.
5. Data do front matter em UTC ou sem fuso → "Publicado às" sempre em horário de Brasília. Teste na Task 1.

---

### Task 1: Pacote, tipos e coletor de matérias

**Files:**
- Create: `services/stream-engine/package.json`, `tsconfig.json`, `.gitignore` (`data/`, `.env`, `node_modules/`), `.env.example`
- Create: `services/stream-engine/src/tipos.ts`, `src/coletor.ts`
- Test: `services/stream-engine/test/coletor.test.ts`, fixtures em `test/fixtures/repo/content/...`

**Interfaces:**
- Produces:
  - `interface Materia { id: string; titulo: string; resumo: string; fonte: string; cidade: string | null; publicadaEm: Date; caminho: string; lauda: { textoGc: string; textoLocucao: string; palavrasChaveVisuais: string[] } | null }` — `lauda` vem do front matter `lauda_youtube` (`texto_gc`, `texto_locucao`, `palavras_chave_visuais`) que o robô nacional passa a gerar (branch `dual-gpu`, 6e742ea, ainda fora do `main`); `null` se ausente ou incompleta (matérias de cidade não têm) — `id` = caminho relativo sem `.md`; `cidade` = slug da pasta em `content/cidades/<slug>/`, `null` para `content/noticias/`.
  - `coletar(raizRepo: string, agora: Date, janelaHoras = 48): Promise<Materia[]>` — ordenado por `publicadaEm` desc, ignora `_index.md`.
  - `nomeCidade(slug: string): string` — `"sao-jose-dos-campos"` → `"São José dos Campos"` via mapa em `src/cidades.ts` com fallback capitalizando.
  - `horaBrasilia(d: Date): string` — `"14:10"`.

- [ ] **Step 1: Escrever `package.json`** (`"type": "module"`, scripts `test`, `ao-vivo` = `node src/ao-vivo.ts`, `gerar` = `node src/gerar.ts`), dependências `gray-matter`, `satori`, `@resvg/resvg-js`, `dotenv`; `npm install` dentro da pasta.
- [ ] **Step 2: Testes que falham** em `coletor.test.ts`:
  - fixture com 3 matérias (Pelotas há 2 h, nacional há 10 h, Pelotas há 50 h) + `_index.md` → `coletar` devolve 2, mais nova primeiro (Pelotas 2 h, depois a nacional); a de 50 h fica fora.
  - `cidade === "pelotas"` e `null` para a nacional; `resumo` = `description`.
  - `horaBrasilia(new Date("2026-11-25T17:10:31Z")) === "14:10"` e `horaBrasilia(new Date("2026-11-25T14:10:31-03:00")) === "14:10"`.
  - matéria nacional com `lauda_youtube` completo → `lauda.textoLocucao` preenchido; matéria de cidade sem o campo e nacional com `lauda_youtube` sem `texto_locucao` → `lauda === null`.
  - `nomeCidade("sao-jose-dos-campos") === "São José dos Campos"`, `nomeCidade("cidade-nova") === "Cidade Nova"`.
- [ ] **Step 3: Rodar** `npm test` → FAIL (módulo não existe).
- [ ] **Step 4: Implementar** `tipos.ts`, `cidades.ts` (mapa das 42 cidades de `content/cidades/`), `coletor.ts` (`fs.readdir` recursivo + `gray-matter`; `horaBrasilia` com `Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })`).
- [ ] **Step 5: Rodar** `npm test` → PASS. Commit no `live-24h`.

### Task 2: Filtro editorial

**Files:**
- Create: `src/filtro.ts`, `config/bloqueio.txt`
- Test: `test/filtro.test.ts`

**Interfaces:**
- Consumes: `Materia`.
- Produces: `filtrar(materias: Materia[], bloqueio: string[]): Materia[]` e `carregarBloqueio(caminho: string): Promise<string[]>` (uma palavra/expressão por linha, `#` comenta, comparação sem acento e minúscula, por palavra inteira).

- [ ] **Step 1: `config/bloqueio.txt`** com no mínimo: baleado/baleada, morto/morta/morte, assassinato, homicídio, estupro, tiroteio, chacina, esfaqueado, feminicídio, latrocínio, sequestro, tragédia, acidente fatal, corpo encontrado, suicídio, preso, prisão em flagrante, tráfico.
- [ ] **Step 2: Testes que falham:**
  - "Adolescente baleada na cabeça pelo ex-companheiro em Pelotas" → removida.
  - "MEC promove último aulão do Enem em Pelotas" → mantida.
  - resumo com menos de 80 caracteres → removida.
  - duas matérias de cidades diferentes com títulos iguais após normalizar (minúsculas, sem acento, sem pontuação) → fica só a mais nova.
  - "Prefeitura amorteceu custos" NÃO é barrada por "morte" (palavra inteira).
- [ ] **Step 3: Rodar** → FAIL. **Step 4: Implementar.** **Step 5: Rodar** → PASS.

### Task 3: Sincronizador do repositório

**Files:**
- Create: `src/sincronizador.ts`
- Test: `test/sincronizador.test.ts`

**Interfaces:**
- Produces: `sincronizar(urlRepo: string, destino: string): Promise<{ ok: boolean; erro?: string }>` — `git clone --depth 1` se `destino` não existe, senão `git -C destino pull --ff-only --depth 1`; nunca lança.
- URL padrão: `https://github.com/marianoangra/cnbnews.git`, destino `data/repo`.

- [ ] **Step 1: Testes que falham** usando um repo git local temporário (criado no teste com `git init` + commit): primeiro `sincronizar` clona; commit novo na origem + segundo `sincronizar` traz o arquivo; `sincronizar("C:/nao/existe", destinoJaClonado)` → `{ ok: false }` e o conteúdo antigo continua lá (Review Focus 4).
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** com `execFile` (sem shell). **Step 4: Rodar** → PASS.

### Task 4: Renderizador de cards (satori)

**Files:**
- Create: `src/card.ts`, `assets/fonts/Montserrat-Regular.ttf`, `Montserrat-Bold.ttf`, `Montserrat-ExtraBold.ttf` (baixar do repositório Google Fonts, licença OFL, salvar também `assets/fonts/OFL.txt`)
- Test: `test/card.test.ts`

**Interfaces:**
- Consumes: `Materia`, `nomeCidade`, `horaBrasilia`.
- Produces:
  - `renderizarFundo(): Promise<Buffer>` — PNG 1920×1080 opaco: gradiente escuro da marca, faixa superior "CNB NEWS • AO VIVO" com bolinha vermelha, área da tarja inferior (altura 110 px) vazia.
  - `renderizarConteudo(m: Materia): Promise<Buffer>` — PNG 1920×1080 **transparente**: selo da cidade (ou "BRASIL"), manchete ExtraBold até 3 linhas (trunca com "…"), destaque em amarelo `#FFC83D` na primeira palavra da manchete com 5+ letras ou número, resumo até 3 linhas, "Fonte: X • Publicado às HH:MM", barra roxa vertical à esquerda (como a referência do Gabriel Paiva), chamada "Leia a matéria completa em cnbmobile.com".
  - `renderizarTicker(manchetes: string[]): Promise<{ png: Buffer; largura: number }>` — faixa de 110 px de altura com as manchetes separadas por " • ", largura = largura do texto.
  - `renderizarVinheta(texto: string): Promise<Buffer>` — tela cheia da marca.
  - Cores: fundo `#0B0F1A`→`#141B2E`, texto `#FFFFFF`, roxo `#7C3AED`, amarelo `#FFC83D`, vermelho ao vivo `#E11D48`.
- Satori recebe objetos `{ type, props }` (sem JSX), largura/altura 1920×1080, fontes carregadas uma vez.

- [ ] **Step 1: Baixar as fontes** e conferir que os 3 `.ttf` abrem (tamanho > 50 KB).
- [ ] **Step 2: Testes que falham:**
  - `renderizarConteudo` de uma matéria normal → Buffer começa com a assinatura PNG e IHDR diz 1920×1080.
  - manchete de 400 caracteres com aspas “ ”, travessão — e emoji 🚨 → não lança, devolve PNG 1920×1080 (Review Focus 1).
  - `renderizarTicker(["A", "B"]).largura > 0` e altura do PNG = 110.
  - `escolherDestaque("O dólar bateu R$ 6 na semana") === "dólar"`; `escolherDestaque("Enem 2026 em Pelotas") === "2026"` — exportar essa função pura.
- [ ] **Step 3: Rodar** → FAIL. **Step 4: Implementar.** **Step 5: Rodar** → PASS.
- [ ] **Step 6: Script `npm run amostra`** grava `data/amostras/*.png` de 5 matérias reais para o Rafael ver.

### Task 5: Locutor (TTS)

**Files:**
- Create: `src/locutor.ts`
- Test: `test/locutor.test.ts`

**Interfaces:**
- Produces:
  - `textoLocucao(m: Materia): string` — se `m.lauda` existe, usa `m.lauda.textoLocucao` + `" Fonte: <fonte>. Mais em cnbmobile ponto com."`; senão `"<titulo>. <resumo> Fonte: <fonte>. Mais em cnbmobile ponto com."` (garante ponto final entre partes, remove URLs e emoji).
  - `interface Locutor { falar(texto: string, saidaMp3: string): Promise<void> }`
  - `class EdgeLocutor implements Locutor` — `execFile("edge-tts", ["--voice", voz, "--rate", "+5%", "--text", texto, "--write-media", saida])`; voz padrão `pt-BR-FranciscaNeural`, configurável por `TTS_VOZ`; timeout 60 s; lança `ErroLocucao` em falha ou arquivo vazio.
- Pré-requisito: `pip install edge-tts` (documentar no README da Task 10).

- [ ] **Step 1: Testes que falham:**
  - `textoLocucao` de matéria com resumo sem ponto final → termina em `"Mais em cnbmobile ponto com."` e contém `"Fonte: RS.GOV.BR"`; URL no resumo é removida.
  - matéria com `lauda` → texto começa com `lauda.textoLocucao` e NÃO repete o título; termina igual.
  - `EdgeLocutor` com binário inexistente (`new EdgeLocutor({ binario: "nao-existe-tts" })`) → rejeita com `ErroLocucao` (Review Focus 2).
  - teste de integração `falar("Teste da CNB News.")` gera MP3 > 5 KB — marcado `{ skip: !temEdgeTts }`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.

### Task 6: Montador de blocos (FFmpeg)

**Files:**
- Create: `src/montador.ts`, `src/ffmpeg.ts` (helpers `rodarFfmpeg(args)`, `sondar(arquivo)` via `ffprobe -print_format json`)
- Test: `test/montador.test.ts`

**Interfaces:**
- Consumes: os PNGs da Task 4, MP3 da Task 5.
- Produces:
  - `argsBloco(e: { fundo: string; conteudo: string; ticker: string; larguraTicker: number; voz: string | null; trilha: string | null; duracao: number; saida: string; gpu: number }): string[]` — pura; inclui `-gpu <gpu>` logo após `-c:v h264_nvenc`. Filtro: fundo em loop; conteúdo entra com fade de alpha 0,6 s e slide de 40 px de baixo para cima; ticker em `overlay=x='W-mod(t*120, W+larguraTicker)':y=H-110`; voz (ou `anullsrc` se null) mixada com trilha `volume=-22dB` (`amix=duration=first`); parâmetros de vídeo/áudio exatos das Global Constraints; `-t duracao`; `-f mpegts`.
  - `montarBloco(m: Materia, manchetesTicker: string[], locutor: Locutor, dirSaida: string, trilhas: string[]): Promise<BlocoPronto>` — duração = duração da voz + 2 s; se o locutor lançar, **propaga** (o chamador pula a notícia; nunca gera bloco mudo de notícia).
  - `montarVinheta(texto: string, duracao: number, saida: string, trilha: string | null): Promise<void>` — mesmo encoder, áudio só trilha ou silêncio.
  - `interface BlocoPronto { id: string; arquivo: string; duracao: number; criadoEm: Date; tipo: "noticia" | "vinheta" | "institucional"; cidade: string | null }` gravado também em `<arquivo>.json`.
- Trilha escolhida por rodízio do índice (determinístico).

- [ ] **Step 1: Testes que falham:**
  - `argsBloco({ ..., gpu: 1 })` contém `-c:v`, `h264_nvenc`, `-gpu`, `1` em sequência, e `-g`, `60`, `-ar`, `48000`, `-f`, `mpegts` e `-t` com a duração.
  - integração (skip se sem NVENC): `montarBloco` com um `Locutor` falso que grava 3 s de tom (`ffmpeg -f lavfi sine`) → `sondar` diz h264, 1920×1080, 30/1, aac 48000 2 canais, duração ≈ 5 s.
  - `montarVinheta` → mesmos parâmetros de stream que o bloco de notícia (comparar campo a campo) (Review Focus 3).
  - locutor falso que lança → `montarBloco` rejeita e não deixa `.ts` no diretório.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.

### Task 7: Fábrica (gerar blocos, institucional e limpeza)

**Files:**
- Create: `src/fabrica.ts`, `src/gerar.ts` (CLI: sincroniza, coleta, filtra, gera o que falta, uma vez), `config/institucional.json`
- Test: `test/fabrica.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `gerarPendentes(materias: Materia[], dirBlocos: string, locutor: Locutor, trilhas: string[]): Promise<{ gerados: string[]; falhas: string[] }>` — pula `id` cujo `.ts` já existe; falha de uma matéria entra em `falhas` e não interrompe as outras; ticker = títulos das outras 8 mais recentes.
  - `garantirInstitucional(dir: string, locutor: Locutor, trilhas: string[]): Promise<void>` — gera, se faltarem, 3 blocos a partir de `config/institucional.json` ("O que é a CNB News", "Cidades que cobrimos" com a lista de `nomeCidade`, "Acompanhe em cnbmobile.com") e 1 vinheta de 6 s "Você está na CNB News • cnbmobile.com".
  - `limpar(dirBlocos: string, agora: Date, maxHoras = 48): Promise<number>` — apaga `.ts`+`.json` de notícia mais velhos; nunca apaga institucional/vinheta.
  - `listarBlocos(dirBlocos: string): Promise<BlocoPronto[]>`.

- [ ] **Step 1: Testes que falham** (locutor falso, montador real com skip se sem NVENC ou montador injetado): segunda chamada de `gerarPendentes` não regera; 1 matéria com locutor que falha + 2 boas → `gerados.length === 2`, `falhas.length === 1`; `limpar` com bloco de 50 h e institucional de 50 h → apaga só o de notícia.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Rodar `npm run gerar`** contra o repo real → pelo menos 20 blocos em `data/blocos/`; abrir 3 no player e mostrar ao Rafael.

### Task 8: Programador (ordem de exibição)

**Files:**
- Create: `src/programador.ts`
- Test: `test/programador.test.ts`

**Interfaces:**
- Consumes: `BlocoPronto`.
- Produces: `class Programador { constructor(opts?: { vinhetaACada?: number /*5*/; semRepetirMin?: number /*60*/ }); proximo(blocos: BlocoPronto[], agora: Date): BlocoPronto; registrarExibicao(id: string, quando: Date): void; minutosProntosAFrente(blocos: BlocoPronto[], agora: Date): number }`.
- Regras, nesta ordem: (1) depois de 5 blocos não-vinheta, a vinheta; (2) notícia nunca exibida, mais nova primeiro; (3) notícia não exibida há 60+ min, preferindo cidade diferente da última, a exibida há mais tempo; (4) se nada disso existir, institucional em rodízio; (5) em último caso, a notícia exibida há mais tempo (repete, mas não para).

- [ ] **Step 1: Testes que falham** cobrindo cada regra: novidade fura a fila; sem repetição em 60 min quando há alternativa; alterna cidade; 6º item é vinheta; só institucionais → rodízio entre os 3; lista só com 1 notícia já exibida há 5 min e sem institucional → devolve ela mesma (nunca lança). `minutosProntosAFrente` soma durações não exibidas nos últimos 60 min.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.

### Task 9: Transmissor

**Files:**
- Create: `src/transmissor.ts`
- Test: `test/transmissor.test.ts`

**Interfaces:**
- Produces: `class Transmissor extends EventEmitter { constructor(destino: string /* rtmp://… ou caminho .flv para teste */); iniciar(): void; enviar(arquivoTs: string): Promise<void> /* resolve quando o arquivo foi todo escrito no stdin, respeitando backpressure */; parar(): Promise<void> }` — eventos `"queda"` (com motivo) e `"reconectou"`.
- FFmpeg: `-re -fflags +genpts -i pipe:0 -c copy -f flv <destino>` (`-flvflags no_duration_filesize`). Se o processo sair, reinicia com espera 5 s, 10 s, 20 s… até 60 s, zerando após 5 min estável; `enviar` durante a queda espera o reinício e manda o bloco seguinte do zero.

- [ ] **Step 1: Testes que falham** (skip se sem NVENC, usando 2 blocos curtos gerados no setup com o montador):
  - destino `data/teste.flv`, enviar os 2 blocos → arquivo existe e `sondar` dá duração ≈ soma.
  - matar o processo FFmpeg (`process.kill(pid)`) entre os blocos → emite `"queda"` e depois `"reconectou"`, e o segundo `enviar` resolve.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.

### Task 10: Orquestrador `ao-vivo`, status, documentação e commit

**Files:**
- Create: `src/ao-vivo.ts`, `README.md` (substitui o atual), `docs/roteiro-youtube.md`
- Modify (só no commit, com OK): `package.json` da raiz (`workspaces` + script `live`), `CLAUDE.md` (bloco "Estado real": stream-engine iniciado)

**Interfaces:**
- Consumes: tudo.
- Comportamento de `npm run ao-vivo` (lê `.env`: `YOUTUBE_STREAM_KEY`, opcional `DESTINO` para sobrescrever, `TTS_VOZ`):
  - na largada: `garantirInstitucional`; inicia `Transmissor`.
  - laço de exibição: `programador.proximo` → `transmissor.enviar` → `registrarExibicao` → grava `data/status.json` `{ noAr: id, desde, quedas, minutosProntos, ultimaGeracao }`.
  - laço de produção, independente, a cada 5 min: `sincronizar` → `coletar` → `filtrar` → `gerarPendentes` → `limpar`; erro é logado e o laço segue.
  - `minutosProntos < 15` → aviso no console (`⚠ buffer baixo`).
  - Ctrl+C → `parar()` limpo.
  - sem `YOUTUBE_STREAM_KEY` e sem `DESTINO` → sai com mensagem clara, código 1.

- [ ] **Step 1: Teste de fumaça** `DESTINO=data/fumaca.flv` rodando 3 min → `status.json` atualizado, `fumaca.flv` com ~3 min, nenhuma exceção.
- [ ] **Step 2: Escrever `README.md`** (pré-requisitos: Node 24, FFmpeg com NVENC, `pip install edge-tts`; comandos `gerar`, `amostra`, `ao-vivo`; pasta `trilhas/`; troca para Azure no futuro) e **`docs/roteiro-youtube.md`** com os passos da §6 do spec (conta de marca, verificação, chave persistente, flag de conteúdo sintético, título/descrição prontos para colar, categoria Notícias e Política, não é para crianças).
- [ ] **Step 3: Live de teste NÃO LISTADA** com a chave do Rafael: 2 h sem queda nem tela preta; derrubar a internet por 1 min e confirmar que volta sozinha (critério de pronto do spec §9).
- [ ] **Step 4: Commit** — só depois de confirmar que o outro terminal não tem nada staged (`git status`) e com OK do Rafael: `git pull --rebase --autostash`, adicionar `services/stream-engine` (sem `data/`, `.env`), `docs/superpowers/`, o `package.json` da raiz e `CLAUDE.md`; mensagem `feat(stream-engine): live 24h CNB News TV (fase 1)`.
