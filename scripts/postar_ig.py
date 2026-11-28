"""Posta o carrossel diário no Instagram @cnbnewstv pelo Zernio (roda na rig, timer cnbnews-ig.timer, 19h BRT).

    python3 scripts/postar_ig.py            # gera (carrossel_ig.py) e posta
    python3 scripts/postar_ig.py --seco     # só gera e mostra a legenda, não posta

Lê do services/agents/.env: ZERNIO_API_KEY e ZERNIO_IG_CONTA (id da conta @cnbnewstv no Zernio).
Um post por dia: a pasta do dia ganha "postado.json" e o Idempotency-Key é a data — rodar de novo não duplica.
"""
import argparse, datetime, json, os, sys, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carrossel_ig  # noqa: E402

API = "https://zernio.com/api/v1"


def ler_env():
    p = os.path.join(carrossel_ig.RAIZ, "services", "agents", ".env")
    env = {}
    if os.path.exists(p):
        for l in open(p, encoding="utf-8"):
            if "=" in l and not l.lstrip().startswith("#"):
                k, v = l.rstrip("\n").split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    env.update({k: v for k, v in os.environ.items() if k.startswith("ZERNIO_")})
    return env


def chamar(metodo, caminho, chave, corpo=None, extra=None):
    req = urllib.request.Request(API + caminho, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"Authorization": "Bearer " + chave, "Content-Type": "application/json", **(extra or {})})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Zernio {metodo} {caminho}: {e.code} {e.read().decode('utf-8', 'replace')[:400]}")


def enviar_imagem(caminho, chave):
    nome = os.path.basename(caminho)
    p = chamar("POST", "/media/presign", chave, {"filename": nome, "contentType": "image/jpeg"})
    put = urllib.request.Request(p["uploadUrl"], method="PUT", data=open(caminho, "rb").read(), headers={"Content-Type": "image/jpeg"})
    urllib.request.urlopen(put, timeout=120).read()
    return p["publicUrl"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seco", action="store_true")
    a = ap.parse_args()
    hoje = datetime.datetime.now(carrossel_ig.BRT).strftime("%Y-%m-%d")
    pasta = os.path.join(carrossel_ig.RAIZ, "carrossel-ig", hoje)
    if os.path.exists(os.path.join(pasta, "postado.json")):
        print("já postado hoje:", open(os.path.join(pasta, "postado.json"), encoding="utf-8").read()[:200])
        return 0
    sys.argv = [sys.argv[0], "--saida", pasta]
    if carrossel_ig.main() != 0:
        return 0  # poucas notícias: sem post hoje, não é erro
    legenda = open(os.path.join(pasta, "legenda.txt"), encoding="utf-8").read()
    slides = json.load(open(os.path.join(pasta, "itens.json"), encoding="utf-8"))["slides"]
    if a.seco:
        print(legenda)
        return 0
    env = ler_env()
    chave, conta = env.get("ZERNIO_API_KEY"), env.get("ZERNIO_IG_CONTA")
    if not chave or not conta:
        raise SystemExit("faltam ZERNIO_API_KEY e/ou ZERNIO_IG_CONTA no services/agents/.env")
    urls = [enviar_imagem(s, chave) for s in slides]
    r = chamar("POST", "/posts", chave, {
        "content": legenda,
        "mediaItems": [{"type": "image", "url": u} for u in urls],
        "publishNow": True,
        "platforms": [{"platform": "instagram", "accountId": conta}],
    }, {"Idempotency-Key": "cnb-ig-carrossel-" + hoje})
    post = r.get("post", r)
    info = {"id": post.get("_id") or post.get("id"), "status": post.get("status"), "slides": len(urls), "quando": datetime.datetime.now(carrossel_ig.BRT).isoformat()}
    json.dump(info, open(os.path.join(pasta, "postado.json"), "w", encoding="utf-8"))
    print("postado:", info)
    return 0


if __name__ == "__main__":
    sys.exit(main())
