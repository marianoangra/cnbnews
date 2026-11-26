import os, re, time, json, random, urllib.request, urllib.parse, unicodedata, subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

CIDADES = [
    ("pelotas", "Pelotas (RS)", "Pelotas RS"),
    ("londrina", "Londrina (PR)", "Londrina PR"),
    ("maringa", "Maringá (PR)", "Maringa PR"),
    ("vitoria-es", "Vitória (ES)", "Vitoria ES"),
    ("angra-dos-reis", "Angra dos Reis (RJ)", "Angra dos Reis RJ"),
    ("paraty", "Paraty (RJ)", "Paraty RJ"),
    ("lorena", "Lorena (SP)", "Lorena SP"),
    ("cachoeira-paulista", "Cachoeira Paulista (SP)", "Cachoeira Paulista SP"),
    ("cruzeiro-sp", "Cruzeiro (SP)", "Cruzeiro SP"),
    ("lavras-mg", "Lavras (MG)", "Lavras MG"),
    ("taubate", "Taubaté (SP)", "Taubate SP"),
    ("sao-jose-dos-campos", "São José dos Campos (SP)", "Sao Jose dos Campos SP"),
    ("resende", "Resende (RJ)", "Resende RJ"),
    ("macae", "Macaé (RJ)", "Macae RJ"),
    ("campos-dos-goytacazes", "Campos dos Goytacazes (RJ)", "Campos dos Goytacazes RJ"),
    ("caraguatatuba", "Caraguatatuba (SP)", "Caraguatatuba SP"),
    ("ilhabela", "Ilhabela (SP)", "Ilhabela SP"),
    ("sao-sebastiao", "São Sebastião (SP)", "Sao Sebastiao SP"),
    ("ubatuba", "Ubatuba (SP)", "Ubatuba SP"),
    ("mangaratiba", "Mangaratiba (RJ)", "Mangaratiba RJ"),
    ("itaguai", "Itaguaí (RJ)", "Itaguai RJ"),
    ("cabo-frio", "Cabo Frio (RJ)", "Cabo Frio RJ"),
    ("armacao-dos-buzios", "Armação dos Búzios (RJ)", "Armacao dos Buzios RJ"),
    ("arraial-do-cabo", "Arraial do Cabo (RJ)", "Arraial do Cabo RJ"),
    ("sao-pedro-da-aldeia", "São Pedro da Aldeia (RJ)", "Sao Pedro da Aldeia RJ"),
    ("rio-das-ostras", "Rio das Ostras (RJ)", "Rio das Ostras RJ"),
    ("sao-joao-da-barra", "São João da Barra (RJ)", "Sao Joao da Barra RJ"),
    ("quissama", "Quissamã (RJ)", "Quissama RJ"),
    ("curitiba", "Curitiba (PR)", "Curitiba PR"),
    ("foz-do-iguacu", "Foz do Iguaçu (PR)", "Foz do Iguaçu PR"),
    ("cascavel", "Cascavel (PR)", "Cascavel PR"),
    ("ponta-grossa", "Ponta Grossa (PR)", "Ponta Grossa PR"),
    ("paranagua", "Paranaguá (PR)", "Paranagua PR"),
    ("francisco-beltrao", "Francisco Beltrão (PR)", "Francisco Beltrao PR"),
    ("campo-largo", "Campo Largo (PR)", "Campo Largo PR"),
    ("almirante-tamandare", "Almirante Tamandaré (PR)", "Almirante Tamandare PR"),
    ("pitanga", "Pitanga (PR)", "Pitanga PR"),
    ("manoel-ribas", "Manoel Ribas (PR)", "Manoel Ribas PR"),
    ("prudentopolis", "Prudentópolis (PR)", "Prudentopolis PR"),
    ("guaira", "Guaíra (PR)", "Guaira PR"),
    ("reboucas", "Rebouças (PR)", "Reboucas PR"),
    ("capanema", "Capanema (PR)", "Capanema PR"),
]

STOPWORDS = {
    "para", "com", "sobre", "pela", "pelo", "mais", "nova", "novo",
    "prefeitura", "municipal", "cidade", "nesta", "neste", "apos",
    "entre", "como", "sera", "esta", "sao", "dos", "das", "nos", "nas"
}

TITULOS_GENERICOS_BLOQUEADOS = (
    "inicio", "home", "portal", "atendimento", "contato", "sobre",
    "webmail", "diario oficial", "transparencia", "ouvidoria", "login",
    "acesso", "servicos", "secretaria", "central de", "consulta"
)

def normalizar(txt):
    t = unicodedata.normalize("NFKD", str(txt)).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"\s+", " ", t).strip()

def slugify(texto):
    texto = normalizar(texto)
    texto = re.sub(r"[^a-z0-9]+", "-", texto).strip("-")
    return texto[:65].rstrip("-") or "noticia"

def extrair_palavras_chave(texto):
    t = normalizar(texto)
    return {p for p in re.findall(r"[a-z]{4,}", t) if p not in STOPWORDS}

