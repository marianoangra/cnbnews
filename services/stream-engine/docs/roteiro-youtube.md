# Roteiro — colocar a CNB News ao vivo no YouTube

Passos manuais do Rafael. Faça o 1 e o 2 primeiro: o YouTube leva até 24 h para liberar a live.

## 1. Criar o canal como conta de marca

1. youtube.com → foto do perfil → **Configurações** → **Adicionar ou gerenciar seus canais** → **Criar um canal**.
2. Nome: **CNB News**. Isso cria uma conta de marca, separada do seu canal pessoal.
3. Personalizar: foto (logo CNB NEWS), banner e descrição do canal (texto abaixo).

## 2. Verificar e pedir a live

1. youtube.com/verify → verificar por telefone.
2. YouTube Studio → **Criar** → **Transmitir ao vivo**. Na primeira vez o YouTube pede a ativação e libera em até 24 h.

## 3. Criar a transmissão (quando liberar)

YouTube Studio → **Transmitir ao vivo** → aba **Stream**:

- **Chave de transmissão**: escolha uma **chave persistente** (não a "única") e copie.
- **Título**: `CNB News AO VIVO — notícias das cidades 24 horas`
- **Descrição** (pronta para colar):

  Notícias das cidades do Sul e do Sudeste e do Brasil, 24 horas por dia, com a fonte de cada informação.
  Leia as matérias completas em https://cnbmobile.com

  Narração gerada por voz sintética. Resumos produzidos pela redação da CNB News (Editor-Chefe: Rafael Mariano).
  Correções: contato@rafaelmariano.com.br

- **Categoria**: Notícias e política.
- **Público**: "Não, não é conteúdo para crianças".
- **Conteúdo alterado ou sintético**: **Sim** (a voz é sintética).
- **Visibilidade**: para o primeiro teste, **Não listado**. Depois do teste de 2 h, troque para **Público**.
- Latência: **Normal** (aguenta melhor oscilação de rede).
- DVR: ligado.

## 4. Ligar

1. Cole a chave no `.env` de `services/stream-engine`: `YOUTUBE_STREAM_KEY=xxxx-xxxx-xxxx-xxxx-xxxx`.
2. Confira `FFMPEG_GPU_DEVICE=0` neste PC.
3. `npm run live` na raiz do repo. Em ~10 s o YouTube Studio mostra "Excelente" na saúde do stream.

## 5. Teste de aceitação (antes de deixar público)

- 2 h no ar sem queda nem tela preta (`data/status.json` com `quedas: 0`).
- Desligar o Wi-Fi/cabo por 1 min e religar: a live tem que voltar sozinha (o console mostra `⚠ QUEDA` e depois `transmissão reconectada`).

## Trilha (opcional)

YouTube Studio → **Biblioteca de áudio** → filtrar por **Atribuição não necessária** → baixar 5–10 faixas
instrumentais calmas → colocar em `services/stream-engine/trilhas/`. Os blocos novos já saem com trilha.
