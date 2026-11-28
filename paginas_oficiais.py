"""Texto completo de notícias de prefeituras que NÃO têm RSS com a matéria inteira (27/11/2026).

Dois casos, configurados em prefeituras.py:
  - RSS só com resumo (Rio, Manaus...): segue o link de cada item e lê a página.
  - Sem RSS (São Paulo, BH, Recife...): lê a página de listagem de notícias, pega os links que
    casam com o padrão da prefeitura e lê cada página.

Extração sem dependências (a rig só tem a biblioteca padrão): junta os parágrafos <p> de dentro de
<article>/<main> (ou do maior bloco de parágrafos da página), pulando menu, rodapé, barra lateral,
scripts e formulários. Data: meta article:published_time, <time datetime>, JSON-LD datePublished
ou data escrita no texto ("27/11/2026"). Sem data confiável, a notícia é ignorada (não dá para
saber se é de hoje ou de 2019).
"""
import html
import json
import re
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

UA = "Mozilla/5.0 (compatible; CNBNewsBot/1.0; +https://news.cnbmobile.com/sobre/)"
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE
BRT = timezone(timedelta(hours=-3))

_PULAR = {"script", "style", "nav", "footer", "aside", "form", "header", "noscript", "button", "select", "figcaption", "iframe", "svg"}


def baixar(url, limite=1_500_000):
    # link com acento ou aspas tipográficas no caminho ("“Natal”") quebra o urllib: codifica o que não é ASCII
    url = urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=%~")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"})
    r = urllib.request.urlopen(req, timeout=20, context=_CTX)
    bruto = r.read(limite)
    cs = r.headers.get_content_charset() or "utf-8"
    try:
        return r.geturl(), bruto.decode(cs, "replace")
    except LookupError:
        return r.geturl(), bruto.decode("utf-8", "replace")


