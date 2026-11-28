"""Fonte oficial com TEXTO COMPLETO para o robô de cidades (27/11/2026).

A nota curta (só a manchete do Google Notícias) tem mediana de 44 palavras e o Google não indexa
(Search Console 22/11: 115 páginas "rastreadas, mas não indexadas"). Aqui o robô lê o RSS da
própria prefeitura, que traz a matéria inteira, e escreve uma matéria de 150 a 300 palavras.
As travas são as mesmas da nota curta, com a fonte inteira no lugar da manchete: todo número e
todo nome do texto têm de estar no comunicado.

Feeds achados testando <cidade>.<uf>.gov.br + caminhos comuns (scripts no histórico da sessão):
27 de 111 prefeituras têm RSS; ficaram as 22 cujo item traz o texto (>= ~1000 caracteres).
"""
import html
import json
import os
import re
import ssl
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

FEEDS_PREFEITURAS = {
    "reboucas": "https://reboucas.pr.gov.br/feed/",
    "quissama": "https://quissama.rj.gov.br/feed/",
    "poa": "https://poa.sp.gov.br/feed/",
    "ferraz-de-vasconcelos": "https://ferrazdevasconcelos.sp.gov.br/web/feed/",
    "sao-bento-do-sapucai": "https://saobentodosapucai.sp.gov.br/feed/",
    "franco-da-rocha": "https://www.francodarocha.sp.gov.br/feed/",
    "jacarei": "https://www.jacarei.sp.gov.br/feed/",
    "suzano": "https://suzano.sp.gov.br/feed/",
    "cajamar": "https://cajamar.sp.gov.br/feed/",
    "macae": "https://macae.rj.gov.br/rss",
    "osasco": "https://osasco.sp.gov.br/feed/",
    "rio-das-ostras": "https://www.riodasostras.rj.gov.br/feed/",
    "ponta-grossa": "https://pontagrossa.pr.gov.br/feed/",
    "cotia": "https://cotia.sp.gov.br/feed/",
    "itapevi": "https://itapevi.sp.gov.br/feed/",
    "potim": "https://www.potim.sp.gov.br/feed/",
    "mangaratiba": "https://prefeitura.mangaratiba.rj.gov.br/feed/",
    "juquitiba": "https://juquitiba.sp.gov.br/feed/",
    "cruzeiro-sp": "https://www.cruzeiro.sp.gov.br/feed/",
    "areias": "https://www.areias.sp.gov.br/feed/",
    "guaratingueta": "https://guaratingueta.sp.gov.br/feed/",
    "cabo-frio": "https://cabofrio.rj.gov.br/feed/",
    # capitais com texto completo no RSS (27/11/2026)
    "goiania": "https://www.goiania.go.gov.br/feed/",
    "rio-branco": "https://www.riobranco.ac.gov.br/feed/",
    "salvador": "https://salvador.ba.gov.br/feed/",
    "joao-pessoa": "https://www.joaopessoa.pb.gov.br/feed/",
    "macapa": "https://macapa.ap.gov.br/feed/",
}

# RSS só com RESUMO: segue o link de cada item e lê a matéria na página (paginas_oficiais.py).
FEEDS_RESUMO = {
    "rio-de-janeiro": "https://prefeitura.rio/feed/",
    "manaus": "https://www.manaus.am.gov.br/feed/",
    "maceio": "https://maceio.al.gov.br/feed/",
}

