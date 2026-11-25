# apps/web — portal cnbmobile.com (Next.js) — AINDA NÃO INICIADO

Alvo descrito no CLAUDE.md §6 (App Router, Tailwind, JSON-LD NewsArticle, `/api/ingest`, `/api/indexing`).

Até a migração, **o portal no ar é o site Hugo da raiz do repositório**. Ao começar aqui:

1. Criar o app sem tocar no Hugo; publicar primeiro num projeto Vercel separado (preview).
2. Ler as matérias de `content/noticias/` (mesmo front matter que o robô já grava) para não perder histórico.
3. Só trocar o domínio `cnbmobile.com` depois de validar URLs, sitemap e redirecionamentos das cidades.
4. Ao trocar, revisar o `.vercelignore` da raiz (hoje ele esconde `apps/` do deploy).
