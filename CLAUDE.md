# CLAUDE.md — CNB News

> **Estado real do repositório (atualizar a cada fase)** — o que está abaixo é o alvo; isto é o que existe hoje:
>
> - **Portal no ar = Hugo na raiz** (`config.toml`, `content/`, `layouts/`, `static/`), projeto Vercel `cnbnews` na equipe `gasomax`, servindo `cnbmobile.com`, `news.cnbmobile.com` e `<cidade>.news.cnbmobile.com`. `git push` em `main` publica sozinho. Hugo da Vercel é 0.58: a config TEM que ser `config.toml`.
> - **`apps/web/`** é o futuro portal Next.js (seção 6). Ainda vazio — o Hugo continua sendo o site até a migração.
> - **`services/agents/`** é o robô de redação (Fase 1, pronto): RSS da Agência Brasil → Triagem (GPU rápida) → Redator → Revisor → Editor/SEO (GPU pesada) → travas determinísticas (`src/guardrails.ts`) → Lauda da live (GPU rápida) → Markdown em `content/noticias/` (lauda no front matter `lauda_youtube`). Roteamento em `ROTAS` (`src/orquestrador.ts`). A triagem só sobe o score com prova no texto (trecho citado ou termo sensível no título/lead). Score ≥ 4 vai para `services/agents/fila-aprovacao/` (fora do git) e só sobe se Rafael mover o arquivo à mão.
> - **`services/stream-engine/`** (live 24h) ainda não começou; já existe a rota `/tv/` (telão, ver `ROADMAP.md` Fase 2).
> - **Hardware real ≠ seção 2 (26/11/2026):** GPU pesada = rig `rig1660s` (nome ficou; hoje Pentium G4560, 7,7 GB RAM, **RTX 3060 12 GB**, Ollama em 127.0.0.1:11434, modelos no pendrive com ~4 GB livres). GPU rápida = **RTX 2060 do PC do Rafael** (Windows), Ollama em 127.0.0.1:11435 exposto só na tailnet por `tailscale serve --tcp 11435`; a rig chama `OLLAMA_FAST_URL=http://100.81.172.17:11435`. PC desligado → as etapas rápidas caem sozinhas na 3060 (`comReserva`). Vem aí uma 2ª rig com outra 2060, que assume esse papel. Modelos: pesado **`qwen3:4b`** (`num_ctx` 4096, `think: false`, igual ao `robo_cnb.py` para não recarregar), rápido **`llama3.2:3b`** (o Qwen2.5-3B tem licença não comercial). O `qwen2.5:14b` da seção 2 só entra com os modelos no HD da rig e o `robo_cnb.py` no mesmo modelo — 14b + qwen3:4b não cabem juntos nos 12 GB.
> - **Robô de cidades = `robo_cnb.py`** (Python, na rig, 42 cidades, ciclo de 45 min) → `content/cidades/<slug>/` + `static/sitemap.xml` + `git add content/` e push. Detalhes em `MEMORIA_PROJETO.md`. Não mexer nesse formato. Como ele faz `git add content/`, matérias em `content/noticias/` também sobem no push dele.
> - **Colunas (27/11/2026):** `/colunas/` no Hugo (`layouts/colunas/`, `OpinionNewsArticle`, autor Rafael Mariano). Produto recomendado e nota de transparência entram pelo LAYOUT (`data/produtos.yaml`, link `rel="sponsored noopener"`); o texto da coluna não leva link. Robô `services/agents/src/colunista.ts` usa **`qwen2.5:7b-instruct`** (o 4b repetia frases e inventou versículo) e descarrega o modelo ao fim; timer `cnbnews-colunista.timer` na rig (seg e qui, 9h BRT) grava em `services/agents/fila-aprovacao/colunas/` com `alertas_revisao`. Nunca publica sozinho: Rafael aprova e a coluna vai para `content/colunas/`.
> - **Contato da redação real** é `contato@rafaelmariano.com.br` (`/contato/`), não o `redacao@cnbmobile.com` da seção 5A — essa caixa não existe.
> - **Sitemaps (27/11/2026):** quem vale no ar é o que o Hugo gera: `layouts/sitemap.xml` (URLs canônicas: cidades no subdomínio + `/noticias/`) e `layouts/index.newssitemap.xml` → `/news-sitemap.xml` (Google Notícias, últimas 48 h), ambos listados no `layouts/robots.txt`. O `static/sitemap.xml` que o `robo_cnb.py` reescreve é sobrescrito pelo Hugo (peso morto, não mexer no robô por isso). URLs de subdomínio exigem a propriedade de DOMÍNIO `cnbmobile.com` no Search Console. Testar templates com Hugo **0.58.2** (o da Vercel).
> - `.vercelignore` tira o monorepo Node do deploy: a Vercel continua vendo só o site Hugo. Não remover sem migrar o build.
> - Limite de deploys do plano Hobby: agrupar matérias num commit só (o robô faz um push por ciclo, ciclo mínimo de 20 min). Antes de qualquer push manual: `git pull --rebase --autostash` (o robô da rig empurra o tempo todo).

