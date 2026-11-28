"""Produtor da TV CNB News: mantém /mnt/hd/tv/segmentos em dia (timer cnbnews-tv-produtor, a cada 10 min).

    python produtor.py            # gera o que falta (até MAX por rodada) e limpa o velho
    python produtor.py --vinheta  # refaz a vinheta institucional

- Matérias nacionais de content/noticias/ das últimas 48 h com lauda_youtube.texto_locucao.
- Voz em rodízio Cadu/Faber (escolha do Rafael, 28/11/2026; Jeff fora).
- Polícia nunca (gerar_segmento recusa).
- Apaga segmento com mais de 72 h.
- Vinheta institucional (vinheta.mp4): abre cada bloco da transmissão e segura o ar se não houver notícia.
"""
import argparse, datetime, glob, json, os, re, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import gerar_segmento as G  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

SEG = os.path.join(G.TV, "segmentos")
VOZES = ["cadu", "faber"]
MAX = 8
JANELA_H, APAGAR_H = 48, 72
VINHETA_TEXTO = ("Você está na TV CNB News. Notícias do Brasil e de cento e trinta e seis cidades, vinte e quatro horas por dia. "
                 "As matérias completas, com as fontes, estão em news ponto cnbmobile ponto com.")


def data_do_slug(nome):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", nome)
    return datetime.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=datetime.timezone.utc) if m else None


def vinheta():
    img = Image.new("RGB", (G.W, G.H), G.PRETO)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, G.W, 14], fill=G.VERMELHO)
    G.selo(d, 160, 330, 2.6)
    d.text((165, 640), "Notícias do Brasil e de 136 cidades, 24 horas por dia.", font=G.fonte(58, 700), fill=G.BRANCO)
    d.text((165, 730), "Matérias completas, com as fontes:", font=G.fonte(44, 500), fill=G.CINZA)
    d.text((165, 790), "news.cnbmobile.com", font=G.fonte(64), fill=G.VERMELHO)
    d.text((165, G.H - 120), "Conteúdo produzido com inteligência artificial e revisado por regras editoriais.", font=G.fonte(30, 500), fill=G.CINZA)
    os.makedirs(SEG, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png, wav = os.path.join(tmp, "q.png"), os.path.join(tmp, "v.wav")
        img.save(png)
        dur = G.sintetizar(VINHETA_TEXTO, "cadu", wav)
        G.codificar(png, wav, os.path.join(SEG, "vinheta.mp4"), dur)
    print("vinheta ok")


def proxima_voz():
    n = len(glob.glob(os.path.join(SEG, "2*.json")))
    return VOZES[n % len(VOZES)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vinheta", action="store_true")
    a = ap.parse_args()
    os.makedirs(SEG, exist_ok=True)
    if a.vinheta or not os.path.exists(os.path.join(SEG, "vinheta.mp4")):
        vinheta()
    agora = datetime.datetime.now(datetime.timezone.utc)
    # limpeza
    for f in glob.glob(os.path.join(SEG, "2*.mp4")) + glob.glob(os.path.join(SEG, "2*.json")):
        d = data_do_slug(os.path.basename(f))
        if d and agora - d > datetime.timedelta(hours=APAGAR_H):
            os.remove(f)
    # recusadas (Polícia, sem lauda) não são tentadas de novo
    recusa_p = os.path.join(SEG, ".recusadas.json")
    recusadas = json.load(open(recusa_p)) if os.path.exists(recusa_p) else {}
    feitas = 0
    materias = sorted(glob.glob(os.path.join(G.RAIZ, "content", "noticias", "2*.md")), reverse=True)
    for md in materias:
        slug = os.path.splitext(os.path.basename(md))[0]
        d = data_do_slug(slug)
        if not d or agora - d > datetime.timedelta(hours=JANELA_H):
            continue
        if os.path.exists(os.path.join(SEG, slug + ".mp4")) or slug in recusadas:
            continue
        try:
            mp4, dur = G.gerar(md, proxima_voz(), SEG)
            print(f"ok {slug} ({dur:.0f} s)")
            feitas += 1
        except SystemExit as e:
            recusadas[slug] = str(e)
            print("fora:", e)
        except Exception as e:  # um segmento com problema não derruba a rodada
            print("ERRO", slug, repr(e)[:300])
        if feitas >= MAX:
            break
    json.dump(recusadas, open(recusa_p, "w"), ensure_ascii=False)
    n = len(glob.glob(os.path.join(SEG, "2*.mp4")))
    print(f"{datetime.datetime.now():%Y-%m-%d %H:%M} rodada: {feitas} novo(s), {n} no estoque")


if __name__ == "__main__":
    main()
