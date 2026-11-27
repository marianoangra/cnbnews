"""Monta o banco de fotos livres de uma cidade a partir do Wikimedia Commons.

Uso:
    python scripts/fotos_cidade.py pelotas "Pelotas" RS
    python scripts/fotos_cidade.py pelotas "Pelotas" RS --max 15

Gera:
    static/fotos/<slug>/<arquivo>.jpg   (1280px de largura, serve pro Google Discover)
    data/fotos/<slug>.json              (legenda, autor, licença e link de cada foto)

Os templates do Hugo leem data/fotos/<slug>.json e escolhem uma foto por notícia,
sempre com legenda "foto de arquivo" e crédito. Notícia de Polícia não recebe foto.

Só entram fotos com licença que permite uso comercial com crédito
(CC BY, CC BY-SA, CC0, domínio público). Revise o JSON antes de commitar:
apague a entrada (e o .jpg) de qualquer foto que não combine com um portal de notícias.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
UA = "cnbnews-fotos/1.0 (portal de noticias locais)"
LICENCAS_OK = re.compile(r"^(CC BY(-SA)? [0-9.]+.*|CC0|Public domain|Domínio público)", re.I)
TITULO_RUIM = re.compile(
    r"\.(pdf|svg|tif|tiff|gif|webm|ogv)$|mapa|map|locator|bandeira|flag|brasão|brasao|coat of arms|"
    r"logo|selo|diagram|gráfico|grafico|planta|museu da pessoa|processo crime",
    re.I,
)
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def api(params):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def limpar_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def legenda_de(titulo, desc):
    desc = limpar_html(desc)
    if desc and len(desc) <= 110 and "http" not in desc:
        return desc.rstrip(".")
    nome = re.sub(r"^File:", "", titulo)
    nome = re.sub(r"\.[a-zA-Z]+$", "", nome)
    nome = re.sub(r"[_]+", " ", nome)
    nome = re.sub(r"\s*-?\s*\d{8,}.*$", "", nome)  # carimbos de data do nome do arquivo
    nome = re.sub(r"\s*\(\d+\)$", "", nome)
    return nome.strip(" -")


def buscar(consulta, limite=30):
    d = api({
        "action": "query", "generator": "search", "gsrnamespace": 6,
        "gsrsearch": consulta + " filetype:bitmap", "gsrlimit": limite,
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 1280,
        "iiextmetadatafilter": "Artist|LicenseShortName|ImageDescription",
    })
    return list(d.get("query", {}).get("pages", {}).values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("nome")
    ap.add_argument("uf")
    ap.add_argument("--max", type=int, default=12)
    a = ap.parse_args()

    n = f'"{a.nome}"'
    consultas = [f"{n} centro histórico", f"{n} praça", f"{n} mercado público", f"{n} catedral",
                 f"{n} prefeitura", f"{n} avenida", f"{n} vista", f"{n} praia", f"{n} teatro",
                 f"{n} universidade", f"{n} chuva enchente", f"{n} {a.uf}"]
    vistos, fotos, por_serie = set(), [], {}
    for q in consultas:
        for p in buscar(q):
            if len(fotos) >= a.max:
                break
            t = p.get("title", "")
            if t in vistos or TITULO_RUIM.search(t) or a.nome.lower() not in t.lower() + limpar_html(
                    p.get("imageinfo", [{}])[0].get("extmetadata", {}).get("ImageDescription", {}).get("value", "")).lower():
                continue
            vistos.add(t)
            ii = p["imageinfo"][0]
            m = ii.get("extmetadata", {})
            lic = m.get("LicenseShortName", {}).get("value", "")
            if ii.get("mime") != "image/jpeg" or not LICENCAS_OK.match(lic):
                continue
            if ii["width"] < 1280 or ii["width"] < ii["height"] * 1.25:  # só paisagem e grande
                continue
            autor = limpar_html(m.get("Artist", {}).get("value", "")) or "Autor desconhecido"
            legenda = legenda_de(t, m.get("ImageDescription", {}).get("value", ""))
            serie = re.sub(r"[^a-z]", "", legenda.lower())[:30]  # mesma sessão de fotos = mesma legenda
            if por_serie.get(serie, 0) >= 2:
                continue
            por_serie[serie] = por_serie.get(serie, 0) + 1
            fotos.append({
                "titulo": t,
                "thumb": ii.get("thumburl") or ii["url"],
                "pagina": ii.get("descriptionurl") or "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(t.replace(" ", "_")),
                "legenda": legenda,
                "tema": "clima" if re.search(r"enchente|chuva|cheia|alagamento|temporal|inunda", legenda, re.I) else "",
                "autor": autor[:60],
                "licenca": "domínio público" if lic.lower().startswith(("public", "domínio")) else lic,
            })
        time.sleep(0.5)

    if not fotos:
        sys.exit(f"Nenhuma foto livre encontrada para {a.nome}.")

    pasta = os.path.join(RAIZ, "static", "fotos", a.slug)
    os.makedirs(pasta, exist_ok=True)
    os.makedirs(os.path.join(RAIZ, "data", "fotos"), exist_ok=True)
    saida = []
    for i, f in enumerate(fotos, 1):
        nome = f"{a.slug}-{i:02d}.jpg"
        req = urllib.request.Request(f["thumb"], headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r, open(os.path.join(pasta, nome), "wb") as out:
            out.write(r.read())
        saida.append({
            "arquivo": f"/fotos/{a.slug}/{nome}",
            "legenda": f["legenda"],
            "autor": f["autor"],
            "licenca": f["licenca"],
            "fonte": f["pagina"],
            "tema": f["tema"],
        })
        print(f"  {nome}  {f['legenda'][:60]}  ·  {f['autor'][:30]} / {f['licenca']}")
        time.sleep(0.5)

    with open(os.path.join(RAIZ, "data", "fotos", f"{a.slug}.json"), "w", encoding="utf-8") as out:
        json.dump(saida, out, ensure_ascii=False, indent=2)
    print(f"{len(saida)} fotos em static/fotos/{a.slug}/ e data/fotos/{a.slug}.json. Revise antes de commitar.")


if __name__ == "__main__":
    main()
