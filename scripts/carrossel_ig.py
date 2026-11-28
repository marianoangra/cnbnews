"""Carrossel diário do Instagram @cnbnewstv: capa + 5 notícias do dia + chamada final, em 1080x1350.

    python scripts/carrossel_ig.py                 # gera em ./carrossel-ig/<data>/ (slides + legenda.txt + itens.json)
    python scripts/carrossel_ig.py --saida /tmp/x  # outra pasta
    python scripts/carrossel_ig.py --busca arquivo.json   # índice local em vez do do site

Regras (as mesmas do site):
  - Polícia nunca entra (ECA e presunção de inocência), nem coluna.
  - Até 3 notícias do Brasil + cidades diferentes, das últimas 24 h, mais recentes primeiro.
  - Foto só do banco de fotos livres (data/fotos), sempre com "foto de arquivo" e crédito no slide e na legenda.
    Sem banco (mundo sem foto, cidade sem banco): bloco da marca, nunca foto de outro lugar.
Quem posta é scripts/postar_ig.py (Zernio). Este script só desenha.
"""
import argparse, datetime, hashlib, io, json, os, sys, urllib.request
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cartoes_og import RAIZ, VERMELHO, PRETO, BRANCO, CINZA, fonte, selo, cobrir  # noqa: E402

W, H = 1080, 1350
BRT = datetime.timezone(datetime.timedelta(hours=-3))
UA = "Mozilla/5.0 (compatible; CNBNewsBot/1.0; +https://news.cnbmobile.com/sobre/)"
FORA = {"policia"}
POR_CAT = {"agro": "agro", "natureza": "clima", "saude": "saude", "politica": "politica", "economia": "economia"}
SEM_FOTO_GERAL = {"mundo", "esportes", "entretenimento", "tecnologia"}  # foto de Brasília engana nesses temas
NOMES = {"politica": "Política", "economia": "Economia", "agro": "Agro", "saude": "Saúde", "educacao": "Educação", "clima": "Clima",
         "mundo": "Mundo", "esportes": "Esportes", "entretenimento": "Entretenimento", "tecnologia": "Tecnologia", "natureza": "Natureza",
         "empregos": "Empregos", "cultura": "Cultura", "obras": "Obras", "transito": "Trânsito"}
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]


def carregar_indice(arquivo):
    if arquivo:
        return json.load(open(arquivo, encoding="utf-8"))
    req = urllib.request.Request("https://news.cnbmobile.com/busca.json", headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=30))


def escolher(itens, agora, n=5):
    limite = agora - datetime.timedelta(hours=24)
    br, cid, vistas = [], [], set()
    for i in itens:  # o índice já vem do mais recente para o mais antigo
        if i.get("ed") in FORA or i.get("e") in ("Polícia", "Coluna"):
            continue
        if datetime.datetime.fromisoformat(i["dt"]) < limite:
            continue
        if i["c"] == "Brasil":
            br.append(i)
        elif i["s"] not in vistas:
            vistas.add(i["s"])
            cid.append(i)
    escolhidos = br[:3]
    escolhidos += cid[: n - len(escolhidos)]
    escolhidos += br[3 : 3 + n - len(escolhidos)]
    return escolhidos[:n]


def banco(nome):
    p = os.path.join(RAIZ, "data", "fotos", nome + ".json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def foto_de(item):
    """Mesmo critério do site: banco da cidade; nacional = banco do tema, senão o geral (menos nos temas que enganam)."""
    ed = item.get("ed") or ""
    if item["c"] != "Brasil":
        b = banco(item["s"])
    else:  # igual a layouts/partials/link-capa.html
        cat = item.get("cat") or ""
        ed = POR_CAT.get(cat, ed)
        b = banco("brasil-" + ed) or banco("brasil")
        if cat in SEM_FOTO_GERAL:
            b = banco("brasil-" + cat)
    if not b:
        return None
    lista = [f for f in b if not f.get("tema")] or b
    if ed == "clima":
        lista = [f for f in b if f.get("tema") == "clima"] or lista
    k = int(hashlib.sha1(item["u"].encode()).hexdigest(), 16) % len(lista)
    f = dict(lista[k])
    f["caminho"] = os.path.join(RAIZ, "static", f["arquivo"].lstrip("/"))
    return f if os.path.exists(f["caminho"]) else None


def quebrar(d, texto, f, largura, max_linhas):
    linhas, atual = [], ""
    for p in texto.split():
        t = (atual + " " + p).strip()
        if d.textlength(t, font=f) <= largura:
            atual = t
        else:
            linhas.append(atual)
            atual = p
    if atual:
        linhas.append(atual)
    if len(linhas) > max_linhas:
        linhas = linhas[:max_linhas]
        while linhas[-1] and d.textlength(linhas[-1] + "…", font=f) > largura:
            linhas[-1] = linhas[-1].rsplit(" ", 1)[0]
        linhas[-1] += "…"
    return linhas


def data_extenso(agora):
    return f"{DIAS[agora.weekday()]}, {agora.day} de {MESES[agora.month - 1]}"


def slide_capa(itens, agora):
    img = Image.new("RGB", (W, H), PRETO)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 12], fill=VERMELHO)
    selo(d, 72, 90, 1.25)
    d.text((72, 250), "Resumo do dia", font=fonte(104), fill=BRANCO)
    d.text((72, 380), data_extenso(agora), font=fonte(40, 500), fill=CINZA)
    y = 490
    for n, i in enumerate(itens, 1):
        d.text((72, y - 4), str(n), font=fonte(50), fill=VERMELHO)
        linhas = quebrar(d, i["t"], fonte(38, 700), W - 72 - 150, 2)
        for k, l in enumerate(linhas):
            d.text((150, y + k * 48), l, font=fonte(38, 700), fill=BRANCO)
        y += 48 * len(linhas) + 40
    d.text((72, H - 110), "Arraste para ler  →", font=fonte(38, 700), fill=CINZA)
    return img


