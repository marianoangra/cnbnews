"""Texto de locução falável: números, dinheiro, porcentagem, horas e abreviações por extenso (pt-BR).

A voz sintética (Piper) lê "R$ 5,51" e "3,97%" de forma estranha ou soletrada; aqui tudo vira palavra
ANTES de sintetizar. Usado por gerar_segmento.py.

    python locucao.py "O dólar caiu 3,97% e fechou em R$ 5,516 às 17h30."
"""
import re
import sys

from num2words import num2words


def _n(x):
    return num2words(int(x), lang="pt_BR")


def _decimal(inteiro, dec):
    inteiro = inteiro.replace(".", "")
    zeros = len(dec) - len(dec.lstrip("0"))
    resto = dec.lstrip("0")
    falado = " ".join(["zero"] * zeros + ([_n(resto)] if resto else []))
    return f"{_n(inteiro)} vírgula {falado}" if falado else _n(inteiro)


FEMININO = [(r"\bum\b", "uma"), (r"\bdois\b", "duas"), (r"entos\b", "entas")]
# Substantivos femininos que mais aparecem depois de número nas matérias (o resto fica no masculino).
FEM = (r"(?:vagas?|pessoas?|toneladas?|horas?|vezes|famílias?|escolas?|crianças?|mulheres|mulher|unidades?|cidades?|"
       r"empresas?|casas?|vítimas?|doses?|ruas?|obras?|semanas?|turmas?|inscrições|inscrição|moradias?|árvores?|mortes?)")


def _numero(s, feminino=False):
    """'1.200' -> mil e duzentos; '3,97' -> três vírgula noventa e sete. feminino: 'duzentas vagas', 'duas pessoas'."""
    if "," in s:
        i, d = s.split(",", 1)
        return _decimal(i, d)
    r = _n(s.replace(".", ""))
    if feminino:
        for a, b in FEMININO:
            r = re.sub(a, b, r)
    return r


ESCALAS = r"(milhões|milhão|bilhões|bilhão|trilhões|trilhão|mil)\b"
NUM = r"\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?"


def _reais(m, moeda_sing, moeda_pl):
    valor, escala = m.group(1), m.group(2)
    if escala:  # R$ 53,8 bilhões -> cinquenta e três vírgula oito bilhões de reais
        return f"{_numero(valor)} {escala} de {moeda_pl}"
    if "," in valor:
        i, c = valor.split(",", 1)
        i = i.replace(".", "")
        c = (c + "0")[:2]  # R$ 5,516 vira 5 reais e 51 centavos (fala arredonda para baixo, como o jornal)
        partes = []
        if int(i):
            partes.append(f"{_n(i)} {moeda_sing if int(i) == 1 else moeda_pl}")
        if int(c):
            partes.append(f"{_n(c)} {'centavo' if int(c) == 1 else 'centavos'}")
        return " e ".join(partes) or f"zero {moeda_pl}"
    i = valor.replace(".", "")
    return f"{_n(i)} {moeda_sing if int(i) == 1 else moeda_pl}"


ABREV = [
    (r"\bkm/h\b", "quilômetros por hora"), (r"\bkm\b", "quilômetros"), (r"\bkg\b", "quilos"),
    (r"\bmm\b", "milímetros"), (r"\bm²\b", "metros quadrados"), (r"\bºC\b|°C\b", " graus"),
    (r"\bSr\.", "senhor"), (r"\bSra\.", "senhora"), (r"\bDr\.", "doutor"), (r"\bDra\.", "doutora"),
    (r"\bnº\s*", "número "), (r"\bart\.\s*", "artigo "),
]


def falavel(t):
    t = t.replace(" ", " ")
    t = re.sub(r"\s*\((\d{1,2})\)", r", dia \1,", t)  # "sexta-feira (27)" -> "sexta-feira, dia 27,"
    for a, b in ABREV:
        t = re.sub(a, b, t)
    t = re.sub(rf"R\$\s*({NUM})(?:\s+{ESCALAS})?", lambda m: _reais(m, "real", "reais"), t)
    t = re.sub(rf"US\$\s*({NUM})(?:\s+{ESCALAS})?", lambda m: _reais(m, "dólar", "dólares"), t)
    t = re.sub(rf"€\s*({NUM})(?:\s+{ESCALAS})?", lambda m: _reais(m, "euro", "euros"), t)
    t = re.sub(rf"({NUM})\s*%", lambda m: f"{_numero(m.group(1))} por cento", t)
    t = re.sub(r"\b(\d{1,2})h(\d{2})\b", lambda m: f"{_n(m.group(1))} horas e {_n(m.group(2))}", t)
    t = re.sub(r"\b(\d{1,2})h\b", lambda m: f"{_n(m.group(1))} {'hora' if int(m.group(1)) == 1 else 'horas'}", t)
    t = re.sub(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", lambda m: f"{_n(m.group(1))} do {_n(m.group(2))} de {_n(m.group(3))}", t)
    t = re.sub(r"\b(\d+)º", lambda m: num2words(int(m.group(1)), lang="pt_BR", to="ordinal"), t)
    t = re.sub(r"\b(\d+)ª", lambda m: re.sub(r"o\b", "a", num2words(int(m.group(1)), lang="pt_BR", to="ordinal")), t)
    t = re.sub(rf"\b({NUM})(\s+(?:mil\s+)?{FEM}\b)", lambda m: _numero(m.group(1), True) + m.group(2), t)
    t = re.sub(rf"\b({NUM})\b", lambda m: _numero(m.group(1)), t)
    t = re.sub(r"[“”\"]", "", t)
    t = re.sub(r",\s*([,.;:])", r"\1", t)
    t = re.sub(r"\s+,", ",", re.sub(r"\s{2,}", " ", t))
    return t.strip()


if __name__ == "__main__":
    print(falavel(" ".join(sys.argv[1:]) or sys.stdin.read()))
