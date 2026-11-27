# CNB News
Portal estático (Hugo). Uma cidade = uma pasta; cada cidade vira `<slug>.news.cnbmobile.com`.

## Contrato para o robô
- Cidade nova: `content/cidades/<slug>/_index.md` com `title: "Nome (UF)"`.
  `<slug>` = nome sem acento, minúsculo, hífen no lugar de espaço (`sao-paulo`).
  Nome repetido em outro estado: `<slug>-<uf>` (`santa-maria-rs`).
- Notícia: `content/cidades/<slug>/AAAA-MM-DD-titulo.md` com `title`, `date`, `description`, `fonte`, `fonte_url`.
- Publicar: juntar várias notícias num único commit e `git push` (limite de deploys/dia no plano gratuito).
- Teste local: `hugo server`.

## Fotos das notícias
- Cada cidade tem um banco de fotos livres: `static/fotos/<slug>/` + `data/fotos/<slug>.json` (legenda, autor, licença, link da fonte, `tema`).
- Montar o banco de uma cidade nova: `python scripts/fotos_cidade.py <slug> "<Nome>" <UF>`. Busca no Wikimedia Commons só licenças com uso comercial (CC BY, CC BY-SA, CC0, domínio público). **Revise as fotos antes de commitar**: apague pinturas, fotos de outra cidade e fotos com pessoas identificáveis. Para cidade com nome repetido em outros lugares (Lorena, Resende, Rebouças, São Sebastião...), use `--categoria "Category:Lorena (São Paulo)"`: só entram fotos classificadas no Commons como daquele município. Hoje 67 das 72 cidades têm banco revisado (27/11/2026). Sem foto por falta de imagem confiável: Rebouças, Capanema, Potim, Canas e Arapeí.
- O template escolhe a foto sozinho pela data e título da notícia; Clima prefere fotos com `"tema": "clima"`. A legenda sempre diz "foto de arquivo" e dá o crédito.
- **Polícia nunca recebe foto** (ECA e presunção de inocência).
- Foto própria de uma matéria: `imagem` + `imagem_credito` (e opcional `imagem_legenda`) no front matter. `imagem` sozinho é ignorado.
- Nunca usar foto de outro jornal (GZH, G1 etc.): é violação de direito autoral.
- Estáticos são sempre linkados por `news.cnbmobile.com` (via `absURL`): no subdomínio da cidade, `/fotos/...` cai na rota `/cidades/<slug>/...` e dá 404.
- Editoria (Polícia, Clima, Trânsito…) é deduzida do título em `layouts/partials/editoria.html`; o campo opcional `editoria` no front matter tem prioridade.
