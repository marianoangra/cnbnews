# Rádio CNB News — design (28/11/2026)

## Intenção
Webrádio do portal CNB News com **música e informação**. A notícia é a estrela; a música (livre de direitos) só acompanha. O ouvinte aperta "Rádio CNB" no cabeçalho do portal e ouve música instrumental/lo-fi 24h com boletins de notícia nas vozes da TV CNB.

## Metas
- Stream 24h, nacional e igual para todos (sem versão por cidade).
- Grade fixa:
  - `:00` vinheta → boletim completo (~3 min: nacional + editorias + hora certa) → música
  - `:15` e `:45` vinheta curta "Rádio CNB" → música
  - `:30` vinheta → manchetes (~1 min, 3–5 manchetes recentes) → música
- Vozes Cadu/Faber em rodízio (Piper, as mesmas da TV). Editoria Polícia nunca entra.
- Botão do cabeçalho vira player (`params.radio` no `config.toml`); página `/radio/` com créditos das músicas.

## Não-metas
- Música comercial (exigiria ECAD) — descartada pelo user.
- Locução ao vivo, programas, pedidos de música, app próprio.
- Versão por cidade.

## Antimetas (falha mesmo funcionando)
- Música sem licença que permita **transmissão** (ex.: Biblioteca de Áudio do YouTube, licenças "só vídeo"). Cada faixa precisa de licença verificada (CC0 / CC BY / equivalente que permita broadcast) e crédito.
- Boletim com matéria de Polícia, fato velho (>24 h) ou a mesma manchete repetida o dia todo.
- Botão que fica "carregando" para sempre quando a rig cai.

## Restrições
- Tudo roda na rig (Pentium G4560, 7,7 GB RAM, Ubuntu no pendrive + HD em /mnt/hd, upload ~365 Mbps). Sem custo de host.
- Site em HTTPS → stream tem de ser HTTPS (senão o navegador bloqueia mixed content).
- Vercel não repassa áudio contínuo; o stream vai direto da rig ao ouvinte.
- Raiz `/` do Tailscale Funnel é o ttyd do Fric — não mexer; a rádio usa caminho próprio.
- Queda de energia/internet derruba a rádio (aceito pelo user ao escolher a opção A).

## Abordagens consideradas
- **A) Tudo na rig (ESCOLHIDA pelo user):** Icecast + Liquidsoap na rig, exposto pelo Funnel. Custo zero; cai junto com a rig; banda do Funnel a medir.
- B) Tudo num host (Brascast/HostBH): AutoDJ do host + rig envia boletins por FTP/API. Estável, mas depende do painel aceitar envio automático; menos controle de horário.
- C) Rig monta, host distribui, AutoDJ do host como reserva. Recomendada por mim, não escolhida.

## Como (decisões tomadas)
- **Rig:** `icecast2` + `liquidsoap` (apt), serviços systemd (`Restart=always`). Icecast só em 127.0.0.1; mount `/radio` (ajustar nome se o Funnel exigir), MP3 128 kbps 44,1 kHz estéreo.
- **Boletins:** reaproveitam o áudio que o `services/stream-engine/produtor.py` já gera em `/mnt/hd/tv/segmentos` (mp4 com AAC). Boletim = concatenação de N segmentos recentes (nacional/editorias, sem Polícia, <24 h, não repetidos no mesmo bloco) + "hora certa" sintetizada na hora.
- **Vinhetas:** geradas com Piper (voz + trilha curta livre), em `/mnt/hd/radio/vinhetas`.
- **Acervo:** 10–20 h de música CC0/CC BY em `/mnt/hd/radio/musicas`, com planilha/JSON de licença (título, autor, fonte, licença, URL) que gera a página `/radio/`. Normalizar volume (loudness) de música e voz para não haver saltos.
- **Exposição:** Tailscale Funnel em caminho dedicado (ex.: `/radio`) → Icecast. Medir vazão/estabilidade com vários ouvintes simultâneos antes de divulgar.
- **Site:** `params.radio` = URL HTTPS do Funnel; `radioEmBreve` continua até o fim do teste. Player trata erro/timeout mostrando "Rádio fora do ar" em vez de girar para sempre.
- **Lançamento:** 48 h de teste não divulgado, depois liga o botão.
- **Logs:** `~/cnbnews/radio.log`, padrão dos outros serviços.

## Player: ouvir sem sair da página (decidido pelo user em 28/11)
O ouvinte continua navegando com a rádio tocando. Escolha do user: **barra fixa no rodapé + navegação sem recarregar** (a janelinha pop-up foi descartada). Restrição do user: **não atrapalhar AdSense nem GA4**. Por isso:
- **Navegação sem recarregar só liga enquanto a rádio toca.** Sem rádio (a maioria), o site recarrega a cada clique como hoje, sem nenhuma mudança em AdSense e GA4.
- Com a rádio tocando, o clique em link interno busca a página nova, troca o conteúdo (menos a barra), atualiza `<title>`, URL (`history.pushState`), rola pro topo e reexecuta os scripts da página (relógio relativo, WhatsApp, clima, newsletter etc.). Voltar/avançar do navegador funciona.
- **GA4:** `gtag('event','page_view', {page_location, page_title})` a cada troca.
- **AdSense:** anúncios automáticos NÃO são reinseridos nas trocas (nenhum refresh automático = nenhum risco de política). Aceito: ouvinte vê menos anúncio enquanto navega com a rádio.
- **Pausou a rádio:** o próximo clique volta a recarregar normalmente.
- **Cidades:** com a rádio tocando, link para `<cidade>.news.cnbmobile.com/...` é aberto como `news.cnbmobile.com/cidades/<cidade>/...` (rota já funciona: 200). A canonical da página continua no subdomínio, SEO intocado.
- Links externos, `target=_blank`, `/admin`, downloads e âncoras na mesma página: comportamento normal.
- Falha ao buscar a página: cai para navegação normal (a rádio para, mas nada quebra).
- Testar com `hugo --minify` 0.58.2 (o minify já apagou atributo antes).

## Decisões minhas (revisão de construtor)
- Sem matéria nova suficiente para o boletim: o bloco é pulado e entra só a vinheta. Nunca repetir boletim velho.
- Funnel: `tailscale funnel --set-path /radio` apontando pro Icecast, sem tocar na raiz (ttyd) nem em `/cnb-admin` e `/aovivo`.
- Filtro de Polícia e de idade: usar os metadados que o produtor já grava (`.json` ao lado do mp4), com a mesma regra da TV.
- A rádio não usa GPU (Piper roda em CPU, MP3 em CPU), então não disputa com o Ollama nem com o NVENC da TV.

## Deixado ao construtor
- Script Liquidsoap exato (playlist aleatória sem repetir faixa por X horas, inserção por horário com `crossfade`/fade ao entrar o boletim).
- Ler o áudio direto do mp4 (decoder ffmpeg do Liquidsoap) ou fazer o produtor salvar também `.m4a`/`.mp3` — escolher o mais simples e robusto.
- Fontes do acervo (Free Music Archive CC0, Musopen, ccMixter, etc.) — confirmar licença de broadcast de cada uma.
- Montagem do boletim completo (ordem das editorias, quantas matérias).
- Testes: locução e montagem de boletim com testes unitários (padrão do `locucao.py`); stream testado tocando no navegador pelo HTTPS do Funnel.