def slide_noticia(item, n, total):
    img = Image.new("RGB", (W, H), PRETO)
    d = ImageDraw.Draw(img)
    f = foto_de(item)
    alto_foto = 700
    if f:
        img.paste(cobrir(Image.open(f["caminho"]).convert("RGB"), W, alto_foto), (0, 0))
    else:  # bloco da marca, como no site
        d.rectangle([0, 0, W, alto_foto], fill=(24, 26, 32))
        d.text((W - 640, alto_foto - 260), "CNB", font=fonte(300), fill=(40, 30, 36))
    rot = (item["c"] if item["c"] != "Brasil" else NOMES.get(item.get("cat") or "", "Brasil")).upper()
    fr = fonte(34)
    tb = d.textbbox((0, 0), rot, font=fr)
    d.rounded_rectangle([60, alto_foto - 40, 60 + tb[2] - tb[0] + 36, alto_foto + 30], radius=6, fill=VERMELHO)
    d.text((78 - tb[0], alto_foto - 23 - tb[1]), rot, font=fr, fill=BRANCO)
    y = alto_foto + 70
    for l in quebrar(d, item["t"], fonte(62), W - 120, 4):
        d.text((60, y), l, font=fonte(62), fill=BRANCO)
        y += 74
    y += 16
    if item.get("d"):
        for l in quebrar(d, item["d"], fonte(34, 450), W - 120, 4 if y < 1050 else 2):
            if y > H - 170:
                break
            d.text((60, y), l, font=fonte(34, 450), fill=CINZA)
            y += 46
    rodape = "news.cnbmobile.com"
    d.text((60, H - 90), rodape, font=fonte(32, 700), fill=BRANCO)
    d.text((W - 60 - d.textlength(f"{n}/{total}", font=fonte(32, 700)), H - 90), f"{n}/{total}", font=fonte(32, 700), fill=CINZA)
    if f:
        cred = f"foto de arquivo · {f['autor']}" + (f" ({f['licenca']})" if f.get("licenca") else "")
        fc = fonte(24, 500)
        while d.textlength(cred, font=fc) > W - 120:
            cred = cred[:-2]
        d.text((60, H - 140), cred, font=fc, fill=(150, 154, 163))
    return img, f


def slide_final():
    img = Image.new("RGB", (W, H), PRETO)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 12], fill=VERMELHO)
    selo(d, 72, 420, 1.6)
    d.text((72, 640), "As matérias completas,", font=fonte(70), fill=BRANCO)
    d.text((72, 725), "com as fontes, estão no", font=fonte(70), fill=BRANCO)
    d.text((72, 810), "link da bio.", font=fonte(70), fill=VERMELHO)
    d.text((72, 960), "Notícias do Brasil e de 136 cidades.", font=fonte(38, 600), fill=CINZA)
    d.text((72, H - 110), "news.cnbmobile.com", font=fonte(38, 700), fill=BRANCO)
    return img


def legenda(itens, fotos, agora):
    linhas = [f"📰 Resumo do dia · {agora.day:02d}/{agora.month:02d}", ""]
    for n, i in enumerate(itens, 1):
        linhas.append(f"{n}. {i['t']}" + (f" ({i['c']})" if i["c"] != "Brasil" else ""))
    linhas += ["", "As matérias completas, com as fontes, estão no link da bio: news.cnbmobile.com"]
    creditos = sorted({f"{f['autor']} ({f['licenca']})" if f.get("licenca") else f["autor"] for f in fotos if f})
    if creditos:
        linhas += ["", "Fotos de arquivo, Wikimedia Commons: " + "; ".join(creditos) + "."]
    linhas += ["", "#noticias #brasil #cnbnews"]
    return "\n".join(linhas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida")
    ap.add_argument("--busca")
    a = ap.parse_args()
    agora = datetime.datetime.now(BRT)
    itens = escolher(carregar_indice(a.busca), agora)
    if len(itens) < 3:
        print(f"só {len(itens)} notícia(s) nas últimas 24 h: sem carrossel hoje")
        return 2
    pasta = a.saida or os.path.join(RAIZ, "carrossel-ig", agora.strftime("%Y-%m-%d"))
    os.makedirs(pasta, exist_ok=True)
    total = len(itens) + 2
    arquivos, fotos = [], []
    slides = [slide_capa(itens, agora)]
    for n, i in enumerate(itens, 2):
        s, f = slide_noticia(i, n, total)
        slides.append(s)
        fotos.append(f)
    slides.append(slide_final())
    for k, s in enumerate(slides, 1):
        c = os.path.join(pasta, f"{k:02d}.jpg")
        s.save(c, "JPEG", quality=88, optimize=True, progressive=True)
        arquivos.append(c)
    open(os.path.join(pasta, "legenda.txt"), "w", encoding="utf-8").write(legenda(itens, fotos, agora))
    json.dump({"itens": itens, "slides": arquivos}, open(os.path.join(pasta, "itens.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(pasta)
    return 0


if __name__ == "__main__":
    sys.exit(main())
