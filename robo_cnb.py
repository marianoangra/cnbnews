import os, re, time, json, urllib.request, urllib.parse, unicodedata, subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

CIDADES = [
    ("pelotas", "Pelotas (RS)", "Pelotas RS"),
    ("londrina", "Londrina (PR)", "Londrina PR"),
    ("maringa", "Maringá (PR)", "Maringa PR"),
    ("vitoria-es", "Vitória (ES)", "Vitoria ES Prefeitura"),
    ("angra-dos-reis", "Angra dos Reis (RJ)", "Angra dos Reis RJ"),
    ("paraty", "Paraty (RJ)", "Paraty RJ"),
    ("lorena", "Lorena (SP)", "Lorena SP Prefeitura"),
    ("cachoeira-paulista", "Cachoeira Paulista (SP)", "Cachoeira Paulista SP Prefeitura"),
    ("cruzeiro-sp", "Cruzeiro (SP)", "Cruzeiro SP Prefeitura"),
    ("lavras-mg", "Lavras (MG)", "Lavras MG Prefeitura"),
    ("taubate", "Taubaté (SP)", "Taubate SP Prefeitura"),
    ("sao-jose-dos-campos", "São José dos Campos (SP)", "Sao Jose dos Campos SP"),
    ("resende", "Resende (RJ)", "Resende RJ Prefeitura"),
    ("macae", "Macaé (RJ)", "Macae RJ Prefeitura"),
    ("campos-dos-goytacazes", "Campos dos Goytacazes (RJ)", "Campos dos Goytacazes RJ"),
    ("caraguatatuba", "Caraguatatuba (SP)", "Caraguatatuba SP Prefeitura"),
    ("ilhabela", "Ilhabela (SP)", "Ilhabela SP Prefeitura"),
    ("sao-sebastiao", "São Sebastião (SP)", "Sao Sebastiao SP Prefeitura"),
    ("ubatuba", "Ubatuba (SP)", "Ubatuba SP Prefeitura"),
    ("mangaratiba", "Mangaratiba (RJ)", "Mangaratiba RJ Prefeitura"),
    ("itaguai", "Itaguaí (RJ)", "Itaguai RJ Prefeitura"),
    ("cabo-frio", "Cabo Frio (RJ)", "Cabo Frio RJ Prefeitura"),
    ("armacao-dos-buzios", "Armação dos Búzios (RJ)", "Armacao dos Buzios RJ Prefeitura"),
    ("arraial-do-cabo", "Arraial do Cabo (RJ)", "Arraial do Cabo RJ Prefeitura"),
    ("sao-pedro-da-aldeia", "São Pedro da Aldeia (RJ)", "Sao Pedro da Aldeia RJ Prefeitura"),
    ("rio-das-ostras", "Rio das Ostras (RJ)", "Rio das Ostras RJ Prefeitura"),
    ("sao-joao-da-barra", "São João da Barra (RJ)", "Sao Joao da Barra RJ Prefeitura"),
    ("quissama", "Quissamã (RJ)", "Quissama RJ Prefeitura"),
]

STOPWORDS = {
    "para", "com", "sobre", "pela", "pelo", "mais", "nova", "novo",
    "prefeitura", "municipal", "cidade", "nesta", "neste", "apos",
    "entre", "como", "sera", "esta", "sao", "dos", "das", "nos", "nas"
}

def slugify(texto):
    texto = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode("ascii")
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto[:65].rstrip("-") or "noticia"

def extrair_palavras_chave(texto):
    t = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode("ascii").lower()
    return {p for p in re.findall(r"[a-z]{4,}", t) if p not in STOPWORDS}

def eh_duplicada(pasta, titulo_novo):
    chaves_novas = extrair_palavras_chave(titulo_novo)
    if len(chaves_novas) < 2:
        return True
    arquivos = sorted([f for f in os.listdir(pasta) if f.endswith(".md") and f != "_index.md"], reverse=True)[:40]
    for arq in arquivos:
        chaves_existentes = extrair_palavras_chave(arq)
        if not chaves_existentes:
            continue
        intersecao = chaves_novas.intersection(chaves_existentes)
        if len(intersecao) / min(len(chaves_novas), len(chaves_existentes)) >= 0.55:
            return True
    return False

def limpar_texto_ia(txt):
    txt = re.sub(r"\b2\.0(2[0-9]|3[0-9])\b", r"20\1", txt)
    txt = re.sub(r"\((\d)\.(\d)\)", r"(\1\2)", txt)
    txt = re.sub(r"\s[-|]\s(MEON|ge|spriomais|Nova Concursos|JC Concursos|Estratégia Concursos|Central de Concursos|G1|UOL|R7|Terra).*$", "", txt, flags=re.I)
    txt = re.sub(r"(^|\n)\s*\d+\.\s+", r"\1", txt)
    return txt.strip()

def buscar_pautas_oficiais(query_cidade):
    hdr = {"User-Agent": "Mozilla/5.0"}
    consultas = [
        f"{query_cidade} site:gov.br",
        f"{query_cidade} concurso OR edital OR saude OR obras OR prefeitura"
    ]
    itens, vistos = [], set()
    for q in consultas:
        try:
            url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(q) + "&hl=pt-BR&gl=BR&ceid=BR:pt-419"
            xml_data = urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=12).read()
            root = ET.fromstring(xml_data)
            for item in root.findall(".//item")[:5]:
                t = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                src = item.find("source")
                fonte = (src.text if src is not None else "Portal Oficial").strip()
                t_limpo = t.rsplit(" - ", 1).strip() if " - " in t else t
                t_limpo = t_limpo.rsplit(" | ", 1).strip() if " | " in t_limpo else t_limpo
                if t_limpo and t_limpo not in vistos:
                    vistos.add(t_limpo)
                    itens.append((t_limpo, link, fonte))
        except Exception as e:
            print(f"[AVISO RSS] {e}", flush=True)
    return itens[:3]