---

> **Instruções para o Claude Code:** Este é o guia definitivo de arquitetura, padrões de código, governança editorial, matriz de riscos e modelo de dados para o desenvolvimento do ecossistema **CNB News** (`cnbmobile.com` e canal de transmissão contínua 24h no YouTube). Siga estritamente as convenções, regras legais e restrições técnicas aqui documentadas.

---

## 1. Visão Executiva e Identidade

* **Veículo:** CNB News
* **Portal Web:** https://cnbmobile.com (Next.js / TypeScript hospedado na Vercel)
* **Canal Audiovisual:** Transmissão ao vivo ininterrupta 24h no YouTube
* **Repositório GitHub:** `https://github.com/marianoangra/cnbnews`
* **Fundador e Editor-Chefe:** Rafael Mariano
  * Site Oficial: https://www.rafaelmariano.com.br
  * Instagram Oficial de Entrevistas: `instagram.com/rafaelmariano`
* **Missão:** Informar com agilidade, clareza e rigor ético, entregando notícias verificadas 24 horas por dia por meio de tecnologia de ponta, design acessível e compromisso inegociável com a verdade.
* **Visão:** Ser o portal de notícias mais ágil, confiável e moderno do Brasil, unindo cobertura nacional factual, jornalismo multiplataforma e entrevistas exclusivas.

---

## 2. Infraestrutura e Restrições de Hardware

### Rig de Inteligência Artificial Local
* **GPU Dedicada:** NVIDIA GeForce RTX 3060 (12 GB de VRAM GDDR6, arquitetura Ampere).
* **Motor de Inferência:** Ollama local (`http://localhost:11434`).
* **Modelo Base Único:** `qwen2.5:14b-instruct-q4_K_M` (ou `llama3.1:8b-instruct-q8_0`).
* **Regras de Otimização na GPU:**
  1. **Zero Model Swapping:** Nunca instanciar modelos diferentes para agentes diferentes. Mantenha **um único modelo carregado na VRAM** e alterne exclusivamente o `system prompt` em cada requisição.
  2. **Context Window (`num_ctx`):** Fixado em `8192` tokens (suficiente para analisar documentos longos sem causar estouro de VRAM / CUDA OOM).
  3. **Processamento Sequencial:** A esteira de agentes processa uma matéria por vez (`Pauta -> Redator -> Revisor -> Editor/SEO -> Videorrepórter`).
  4. **Live Stream NVENC:** A codificação de vídeo da live 24h utiliza o chip de hardware NVENC da RTX 3060 (`-c:v h264_nvenc`), consumindo zero de processamento do modelo LLM.
  5. **Concorrência e Disco:** Não executar modelos de difusão de imagem pesados concorrendo na GPU durante a live. Implementar cron job para purgar arquivos temporários de mídia (áudios e blocos de vídeo) com mais de 24 horas.

---

## 3. Cobertura Editorial e Verticais Temáticas

