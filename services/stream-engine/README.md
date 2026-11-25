# services/stream-engine — live 24h no YouTube — AINDA NÃO INICIADO

Alvo descrito no CLAUDE.md §2 e §4C: TTS (edge-tts, voz pt-BR) → composição FFmpeg → RTMP com NVENC da RTX 3060, com loop institucional de contingência (buffer mínimo de 15 min) e flag de conteúdo sintético ligada no YouTube.

Entrada prevista: a `lauda_youtube` do `ArticlePayload` (`packages/types/article.ts`), que o robô de redação ainda não gera — o agente Videorrepórter entra na esteira quando esta fase começar, para não gastar GPU antes.

A chave RTMP (`YOUTUBE_STREAM_KEY`) fica só no `.env` da rig, nunca no git.
