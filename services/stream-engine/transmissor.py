"""Transmissor da TV CNB News: live 24h no YouTube sem recodificar (serviço cnbnews-tv, Restart=always).

    python transmissor.py           # transmite para o YouTube (chave em /mnt/hd/tv/youtube.key)
    python transmissor.py --teste   # mesma coisa, mas descarta a saída (sem chave, para testar a emenda)

Como funciona (testado em 28/11/2026: 400 s e 150 emendas sem salto de tempo):
  - Duas playlists ffconcat que apontam uma para a outra (lista-a -> lista-b -> lista-a ...).
  - UM ffmpeg com -re lê a lista-a e manda -c copy (zero recodificação: o Pentium nem sente).
  - Cada lista tem ~15 min (CNB_TV_HORA). A PRÓXIMA lista é montada 60 s antes de tocar (o concat só abre o
    arquivo da lista aninhada quando chega nele), então notícia nova entra no ar em até ~16 min.
  - Rodízio contínuo entre listas: uma "rodada" = vinheta + todas as notícias do estoque, da mais nova para a
    mais velha; a lista seguinte continua de onde a anterior parou. Notícia que chegou no meio da rodada entra
    na frente (ainda não passou nesta rodada). Sem isso, com lista menor que o estoque, as velhas nunca iam ao ar.
  - Sem notícia no estoque: só a vinheta (nunca tela preta).
  - Cada emenda deixa ~1 arquivo aberto e ~75 KB no ffmpeg: o timer cnbnews-tv-reinicio reinicia toda segunda às 4h BRT.
  - A posição real vem do -progress do ffmpeg (out_time), não do relógio.
"""
import argparse, glob, json, os, subprocess, sys, threading, time

TV = os.environ.get("CNB_TV_DIR", "/mnt/hd/tv")
SEG = os.path.join(TV, "segmentos")
AR = os.path.join(TV, "ar")
CHAVE = os.path.join(TV, "youtube.key")
RTMP = "rtmp://a.rtmp.youtube.com/live2/"
HORA = float(os.environ.get("CNB_TV_HORA", 900))  # duração de cada playlist; no teste, menor para ver as emendas
ANTES = 60  # monta a próxima lista este tanto de segundos antes de ela tocar


# O AAC começa 1024 amostras ANTES do zero (priming: 1º pacote de áudio em -0,0213 s). Emendando pela duração
# do arquivo, esse pedaço invade o fim do anterior e o muxer reclama de DTS fora de ordem (visto no teste de
# 28/11/2026). Declarando cada arquivo 1024/48000 s mais longo, o áudio emenda exato e o vídeo ganha 21 ms parado.
PRIMING = 1024 / 48000
_dur = {}
_rodada = set()  # notícias que já entraram numa lista nesta rodada


def duracao(mp4):
    """Duração real do arquivo (ffprobe), com cache."""
    k = (mp4, os.path.getmtime(mp4))
    if k not in _dur:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], capture_output=True, text=True)
        _dur[k] = float(r.stdout.strip() or 0)
    return _dur[k]


def montar(nome, proxima, geracao):
    """Reescreve a playlist `nome` (~1 h) e devolve a duração. Links com nome curto e relativo: a lista
    aninhada do ffconcat recusa caminho absoluto ('unsafe file name')."""
    vinheta = os.path.join(SEG, "vinheta.mp4")
    noticias = sorted(glob.glob(os.path.join(SEG, "2*.mp4")), reverse=True)
    noticias = [f for f in noticias if ".parcial" not in f and os.path.exists(f) and os.path.getsize(f) > 0]
    itens, total = [], 0.0
    _rodada.intersection_update(noticias)  # some quem saiu do estoque (>72 h)
    while total < HORA:
        pendentes = [f for f in noticias if f not in _rodada]
        if not pendentes:  # rodada completa (ou estoque vazio): recomeça com a vinheta
            _rodada.clear()
            itens.append(vinheta)
            total += duracao(vinheta) + PRIMING
            if not noticias and total >= 60:
                break
            continue
        f = pendentes[0]
        _rodada.add(f)
        itens.append(f)
        total += duracao(f) + PRIMING
    for velho in glob.glob(os.path.join(AR, f"{nome[-1]}*-*.mp4")):  # links da geração anterior DESTA lista
        if not os.path.basename(velho).startswith(f"{nome[-1]}{geracao}-"):
            os.remove(velho)
    linhas = ["ffconcat version 1.0"]
    for k, f in enumerate(itens):
        link = f"{nome[-1]}{geracao}-{k:03d}.mp4"
        caminho = os.path.join(AR, link)
        if os.path.lexists(caminho):
            os.remove(caminho)
        os.symlink(f, caminho)
        linhas.append(f"file {link}")
        linhas.append(f"duration {duracao(f) + PRIMING:.6f}")
    linhas.append(f"file {proxima}.ffconcat")
    tmp = os.path.join(AR, nome + ".tmp")
    open(tmp, "w").write("\n".join(linhas) + "\n")
    os.replace(tmp, os.path.join(AR, nome + ".ffconcat"))
    print(f"[{time.strftime('%H:%M:%S')}] {nome}: {len(itens)} itens, {total / 60:.1f} min ({len(noticias)} notícias no estoque)", flush=True)
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--teste", action="store_true")
    a = ap.parse_args()
    os.makedirs(AR, exist_ok=True)
    if not os.path.exists(os.path.join(SEG, "vinheta.mp4")):
        sys.exit("sem vinheta.mp4: rode produtor.py antes")
    if a.teste:
        destino = ["-f", "null", "-"]
    else:
        if not os.path.exists(CHAVE):
            sys.exit(f"sem chave de transmissão em {CHAVE}")
        destino = ["-f", "flv", "-flvflags", "no_duration_filesize", RTMP + open(CHAVE).read().strip()]
    geracao = int(time.time())
    fim = {"lista-a": montar("lista-a", "lista-b", geracao)}
    fim["lista-b"] = fim["lista-a"] + montar("lista-b", "lista-a", geracao)
    pronta = {"lista-a": True, "lista-b": True}  # a próxima já está montada para tocar
    ff = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "warning", "-re", "-f", "concat", "-i", os.path.join(AR, "lista-a.ffconcat"),
                           "-c", "copy", "-progress", "pipe:1", "-nostats"] + destino,
                          stdout=subprocess.PIPE, text=True, cwd=AR)
    pos = {"s": 0.0}

    def ler_progresso():
        for linha in ff.stdout:
            if linha.startswith("out_time_us="):
                try:
                    pos["s"] = int(linha.split("=", 1)[1]) / 1e6
                except ValueError:
                    pass
    threading.Thread(target=ler_progresso, daemon=True).start()
    tocando, outra = "lista-a", "lista-b"
    while ff.poll() is None:
        time.sleep(5)
        if not pronta[outra] and pos["s"] > fim[tocando] - ANTES:  # 60 s antes de a outra tocar: monta com o mais novo
            geracao += 1
            fim[outra] = fim[tocando] + montar(outra, tocando, geracao)
            pronta[outra] = True
        if pos["s"] > fim[tocando] + 20:  # já passou para a outra: a que acabou de tocar fica para remontar
            pronta[tocando] = False
            tocando, outra = outra, tocando
    print("ffmpeg saiu com", ff.returncode, flush=True)
    sys.exit(ff.returncode or 1)


if __name__ == "__main__":
    main()
