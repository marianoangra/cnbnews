"""Limpa as matérias de cidades escritas no formato antigo (3 parágrafos a partir só da manchete).

O 2º e o 3º parágrafos eram enchimento por construção ("o que isso significa para os moradores",
"acompanhe os canais oficiais"). Este script:
  - mantém só as frases do 1º parágrafo sem enchimento + a cláusula de contraditório (se houver)
    + atribuição com link para a matéria original;
  - troca a description quando ela é enchimento;
  - separa as SUSPEITAS (sobrou nada, título com enchimento, ou título muito diferente da manchete
    original registrada no robo.log) para irem à fila de aprovação em vez de ficar no ar.

    python scripts/limpar_cidades_antigas.py ROBO_LOG [--aplicar SAIDA_SUSPEITAS]
Sem --aplicar só mostra o que faria.
"""
import importlib.util
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("robo", os.path.join(RAIZ, "robo_cnb.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

LIMITE_TITULO_NOVO = 0.6  # título com mais de 60% de palavras que não estão na manchete = suspeito


def manchetes_do_log(caminho):
    """[REDIGINDO slug] manchete (55 caracteres)... seguido de [OK] content/cidades/slug/arq.md"""
    mapa, ultima = {}, {}
    for linha in open(caminho, encoding="utf-8", errors="replace"):
        m = re.match(r"\[REDIGINDO ([\w-]+)\] (.*?)(\.\.\.)?\s*$", linha)
        if m:
            ultima[m.group(1)] = m.group(2)
            continue
        m = re.match(r"\[OK\] (content/cidades/([\w-]+)/[^\s]+\.md)", linha)
        if m and m.group(2) in ultima:
            mapa[m.group(1)] = ultima[m.group(2)]
    return mapa


def frases(p):
    return [f.strip() for f in re.split(r"(?<=[.!?])\s+", p.strip()) if f.strip()]


def campo(fm, chave):
    m = re.search(rf'^{chave}:\s*"(.*)"\s*$', fm, re.M)
    return m.group(1).replace('\\"', '"') if m else ""


def processar(caminho, manchete, nome_cidade):
    bruto = open(caminho, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", bruto, re.S)
    if not m:
        return None
    fm, corpo = m.group(1), m.group(2).strip()
    if "[Leia a matéria original]" in corpo:
        return None  # já no formato novo
    title, desc, fonte, url = campo(fm, "title"), campo(fm, "description"), campo(fm, "fonte"), campo(fm, "fonte_url")
    paragrafos = [p.strip() for p in corpo.split("\n\n") if p.strip()]
    contraditorio = [p for p in paragrafos if r.CLAUSULA_CONTRADITORIO[:40] in p]
    texto = [p for p in paragrafos if p not in contraditorio]
    p1 = texto[0] if texto else ""
    # Frase com enchimento: corta no começo do enchimento ("Lorena lançou edital, visando garantir..."
    # → "Lorena lançou edital."). Se o que sobra é curto demais, a frase sai inteira.
    # Só a 1ª frase (o fato principal, a mais próxima da manchete): as seguintes eram explicação
    # inventada ("esse serviço é fundamental para..."). Com enchimento, corta na última vírgula
    # antes dele; sem vírgula, a frase sai (e a matéria vira suspeita).
    mantidas = []
    primeira = (frases(p1) or [""])[0]
    e = r._RE_ENCHIMENTO.search(primeira)
    if primeira and not e:
        mantidas.append(primeira)
    elif e:
        antes = primeira[: e.start()]
        if "," in antes and len(antes.rsplit(",", 1)[0].strip()) >= 50:
            mantidas.append(antes.rsplit(",", 1)[0].strip().rstrip(".") + ".")
    motivos = []
    if manchete and (len(r.normalizar(manchete).split()) < 5 or re.search(r"\b(home|inicio|portal|diario oficial)\b", r.normalizar(manchete))):
        motivos.append(f"a 'manchete' era título de página, não notícia ({manchete})")
    if not mantidas:
        motivos.append("1º parágrafo só tinha enchimento")
    if r.tem_enchimento(title):
        motivos.append(f"título com enchimento ('{r.tem_enchimento(title)}')")
    if manchete:
        novo = r.conteudo_novo(manchete, nome_cidade, fonte, title)
        if novo > LIMITE_TITULO_NOVO:
            motivos.append(f"título longe da manchete original ({novo:.0%} de palavras novas; manchete: {manchete})")
    nova_desc = desc
    if r.tem_enchimento(desc) and mantidas:
        nova_desc = mantidas[0]
        if len(nova_desc) > 160:
            nova_desc = nova_desc[:157].rsplit(" ", 1)[0] + "…"
    novo_corpo = " ".join(mantidas)
    if contraditorio:
        novo_corpo += "\n\n" + contraditorio[0]
    novo_corpo += f"\n\n*A informação é de {fonte or 'veículo local'}." + (f" [Leia a matéria original]({url}).*" if url else "*")
    fm2 = fm
    if nova_desc != desc:
        fm2 = re.sub(r'^description:.*$', "description: " + json.dumps(nova_desc, ensure_ascii=False), fm2, count=1, flags=re.M)
    return {
        "caminho": caminho,
        "antes": len(corpo),
        "depois": len(novo_corpo),
        "suspeita": motivos,
        "markdown": f"---\n{fm2}\n---\n\n{novo_corpo}\n",
        "titulo": title,
    }


def main():
    log = sys.argv[1]
    aplicar = "--aplicar" in sys.argv
    saida = sys.argv[sys.argv.index("--aplicar") + 1] if aplicar else None
    mapa = manchetes_do_log(log)
    base = os.path.join(RAIZ, "content", "cidades")
    nomes = {slug: nome for slug, nome, _ in r.CIDADES}
    res = []
    for slug in sorted(os.listdir(base)):
        d = os.path.join(base, slug)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".md") or f == "_index.md":
                continue
            rel = f"content/cidades/{slug}/{f}"
            x = processar(os.path.join(d, f), mapa.get(rel, ""), nomes.get(slug, slug))
            if x:
                x["rel"], x["slug"] = rel, slug
                res.append(x)
    susp = [x for x in res if x["suspeita"]]
    print(f"{len(res)} matérias no formato antigo · {len(mapa)} com manchete no log · {len(susp)} suspeitas")
    print(f"tamanho médio do texto: {sum(x['antes'] for x in res) // max(1, len(res))} → {sum(x['depois'] for x in res) // max(1, len(res))} caracteres")
    for x in susp:
        print(f"  SUSPEITA {x['rel'][16:80]} · {'; '.join(x['suspeita'])[:160]}")
    if not aplicar:
        return
    os.makedirs(saida, exist_ok=True)
    for x in res:
        if x["suspeita"]:
            # vai para a fila (na rig): sai do site, Rafael decide no painel
            fm_extra = 'score_sensibilidade: 3\nrequer_aprovacao_humana: true\nmotivos_revisao:\n' + "".join(
                f"  - {json.dumps('revisão do formato antigo: ' + m, ensure_ascii=False)}\n" for m in x["suspeita"]
            ) + 'retirada_do_site: "2026-11-27 (texto antigo com suspeita de fato inventado)"\n'
            md = x["markdown"].replace("\n---\n\n", "\n" + fm_extra + "---\n\n", 1)
            os.makedirs(os.path.join(saida, x["slug"]), exist_ok=True)
            open(os.path.join(saida, x["slug"], os.path.basename(x["caminho"])), "w", encoding="utf-8").write(md)
            os.remove(x["caminho"])
        else:
            open(x["caminho"], "w", encoding="utf-8").write(x["markdown"])
    print(f"aplicado: {len(res) - len(susp)} limpas no site, {len(susp)} movidas para {saida}")


if __name__ == "__main__":
    main()
