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


def ler_feed(url, agora=None):
    """[(titulo, link, texto, data)] dos últimos MAX_DIAS dias, mais novos primeiro."""
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
        if not titulo or not link or agora - data > timedelta(days=MAX_DIAS) or len(texto) < MIN_CHARS_FONTE:
            continue
        out.append((titulo, link, texto, data))
    out.sort(key=lambda x: x[3], reverse=True)
    return out


def prompt_materia(cidade_nome, titulo, texto, data_hoje):
    cidade_pura = cidade_nome.split("(")[0].strip()
    return f"""Você é redator de jornalismo local no Brasil. Hoje é {data_hoje}.
Abaixo está um comunicado oficial da Prefeitura de {cidade_pura}. Escreva uma matéria jornalística sobre ele.

TÍTULO DO COMUNICADO: {titulo}

COMUNICADO:
{texto[:5000]}

REGRAS (a matéria é descartada se não cumprir):
- Use SOMENTE fatos do comunicado. Todo número, data, nome de pessoa, de lugar e de programa tem de estar nele.
- Escreva com suas palavras, em tom jornalístico e neutro: sem elogios à prefeitura, sem "qualidade de vida", "compromisso", "importante iniciativa", "fortalecer".
- Pirâmide invertida: o fato principal no 1º parágrafo (o quê, quando, onde); depois os detalhes úteis ao morador (datas, locais, horários, como participar) que estiverem no comunicado.
- Não cite o site nem diga "segundo o comunicado" a cada frase: a atribuição é colocada no fim, automaticamente.
Responda {{"valido": false}} se o comunicado não for notícia (aviso interno, galeria de fotos, texto só com link).

JSON:
- "valido": true
- "title": título de 50 a 90 caracteres com {cidade_pura}.
- "description": 1 frase de 100 a 160 caracteres com o fato principal.
- "artigo": a matéria em 3 a 5 parágrafos, de 150 a 300 palavras no total, separados por linha em branco.

Responda EXCLUSIVAMENTE o JSON."""


def montar_texto_oficial(artigo, cidade_nome, link):
    cidade_pura = cidade_nome.split("(")[0].strip()
    return (f"{artigo.strip()}\n\n*Com informações da Prefeitura de {cidade_pura}. "
            f"[Leia o comunicado original]({link}).*")


def checar_materia_oficial(robo, cidade_nome, titulo, texto_fonte, data_hoje, title, desc, artigo):
    """Mesmas travas da nota curta, com o comunicado inteiro como fonte. Devolve o motivo do descarte ou None."""
    fonte = f"Prefeitura de {cidade_nome.split('(')[0].strip()}"
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


def pautas_da_prefeitura(slug):
    url = FEEDS_PREFEITURAS.get(slug)
    if not url:
        return []
    try:
        return ler_feed(url)
    except Exception as e:  # feed fora do ar não pode parar o ciclo
        print(f"[PREFEITURA {slug}] feed falhou: {e}", flush=True)
        return []
