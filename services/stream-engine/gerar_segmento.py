"""Gera o segmento de vídeo de UMA matéria nacional para a TV CNB News (live 24h).

    python gerar_segmento.py content/noticias/<arquivo>.md [--voz cadu] [--saida pasta]

Saída: <saida>/<slug>.mp4, 1920x1080, 30 fps, H.264 pela NVENC (placa de vídeo, quase sem CPU) + AAC 48 kHz.
Todos os segmentos saem com os MESMOS parâmetros: a transmissão só emenda os arquivos (ffmpeg -c copy),
sem recodificar, para o Pentium da rig não sofrer.

Regras (iguais ao site e ao Instagram):
  - Polícia não vai para a TV (ECA e presunção de inocência; foto/voz sugerem ligação que a nota não prova).
  - Foto só do banco livre, com "foto de arquivo" e crédito na tela.
  - A voz lê o lauda_youtube.texto_locucao (escrito pelo robô, revisado pelas travas), passado pelo locucao.falavel().
Voz: Piper, modelos pt_BR com licença CC0 em /mnt/hd/tv/vozes.
"""
import argparse, json, os, re, subprocess, sys, tempfile, wave

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))
sys.path.insert(0, AQUI)
from PIL import Image, ImageChops, ImageDraw  # noqa: E402
from cartoes_og import VERMELHO, PRETO, BRANCO, CINZA, fonte, selo, cobrir  # noqa: E402
import carrossel_ig  # noqa: E402  (foto_de e NOMES: mesma escolha de foto do Instagram)
from locucao import falavel  # noqa: E402

TV = os.environ.get("CNB_TV_DIR", "/mnt/hd/tv")
W, H = 1920, 1080
PIPER = os.path.join(TV, "piper-venv", "bin", "piper")


def front_matter(caminho):
    txt = open(caminho, encoding="utf-8").read()
    m = re.match(r"---\n(.*?)\n---\n", txt, re.S)
    fm = m.group(1) if m else ""

    def campo(nome):
        r = re.search(rf'^\s*{nome}:\s*"?(.*?)"?\s*$', fm, re.M)
        return r.group(1).replace('\\"', '"') if r else ""
    return {"titulo": campo("title"), "linha": campo("description"), "categoria": campo("categoria"),
            "editoria": campo("editoria"), "locucao": campo("texto_locucao"), "gc": campo("texto_gc"),
            "fonte": campo("fonte"), "slug": os.path.splitext(os.path.basename(caminho))[0]}


def e_policia(m):
    if m["editoria"] == "policia":
        return True
    t = (m["titulo"] + " " + m["linha"]).lower()
    return bool(re.search(r"polícia|policia|policial|preso|presa|prisão|homicídio|assassin|tráfico|assalto|roubo|furto|delegacia|"
                          r"feminicíd|estupro|agress|esfaque|baleado|crime|suspeito|investigad", t))


def quebrar(d, texto, f, largura, max_linhas):
    return carrossel_ig.quebrar(d, texto, f, largura, max_linhas)


