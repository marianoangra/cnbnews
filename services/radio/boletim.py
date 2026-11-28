"""Lógica pura do boletim da Rádio CNB (sem ffmpeg/Piper; testada em test_boletim.py).

Cada segmento é um dict do JSON que o produtor da TV grava ({"slug","titulo",...})
acrescido de "ts" (datetime com fuso = quando o segmento foi gerado, ~minutos após a publicação).
O produtor já recusa Polícia; aqui só entram frescor, repetição e quantidade.
"""
import datetime as dt

TIPOS = {"completo": 8, "manchetes": 4}  # completo = áudio dos segmentos, cortado em ~3 min no montar_boletim; manchetes = só os títulos
MINIMO = {8: 3, 4: 2}
JANELA = dt.timedelta(hours=24)
SEM_REPETIR = dt.timedelta(minutes=90)  # nunca a mesma matéria em dois blocos seguidos do mesmo tipo (fluxo ~14 matérias/dia)

_HORAS = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
          "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
          "vinte", "vinte e uma", "vinte e duas", "vinte e três"]


def escolher(segmentos, agora, tocados, n):
    """Até n segmentos frescos (< 24 h), mais recentes primeiro, sem as tocadas no bloco anterior do mesmo tipo.
    Menos que o mínimo do tipo → [] (o bloco é pulado)."""
    def tocado_recente(slug):
        quando = tocados.get(slug)
        return bool(quando) and agora - dt.datetime.fromisoformat(quando) < SEM_REPETIR

    bons = [s for s in segmentos if agora - s["ts"] < JANELA and not tocado_recente(s["slug"])]
    bons.sort(key=lambda s: s["ts"], reverse=True)
    bons = bons[:n]
    return bons if len(bons) >= MINIMO.get(n, 1) else []


def hora_certa(agora_brt):
    """Frase da hora certa (horário de Brasília já convertido)."""
    h, m = agora_brt.hour, agora_brt.minute
    if h == 0:
        base, verbo = "meia-noite", "É"
    elif h == 12:
        base, verbo = "meio-dia", "É"
    else:
        base = _HORAS[h] + (" hora" if h == 1 else " horas")
        verbo = "É" if h == 1 else "São"
    minutos = f" e {'trinta' if m == 30 else m} minutos" if m else ""
    return f"{verbo} {base}{minutos} em Brasília."