O sistema opera com 7 editorias ativas:
1. **`politica`**: Cobertura dos três poderes, decisões do STF, Congresso Nacional e governos estaduais.
2. **`economia`**: Mercado financeiro, inflação (IPCA), decisões do Copom/Selic, cotações em tempo real e negócios.
3. **`agro`**: O motor do Brasil — cotações de commodities (soja, milho, boi), safras (Conab/Cepea), inovação tecnológica no campo (Embrapa) e sustentabilidade agrícola.
4. **`tecnologia`**: Inovação digital, inteligência artificial aplicada, cibersegurança e lançamentos.
5. **`cristao`**: Cultura cristã, grandes encontros, projetos sociais comunitários, liberdade religiosa e reflexões éticas com tom respeitoso e agregador.
6. **`brasil` / `mundo`**: Hard news nacional e fatos internacionais relevantes.
7. **`entrevistas`**: Conteúdo de autoridade gravado por Rafael Mariano em seu canal/Instagram (`@rafaelmariano`), transcrito e adaptado em reportagens especiais com aspas e atribuição direta.

---

## 4. Monetização e Blindagem com Google AdSense e Kiwify

### A. Regras para Infoprodutos e Colunistas (Kiwify)
* **Objetivo:** Gerar receita direta por meio de infoprodutos próprios (ex: planilhas financeiras pessoais, cursos práticos) sem violar regras do Google Notícias e AdSense.
* **Regra 90/10:** O artigo do colunista deve ter **90% de conteúdo educacional e prático real** (que agregue valor imediato sem necessidade de compra) e no máximo **10% de transição sutil** para o treinamento/planilha.
* **Tag Obrigatória de Links:** Todo link externo para a Kiwify DEVE conter obrigatoriamente:
  `rel="sponsored noopener" target="_blank"`
  *(Proibido usar links disfarçados ou sem marcação patrocinada para evitar banimento por spam no Google).*
* **Nota de Transparência Obrigatória:** Inserir no rodapé de toda coluna comercial:
  > *"Nota de transparência: Esta coluna expressa a análise do autor e pode conter links para treinamentos e materiais recomendados pela equipe editorial."*
* **Frequência Máxima:** De 1 a 2 artigos de colunistas por semana, diluídos em meio a dezenas de matérias de hard news.

### B. Google E-E-A-T e Google Notícias
* **Autoria Transparente:** Todas as matérias contêm a assinatura da redação com a chancela do Editor-Chefe (*"Redação CNB News — Editor-Chefe: Rafael Mariano"*).
* **Schema.org:** Injetar JSON-LD completo nas páginas com tipo `NewsArticle`, `author` (link para `rafaelmariano.com.br`), `publisher` e imagem destacada (mínimo de 1200px de largura com diretiva `max-image-preview:large` para o Google Discover).
* **Google Indexing API:** Webhook na Vercel para notificar o Google imediatamente após a publicação de cada nova URL.

### C. Transmissão YouTube 24h
* **Marcação de Conteúdo Sintético:** Parâmetro `has_altered_or_synthetic_content: true` mantido nas configurações da live.
* **Trilhas e Áudios:** Utilizar somente áudios com licença comercial explícita ou ruídos brancos/trilhas royalty-free para impedir strikes de Content ID.
* **Kill Switch da Live:** Script de contingência que comuta o sinal RTMP para um loop de vídeo institucional caso ocorra atraso ou falha em uma lauda.

---

## 5. Matriz de Riscos, Cuidados Críticos e Guardrails Obrigatórios

> **ATENÇÃO:** O Claude Code deve garantir que o código implemente validadores e filtros rígidos para os seguintes riscos, sob responsabilidade do Editor-Chefe Rafael Mariano:

### A. Riscos Jurídicos e Conformidade Legal (Brasil)
1. **Presunção de Inocência (Art. 5º, LVII da CF/88):**
   * **Proibido:** Declarar que alguém é "culpado", "assassino", "corrupto" ou "ladrão" antes do trânsito em julgado.
   * **Obrigatório:** Utilizar estritamente termos jurídicos neutros: *"suspeito de"*, *"investigado por"*, *"denunciado pelo Ministério Público"*, *"réu em processo judicial"*.