def quadro(m, foto):
    """Um quadro só (a imagem fica parada; a voz carrega o segmento)."""
    if foto:
        base = cobrir(Image.open(foto["caminho"]).convert("RGB"), W, H)
        sombra = Image.new("L", (W, H))
        ds = ImageDraw.Draw(sombra)
        for y in range(H):  # escurece de cima para baixo, forte onde ficam os letreiros
            ds.line([(0, y), (W, y)], fill=int(70 + 170 * max(0.0, (y - H * 0.35) / (H * 0.65)) ** 1.2))
        img = Image.composite(Image.new("RGB", (W, H), PRETO), base, sombra)
    else:
        img = Image.new("RGB", (W, H), (20, 22, 27))
        ImageDraw.Draw(img).text((W - 1050, 120), "CNB", font=fonte(520), fill=(36, 28, 34))
    d = ImageDraw.Draw(img)
    selo(d, 70, 60, 1.0)
    # AO VIVO
    fa = fonte(30)
    tb = d.textbbox((0, 0), "AO VIVO", font=fa)
    x0 = W - 70 - (tb[2] - tb[0]) - 70
    d.rounded_rectangle([x0, 66, W - 70, 122], radius=28, fill=(0, 0, 0))
    d.ellipse([x0 + 22, 85, x0 + 40, 103], fill=VERMELHO)
    d.text((x0 + 52 - tb[0], 94 - (tb[3] - tb[1]) // 2 - tb[1]), "AO VIVO", font=fa, fill=BRANCO)
    # editoria
    rot = carrossel_ig.NOMES.get(m["categoria"], "Brasil").upper()
    fr = fonte(32)
    tb = d.textbbox((0, 0), rot, font=fr)
    d.rectangle([70, 640, 70 + tb[2] - tb[0] + 40, 692], fill=VERMELHO)
    d.text((90 - tb[0], 666 - (tb[3] - tb[1]) // 2 - tb[1]), rot, font=fr, fill=BRANCO)
    # manchete
    y = 712
    for l in quebrar(d, m["titulo"], fonte(68), W - 140, 2):
        d.text((70, y), l, font=fonte(68), fill=BRANCO)
        y += 80
    # GC (tarja inferior, como na TV)
    gc = (m["gc"] or m["titulo"]).upper()[:60]
    d.rectangle([0, 905, W, 985], fill=VERMELHO)
    d.text((70, 945 - 22), gc, font=fonte(44), fill=BRANCO)
    d.rectangle([0, 985, W, H], fill=(245, 246, 248))
    linha = f"Fonte: {m['fonte']}" if m["fonte"] else ""
    d.text((70, 1004), (linha + "   ·   " if linha else "") + "news.cnbmobile.com", font=fonte(34, 700), fill=PRETO)
    if foto:
        cred = f"foto de arquivo · {foto['autor']}" + (f" ({foto['licenca']})" if foto.get("licenca") else "")
        fc = fonte(24, 500)
        d.text((W - 70 - d.textlength(cred, font=fc), 870), cred, font=fc, fill=(190, 193, 200))
    return img


def sintetizar(texto, voz, wav):
    """Voz Piper do texto JÁ falável; devolve a duração em segundos."""
    subprocess.run([PIPER, "-m", os.path.join(TV, "vozes", f"pt_BR-{voz}-medium.onnx"), "-f", wav],
                   input=texto.encode("utf-8"), check=True, stderr=subprocess.DEVNULL)
    with wave.open(wav) as w:
        return w.getnframes() / w.getframerate()


def codificar(png, wav, mp4, dur):
    """Quadro parado + voz -> MP4 com os parâmetros FIXOS da TV (a transmissão emenda com -c copy).
    0,8 s de silêncio antes e 1,2 s depois: respiro entre uma notícia e outra."""
    tmp = mp4 + ".parcial.mp4"
    subprocess.run(["nice", "-n", "15", "ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", png,
                    "-i", wav, "-filter_complex", "[1:a]adelay=800|800,apad=pad_dur=1.2,aresample=48000,aformat=channel_layouts=stereo[a]",
                    "-map", "0:v", "-map", "[a]", "-t", f"{dur + 2.0:.2f}",
                    "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "cbr", "-b:v", "4500k", "-maxrate", "4500k", "-bufsize", "9000k",
                    "-g", "60", "-bf", "0", "-pix_fmt", "yuv420p", "-r", "30",
                    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", "-f", "mp4", tmp], check=True)
    os.replace(tmp, mp4)  # a playlist nunca enxerga arquivo pela metade
    return dur + 2.0


def gerar(caminho, voz, saida):
    m = front_matter(caminho)
    if not m["locucao"]:
        raise SystemExit(f"{m['slug']}: sem lauda_youtube.texto_locucao")
    if e_policia(m):
        raise SystemExit(f"{m['slug']}: Polícia não vai para a TV")
    item = {"c": "Brasil", "s": "", "u": m["slug"], "ed": m["editoria"], "cat": m["categoria"]}
    foto = carrossel_ig.foto_de(item)
    os.makedirs(saida, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png, wav = os.path.join(tmp, "q.png"), os.path.join(tmp, "v.wav")
        quadro(m, foto).save(png)
        texto = falavel(m["locucao"])
        dur = sintetizar(texto, voz, wav)
        mp4 = os.path.join(saida, m["slug"] + ".mp4")
        total = codificar(png, wav, mp4, dur)
    json.dump({"slug": m["slug"], "titulo": m["titulo"], "voz": voz, "duracao": round(total, 2), "texto_falado": texto},
              open(os.path.join(saida, m["slug"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return mp4, total


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("materia")
    ap.add_argument("--voz", default="cadu")
    ap.add_argument("--saida", default=os.path.join(TV, "segmentos"))
    a = ap.parse_args()
    mp4, dur = gerar(a.materia, a.voz, a.saida)
    print(f"{mp4} ({dur:.1f} s)")