def eh_duplicada(pasta, titulo_novo):
    chaves_novas = extrair_palavras_chave(titulo_novo)
    if len(chaves_novas) < 2:
        return True
    arquivos = sorted([f for f in os.listdir(pasta) if f.endswith(".md") and f != "_index.md"], reverse=True)[:50]
    for arq in arquivos:
        chaves_existentes = extrair_palavras_chave(arq)
        if not chaves_existentes:
            continue
        intersecao = chaves_novas.intersection(chaves_existentes)
        if len(intersecao) / min(len(chaves_novas), len(chaves_existentes)) >= 0.50:
            return True
    return False

def pauta_eh_valida_para_cidade(cidade_nome, manchete):
    cidade_pura = cidade_nome.split("(")[0].strip()
    c_norm = normalizar(cidade_pura)
    m_norm = normalizar(manchete)
    if c_norm not in m_norm:
        return False
    if len(m_norm.split()) < 5:
        return False
    for bloq in TITULOS_GENERICOS_BLOQUEADOS:
        if m_norm.startswith(bloq):
            return False
    if "prefeitura de " in m_norm and f"prefeitura de {c_norm}" not in m_norm:
        return False
    return True

def limpar_texto_ia(txt):
    txt = re.sub(r"\b2\.0(2[0-9]|3[0-9])\b", r"20\1", txt)
    txt = re.sub(r"\((\d)\.(\d)\)", r"(\1\2)", txt)
    txt = re.sub(r"\s[-|]\s(MEON|ge|spriomais|Nova Concursos|JC Concursos|Estratégia Concursos|Central de Concursos|G1|UOL|R7|Terra|CNN|Folha|Estadão).*$", "", txt, flags=re.I)
    txt = re.sub(r"(^|\n)\s*\d+\.\s+", r"\1", txt)
    return txt.strip()

def buscar_pautas_oficiais(cidade_nome, query_cidade):
    hdr = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}
    cidade_pura = cidade_nome.split("(")[0].strip()
    consultas = [
        f'"{cidade_pura}" prefeitura OR obras OR saude OR concurso OR policia when:7d',
        f'"{cidade_pura}" noticias OR edital OR transito OR educacao when:7d'
    ]
    itens, vistos = [], set()
    for q in consultas:
        time.sleep(random.uniform(2.0, 3.5))
        try:
            url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(q) + "&hl=pt-BR&gl=BR&ceid=BR:pt-419"
            xml_data = urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=15).read()
            root = ET.fromstring(xml_data)
            for item in root.findall(".//item")[:8]:
                t = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                src = item.find("source")
                fonte = (src.text if src is not None and src.text else "Portal de Notícias").strip()
                t_limpo = t.rsplit(" - ", 1)[0].strip() if " - " in t else t
                t_limpo = t_limpo.rsplit(" | ", 1)[0].strip() if " | " in t_limpo else t_limpo
                if not t_limpo or t_limpo in vistos:
                    continue
                vistos.add(t_limpo)
                if pauta_eh_valida_para_cidade(cidade_nome, t_limpo):
                    itens.append((t_limpo, link, fonte))
                else:
                    print(f"[FILTRO] Descartando pauta sem foco local: {t_limpo[:55]}...", flush=True)
        except Exception as e:
            print(f"[AVISO RSS] {e}", flush=True)
            if "429" in str(e):
                time.sleep(30)
    return itens[:3]

def redigir_com_ia(cidade_nome, manchete, fonte, data_hoje):
    cidade_pura = cidade_nome.split("(")[0].strip()
    prompt = f"""Você é editor-chefe de jornalismo local no Brasil. Hoje é {data_hoje}.
Reescreva a notícia abaixo exclusivamente com base nos fatos da manchete sobre {cidade_nome}.

Manchete original: "{manchete}"
Veículo/Fonte: {fonte}

REGRAS ANTI-ALUCINAÇÃO (OBRIGATÓRIAS):
- Se a manchete NÃO for uma notícia real ocorrida em {cidade_nome} (por exemplo, página institucional, login, atendimento genérico ou notícia de outra cidade), responda APENAS: {{"valido": false}}
- NUNCA invente datas (como dias da semana ou meses diferentes de {data_hoje}), números, leis, nomes de programas ou prefeituras de outras cidades.
- Use estritamente o que está implícito na manchete e o contexto jornalístico factual de {cidade_nome}.

FORMATO DE SAÍDA (JSON válido):
- "valido": true
- "title": Título jornalístico claro e objetivo (55 a 85 caracteres), mencionando {cidade_pura}.
- "description": Lide em 1 frase objetiva (110 a 170 caracteres) sem repetir o título.
- "artigo": Texto jornalístico em 3 parágrafos curtos e bem escritos (500 a 800 caracteres no total), separados por quebra de linha dupla (\\n\\n):
  1º parágrafo: O fato principal ocorrido em {cidade_nome}.
  2º parágrafo: Impacto prático e orientações gerais para os moradores da cidade.
  3º parágrafo: Registro da fonte ({fonte}) e recomendação para acompanhar atualizações oficiais.

Responda EXCLUSIVAMENTE o JSON válido."""

    payload = json.dumps({
        "model": "qwen3:4b",
        "prompt": prompt,
        "stream": False,
        "think": False,
        "format": "json",
        "options": {"temperature": 0.15, "top_p": 0.85, "repeat_penalty": 1.15, "num_ctx": 4096}
    }).encode("utf-8")

    req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=payload, headers={"Content-Type": "application/json"})
    # 600 s: logo após o boot o qwen3:4b leva >90 s para sair do pendrive para a GPU;
    # se o cliente desiste antes, o Ollama ABORTA o carregamento e o ciclo nunca termina.
    resp = json.loads(urllib.request.urlopen(req, timeout=600).read().decode("utf-8"))
    dados = json.loads(resp["response"])
    if not dados.get("valido", True):
        return None, None, None
    return (
        limpar_texto_ia(dados["title"]),
        limpar_texto_ia(dados["description"]),
        limpar_texto_ia(dados["artigo"])
    )

