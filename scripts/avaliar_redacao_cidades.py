"""Compara a redação antiga (3 parágrafos a partir da manchete) com a nota curta nova,
nas MESMAS pautas reais do Google Notícias. Não grava nada no site.

    ROBO_OLLAMA_URL=http://127.0.0.1:11436 python scripts/avaliar_redacao_cidades.py 12

Métricas por versão: publicáveis (passam todas as travas), com enchimento, com nome que
não está na manchete, conteúdo novo médio, recusadas pela IA.
"""
import importlib.util
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("robo", os.path.join(RAIZ, "robo_cnb.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

n_cidades = int(sys.argv[1]) if len(sys.argv) > 1 else 10
random.seed(int(os.environ.get("SEMENTE", "7")))
cidades = random.sample(r.CIDADES, n_cidades)
hoje = datetime.now(timezone(timedelta(hours=-3))).strftime("%d/%m/%Y")

pautas = []
for slug, nome, query in cidades:
    for manchete, link, fonte in r.buscar_pautas_oficiais(nome, query, slug):
        pautas.append((slug, nome, manchete, link, fonte))
print(f"{len(pautas)} pautas de {n_cidades} cidades\n", flush=True)

res = {"antiga": [], "nova": []}
for slug, nome, manchete, link, fonte in pautas:
    print(f"== [{slug}] {manchete}", flush=True)
    for versao, fn in (("antiga", r.redigir_com_ia_antiga), ("nova", r.redigir_com_ia)):
        try:
            t, d, a = fn(nome, manchete, fonte, hoje)
        except Exception as e:  # JSON quebrado etc.
            res[versao].append({"erro": str(e)})
            print(f"   {versao}: ERRO {e}", flush=True)
            continue
        if not t or not a:
            res[versao].append({"recusada": True})
            print(f"   {versao}: IA recusou", flush=True)
            continue
        tudo = f"{t}\n{d}\n{a}"
        enchimento = r.tem_enchimento(tudo)
        nomes = r.nomes_novos(manchete, nome, fonte, tudo)
        novo = r.conteudo_novo(manchete, nome, fonte, tudo)
        fatos = r.checar_fatos(manchete, fonte, hoje, t, d, a, nome)
        if versao == "antiga":
            curto = len(a) < 380 or len(d) < 60
            barrada = fatos or ("curto" if curto else None)  # o que a versão antiga checava
        else:
            barrada = fatos or r.checar_redacao(manchete, nome, fonte, t, d, a) or ("curto" if len(a) < 120 or len(d) < 60 else None)
        res[versao].append({"enchimento": bool(enchimento), "nomes": nomes, "novo": novo, "barrada": barrada, "title": t, "artigo": a})
        print(f"   {versao}: {'PUB' if not barrada else 'BARRADA (' + barrada + ')'} · novo {novo:.0%}"
              f"{' · ench: ' + enchimento if enchimento else ''}{' · nomes: ' + ','.join(nomes) if nomes else ''}", flush=True)
        print(f"      {t}\n      {a[:260]}", flush=True)

print("\n=== RESUMO ===")
for versao, lst in res.items():
    ok = [x for x in lst if "title" in x]
    pub = [x for x in ok if not x["barrada"]]
    print(f"{versao}: {len(pub)}/{len(lst)} publicáveis · enchimento em {sum(x['enchimento'] for x in ok)}/{len(ok)}"
          f" · nome fora da manchete em {sum(bool(x['nomes']) for x in ok)}/{len(ok)}"
          f" · conteúdo novo médio {sum(x['novo'] for x in ok) / max(1, len(ok)):.0%}"
          f" · recusadas pela IA {sum(1 for x in lst if x.get('recusada'))} · erros {sum(1 for x in lst if 'erro' in x)}")
json.dump(res, open(os.environ.get("SAIDA", os.devnull), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
