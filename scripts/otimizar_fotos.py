"""Recomprime as fotos dos bancos (static/fotos/**/*.jpg) para no máximo 280 KB, sem mudar o tamanho em pixels.

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

antes = depois = mexidas = 0
for f in sorted(glob.glob(os.path.join(RAIZ, 'static', 'fotos', '*', '*.jpg'))):
    t = os.path.getsize(f)
    antes += t
    if t <= LIMITE:
        depois += t
        continue
    im = Image.open(f)
    im.load()
    if im.mode != 'RGB':
        im = im.convert('RGB')
    for q in (84, 80, 76, 72, 68, 64, 60):
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
        if buf.tell() <= LIMITE:
            break
    with open(f, 'wb') as out:
        out.write(buf.getvalue())
    depois += buf.tell()
    mexidas += 1
print(f'{mexidas} fotos recomprimidas · {antes // 1024 // 1024} MB -> {depois // 1024 // 1024} MB')