def redigir_com_ia(cidade_nome, manchete, fonte):
    prompt = f"""Você é editor-chefe de jornalismo local e utilidade pública no Brasil.
Reescreva a pauta abaixo sobre {cidade_nome} em Português do Brasil (pt-BR) culto, direto e informativo, no padrão de grandes portais de notícias.

Pauta original: "{manchete}"
Fonte oficial: {fonte}

DIRETRIZES DE QUALIDADE JORNALÍSTICA:
1. "title": Título jornalístico claro, atraente e objetivo (60 a 85 caracteres). Nunca inclua o nome de outros sites no título.
2. "description": Lide jornalístico em 1 frase informativa (120 a 180 caracteres) que complemente o título sem repeti-lo palavra por palavra.
3. "artigo": Texto completo com exatamente 3 parágrafos bem estruturados (total entre 550 e 900 caracteres), separados por quebra de linha dupla (

):
   - 1º parágrafo: O fato principal (o quê, onde em {cidade_nome}, quem realiza e qual o objetivo prático para o morador).
   - 2º parágrafo: Detalhes de funcionamento, importância do serviço/ação para a comunidade local e orientações gerais ao cidadão.
   - 3º parágrafo: Contexto institucional e recomendação para que os interessados acompanhem os canais oficiais de {cidade_nome} ({fonte}) para prazos e atualizações.
4. PROIBIÇÕES ESTRITAS:
   - NUNCA use clichês repetitivos como "visando estimular a participação cidadã" ou "enriquecer a vida cultural".
   - NUNCA use listas numeradas (1., 2., 3.) ou marcadores.
   - NUNCA coloque ponto em anos (escreva 2026, jamais 2.026).
   - NUNCA invente números de telefone, endereços, valores ou datas que não estejam na pauta.

Responda EXCLUSIVAMENTE um objeto JSON válido com as chaves: "title", "description" e "artigo"."""

    payload = json.dumps({
        "model": "qwen3:4b",
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.35, "top_p": 0.9, "repeat_penalty": 1.15, "num_ctx": 4096}
    }).encode("utf-8")

    req = urllib.request.Request("http://127.0.0", data=payload, headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=180).read().decode("utf-8"))
    dado = json.loads(resp.get("response", "{}"))
    return (
        limpar_texto_ia(str(dado.get("title") or manchete)),
        limpar_texto_ia(str(dado.get("description") or "")),
        limpar_texto_ia(str(dado.get("artigo") or dado.get("conteudo") or ""))
    )

def atualizar_sitemap_e_git(novos):
    urls = [
        "https://cnbmobile.com",
        "https://cnbmobile.comsobre/",
        "https://cnbmobile.comprivacidade/",
        "https://cnbmobile.comtermos/",
        "https://cnbmobile.comcontato/"
    ]
    for root_dir, _, files in os.walk("content/cidades"):
        c_slug = os.path.basename(root_dir)
        if c_slug == "cidades":
            continue
        urls.append(f"https://{c_slug}://")
        for f in sorted(files, reverse=True):
            if f.endswith(".md") and f != "_index.md":
                urls.append(f"https://{c_slug}://{f[:-3]}/")

    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://sitemaps.org">\n' + "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls) + "\n</urlset>\n"
    with open("static/sitemap.xml", "w", encoding="utf-8") as f_sm:
        f_sm.write(sm)

    subprocess.run(["git", "add", "content/", "layouts/", "static/sitemap.xml"], check=False)
    subprocess.run(["git", "commit", "-m", f"chore(news): publica {novos} noticias e atualiza SEO/Google"], check=False)
    subprocess.run(["git", "pull", "--rebase"], check=False)
    subprocess.run(["git", "push"], check=False)
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
        for manchete, link, fonte in buscar_pautas_oficiais(query):
            if eh_duplicada(pasta, manchete):
                print(f"[DUPLICADA] Ignorando: {manchete[:50]}...", flush=True)
                continue
            print(f"[REDIGINDO {slug}] {manchete[:55]}...", flush=True)
            try:
                title, desc, texto = redigir_com_ia(nome, manchete, fonte)
                low_check = (title + " " + texto).lower()
                if len(texto) < 380 or len(desc) < 60 or any(w in low_check for w in [" the ", " with ", " from ", " are ", "<think>"]):
                    print("[DESCARTADO] Texto curto ou fora do padrao pt-BR.", flush=True)
                    continue
                agora = datetime.now(tz) - timedelta(minutes=novos * 7)
                arq = f"{pasta}/{agora.strftime('%Y-%m-%d')}-{slugify(title)}.md"
                md = f'---\ntitle: "{title.replace(chr(34), chr(92)+chr(34))}"\ndate: {agora.isoformat()}\ndescription: "{desc.replace(chr(34), chr(92)+chr(34))}"\nfonte: "{fonte.replace(chr(34), chr(92)+chr(34))}"\nfonte_url: "{link}"\n---\n\n{texto}\n'
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
