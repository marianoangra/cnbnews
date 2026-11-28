"""Vinhetas da Rádio CNB (roda uma vez, ou de novo para refazer).

    python3 vinhetas.py --trilha /mnt/hd/radio/musicas/<faixa>.mp3

vinheta-longa.mp3  (:00 e :30, antes do boletim)
vinheta-curta.mp3  (:15 e :45; também carrega o crédito das músicas, exigido pela CC BY)
Voz Faber sobre os primeiros segundos de uma faixa do acervo (já creditada), com fade.
"""
import argparse, os, subprocess, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "stream-engine"))
RADIO = os.environ.get("CNB_RADIO_DIR", "/mnt/hd/radio")
SAIDA = os.path.join(RADIO, "vinhetas")

TEXTOS = {
    "vinheta-longa": "Rádio CNB News. Notícia na hora certa.",
    "vinheta-curta": "Você ouve a Rádio CNB. Músicas de Kevin MacLeod, incompetech ponto com, licença Creative Commons.",
}


def gerar(nome, texto, trilha, voz="faber"):
    from gerar_segmento import sintetizar
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "v.wav")
        dur = sintetizar(texto, voz, wav)
        total = dur + 2.5
        destino = os.path.join(SAIDA, nome + ".mp3")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", trilha, "-i", wav, "-filter_complex",
            f"[0:a]atrim=0:{total},volume=0.22,afade=t=in:d=0.3,afade=t=out:st={total - 1.2}:d=1.2[t];"
            f"[1:a]adelay=900|900,aresample=44100[v];"
            f"[t][v]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", destino], check=True)
        return destino, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trilha", required=True)
    a = ap.parse_args()
    os.makedirs(SAIDA, exist_ok=True)
    for nome, texto in TEXTOS.items():
        destino, total = gerar(nome, texto, a.trilha)
        print(f"{destino} ({total:.1f} s)")


if __name__ == "__main__":
    main()
