# CNB News
Portal estático (Hugo). Uma cidade = uma pasta; cada cidade vira `<slug>.news.cnbmobile.com`.

## Contrato para o robô
- Cidade nova: `content/cidades/<slug>/_index.md` com `title: "Nome (UF)"`.
  `<slug>` = nome sem acento, minúsculo, hífen no lugar de espaço (`sao-paulo`).
  Nome repetido em outro estado: `<slug>-<uf>` (`santa-maria-rs`).
- Notícia: `content/cidades/<slug>/AAAA-MM-DD-titulo.md` com `title`, `date`, `description`, `fonte`, `fonte_url`.
- Publicar: juntar várias notícias num único commit e `git push` (limite de deploys/dia no plano gratuito).
- Teste local: `hugo server`.