2. **Proteção de Crianças e Adolescentes (ECA - Lei 8.069/1990):**
   * **Proibição Absoluta:** O sistema deve vetar automaticamente qualquer menção a nomes, apelidos, filiação, escola ou fotos de menores de 18 anos envolvidos em atos infracionais ou vítimas de crimes.
3. **Direito de Resposta e Contraditório (Lei nº 13.188/2015):**
   * Toda matéria envolvendo acusações, investigações ou denúncias contra pessoas, empresas ou órgãos deve incluir a cláusula de praxe:
     > *"A reportagem procurou a defesa/assessoria do(s) citado(s) e o espaço permanece aberto para manifestação e devida atualização desta matéria."*
   * O portal deve manter visível o canal direto para correções: `redacao@cnbmobile.com`.

### B. Riscos de Algoritmo do Google (AdSense, Discover e Notícias)
1. **Proibição de Scraping Cego e Conteúdo Duplicado:**
   * Os agentes redatores nunca devem apenas reescrever matérias trocando sinônimos. Devem reestruturar em pirâmide invertida, contextualizar e **sempre citar a fonte primária** (*"Segundo dados da Agência Brasil..."*, *"Conforme boletim divulgado pela Embrapa..."*).
2. **Anti-Clickbait:**
   * Títulos devem ter alto CTR, mas **nunca fazer promessas falsas** que frustrem o usuário. Se a taxa de retorno imediato à busca for alta, o Google Discover remove o domínio da distribuição em 24h.
3. **Separação Editorial vs. Comercial:**
   * O Google AdSense pune contas que misturam publieditoriais com matérias jornalísticas comuns sem tag `rel="sponsored"`. Seguir rigorosamente a regra 90/10.

### C. Riscos da Transmissão YouTube 24h
1. **Transparência de IA (YouTube Community Guidelines):**
   * O canal deve manter habilitada a flag de conteúdo sintético/alterado. Omitir essa informação acarreta desmonetização e suspensão da live.
2. **Content ID e Direitos Conexos:**
   * Qualquer música ou trecho de áudio sem licenciamento comercial derruba o streaming em tempo real. Usar apenas bibliotecas seguras (YouTube Audio Library) ou sintetizadores controlados.
3. **Buffer de Contingência (Zero Black Screen):**
   * A transmissão deve ter um buffer de no mínimo 15 minutos de vídeos pré-renderizados e script de chaveamento automático para o loop institucional em caso de falha de renderização.

### D. Filtro de Bloqueio Automático (Score de Sensibilidade)
O orquestrador deve aplicar o seguinte filtro de termos sensíveis. Qualquer correspondência eleva o `score_sensibilidade` para 4 ou 5, marcando `requer_aprovacao_humana: true` e bloqueando a publicação automática:
* **Lista de Gatilhos Críticos:** crimes violentos, menor de idade, chacina, operação policial armada, flagrante de crime hediondo, acusação nominal de corrupção sem condenação judicial transitada.

---

## 6. Estrutura do Monorepo

