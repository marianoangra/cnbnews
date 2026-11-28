"""Miniatura da live da TV CNB News no YouTube (1280x720, JPEG < 2 MB, limite do YouTube).

    python scripts/miniatura_tv.py     # gera static/img/tv/miniatura-live.jpg

É a imagem que aparece no YouTube e na caixa "TV CNB News" do portal (o site pega a miniatura do vídeo
ao vivo em i.ytimg.com). Arte fixa: não envelhece como um print do site. Subir no YouTube Studio
(Transmitir ao vivo > Editar > Miniatura) sempre que uma live nova for criada.
"""
import os
from PIL import Image, ImageDraw

from cartoes_og import BRANCO, CINZA, PRETO, RAIZ, VERMELHO, fonte, salvar, selo

W, H = 1280, 720
SAIDA = os.path.join(RAIZ, 'static', 'img', 'tv', 'miniatura-live.jpg')


def fundo():
    """Preto com brilho vermelho no canto superior direito (igual à vinheta da caixa da TV no site)."""
    img = Image.new('RGB', (W, H), PRETO)
    brilho = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(brilho)
    for i in range(60, 0, -1):
        r = int(1100 * i / 60)
        d.ellipse([W - r, -r * 0.75, W + r, r * 0.75], fill=int(150 * (1 - i / 60) ** 1.6))
    vermelho = Image.new('RGB', (W, H), VERMELHO)
    return Image.composite(vermelho, img, brilho)


def main():
    img = fundo()
    d = ImageDraw.Draw(img)
    x = 80
    selo(d, x, 70, escala=1.15)

    # Selo "AO VIVO"
    fa = fonte(34, 800)
    tb = d.textbbox((0, 0), 'AO VIVO', font=fa)
    y = 250
    caixa = [x, y, x + 58 + tb[2] - tb[0] + 26, y + 62]
    d.rounded_rectangle(caixa, radius=8, fill=VERMELHO)
    d.ellipse([x + 24, y + 22, x + 42, y + 40], fill=BRANCO)
    d.text((x + 58 - tb[0], y + (62 - (tb[3] - tb[1])) // 2 - tb[1]), 'AO VIVO', font=fa, fill=BRANCO)

    # Título "TV CNB News"
    ft, fn = fonte(150, 900), fonte(150, 500)
    y = 340
    t1 = 'TV CNB '
    b1 = d.textbbox((0, 0), t1, font=ft)
    d.text((x - b1[0], y - b1[1]), t1, font=ft, fill=BRANCO)
    d.text((x + d.textlength(t1, font=ft) - b1[0], y - b1[1]), 'News', font=fn, fill=BRANCO)

    fs = fonte(44, 600)
    d.text((x, 535), 'Notícias do Brasil e da sua cidade · 24 horas', font=fs, fill=CINZA)

    fr = fonte(32, 700)
    d.text((x, 630), 'news.cnbmobile.com', font=fr, fill=BRANCO)

    tam = salvar(img, SAIDA, limite=1900 * 1024)
    print(f'{SAIDA}  {tam // 1024} KB')


if __name__ == '__main__':
    main()