class _Paragrafos(HTMLParser):
    """Guarda cada <p> (e <li> dentro do texto) com a "profundidade" de article/main em que estava."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pular = 0
        self.dentro = 0  # dentro de <article> ou <main>
        self.atual = None
        self.pars = []  # (texto, dentro_de_article)
        self.h1 = ""
        self._h1 = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classe = (a.get("class") or "") + " " + (a.get("id") or "")
        if tag in _PULAR or re.search(r"\b(menu|navbar|breadcrumb|rodape|footer|sidebar|compartilh|share|social|cookie|newsletter|relacionad|related|comentario|comment|banner|publicidade)\b", classe, re.I):
            self.pular += 1 if tag not in ("br", "img", "hr", "input", "meta", "link") else 0
            self._tags_pulo = getattr(self, "_tags_pulo", []) + [tag]
            return
        if tag in ("article", "main"):
            self.dentro += 1
        if tag in ("p", "li", "blockquote") and not self.pular:
            self.atual = []
        if tag == "h1" and not self.h1:
            self._h1 = []
        if tag == "br" and self.atual is not None:
            self.atual.append(" ")

    def handle_endtag(self, tag):
        pilha = getattr(self, "_tags_pulo", [])
        if pilha and pilha[-1] == tag:
            pilha.pop()
            self.pular = max(0, self.pular - 1)
            return
        if tag in ("article", "main"):
            self.dentro = max(0, self.dentro - 1)
        if tag in ("p", "li", "blockquote") and self.atual is not None:
            t = re.sub(r"\s+", " ", "".join(self.atual)).strip()
            if len(t) >= 40:
                self.pars.append((t, self.dentro > 0))
            self.atual = None
        if tag == "h1" and self._h1 is not None:
            self.h1 = re.sub(r"\s+", " ", "".join(self._h1)).strip()
            self._h1 = None

    def handle_data(self, data):
        if self.pular:
            return
        if self.atual is not None:
            self.atual.append(data)
        if self._h1 is not None:
            self._h1.append(data)


_LIXO = re.compile(r"(cookies?|pol[ií]tica de privacidade|todos os direitos|compartilhe|leia tamb[eé]m|clique aqui|assine|whatsapp|siga a prefeitura|baixe o app|copyright|©)", re.I)


def extrair(html_txt):
    """(titulo, texto) da página de uma notícia."""
    p = _Paragrafos()
    try:
        p.feed(html_txt)
    except Exception:
        pass
    pars = [t for t, dentro in p.pars if dentro] if sum(len(t) for t, d in p.pars if d) >= 400 else [t for t, _ in p.pars]
    pars = [t for t in pars if not _LIXO.search(t[:80])]
    # parágrafo repetido (menu duplicado, legenda) sai
    vistos, limpos = set(), []
    for t in pars:
        if t not in vistos:
            vistos.add(t)
            limpos.append(t)
    titulo = meta(html_txt, "og:title") or p.h1
    titulo = re.sub(r"\s*[|–-]\s*(Prefeitura|PMF|PBH|Portal|Ag[eê]ncia)\b.*$", "", html.unescape(titulo or "")).strip()
    return titulo, "\n\n".join(limpos)


def meta(h, nome):
    m = re.search(r'<meta[^>]+(?:property|name)=["\']' + re.escape(nome) + r'["\'][^>]+content=["\']([^"\']+)', h, re.I) \
        or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + re.escape(nome) + r'["\']', h, re.I)
    return html.unescape(m.group(1)).strip() if m else ""


def _iso(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=BRT)
    except ValueError:
        return None


def data_da_pagina(h, texto=""):
    # Só datas DE PUBLICAÇÃO. A meta genérica "date" fica de fora: na Agência Belém ela traz a data em que
    # a página foi montada (hoje) e notícias de 2025 saíam como novas (27/11/2026).
    for nome in ("article:published_time", "og:published_time", "datePublished"):
        d = _iso(meta(h, nome))
        if d:
            return d
    for m in re.finditer(r'"datePublished"\s*:\s*"([^"]+)"', h):
        d = _iso(m.group(1))
        if d:
            return d
    for m in re.finditer(r'<time([^>]*)>', h, re.I):
        # <time id="today-date"> da Agência Belém é o relógio do cabeçalho, não a data da matéria
        if re.search(r"today|hoje|atual|current|relogio|clock", m.group(1), re.I):
            continue
        d = _iso((re.search(r'datetime=["\']([^"\']+)', m.group(1)) or [None, ""])[1])
        if d:
            return d
    # Data escrita na página: só PERTO DO TÍTULO da matéria (até 600 caracteres antes, 4000 depois).
    # O cabeçalho do site costuma mostrar a data de HOJE, e pegar essa faria notícia velha parecer nova.
    meses = "janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro".split()
    corpo = h[max(0, h.lower().find("<body")):]  # o <title> do <head> também tem o título: começa no corpo
    plano = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", corpo))))
    titulo = (meta(h, "og:title") or "").split(" | ")[0].strip()
    pos = plano.find(titulo[:60]) if len(titulo) >= 15 else -1
    if pos < 0:
        return None
    trecho = plano[max(0, pos - 600):pos + 4000]
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(20\d\d)\b", trecho)
    if m:
        try:
            return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), 12, tzinfo=BRT)
        except ValueError:
            pass
    m = re.search(r"\b(\d{1,2}) de (" + "|".join(meses) + r") de (20\d\d)\b", trecho, re.I)
    if m:
        return datetime(int(m.group(3)), meses.index(m.group(2).lower()) + 1, int(m.group(1)), 12, tzinfo=BRT)
    return None


def links_da_lista(url_lista, padrao, maximo=8):
    """Links de notícia na página de listagem (mesmo domínio, casando com o padrão da prefeitura)."""
    final, h = baixar(url_lista)
    base = urllib.parse.urlparse(final)
    out = []
    for href in re.findall(r'href=["\']([^"\'#]+)', h):
        u = urllib.parse.urljoin(final, html.unescape(href))
        pu = urllib.parse.urlparse(u)
        if pu.netloc.split(":")[0].removeprefix("www.") != base.netloc.split(":")[0].removeprefix("www."):
            continue
        if re.search(padrao, pu.path) and u not in out and u.rstrip("/") != final.rstrip("/"):
            out.append(u)
        if len(out) >= maximo:
            break
    return out


def ler_pagina(url):
    """(titulo, link, texto, data) de uma notícia; data None se não deu para descobrir."""
    final, h = baixar(url)
    titulo, texto = extrair(h)
    return titulo, final, texto, data_da_pagina(h, texto)
