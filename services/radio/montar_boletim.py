"""Monta o próximo boletim da Rádio CNB (timer cnbnews-radio-boletim, :57 e :27).

    python3 montar_boletim.py --tipo completo   # :00 — hora certa + áudio dos segmentos (~3 min)
    python3 montar_boletim.py --tipo manchetes  # :30 — só os títulos, lidos pelo Piper (~1 min)

Saída: /mnt/hd/radio/boletins/proximo-<tipo>.mp3 (troca atômica). Sem matéria suficiente → apaga o
arquivo e o Liquidsoap toca só a vinheta. Memória de repetição por tipo em tocados-<tipo>.json.
"""
import argparse, datetime as dt, glob, json, os, subprocess, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "stream-engine"))
import boletim as B  # noqa: E402

TV = os.environ.get("CNB_TV_DIR", "/mnt/hd/tv")
RADIO = os.environ.get("CNB_RADIO_DIR", "/mnt/hd/radio")
SEG = os.path.join(TV, "segmentos")
SAIDA = os.path.join(RADIO, "boletins")
BRT = dt.timezone(dt.timedelta(hours=-3))
LIMITE_COMPLETO_S = 180
VOZES = ["cadu", "faber"]


def log(msg):
    print(f"{dt.datetime.now(BRT):%Y-%m-%d %H:%M} {msg}", flush=True)


def carregar_segmentos():
    segs = []
    for j in glob.glob(os.path.join(SEG, "2*.json")):
        mp4 = j[:-5] + ".mp4"
        if not os.path.exists(mp4):
            continue
        try:
            s = json.load(open(j, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        s["ts"] = dt.datetime.fromtimestamp(os.path.getmtime(j), dt.timezone.utc)
        s["mp4"] = mp4
        segs.append(s)
    return segs


def proximo_horario(agora, tipo):
    """Horário em que o bloco vai ao ar: próxima hora cheia (completo) ou próxima :30 (manchetes)."""
    alvo = agora.replace(second=0, microsecond=0)
    if tipo == "completo":
        alvo = alvo.replace(minute=0) + dt.timedelta(hours=1)
    else:
        alvo = alvo.replace(minute=30) if agora.minute < 30 else alvo.replace(minute=30) + dt.timedelta(hours=1)
    return alvo


def piper_wav(texto, voz, wav):
    from gerar_segmento import sintetizar  # import tardio: puxa PIL etc. só quando precisa
    from locucao import falavel
    return sintetizar(falavel(texto), voz, wav)


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def montar(tipo, agora_utc, para=None):
    os.makedirs(SAIDA, exist_ok=True)
    destino = os.path.join(SAIDA, f"proximo-{tipo}.mp3")
    tocados_p = os.path.join(SAIDA, f"tocados-{tipo}.json")
    tocados = json.load(open(tocados_p)) if os.path.exists(tocados_p) else {}
    escolhidos = B.escolher(carregar_segmentos(), agora_utc, tocados, B.TIPOS[tipo])
    if tipo == "completo":  # corta em ~3 min, mantendo o mínimo
        soma, cortados = 0.0, []
        for s in escolhidos:
            if cortados and soma + s.get("duracao", 30) > LIMITE_COMPLETO_S:
                break
            cortados.append(s)
            soma += s.get("duracao", 30)
        escolhidos = cortados
    if not escolhidos:
        if os.path.exists(destino):
            os.remove(destino)
        log(f"{tipo}: pulado (estoque insuficiente)")
        return None
    voz = VOZES[len(tocados) % 2]
    para = para or proximo_horario(agora_utc.astimezone(BRT), tipo)
    with tempfile.TemporaryDirectory() as tmp:
        partes = []
        abertura = os.path.join(tmp, "abertura.wav")
        if tipo == "completo":
            piper_wav(B.hora_certa(para) + " Estas são as notícias da Rádio CNB News.", voz, abertura)
        else:
            piper_wav("Manchetes da Rádio CNB News.", voz, abertura)
        partes.append(abertura)
        for i, s in enumerate(escolhidos):
            wav = os.path.join(tmp, f"{i}.wav")
            if tipo == "completo":
                ffmpeg("-i", s["mp4"], "-vn", "-ac", "1", "-ar", "22050", wav)
            else:
                piper_wav(s["titulo"] + ".", voz, wav)
            partes.append(wav)
        fecho = os.path.join(tmp, "fecho.wav")
        piper_wav("Notícias completas em news ponto cnbmobile ponto com.", voz, fecho)
        partes.append(fecho)
        lista = os.path.join(tmp, "lista.txt")
        with open(lista, "w") as f:
            f.writelines(f"file '{p}'\n" for p in partes)
        unido = os.path.join(tmp, "unido.wav")
        # tudo para o mesmo formato antes de concatenar (Piper sai 22050 mono; segmentos idem após -ac 1 -ar 22050)
        ffmpeg("-f", "concat", "-safe", "0", "-i", lista, "-ac", "1", "-ar", "22050", unido)
        temp_mp3 = destino + ".tmp.mp3"
        ffmpeg("-i", unido, "-af", "apad=pad_dur=0.6,loudnorm=I=-16:TP=-1.5:LRA=11",
               "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", temp_mp3)
        os.replace(temp_mp3, destino)
    limite = agora_utc - dt.timedelta(hours=24)
    tocados = {k: v for k, v in tocados.items() if dt.datetime.fromisoformat(v) > limite}
    for s in escolhidos:
        tocados[s["slug"]] = agora_utc.isoformat()
    json.dump(tocados, open(tocados_p, "w"), indent=1)
    log(f"{tipo} para {para:%H:%M}: {len(escolhidos)} matéria(s), voz {voz}")
    return destino


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tipo", choices=list(B.TIPOS), required=True)
    a = ap.parse_args()
    montar(a.tipo, dt.datetime.now(dt.timezone.utc))


if __name__ == "__main__":
    main()