# SEM RSS: página de listagem de notícias + padrão do caminho de uma notícia (testados em 27/11/2026).
# Publica só link que apareceu desde a última visita (ESTADO); a 1ª visita só registra o que já existe.
PAGINAS_PREFEITURAS = {
    "sao-paulo": ("https://prefeitura.sp.gov.br/noticias", r"^/w/"),
    "brasilia": ("https://agenciabrasilia.df.gov.br/", r"^/w/"),
    "belo-horizonte": ("https://prefeitura.pbh.gov.br/noticias", r"^/noticias/[a-z0-9-]{20,}"),
    "fortaleza": ("https://www.fortaleza.ce.gov.br/noticias", r"^/noticias/[a-z0-9-]{15,}"),
    "porto-alegre": ("https://prefeitura.poa.br/noticias", r"/noticias/[a-z0-9-]{15,}"),
    "belem": ("https://agenciabelem.com.br/Noticias", r"^/Noticia/\d+"),
    "cuiaba": ("https://www.cuiaba.mt.gov.br/noticias", r"^/noticias/[a-z0-9-]{15,}"),
    "vitoria-es": ("https://www.vitoria.es.gov.br/noticias", r"^/noticia/[a-z0-9-]{10,}"),
    # A página da notícia mostra "11/05/2026" perto do título em TODAS (data errada): vale só a regra do link novo.
    "pelotas": ("https://www.pelotas.com.br/listar-noticias", r"^/noticia/[a-z0-9-]{10,}", {"sem_data": True}),
}

# Quem publicou, quando não é "Prefeitura de <cidade>".
ORGAOS = {
    "brasilia": "Agência Brasília (Governo do Distrito Federal)",
    "rio-de-janeiro": "Prefeitura do Rio de Janeiro",
    "recife": "Prefeitura do Recife",
}

# Não é notícia para o leitor: pauta do dia para jornalistas, agenda de autoridade.
TITULO_FORA = re.compile(r"previs[aã]o de pautas|^agenda\b|agenda (do|da) (prefeit|governad|vice)|^pauta", re.I)

ESTADO = os.environ.get("PREFEITURAS_ESTADO", ".prefeituras_vistos.json")  # fora do git (.gitignore)
MAX_PAGINAS_POR_VISITA = 3


def orgao(slug, cidade_nome):
    return ORGAOS.get(slug) or f"Prefeitura de {cidade_nome.split('(')[0].strip()}"


UA = "Mozilla/5.0 (compatible; CNBNewsBot/1.0; +https://news.cnbmobile.com/sobre/)"
# Muitas prefeituras têm cadeia de certificado incompleta; é leitura de conteúdo público.
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE
_NS_CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
MAX_DIAS = 3
MAX_POR_CICLO = 2
MIN_CHARS_FONTE = 600


def html_para_texto(s):
    s = re.sub(r"(?is)<(script|style|figure|figcaption)\b.*?</\1>", " ", s or "")
    s = re.sub(r"(?i)<br\s*/?>|</p>|</h\d>|</li>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    s = re.sub(r"[ \t\xa0]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s)
    s = re.sub(r"(?i)\n?(the post|o post) .*? (appeared first|apareceu primeiro).*$", "", s.strip())
    return s.strip()


