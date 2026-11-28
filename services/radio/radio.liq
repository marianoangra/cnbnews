#!/usr/bin/liquidsoap
# Rádio CNB News — grade (Liquidsoap 2.2, serviço cnbnews-radio).
#   :00  vinheta longa + boletim completo  (entra na hora certa, música sai em fade)
#   :30  vinheta longa + manchetes         (idem)
#   :15 / :45  vinheta curta com crédito das músicas (espera a faixa atual acabar)
#   resto: acervo em ordem aleatória, com crossfade.
# Boletins: montar_boletim.py grava proximo-<tipo>.mp3 aos :57/:27. Sem arquivo = só a vinheta.

settings.log.stdout := true
settings.log.level := 3

radio = environment.get(default="/mnt/hd/radio", "CNB_RADIO_DIR")
senha = environment.get("ICECAST_SOURCE_PASSWORD")

vinheta_longa = "#{radio}/vinhetas/vinheta-longa.mp3"
vinheta_curta = "#{radio}/vinhetas/vinheta-curta.mp3"

musica = playlist(mode="randomize", reload_mode="watch", "#{radio}/musicas")
musica = crossfade(duration=4., musica)

fila_curta = request.queue(id="curta")
fila_bloco = request.queue(id="bloco")

def empurrar(fila, arquivos) =
  list.iter(fun (f) -> if file.exists(f) then fila.push(request.create(f)) else log.important("faltando: #{f}") end, arquivos)
end

thread.when({0m0s}, fun () -> empurrar(fila_bloco, [vinheta_longa, "#{radio}/boletins/proximo-completo.mp3"]))
thread.when({30m0s}, fun () -> empurrar(fila_bloco, [vinheta_longa, "#{radio}/boletins/proximo-manchetes.mp3"]))
thread.when({15m0s}, fun () -> empurrar(fila_curta, [vinheta_curta]))
thread.when({45m0s}, fun () -> empurrar(fila_curta, [vinheta_curta]))

# vinheta curta: só entre faixas
programacao = fallback(track_sensitive=true, [fila_curta, musica])

# bloco de notícia: entra na hora; ao voltar, pula pra próxima faixa (não retoma música pela metade)
def para_bloco(a, b) =
  saida = (fade.out(duration=2., a):source)
  (sequence([saida, (b:source)]):source)
end
def volta_musica(a, b) =
  musica.skip()
  ignore(a)
  (b:source)
end
radio_cnb = fallback(track_sensitive=false, transitions=[para_bloco, volta_musica], [fila_bloco, programacao])
radio_cnb = mksafe(radio_cnb)

output.icecast(
  %mp3(bitrate=128, samplerate=44100, stereo=true),
  host="127.0.0.1", port=8000, password=senha, mount="/radio",
  name="Rádio CNB News", description="Música e notícia 24h — news.cnbmobile.com",
  url="https://news.cnbmobile.com/radio/", genre="News",
  radio_cnb)
