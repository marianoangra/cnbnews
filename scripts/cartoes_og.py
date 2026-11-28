"""Cartões de compartilhamento (og:image) da CNB News: o que aparece no WhatsApp, Facebook e X quando alguém manda um link.

    python scripts/cartoes_og.py            # gera tudo
    python scripts/cartoes_og.py jacarei    # só uma cidade (rodar ao criar cidade nova)

Gera, em 1200x630 (proporção que o WhatsApp e o Facebook usam) e JPEG < 200 KB:
    static/img/og/cnb-news.jpg      capa nacional, editorias, colunas, páginas institucionais
    static/img/og/<slug>.jpg        capa de cada cidade: foto do banco da cidade + nome da cidade
Fonte: Schibsted Grotesk (scripts/fontes, licença OFL), a mesma dos títulos do site.
"""
import glob, io, json, os, re, sys
from PIL import Image, ImageChops, ImageDraw, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTE = os.path.join(RAIZ, 'scripts', 'fontes', 'SchibstedGrotesk.ttf')
SAIDA = os.path.join(RAIZ, 'static', 'img', 'og')
W, H = 1200, 630
VERMELHO, PRETO, BRANCO, CINZA = (200, 16, 46), (12, 13, 16), (255, 255, 255), (201, 204, 211)


def fonte(tam, peso=900):
    f = ImageFont.truetype(FONTE, tam)
    f.set_variation_by_axes([peso])
    return f


def selo(d, x, y, escala=1.0):
    """Selo da marca: caixa vermelha "CNB" + "NEWS" (igual ao cabeçalho do site)."""
    fb, fn = fonte(int(46 * escala)), fonte(int(62 * escala))
    tb = d.textbbox((0, 0), 'CNB', font=fb)
    pad_x, pad_y = int(14 * escala), int(11 * escala)
    caixa = [x, y, x + tb[2] - tb[0] + 2 * pad_x, y + tb[3] - tb[1] + 2 * pad_y]
    d.rounded_rectangle(caixa, radius=int(8 * escala), fill=VERMELHO)
    d.text((x + pad_x - tb[0], y + pad_y - tb[1]), 'CNB', font=fb, fill=BRANCO)
    tn = d.textbbox((0, 0), 'NEWS', font=fn)
    altura = caixa[3] - caixa[1]
    d.text((caixa[2] + int(16 * escala) - tn[0], y + (altura - (tn[3] - tn[1])) // 2 - tn[1]), 'NEWS', font=fn, fill=BRANCO)
    return caixa[3]


def salvar(img, caminho, limite=190 * 1024):
    for q in (86, 80, 74, 68, 62):
        buf = io.BytesIO()
        img.convert('RGB').save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
        if buf.tell() <= limite:
            break
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, 'wb') as f:
        f.write(buf.getvalue())
    return buf.tell()


def cobrir(foto, w, h):
    """Recorta a foto para preencher w x h sem distorcer (como CSS object-fit: cover)."""
    r = max(w / foto.width, h / foto.height)
    foto = foto.resize((round(foto.width * r), round(foto.height * r)), Image.LANCZOS)
    x, y = (foto.width - w) // 2, (foto.height - h) // 2
    return foto.crop((x, y, x + w, y + h))


def fundo_escuro(foto):
    """Foto escurecida com degradê da esquerda/baixo, para o texto branco ler bem em qualquer foto."""
    base = cobrir(foto.convert('RGB'), W, H)
    horiz = Image.new('L', (W, H))
    dh = ImageDraw.Draw(horiz)
    for x in range(W):  # mais escuro à esquerda, onde fica o texto
        dh.line([(x, 0), (x, H)], fill=int(200 - 130 * (x / W)))
    vert = Image.new('L', (W, H))
    dv = ImageDraw.Draw(vert)
    for y in range(H):  # e embaixo (linha fina e endereço)
        dv.line([(0, y), (W, y)], fill=int(225 * max(0.0, (y - H * 0.35) / (H * 0.65)) ** 1.3))
    sombra = ImageChops.lighter(horiz, vert)
    preto = Image.new('RGB', (W, H), PRETO)
    return Image.composite(preto, base, sombra)


def cartao_nacional(n_cidades):
    img = Image.new('RGB', (W, H), PRETO)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 10], fill=VERMELHO)
    fim = selo(d, 90, 170, escala=1.9)
    d.text((92, fim + 48), 'Notícias do Brasil e da sua cidade', font=fonte(50, 700), fill=BRANCO)
    d.text((92, fim + 118), f'{n_cidades} cidades com edição própria · 24 horas', font=fonte(34, 500), fill=CINZA)
    d.text((92, H - 92), 'news.cnbmobile.com', font=fonte(32, 800), fill=(255, 96, 120))
    return salvar(img, os.path.join(SAIDA, 'cnb-news.jpg'))


def primeira_foto(slug):
    p = os.path.join(RAIZ, 'data', 'fotos', f'{slug}.json')
    if not os.path.exists(p):
        return None
    for f in json.load(open(p, encoding='utf-8')):
        arq = os.path.join(RAIZ, 'static', f['arquivo'].lstrip('/').replace('/', os.sep))
        if os.path.exists(arq) and f.get('tema', '') == '':
            return arq
    return None


def cartao_cidade(slug, nome, uf):
    foto = primeira_foto(slug)
    if foto:
        img = fundo_escuro(Image.open(foto))
    else:
        img = Image.new('RGB', (W, H), PRETO)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 10], fill=VERMELHO)
    selo(d, 80, 70, escala=0.95)
    # nome da cidade: o maior tamanho que caiba em 1040 px de largura
    tam = 150
    while tam > 60 and d.textbbox((0, 0), nome, font=fonte(tam))[2] > 1040:
        tam -= 6
    fn = fonte(tam)
    bb = d.textbbox((0, 0), nome, font=fn)
    y_nome = 330 - (bb[3] - bb[1]) // 2
    d.text((80 - bb[0], y_nome - bb[1]), nome, font=fn, fill=BRANCO)
    fim_nome = y_nome + (bb[3] - bb[1])
    d.text((84, fim_nome + 34), f'Notícias de {nome} ({uf}) hoje', font=fonte(40, 600), fill=BRANCO)
    d.text((84, H - 86), f'{slug}.news.cnbmobile.com', font=fonte(30, 800), fill=(255, 96, 120))
    return salvar(img, os.path.join(SAIDA, f'{slug}.jpg'))


def cidades():
    for idx in sorted(glob.glob(os.path.join(RAIZ, 'content', 'cidades', '*', '_index.md'))):
        m = re.search(r'title: "(.+?) \((\w\w)\)"', open(idx, encoding='utf-8').read())
        if m:
            yield os.path.basename(os.path.dirname(idx)), m.group(1), m.group(2)


if __name__ == '__main__':
    so = set(sys.argv[1:])
    todas = list(cidades())
    if not so:
        print('nacional', cartao_nacional(len(todas)) // 1024, 'KB')
    for slug, nome, uf in todas:
        if so and slug not in so:
            continue
        print(slug, cartao_cidade(slug, nome, uf) // 1024, 'KB', '' if primeira_foto(slug) else '(sem foto: fundo da marca)')
