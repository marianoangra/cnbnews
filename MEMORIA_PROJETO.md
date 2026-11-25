# Memória Técnica e Editorial · CNB News Brasil

**Última atualização:** 24/11/2026  
**Domínio Principal:** `https://cnbmobile.com` (Subdomínios municipais: `https://{cidade}://`)  
**Repositório:** `github.com:marianoangra/cnbnews.git`  
**Hospedagem / Deploy:** Vercel (Deploy automático via `git push` na branch `main`)  

---

## 1. Identidade Editorial e Jurídica (E-E-A-T Google)
- **Editor-Chefe Responsável:** Rafael Mariano (`https://rafaelmariano.com.br` | `@rafaelmariano`)
- **Empresa Mantenedora:** CNB Mobile LTDA - ME
- **CNPJ:** `64.471.793/0001-00`
- **E-mail da Redação e Ouvidoria:** `contato@rafaelmariano.com.br`
- **Páginas Institucionais Obrigatórias:**
  - `/sobre/` (`content/sobre.md`) — Expediente e Política de Uso de IA com supervisão humana.
  - `/privacidade/` (`content/privacidade.md`) — Política de Cookies e Google AdSense.
  - `/termos/` (`content/termos.md`) — Termos de Uso e fontes oficiais.
  - `/contato/` (`content/contato.md`) — Canal de ouvidoria, erratas e comercial.

---

## 2. Arquitetura do Sistema
- **Gerador Estático:** Hugo (`config.toml`, `content/cidades/`, `layouts/`)
- **Servidor Local:** Máquina `rig1660s` (GTX 1660 Super)
- **Motor de IA:** Ollama rodando localmente na porta `11434` com o modelo **`qwen3:4b`** (`"format": "json"`, `temperature: 0.35`, `repeat_penalty: 1.15`).
- **Automação (`robo_cnb.py`):**
  - Roda em segundo plano contínuo (ciclos a cada 45 minutos / 2700s).
  - Coleta pautas via Google News RSS focadas em `.gov.br` e serviços municipais das 28 cidades cadastradas.
  - Aplica filtro anti-duplicidade por palavras-chave (`similaridade >= 0.55` nos últimos 40 artigos da cidade).
  - Limpa erros comuns de formatação (ex: `2.026` -> `2026`, listas numeradas quebradas e sufixos de concorrentes).
  - Espaça os horários de publicação em 7 minutos por matéria.
  - Regenera o `static/sitemap.xml` e faz `git commit` + `git push` automático.

---

## 3. Recursos Implementados no Front-End
- **Capa Nacional (`layouts/_default/index.html`):** Title SEO descritivo, manchete com foto temática (`/fotos/*.jpg`) e `alt` text, ranking "Mais Lidas" e feed de últimas notícias com botão de compartilhamento WhatsApp.
- **Edições Municipais (`layouts/cidades/list.html`):** Widget de **Previsão do Tempo ao Vivo** (API Open-Meteo sem chave) com coordenadas das 28 cidades.
- **Matérias Internas (`layouts/cidades/single.html` e `layouts/_default/single.html`):** Schema Markup `NewsArticle` JSON-LD, assinatura do Editor-Chefe Rafael Mariano, data/hora formatada, foto temática e link clicável para a fonte oficial.
- **Base (`layouts/_default/baseof.html`):** Cotação Dólar/Euro via API do Banco Central (PTAX), logotipo apontando sempre para `https://cnbmobile.com`, favicons no padrão Google (`192x192`, `48x48` e `SVG`) e links do rodapé validados.

---

## 4. Comandos Úteis de Manutenção (Terminal)
- **Ver log do robô ao vivo:**
  `tail -f /home/rafael/cnbnews/robo.log`
- **Reiniciar o robô após alterar `robo_cnb.py`:**
  `pkill -f robo_cnb.py || true && nohup python3 -u /home/rafael/cnbnews/robo_cnb.py > /home/rafael/cnbnews/robo.log 2>&1 &`
- **Enviar alterações manuais sem conflito com o robô:**
  `cd /home/rafael/cnbnews && git add -A && git commit -m "chore: atualizacao" && git pull --rebase --autostash && git push`