def ler_feed(url, agora=None, min_chars=None):
    """[(titulo, link, texto, data)] dos últimos MAX_DIAS dias, mais novos primeiro."""
    min_chars = MIN_CHARS_FONTE if min_chars is None else min_chars
    agora = agora or datetime.now(timezone.utc)
    xml = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20, context=_CTX).read()
    root = ET.fromstring(xml)
    out = []
    for it in root.iter("item"):
        titulo = html.unescape((it.findtext("title") or "").strip())
        link = (it.findtext("link") or "").strip()
        bruto = it.findtext(_NS_CONTENT) or it.findtext("description") or ""
        texto = html_para_texto(bruto)
        try:
            data = parsedate_to_datetime(it.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if data.tzinfo is None:
            data = data.replace(tzinfo=timezone.utc)
        if not titulo or not link or agora - data > timedelta(days=MAX_DIAS) or len(texto) < min_chars:
            continue
        out.append((titulo, link, texto, data))
    out.sort(key=lambda x: x[3], reverse=True)
    return out


def prompt_materia(cidade_nome, titulo, texto, data_hoje, slug=""):
    cidade_pura = cidade_nome.split("(")[0].strip()
    return f"""Você é redator de jornalismo local no Brasil. Hoje é {data_hoje}.
Abaixo está um comunicado oficial publicado por {orgao(slug, cidade_nome)}. Escreva uma matéria jornalística sobre ele.

TÍTULO DO COMUNICADO: {titulo}

COMUNICADO:
{texto[:5000]}

REGRAS (a matéria é descartada se não cumprir):
- Use SOMENTE fatos do comunicado. Todo número, data, nome de pessoa, de lugar e de programa tem de estar nele.
- Escreva com suas palavras, em tom jornalístico e neutro: sem elogios ao governo, sem "qualidade de vida", "compromisso", "importante iniciativa", "fortalecer".
- Pirâmide invertida: o fato principal no 1º parágrafo (o quê, quando, onde); depois os detalhes úteis ao morador (datas, locais, horários, como participar) que estiverem no comunicado.
- Não cite o site nem diga "segundo o comunicado" a cada frase: a atribuição é colocada no fim, automaticamente.
Responda {{"valido": false}} se o comunicado não for notícia (aviso interno, galeria de fotos, texto só com link).

JSON:
- "valido": true
- "title": título de 50 a 90 caracteres com {cidade_pura}.
- "description": 1 frase de 100 a 160 caracteres com o fato principal.
- "artigo": a matéria em 3 a 5 parágrafos, de 150 a 300 palavras no total, separados por linha em branco.

Responda EXCLUSIVAMENTE o JSON."""


# Trava de REGIÃO TROCADA (27/11/2026). Caso real: o comunicado de SP dizia "Parque do Carmo, na Zona Leste"
# e a matéria escreveu "A região central também conta com ... Parque do Carmo". As outras travas só veem se o
# nome existe no comunicado. Um revisor com IA (qwen3:4b) foi testado e REPROVADO: apontou frase certa como
# errada e deixou passar essa. Esta trava é por código: só avisa (a matéria vai para a fila), nunca apaga.
_REGIOES = re.compile(
    r"\b(regi[aã]o central|centro hist[oó]rico|centro da cidade|zona (?:norte|sul|leste|oeste|rural|central)"
    r"|regi[aã]o (?:norte|sul|leste|oeste|metropolitana|serrana)|litoral (?:norte|sul))\b", re.I)
_LUGAR = re.compile(r"\b((?:Parque|Praça|Praia|Avenida|Rua|Largo|Bairro|Vila|Jardim|Estação|Terminal|Mercado|Teatro|Museu|"
                    r"Hospital|Ilha|Lagoa|Morro|Ponte|Viaduto)\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕ][\wÀ-ÿ'-]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕ][\wÀ-ÿ'-]+)*)")


def _n(s):
    import unicodedata
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def regiao_trocada(texto_fonte, artigo):
    """Frases da matéria que põem um lugar numa região que o comunicado não liga a esse lugar."""
    pars = [_n(p) for p in re.split(r"\n\s*\n|\n", texto_fonte) if p.strip()]
    alertas = []
    for frase in re.split(r"(?<=[.!?])\s+", artigo.replace("\n", " ")):
        regioes = {_n(m.group(1)) for m in _REGIOES.finditer(frase)}
        if not regioes:
            continue
        for lugar in {m.group(1) for m in _LUGAR.finditer(frase)}:
            ln = _n(lugar)
            # Só o MESMO parágrafo: incluir os vizinhos foi testado e deixou passar o caso do Parque do Carmo
            # (o parágrafo seguinte falava de "região central" por outro motivo).
            com_lugar = [p for p in pars if ln in p]
            if com_lugar and not any(rg in p for p in com_lugar for rg in regioes):
                alertas.append(f'região trocada? "{lugar}" + "{", ".join(sorted(regioes))}" não aparecem juntos no comunicado')
    return list(dict.fromkeys(alertas))[:3]


def montar_texto_oficial(artigo, cidade_nome, link, slug=""):
    return (f"{artigo.strip()}\n\n*Com informações da {orgao(slug, cidade_nome)}. "
            f"[Leia o comunicado original]({link}).*")


def checar_materia_oficial(robo, cidade_nome, titulo, texto_fonte, data_hoje, title, desc, artigo, slug=""):
    """Mesmas travas da nota curta, com o comunicado inteiro como fonte. Devolve o motivo do descarte ou None."""
    fonte = orgao(slug, cidade_nome)
    base = f"{titulo}\n{texto_fonte}"
    motivo = robo.checar_fatos(base, fonte, data_hoje, title, desc, artigo, cidade_nome)
    if motivo:
        return motivo.replace("na manchete", "no comunicado")
    tudo = f"{title}\n{desc}\n{artigo}"
    e = robo.tem_enchimento(tudo)
    if e and robo.normalizar(e) not in robo.normalizar(base):
        return f"enchimento ('{e}')"
    n = robo.nomes_novos(base, cidade_nome, fonte, tudo)
    if n:
        return f"nome que não está no comunicado ({', '.join(n[:3])})"
    if robo.outra_cidade_homonima(cidade_nome.split("(")[0].strip(), tudo):
        return "texto fala de outra cidade com nome parecido"
    palavras = len(re.findall(r"\w+", artigo))
    if palavras < 90:
        return f"matéria curta demais ({palavras} palavras)"
    return None


def _estado():
    try:
        with open(ESTADO, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _salvar_estado(e):
    tmp = ESTADO + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(e, f, ensure_ascii=False)
    os.replace(tmp, ESTADO)


def _recente(data, agora):
    return data is None or agora - data <= timedelta(days=MAX_DIAS)


def pautas_html(slug, pular=None, agora=None):
    """Notícias novas da página de listagem (link que não estava lá na visita anterior)."""
    import paginas_oficiais as po
    agora = agora or datetime.now(timezone.utc)
    lista, padrao, *opcoes = PAGINAS_PREFEITURAS[slug]
    sem_data = bool(opcoes and opcoes[0].get("sem_data"))
    links = po.links_da_lista(lista, padrao, maximo=12)
    estado = _estado()
    vistos = estado.get(slug)
    estado[slug] = (links + [l for l in (vistos or []) if l not in links])[:300]
    _salvar_estado(estado)
    if vistos is None:  # 1ª visita: só registra o que já existe (não dá para saber se é de hoje)
        print(f"[PREFEITURA {slug}] 1ª visita: {len(links)} links registrados, nada publicado", flush=True)
        return []
    out = []
    for link in [l for l in links if l not in vistos][:MAX_PAGINAS_POR_VISITA]:
        if pular and pular(link):
            continue
        try:
            titulo, final, texto, data = po.ler_pagina(link)
            if sem_data:
                data = None
        except Exception as e:
            print(f"[PREFEITURA {slug}] página falhou: {link} ({e})", flush=True)
            continue
        if not titulo or TITULO_FORA.search(titulo) or len(texto) < MIN_CHARS_FONTE or not _recente(data, agora):
            continue
        out.append((titulo, link, texto, data or agora))
    return out


def pautas_resumo(slug, pular=None, agora=None):
    """RSS só com resumo: datas do RSS, texto da página."""
    import paginas_oficiais as po
    out = []
    for titulo, link, _resumo, data in ler_feed(FEEDS_RESUMO[slug], agora, min_chars=0)[:MAX_PAGINAS_POR_VISITA + 2]:
        if (pular and pular(link)) or TITULO_FORA.search(titulo):
            continue
        try:
            _t, _f, texto, _d = po.ler_pagina(link)
        except Exception as e:
            print(f"[PREFEITURA {slug}] página falhou: {link} ({e})", flush=True)
            continue
        if len(texto) >= MIN_CHARS_FONTE:
            out.append((titulo, link, texto, data))
    return out


def pautas_da_prefeitura(slug, pular=None):
    """[(titulo, link, texto_completo, data)]. pular(link) -> True para o que já foi publicado (poupa download)."""
    try:
        if slug in FEEDS_PREFEITURAS:
            return ler_feed(FEEDS_PREFEITURAS[slug])
        if slug in FEEDS_RESUMO:
            return pautas_resumo(slug, pular)
        if slug in PAGINAS_PREFEITURAS:
            return pautas_html(slug, pular)
    except Exception as e:  # fonte fora do ar não pode parar o ciclo
        print(f"[PREFEITURA {slug}] fonte falhou: {e}", flush=True)
    return []