```text
cnbnews/
├── CLAUDE.md                     # Este arquivo de referência central
├── apps/
│   └── web/                      # Portal cnbmobile.com (Next.js App Router, Tailwind, Vercel)
│       ├── app/
│       │   ├── (portal)/         # Rotas públicas: capa, categorias, colunas e matérias
│       │   │   ├── [categoria]/  # Páginas temáticas (agro, economia, cristao, etc.)
│       │   │   ├── noticia/[slug]# Matéria completa com dados estruturados e AdSense
│       │   │   └── colunas/      # Artigos de opinião e educação financeira (Kiwify)
│       │   ├── api/
│       │   │   ├── ingest/       # Webhook seguro para receber matérias da rig local
│       │   │   └── indexing/     # Disparo da Google Indexing API
│       │   └── components/       # Player YouTube ao vivo, geradores de banner e carrossel
│       └── lib/
│           └── seo/              # Gerador de JSON-LD Schema.org (NewsArticle)
├── services/
│   ├── agents/                   # Orquestrador de IA (executa na rig RTX 3060)
│   │   ├── orchestrator.ts       # Pipeline sequencial de agentes do Ollama com Guardrails
│   │   ├── ingestor/
│   │   │   └── rss-ingestor.ts   # Coletor e deduplicador de RSS multi-editorias
│   │   └── prompts/              # Prompts de sistema de cada função jornalística
│   └── stream-engine/            # Motor da Live 24h (executa na rig local ou VPS)
│       ├── tts/
│       │   └── tts-generator.ts  # Síntese neural de voz em PT-BR (Edge-TTS)
│       ├── renderer/             # Composição gráfica de GC, telão e vinhetas (FFmpeg)
│       └── stream-broadcaster.sh # Transmissor contínuo RTMP para o YouTube com Kill Switch
└── packages/
    └── types/                    # Tipagens TypeScript compartilhadas
        └── article.ts            # Contratos ArticlePayload e ColumnistPayload
```

---

## 7. Contratos de Dados TypeScript

### A. Matéria de Notícia (Hard News / Entrevistas)
```typescript
export interface ArticlePayload {
  id: string;
  categoria: 'politica' | 'economia' | 'agro' | 'tecnologia' | 'cristao' | 'brasil' | 'mundo' | 'entrevistas';
  urgencia: 'normal' | 'urgente' | 'plantao';
  manchete_home: string;           // Máx 70 caracteres, otimizado para CTR sem clickbait falso
  subtitulo: string;               // Linha fina contextual
  slug: string;                    // Formato kebab-case
  corpo_artigo_md: string;         // Artigo em Markdown com pirâmide invertida
  lauda_youtube: {
    texto_locucao: string;         // Roteiro falado com pontuação para pausas naturais (45-60s)
    texto_gc: string;              // Tarja inferior da live em caixa alta (máx 45 caracteres)
    palavras_chave_visuais: string[];
  };
  fontes_verificadas: string[];    // Atribuição obrigatória (ex: Agência Brasil, Instagram @rafaelmariano)
  score_sensibilidade: number;     // 1 (seguro) a 5 (crítico)
  requer_aprovacao_humana: boolean;// true se score >= 4 (termos sensíveis, acidentes graves, denúncias)
  autor_atribuicao: string;        // "Redação CNB News (Editor-Chefe: Rafael Mariano)"
  publicado_em: string;            // ISO 8601
}
```

### B. Artigo de Colunista (Educação Financeira / Kiwify)
```typescript
export interface ColumnistArticlePayload {
  id: string;
  tema_central: string;
  autor_nome: string;              // Nome do colunista ou Rafael Mariano
  autor_bio: string;
  manchete: string;
  subtitulo: string;
  slug: string;
  corpo_artigo_md: string;         // Artigo educativo (600-800 palavras) com link rel="sponsored"
  nota_transparencia: string;      // Declaração de links parceiros
  produto_recomendado: {
    nome: string;
    link_kiwify: string;
  };
  lauda_minuto_bolso?: {
    texto_locucao: string;         // Bloco de 40s para a live
    texto_gc: string;
  };
  publicado_em: string;
}
```

---

## 8. Instruções Operacionais para o Claude Code

Ao implementar novas funcionalidades ou scripts neste repositório:
1. **TypeScript Rígido:** Sempre use tipagens estritas (`strict: true` no `tsconfig.json`).
2. **Defensividade de API:** As chamadas à API do Ollama (`/api/generate`) devem sempre tratar timeouts e validar o parse de JSON de retorno.
3. **Respeito aos Guardrails:** Nunca remova a citação de fontes primárias, a marcação de links patrocinados ou a cláusula de direito de resposta.
4. **Sem Dependências Pesadas Desnecessárias:** Prefira soluções nativas do Node.js/FFmpeg antes de instalar pacotes volumosos.
5. **Código Modular:** Mantenha separação clara entre a camada do portal web (Vercel) e os serviços pesados de GPU/vídeo (executados localmente).
