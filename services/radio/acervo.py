"""Acervo de músicas da Rádio CNB: valida licenças e gera os créditos do site.

    python3 acervo.py --verificar            # sai 1 se houver faixa sem licença aceita/crédito
    python3 acervo.py --site <raiz do repo>  # grava data/radio.json (página /radio/)

Pasta: $CNB_RADIO_DIR/musicas/*.mp3 + creditos.json = lista de
{"arquivo","titulo","autor","licenca","fonte_url","duracao"}.
Lista branca: só licenças que permitem transmissão em site comercial. NC (não comercial),
ND e "só vídeo" (Biblioteca de Áudio do YouTube) ficam fora.
"""
import argparse, glob, json, os, sys

RADIO = os.environ.get("CNB_RADIO_DIR", "/mnt/hd/radio")
MUSICAS = os.path.join(RADIO, "musicas")
LISTA_BRANCA = {"CC0", "PD", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-4.0"}
OBRIGATORIOS = ("arquivo", "titulo", "autor", "licenca", "fonte_url")


def validar(creditos, arquivos):
    """Lista de erros (vazia = acervo ok). `arquivos` = nomes dos mp3 da pasta."""
    erros = []
    citados = set()
    for c in creditos:
        nome = c.get("arquivo", "?")
        citados.add(nome)
        for campo in OBRIGATORIOS:
            if not str(c.get(campo, "")).strip():
                erros.append(f"{nome}: falta {campo}")
        if c.get("licenca") and c["licenca"] not in LISTA_BRANCA:
            erros.append(f"{nome}: licença {c['licenca']} fora da lista branca")
        if nome not in arquivos:
            erros.append(f"{nome}: crédito sem arquivo na pasta")
    for orfa in sorted(arquivos - citados):
        erros.append(f"{orfa}: arquivo sem crédito")
    return erros


def gerar_site(creditos):
    faixas = [{k: c[k] for k in ("titulo", "autor", "licenca", "fonte_url")} for c in creditos]
    horas = round(sum(float(c.get("duracao", 0)) for c in creditos) / 3600, 1)
    return {"faixas": faixas, "horas": horas}


def carregar():
    creditos = json.load(open(os.path.join(MUSICAS, "creditos.json"), encoding="utf-8"))
    arquivos = {os.path.basename(p) for p in glob.glob(os.path.join(MUSICAS, "*.mp3"))}
    return creditos, arquivos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verificar", action="store_true")
    ap.add_argument("--site")
    a = ap.parse_args()
    creditos, arquivos = carregar()
    erros = validar(creditos, arquivos)
    for e in erros:
        print("ERRO", e)
    if a.verificar:
        print(f"{len(creditos)} faixa(s), {gerar_site(creditos)['horas']} h, {len(erros)} erro(s)")
        sys.exit(1 if erros else 0)
    if a.site:
        if erros:
            sys.exit("acervo com erro: corrija antes de publicar os créditos")
        destino = os.path.join(a.site, "data", "radio.json")
        json.dump(gerar_site(creditos), open(destino, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("gravado", destino)


if __name__ == "__main__":
    main()
