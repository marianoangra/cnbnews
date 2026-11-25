# Memória Técnica e Editorial · CNB News Brasil

**Última atualização:** 25/11/2026  
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

## 2. Arquitetura do Sistema e Cobertura (42 Cidades)
- **Gerador Estático:** Hugo (`config.toml`, `content/cidades/`, `layouts/`) — compilado na Vercel (`hugo --minify`).
- **Servidor Local:** Máquina `rig1660s` (GTX 1660 Super)
- **Motor de IA:** Ollama rodando localmente na porta `11434` com o modelo **`qwen3:4b`** (`"format": "json"`, `temperature: 0.35`, `repeat_penalty: 1.15`).
- **Cidades Ativas (42 municípios):**
  - **Sudeste (25):** Vitória (ES), Angra dos Reis (RJ), Paraty (RJ), Lorena (SP), Cachoeira Paulista (SP), Cruzeiro (SP), Lavras (MG), Taubaté (SP), São José dos Campos (SP), Resende (RJ), Macaé (RJ), Campos dos Goytacazes (RJ), Caraguatatuba (SP), Ilhabela (SP), São Sebastião (SP), Ubatuba (SP), Mangaratiba (RJ), Itaguaí (RJ), Cabo Frio (RJ), Armação dos Búzios (RJ), Arraial do Cabo (RJ), São Pedro da Aldeia (RJ), Rio das Ostras (RJ), São João da Barra (RJ), Quissamã (RJ).
  - **Sul (17):** Pelotas (RS), Londrina (PR), Maringá (PR), Curitiba (PR), Foz do Iguaçu (PR), Cascavel (PR), Ponta Grossa (PR), Paranaguá (PR), Francisco Beltrão (PR), Campo Largo (PR), Almirante Tamandaré (PR), Pitanga (PR), Manoel Ribas (PR), Prudentópolis (PR), Guaíra (PR), Rebouças (PR), Capanema (PR).
- **Automação (`robo_cnb.py`):**
  - Ciclos a cada 45 minutos (2700s), coleta via Google News RSS, filtro anti-duplicidade (`similaridade >= 0.55` nos últimos 40 artigos), espaçamento de 7 minutos por matéria, atualização do `static/sitemap.xml` e `git push` automático.

---

## 3. Front-End Implementado (`layouts/`)
- **Base (`layouts/_default/baseof.html`):**
  - Tema escuro estilo CNN/G1 (`--bg:#0b0d12`, `--card:#131720`, `--red:#dc2626`).
  - **Menu das 5 Regiões do Brasil:** `Brasil (Todas)`, `Sudeste`, `Sul`, `Centro-Oeste`, `Nordeste`, `Norte` com gaveta expansível (`#sub-cidades`) listando os subdomínios municipais por UF e filtrando instantaneamente os cards na capa nacional.
  - Cotação USD/EUR ao vivo via CDN jsDelivr (`@fawazahmed0/currency-api`), busca instantânea na página, botão de compartilhamento WhatsApp e rodapé institucional.
- **Capa Nacional (`layouts/_default/index.html`):** Destaque principal + 30 cards usando exclusivamente as 6 fotos reais de `static/fotos/` (`clima.jpg`, `economia.jpg`, `educacao.jpg`, `obras.jpg`, `policia.jpg`, `saude.jpg`). *(Nota: `layouts/index.html` foi removido para não sobrescrever `_default/index.html`).*
- **Edições Municipais (`layouts/cidades/list.html`):** Widget de **Previsão do Tempo ao Vivo** (API Open-Meteo `/v1/forecast`) configurado com as coordenadas das 42 cidades.
- **Matérias Internas (`layouts/cidades/single.html` e `layouts/_default/single.html`):** Padronizadas no tema escuro, com Schema Markup `NewsArticle` JSON-LD, imagem temática, assinatura do Editor-Chefe Rafael Mariano e link clicável para a fonte oficial.

---

## 4. Comandos Úteis de Manutenção (Terminal)
- **Ver log do robô ao vivo:**
  `tail -f /home/rafael/cnbnews/robo.log`
- **Reiniciar o robô após alterar `robo_cnb.py`:**
  `pkill -f robo_cnb.py || true && nohup python3 -u /home/rafael/cnbnews/robo_cnb.py > /home/rafael/cnbnews/robo.log 2>&1 &`
- **Enviar alterações manuais sem conflito com o robô:**
  `cd /home/rafael/cnbnews && git add -A && git commit -m "chore: atualizacao" && git pull --rebase --autostash && git push`
