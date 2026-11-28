"""Recomprime as fotos dos bancos (static/fotos/**/*.jpg) para no máximo 280 KB, sem mudar o tamanho em pixels,
e gera a miniatura <foto>-480.jpg (480 px de largura) que os cartões usam no srcset.

    python scripts/otimizar_fotos.py

Por quê: o WhatsApp não mostra a imagem do link (og:image) acima de ~300 KB, e foto pesada deixa o
site lento (Core Web Vitals, que contam para o Google). Em 27/11/2026, 326 de 730 fotos passavam de
280 KB (a maior tinha 1 MB). Rodar de novo depois de montar banco de fotos de cidade nova: só mexe
no que ainda passa do limite.
"""
import glob, io, os
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMITE = 280 * 1024
MINI = '-480.jpg'   # layouts/partials/fig.html procura este sufixo (fileExists) antes de pôr o srcset

antes = depois = mexidas = 0
FOTOS = [f for f in sorted(glob.glob(os.path.join(RAIZ, 'static', 'fotos', '*', '*.jpg'))) if not f.endswith(MINI)]
for f in FOTOS:
    t = os.path.getsize(f)
    antes += t
    if t <= LIMITE:
        depois += t
        continue
    im = Image.open(f)
    im.load()
    if im.mode != 'RGB':
        im = im.convert('RGB')
    # Primeiro só qualidade; foto muito detalhada que não cabe nem com 64 perde um pouco de resolução.
    ok = False
    for escala in (1.0, 0.9, 0.8, 0.7):
        alvo = im if escala == 1.0 else im.resize((round(im.width * escala), round(im.height * escala)), Image.LANCZOS)
        for q in (84, 80, 76, 72, 68, 64):
            buf = io.BytesIO()
            alvo.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
            if buf.tell() <= LIMITE:
                ok = True
                break
        if ok:
            break
    with open(f, 'wb') as out:
        out.write(buf.getvalue())
    depois += buf.tell()
    mexidas += 1
print(f'{mexidas} fotos recomprimidas · {antes // 1024 // 1024} MB -> {depois // 1024 // 1024} MB')

# Miniaturas: os cartões da capa aparecem com 100-360 px; sem isto o celular baixava a foto de 1280 px
# (~250 KB) para mostrar 162 px. Só gera a que falta ou que ficou mais velha que a foto.
novas = 0
for f in FOTOS:
    m = f[:-4] + MINI
    if os.path.exists(m) and os.path.getmtime(m) >= os.path.getmtime(f):
        continue
    im = Image.open(f)
    im.load()
    if im.mode != 'RGB':
        im = im.convert('RGB')
    if im.width > 480:
        im = im.resize((480, round(im.height * 480 / im.width)), Image.LANCZOS)
    im.save(m, 'JPEG', quality=74, optimize=True, progressive=True)
    novas += 1
print(f'{novas} miniaturas geradas')