def atualizar_sitemap_e_git(novos):
    urls = [
        "https://cnbmobile.com/",
        "https://cnbmobile.com/sobre/",
        "https://cnbmobile.com/privacidade/",
        "https://cnbmobile.com/termos/",
        "https://cnbmobile.com/contato/"
    ]
    for root_dir, _, files in os.walk("content/cidades"):
        c_slug = os.path.basename(root_dir)
        if c_slug == "cidades":
            continue
        urls.append(f"https://{c_slug}.news.cnbmobile.com/")
        for f in sorted(files, reverse=True):
            if f.endswith(".md") and f != "_index.md":
                urls.append(f"https://{c_slug}.news.cnbmobile.com/{f[:-3]}/")

    sm = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
        + "\n</urlset>\n"
    )
    with open("static/sitemap.xml", "w", encoding="utf-8") as f_sm:
        f_sm.write(sm)

    subprocess.run(["git", "add", "content/", "static/sitemap.xml"], check=False)
    subprocess.run(["git", "commit", "-m", f"chore(news): publica {novos} noticias e atualiza sitemap"], check=False)
    subprocess.run(["git", "pull", "--rebase", "--autostash", "origin", "main"], check=False)
    subprocess.run(["git", "push", "origin", "main"], check=False)
    print(f"[SYNC] {novos} noticias enviadas para GitHub/Vercel!", flush=True)

def rodar_ciclo():
    tz = timezone(timedelta(hours=-3))
    novos = 0
    for slug, nome, query in CIDADES:
        pasta = f"content/cidades/{slug}"
        os.makedirs(pasta, exist_ok=True)
        idx = f"{pasta}/_index.md"
        if not os.path.exists(idx):
            with open(idx, "w", encoding="utf-8") as f_idx:
                f_idx.write(f'---\ntitle: "{nome}"\n---\n')

        print(f"[CIDADE] Coletando pautas de {nome}...", flush=True)
        for manchete, link, fonte in buscar_pautas_oficiais(nome, query):
            if eh_duplicada(pasta, manchete):
                print(f"[DUPLICADA] Ignorando: {manchete[:50]}...", flush=True)
                continue
            print(f"[REDIGINDO {slug}] {manchete[:55]}...", flush=True)
            try:
                agora = datetime.now(tz) - timedelta(minutes=novos * 7)
                title, desc, texto = redigir_com_ia(nome, manchete, fonte, agora.strftime("%d/%m/%Y"))
                if not title or not texto:
                    print("[IA REJEITOU] Pauta considerada invalida/nao-local pela IA.", flush=True)
                    continue
                low_check = (title + " " + texto).lower()
                if len(texto) < 380 or len(desc) < 60 or any(w in low_check for w in [" the ", " with ", " from ", " are ", "<think>", "oitos", "oitavos"]):
                    print("[DESCARTADO] Texto curto ou fora do padrao pt-BR.", flush=True)
                    continue
                arq = f"{pasta}/{agora.strftime('%Y-%m-%d')}-{slugify(title)}.md"
                md = (
                    f'---\n'
                    f'title: "{title.replace(chr(34), chr(92)+chr(34))}"\n'
                    f'date: {agora.isoformat()}\n'
                    f'description: "{desc.replace(chr(34), chr(92)+chr(34))}"\n'
                    f'fonte: "{fonte.replace(chr(34), chr(92)+chr(34))}"\n'
                    f'fonte_url: "{link}"\n'
                    f'---\n\n{texto}\n'
                )
                with open(arq, "w", encoding="utf-8") as f_out:
                    f_out.write(md)
                print(f"[OK] {arq}", flush=True)
                novos += 1
                time.sleep(2)
            except Exception as e:
                print(f"[ERRO] {e}", flush=True)

    if novos > 0:
        atualizar_sitemap_e_git(novos)

if __name__ == "__main__":
    os.chdir("/home/rafael/cnbnews")
    while True:
        rodar_ciclo()
        print("[PAUSA] Aguardando 45 minutos para o proximo ciclo...", flush=True)
        time.sleep(2700)
