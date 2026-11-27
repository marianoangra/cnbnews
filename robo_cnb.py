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
    # Vale do Paraíba paulista (27/11/2026)
    ("jacarei", "Jacareí (SP)", "Jacarei SP"),
    ("cacapava", "Caçapava (SP)", "Cacapava SP"),
    ("pindamonhangaba", "Pindamonhangaba (SP)", "Pindamonhangaba SP"),
    ("tremembe", "Tremembé (SP)", "Tremembe SP"),
    ("guaratingueta", "Guaratinguetá (SP)", "Guaratingueta SP"),
    ("aparecida", "Aparecida (SP)", "Aparecida SP"),
    ("potim", "Potim (SP)", "Potim SP"),
    ("roseira", "Roseira (SP)", "Roseira SP"),
    ("canas", "Canas (SP)", "Canas SP"),
    ("piquete", "Piquete (SP)", "Piquete SP"),
    ("lavrinhas", "Lavrinhas (SP)", "Lavrinhas SP"),
    ("queluz", "Queluz (SP)", "Queluz SP"),
    ("silveiras", "Silveiras (SP)", "Silveiras SP"),
    ("areias", "Areias (SP)", "Areias SP"),
    ("sao-jose-do-barreiro", "São José do Barreiro (SP)", "Sao Jose do Barreiro SP"),
    ("arapei", "Arapeí (SP)", "Arapei SP"),
    ("bananal", "Bananal (SP)", "Bananal SP"),
    ("campos-do-jordao", "Campos do Jordão (SP)", "Campos do Jordao SP"),
    ("santo-antonio-do-pinhal", "Santo Antônio do Pinhal (SP)", "Santo Antonio do Pinhal SP"),
    ("sao-bento-do-sapucai", "São Bento do Sapucaí (SP)", "Sao Bento do Sapucai SP"),
    ("monteiro-lobato", "Monteiro Lobato (SP)", "Monteiro Lobato SP"),
    ("santa-branca", "Santa Branca (SP)", "Santa Branca SP"),
    ("igarata", "Igaratá (SP)", "Igarata SP"),
    ("paraibuna", "Paraibuna (SP)", "Paraibuna SP"),
    ("jambeiro", "Jambeiro (SP)", "Jambeiro SP"),
    ("redencao-da-serra", "Redenção da Serra (SP)", "Redencao da Serra SP"),
    ("natividade-da-serra", "Natividade da Serra (SP)", "Natividade da Serra SP"),
    ("sao-luiz-do-paraitinga", "São Luiz do Paraitinga (SP)", "Sao Luiz do Paraitinga SP"),
    ("lagoinha", "Lagoinha (SP)", "Lagoinha SP"),
    ("cunha", "Cunha (SP)", "Cunha SP"),
]

# Nome que também é sobrenome, palavra comum ou outra cidade (Eduardo Cunha, "areias",
# Aparecida de Goiânia, Caçapava do Sul, bairro Tremembé em SP, o escritor Monteiro Lobato).
# Para essas, a manchete precisa trazer o nome como LUGAR ("em Cunha", "de Areias",
# "Cunha (SP)", "Cunha-SP") — ou a fonte ser da própria cidade.
# Sem artigo de propósito: nenhum desses municípios usa artigo ("em Cunha", não "no Cunha").
CIDADES_AMBIGUAS = {
    "aparecida": r"aparecida (de goiania|do taboado|do rio negro)|nossa senhora aparecida|n\. ?sra\.? aparecida",
    "areias": "", "bananal": "", "canas": "", "cunha": "", "lagoinha": "", "potim": "",
    "piquete": "", "queluz": "", "roseira": "", "silveiras": "", "jambeiro": "", "lavrinhas": "",
    "paraibuna": "",
    "tremembe": "",  # "do Tremembé"/"no Tremembé" (com artigo) é o bairro de SP
    "monteiro-lobato": r"(livros?|obras?|contos?|personagens?|autor|escritor|sitio do picapau|legado|centenario) (de|do) monteiro lobato", "cacapava": r"cacapava do sul",
}

def nome_como_lugar(slug, cidade_pura, manchete):
    c = re.escape(normalizar(cidade_pura))
    m = normalizar(manchete)
    neg = CIDADES_AMBIGUAS.get(slug, "")
    if neg and re.search(neg, m):
        return False
    return bool(re.search(
        rf"\b(em|de|para|prefeitura de|camara de|cidade de|municipio de)\s+{c}\b"
        rf"|\b{c}\s*(\(sp\)|[-/,]\s*sp\b)", m))

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

def extrair_palavras_chave(texto, ignorar=""):
    """Palavras de 4+ letras sem stopwords. `ignorar` = nome da cidade: aparece em
    todo título da pasta e inflava a semelhança (falso duplicado e falso inédito)."""
    t = normalizar(texto)
    fora = STOPWORDS | set(re.findall(r"[a-z]{4,}", normalizar(ignorar)))
    return {p for p in re.findall(r"[a-z]{4,}", t) if p not in fora}

def _ler_front_matter(caminho):
    """(title, fonte_url) do front matter de uma matéria já gravada."""
    title, url = "", ""
    try:
        with open(caminho, encoding="utf-8") as f:
            for i, linha in enumerate(f):
                if i > 30 or (i > 0 and linha.startswith("---")):
                    break
                if linha.startswith("title:"):
                    title = linha[6:].strip().strip('"')
                elif linha.startswith("fonte_url:"):
                    url = linha[10:].strip().strip('"')
    except OSError:
        pass
    return title, url

def eh_duplicada(pasta, titulo_novo, fonte_url="", cidade=""):
    """Compara com os TÍTULOS gravados (front matter), não só com o nome do arquivo,
    que corta em 65 caracteres. Chamada duas vezes: com a manchete da fonte e,
    depois da IA, com o título reescrito (as duas versões da mesma pauta escapavam)."""
    chaves_novas = extrair_palavras_chave(titulo_novo, cidade)
    if len(chaves_novas) < 2:
        return True
    # também olha a fila de aprovação: senão a mesma pauta sensível é regerada a cada ciclo
    fila = os.path.join(FILA_APROVACAO, os.path.basename(pasta))
    arquivos = []
    for d in (pasta, fila):
        if os.path.isdir(d):
            arquivos += [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".md") and f != "_index.md"]
    arquivos = sorted(arquivos, key=os.path.basename, reverse=True)[:80]
    for arq in arquivos:
        title, url = _ler_front_matter(arq)
        if fonte_url and url == fonte_url:
            return True
        for referencia in (title, os.path.basename(arq)[11:-3]):
            chaves_existentes = extrair_palavras_chave(referencia, cidade)
            if len(chaves_existentes) < 2:
                continue
            intersecao = chaves_novas.intersection(chaves_existentes)
            if len(intersecao) >= 2 and len(intersecao) / min(len(chaves_novas), len(chaves_existentes)) >= 0.50:
                return True
    return False

# ---------------------------------------------------------------------------
# TRAVAS EDITORIAIS (CLAUDE.md §5) — mesmas regras de services/agents/src/guardrails.ts.
# Score >= 4 NÃO vai para content/: fica em fila-aprovacao/ (fora do git) até o
# Editor-Chefe revisar e mover o arquivo à mão.
# ---------------------------------------------------------------------------
FILA_APROVACAO = "fila-aprovacao/cidades"
LIMITE_SCORE_HUMANO = 4
CLAUSULA_CONTRADITORIO = (
    "A reportagem procurou a defesa/assessoria do(s) citado(s) e o espaço permanece "
    "aberto para manifestação e devida atualização desta matéria."
)

# Presunção de inocência (CF art. 5º, LVII)
_RE_CONDENATORIOS = re.compile(
    r"\b(culpad[oa]s?|assassin[oa]s?|corrupt[oa]s?|ladr(ao|oes|a|as)|bandid[oa]s?|criminos[oa]s?"
    r"|estuprador(es)?|pedofil[oa]s?|traficantes?|golpistas?|mafios[oa]s?)\b"
)
_CRITICOS = [
    ("crime violento", 5, re.compile(
        r"\b(chacina|massacre|homicidios?|assassinat[oa]s?|latrocinios?|feminicidios?|estupros?|sequestros?"
        r"|tiroteios?|mort[oa]s? a tiros|balead[oa]s?|esfaquead[oa]s?)\b")),
    ("ocorrência policial", 4, re.compile(
        r"\b(operacao policial|confronto com a policia|troca de tiros|preso em flagrante|prisao em flagrante"
        r"|flagrante|armas? de fogo|apreensao de (armas?|drogas?)|trafico de drogas)\b")),
    ("crime hediondo", 5, re.compile(r"\b(hediondo|abuso sexual|exploracao sexual|trabalho escravo|tortura)\b")),
    ("acusação de corrupção", 4, re.compile(
        r"\b(corrupcao|propinas?|lavagem de dinheiro|desvio de (recursos|verbas|dinheiro)|peculato|improbidade)\b")),
]
# ECA: menor + contexto de crime/vítima na MESMA frase
_RE_MENOR = re.compile(
    r"\b(menor(es)? de idade|menor(es)?|criancas?|adolescentes?|bebes?|recem-nascid[oa]s?|alun[oa]s?"
    r"|estudantes?|garot[oa]s?|menin[oa]s?)\b"
)
_RE_CONTEXTO_CRIME = re.compile(
    r"\b(crimes?|infracion\w*|apreend\w*|apreensao|vitimas?|violencia|abus\w*|agredid[oa]s?|agress\w*"
    r"|mort[oa]s?|assassinad[oa]s?|estuprad[oa]s?|desaparecid[oa]s?|sequestrad[oa]s?|armas?|drogas?"
    r"|trafico|policia\w*|detid[oa]s?|pres[oa]s?|balead[oa]s?|esfaquead[oa]s?|tiros?)\b"
)
# Acusação/investigação → exige cláusula de contraditório (Lei 13.188/2015)
_RE_ACUSACAO = re.compile(
    r"\b(investigad[oa]s?|denunciad[oa]s?|suspeit[oa]s?|acusad[oa]s?|reus?|indiciad[oa]s?|pres[oa]s?"
    r"|processad[oa]s?|alvos? de (uma )?operacao|denuncia|acusacao|inquerito)\b"
)

def avaliar_sensibilidade(title, desc, texto):
    """Devolve (score 1-5, motivos). Score >= LIMITE_SCORE_HUMANO = aprovação humana."""
    tudo = normalizar(f"{title}\n{desc}\n{texto}")
    score, motivos = 1, []
    if _RE_CONDENATORIOS.search(tudo):
        score = 5
        motivos.append("termo condenatório (presunção de inocência)")
    for motivo, pontos, rx in _CRITICOS:
        if rx.search(tudo):
            score = max(score, pontos)
            motivos.append(motivo)
    frases = re.split(r"(?<=[.!?])\s+|\n+", tudo)
    if any(_RE_MENOR.search(f) and _RE_CONTEXTO_CRIME.search(f) for f in frases):
        score = 5
        motivos.append("menor de idade em contexto de crime/vítima (ECA)")
    return score, motivos

def precisa_contraditorio(title, desc, texto):
    return bool(_RE_ACUSACAO.search(normalizar(f"{title}\n{desc}\n{texto}")))

def fonte_eh_da_cidade(cidade_nome, fonte):
    """Veículo/órgão da própria cidade (ex.: "Prefeitura de Pelotas", "Câmara de Curitiba")."""
    return normalizar(cidade_nome.split("(")[0].strip()) in normalizar(fonte)

_SUFIXOS_HOMONIMOS = (
    r"Por[ãa]|Mirim|Grande|Novo|Nova|Velho|Velha|Alegre|Mineir[oa]|Bonito|Branco|Preto|Verde|Doce"
    r"|Dourado|Seco|Real|Paulista|Fluminense|Ga[úu]cha|Catarinense|Baiano|Goiano"
)

def outra_cidade_homonima(cidade_pura, manchete):
    """"Lavras da Mangabeira" (CE) não é Lavras (MG); "Cunha Porã" (SC) não é Cunha (SP).
    Nome da cidade seguido de "da/do/de + Nome" ou de sufixo de topônimo = outra cidade."""
    for m in re.finditer(re.escape(cidade_pura), manchete, re.I):
        depois = manchete[m.end():]
        if re.match(rf"\s+(d[aeo]s?\s+[A-ZÁÉÍÓÚÂÊÔÃÕ][\wÀ-ÿ]{{2,}}|(?:{_SUFIXOS_HOMONIMOS})\b)", depois):
            return True
        # "Geraldo Resende" (deputado) não é Resende: nome próprio colado antes = sobrenome de pessoa
        antes = re.search(r"([A-ZÁÉÍÓÚÂÊÔÃÕ][a-zà-ÿ]{2,})\s+$", manchete[:m.start()])
        if antes and normalizar(antes.group(1)) not in {
                "prefeitura", "camara", "cidade", "municipio", "regiao", "centro", "estancia", "turistica", "em", "de",
                "na", "no", "para", "sobre", "hoje", "agora", "bairro", "zona", "vale", "litoral", "interior", "porto",
                "aeroporto", "rodoviaria", "jornal", "radio", "portal", "noticias", "diario", "folha", "gazeta", "tribuna",
                # instituição + cidade ("Concurso Resende RJ", "Hotel Sesc Paraty", "Hospital Escola Pelotas")
                "concurso", "concursos", "hotel", "sesc", "senac", "senai", "hospital", "escola", "casa", "ufpr", "ifpr",
                "utfpr", "unesp", "usp", "ufla", "unifesp", "fatec", "etec", "shopping", "praia", "parque", "teatro",
                "museu", "festival", "feira", "expo", "carnaval", "natal", "marcha", "corrida", "maratona", "copa",
                "torneio", "campeonato", "clube", "esporte", "futebol", "edital", "processo", "seletivo"}:
            return True
    return False

def pauta_eh_valida_para_cidade(cidade_nome, manchete, fonte="", slug=""):
    cidade_pura = cidade_nome.split("(")[0].strip()
    c_norm = normalizar(cidade_pura)
    m_norm = normalizar(manchete)
    # a Prefeitura de Pelotas não escreve "Pelotas" no título das próprias notícias
    if c_norm not in m_norm and not fonte_eh_da_cidade(cidade_nome, fonte):
        return False
    if slug in CIDADES_AMBIGUAS and not fonte_eh_da_cidade(cidade_nome, fonte)             and not nome_como_lugar(slug, cidade_pura, manchete):
        return False
    if outra_cidade_homonima(cidade_pura, manchete):
        return False
    if len(m_norm.split()) < 5:
        return False
    for bloq in TITULOS_GENERICOS_BLOQUEADOS:
        if m_norm.startswith(bloq):
            return False
    if "prefeitura de " in m_norm and f"prefeitura de {c_norm}" not in m_norm:
        return False
    return True

def como_texto(valor):
    """O qwen3 às vezes devolve o artigo como LISTA de parágrafos (JSON array) ou como
    a string "['par 1', 'par 2']" — saía no site como lista Python. Junta em parágrafos."""
    if isinstance(valor, (list, tuple)):
        return "\n\n".join(como_texto(v) for v in valor if str(v).strip())
    if isinstance(valor, dict):
        return "\n\n".join(como_texto(v) for v in valor.values() if str(v).strip())
    txt = str(valor or "").strip()
    if txt[:2] in ("['", '["') and txt.endswith("]"):
        try:
            import ast
            lista = ast.literal_eval(txt)
            if isinstance(lista, list):
                return como_texto(lista)
        except (ValueError, SyntaxError):
            pass
    return txt

_RE_VEICULOS = re.compile(
    r"(g1|ge|gzh|uol|r7|terra|cnn|folha|estadao|meon|band|record|sbt|globo|rpc|ric|nsc|bem parana"
    r"|banda b|tribuna|gazeta|diario|jornal|radio|tv |portal|prefeitura|camara|pci concursos"
    r"|concursos|noticias|news|agencia|online|\.com)"
)

def tirar_veiculo_do_titulo(titulo, fonte):
    """Tira o ' - Nome do Veículo' / ' | Veículo' do fim do título (vinha do Google News
    ou a IA colava a fonte de volta). Só corta se o pedaço for a fonte ou um veículo."""
    titulo = titulo.strip()
    for _ in range(2):
        m = re.match(r"^(.{25,}?)\s+[-|–—]\s+([^-|–—]{2,60})$", titulo)
        if not m:
            break
        sufixo = normalizar(m.group(2))
        if sufixo == normalizar(fonte) or (len(sufixo.split()) <= 6 and _RE_VEICULOS.search(sufixo)):
            titulo = m.group(1).strip()
        else:
            break
    return titulo

def _numeros(txt):
    """Números do texto normalizados (9.921,22 -> 992122; 4º -> 4)."""
    return {re.sub(r"\D", "", n) for n in re.findall(r"\d[\d.,]*\d|\d", txt)}

def checar_fatos(manchete, fonte, data_hoje, title, desc, texto, cidade_nome=""):
    """Travas anti-alucinação. O modelo só recebe a MANCHETE: todo número e todo nome
    do texto tem que sair dela. Devolve o motivo do descarte ou None."""
    permitidos = _numeros(manchete) | _numeros(data_hoje) | {data_hoje[-4:], data_hoje[-2:]}
    for n in _numeros(f"{title}\n{desc}\n{texto}"):
        if len(n) >= 2 and n not in permitidos:
            return f"número que não está na manchete ({n})"
    # "Hospital GZH": a IA transformava o nome do veículo em instituição da cidade.
    # A fonte só pode aparecer no parágrafo de atribuição (o último), salvo se já está na manchete.
    # Fonte que é órgão da cidade (Prefeitura de X) pode aparecer: ela é a autora do fato.
    f_norm = normalizar(fonte)
    if f_norm and f_norm not in normalizar(manchete) and not fonte_eh_da_cidade(cidade_nome or "-", fonte):
        corpo_sem_atribuicao = "\n\n".join(texto.split("\n\n")[:-1])
        if re.search(r"\b" + re.escape(f_norm) + r"\b", normalizar(f"{title}\n{desc}\n{corpo_sem_atribuicao}")):
            return f"nome da fonte ({fonte}) usado como fato"
    return None

def limpar_texto_ia(txt):
    txt = como_texto(txt)
    txt = re.sub(r"\b2\.0(2[0-9]|3[0-9])\b", r"20\1", txt)
    txt = re.sub(r"\((\d)\.(\d)\)", r"(\1\2)", txt)
    txt = re.sub(r"\s[-|]\s(MEON|ge|spriomais|Nova Concursos|JC Concursos|Estratégia Concursos|Central de Concursos|G1|UOL|R7|Terra|CNN|Folha|Estadão).*$", "", txt, flags=re.I)
    txt = re.sub(r"(^|\n)\s*\d+\.\s+", r"\1", txt)
    return txt.strip()

def buscar_pautas_oficiais(cidade_nome, query_cidade, slug=""):
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
                if pauta_eh_valida_para_cidade(cidade_nome, t_limpo, fonte, slug):
                    itens.append((t_limpo, link, fonte))
                else:
                    print(f"[FILTRO] Descartando pauta sem foco local: {t_limpo[:55]}...", flush=True)
        except Exception as e:
            print(f"[AVISO RSS] {e}", flush=True)
            if "429" in str(e):
                time.sleep(30)
    return itens[:3]

def redigir_com_ia_antiga(cidade_nome, manchete, fonte, data_hoje):
    """Versão até 27/11/2026 (3 parágrafos a partir só da manchete): inventava para encher.
    Fica só para comparação (scripts/avaliar_redacao_cidades.py)."""
    cidade_pura = cidade_nome.split("(")[0].strip()
    prompt = f"""Você é editor-chefe de jornalismo local no Brasil. Hoje é {data_hoje}.
Reescreva a notícia abaixo exclusivamente com base nos fatos da manchete sobre {cidade_nome}.

Manchete original: "{manchete}"
Veículo/Fonte: {fonte}

REGRAS ANTI-ALUCINAÇÃO (OBRIGATÓRIAS):
- Se a manchete NÃO for uma notícia real ocorrida em {cidade_nome} (por exemplo, página institucional, login, atendimento genérico ou notícia de outra cidade), responda APENAS: {{"valido": false}}
- NUNCA invente datas (como dias da semana ou meses diferentes de {data_hoje}), números, valores, horários, telefones, endereços, nomes de pessoas, leis, nomes de programas ou prefeituras de outras cidades. Todo número do texto tem que estar na manchete.
- "{fonte}" é o VEÍCULO que publicou a notícia, não um lugar nem uma instituição da cidade. Cite "{fonte}" só no 3º parágrafo, como fonte.
- Use estritamente o que está na manchete. Se faltar detalhe, escreva de forma geral em vez de inventar.

FORMATO DE SAÍDA (JSON válido):
- "valido": true
- "title": Título jornalístico claro e objetivo (55 a 85 caracteres), mencionando {cidade_pura}, sem o nome do veículo no fim.
- "description": Lide em 1 frase objetiva (110 a 170 caracteres) sem repetir o título.
- "artigo": UMA string (não lista) com o texto jornalístico em 3 parágrafos curtos e bem escritos (500 a 800 caracteres no total), separados por quebra de linha dupla (\\n\\n):
  1º parágrafo: O fato principal ocorrido em {cidade_nome}.
  2º parágrafo: O que isso significa para os moradores, sem acrescentar fatos, números ou nomes que não estão na manchete.
  3º parágrafo: Registro da fonte ({fonte}) e recomendação para acompanhar atualizações oficiais.

Responda EXCLUSIVAMENTE o JSON válido."""

    payload = json.dumps({
        "model": os.environ.get("ROBO_MODELO", "qwen3:4b"),
        "prompt": prompt,
        "stream": False,
        "think": False,
        "format": "json",
        "options": {"temperature": 0.15, "top_p": 0.85, "repeat_penalty": 1.15, "num_ctx": 4096}
    }).encode("utf-8")

    req = urllib.request.Request(os.environ.get("ROBO_OLLAMA_URL", "http://127.0.0.1:11434") + "/api/generate", data=payload, headers={"Content-Type": "application/json"})
    # 600 s: logo após o boot o qwen3:4b leva >90 s para sair do pendrive para a GPU;
    # se o cliente desiste antes, o Ollama ABORTA o carregamento e o ciclo nunca termina.
    resp = json.loads(urllib.request.urlopen(req, timeout=600).read().decode("utf-8"))
    dados = json.loads(resp["response"])
    if not dados.get("valido", True):
        return None, None, None
    return (
        tirar_veiculo_do_titulo(limpar_texto_ia(dados["title"]), fonte),
        limpar_texto_ia(dados["description"]),
        limpar_texto_ia(dados["artigo"])
    )

# ---------------------------------------------------------------------------
# REDAÇÃO SÓ COM O QUE A MANCHETE DIZ (27/11/2026)
# O robô só recebe a MANCHETE do Google Notícias (o texto da matéria não chega aqui).
# Antes ele tinha de escrever 3 parágrafos / 500-800 caracteres e inventava fato para encher
# ("JUCERJA lança serviço de coleta de lixo", "a prefeitura está monitorando a situação").
# Agora: nota curta com o fato da manchete + atribuição com link. As travas abaixo descartam
# enchimento, nome próprio que não está na manchete e conteúdo novo demais.
# ---------------------------------------------------------------------------

_RE_ENCHIMENTO = re.compile(
    r"impact\w*\s+(diretamente\s+)?(a vida\s+)?(dos|os|a)?\s*(moradores|popula)"
    r"|moradores\s+(da regi[aã]o|locais|da cidade)"
    r"|garanti\w*\s+(a\s+|o\s+)?(continuidade|qualidade|seguran|bem)"
    r"|monitora\w*\s+(a\s+)?situa"
    r"|acompanh\w*\s+(as\s+|os\s+)?(atualiza|canais|informa|comunicados)"
    r"|canais oficiais|atualiza\w* oficia"
    r"|transpar[eê]ncia e\s+(a\s+)?qualidade|compromisso\s+(com|da|do)"
    r"|\bvisa(ndo)?\s+(a\s+|ao\s+)?\w+(ar|er|ir)\b|\bbusca(ndo)?\s+\w+(ar|er|ir)\b"
    r"|tem (como|por) (objetivo|finalidade|meta)|com (a|o) (finalidade|objetivo|intuito|prop[oó]sito)|o objetivo [eé]"
    r"|destinad[oa]s? a (atender|garantir|melhorar|promover)|amplia\w* a qualidade|import[aâ]ncia (de|do|da)"
    r"|fundamental para|essencial para|demanda por|necessidades d[aeo]s?"
    r"|\bmanchete\b|evitar poss[ií]veis|poss[ií]veis (impactos|transtornos|riscos)|de acordo com a previs"
    r"|contribu\w+\s+para|fortalec\w+|qualidade de vida|bem-estar|recomenda-se|fique atent"
    r"|para mais informa|importante (passo|medida|iniciativa)|desenvolvimento (local|da regi)"
    r"|\bmelhor(ar|ia)s?\s+(a|o|os|as)?\s*(acesso|atendimento|servi[cç]o|qualidade|vida)"
    r"|efici[eê]ncia|de forma (eficiente|transparente|segura)",
    re.I,
)

def tem_enchimento(texto):
    m = _RE_ENCHIMENTO.search(texto)
    return m.group(0) if m else None

# Palavras com maiúscula (nomes, siglas) fora do começo da frase têm de estar na manchete,
# no nome da cidade/UF ou da fonte. Pega instituição, pessoa ou programa inventados.
_PALAVRAS_LIVRES = {
    "a", "o", "as", "os", "de", "da", "do", "em", "no", "na", "e", "segundo", "conforme", "com",
    "prefeitura", "camara", "municipal", "governo", "estado", "estadual", "federal", "brasil",
    "policia", "civil", "militar", "secretaria", "janeiro", "fevereiro", "marco", "abril", "maio",
    "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
}

def nomes_novos(manchete, cidade_nome, fonte, texto):
    base = set(re.findall(r"[a-z0-9]+", normalizar(f"{manchete} {cidade_nome} {fonte}")))
    novos = set()
    for frase in re.split(r"(?<=[.!?:])\s+|\n+", texto):
        palavras = re.findall(r"[A-Za-zÀ-ÿ][\wÀ-ÿ-]*", frase)
        for w in palavras[1:]:  # a 1ª palavra da frase é maiúscula por gramática
            if not w[0].isupper():
                continue
            n = normalizar(w)
            if n in _PALAVRAS_LIVRES or len(n) <= 1:
                continue
            if all(p in base for p in re.findall(r"[a-z0-9]+", n)):
                continue
            novos.add(w)
    return sorted(novos)

def conteudo_novo(manchete, cidade_nome, fonte, texto):
    """Fração das palavras de conteúdo (5+ letras) do texto que NÃO vêm da manchete
    (compara pelos 5 primeiros caracteres: 'realiza'/'realizou' contam igual).
    Paráfrase troca algumas palavras; fato inventado traz muitas."""
    raizes = {p[:5] for p in extrair_palavras_chave(f"{manchete} {cidade_nome} {fonte}")}
    palavras = [p for p in re.findall(r"[a-z]{5,}", normalizar(texto)) if p not in STOPWORDS]
    if not palavras:
        return 0.0
    return sum(1 for p in palavras if p[:5] not in raizes) / len(palavras)

LIMITE_CONTEUDO_NOVO = float(os.environ.get("ROBO_LIMITE_NOVO", "0.55"))

def _gerar_json(prompt):
    payload = json.dumps({
        "model": os.environ.get("ROBO_MODELO", "qwen3:4b"),
        "prompt": prompt,
        "stream": False,
        "think": False,
        "format": "json",
        "options": {"temperature": 0.15, "top_p": 0.85, "repeat_penalty": 1.15, "num_ctx": 4096}
    }).encode("utf-8")
    req = urllib.request.Request(os.environ.get("ROBO_OLLAMA_URL", "http://127.0.0.1:11434") + "/api/generate", data=payload, headers={"Content-Type": "application/json"})
    # 600 s: logo após o boot o qwen3:4b demora a subir para a GPU; se o cliente desiste antes,
    # o Ollama ABORTA o carregamento e o ciclo nunca termina.
    resp = json.loads(urllib.request.urlopen(req, timeout=600).read().decode("utf-8"))
    return json.loads(resp["response"])

def redigir_com_ia(cidade_nome, manchete, fonte, data_hoje):
    cidade_pura = cidade_nome.split("(")[0].strip()
    prompt = f"""Você é redator de jornalismo local no Brasil. Hoje é {data_hoje}.
Você recebeu SÓ a manchete de uma notícia sobre {cidade_nome}, publicada por {fonte}. Você NÃO leu a matéria.
Escreva uma NOTA CURTA que diga apenas o que a manchete diz, com outras palavras.

Manchete: "{manchete}"

PROIBIDO (a nota é descartada):
- acrescentar fato, detalhe, número, data, nome, lugar, motivo, consequência ou opinião que não esteja na manchete;
- frases sobre impacto para os moradores, prefeitura monitorando ou garantindo algo, transparência, qualidade, compromisso, "visa melhorar", "acompanhe os canais oficiais";
- citar {fonte} no texto (a atribuição é colocada depois, automaticamente).
Responda {{"valido": false}} SOMENTE se a manchete não for notícia (página de serviço, login, lista genérica) ou se for claramente de OUTRA cidade com nome parecido (ex.: "Cunha Porã" não é "Cunha").

JSON:
- "valido": true
- "title": título de 45 a 85 caracteres, com {cidade_pura}, sem o nome do veículo.
- "description": 1 frase de 80 a 160 caracteres com o fato da manchete, sem repetir o título palavra por palavra.
- "artigo": UMA frase (120 a 260 caracteres) com o fato da manchete e nada além: sem objetivo, motivo, efeito ou avaliação.

Responda EXCLUSIVAMENTE o JSON."""
    dados = _gerar_json(prompt)
    if not dados.get("valido", True):
        return None, None, None
    artigo = limpar_texto_ia(dados["artigo"])
    # Uma frase só, por código: a 2ª frase era onde o modelo especulava ("o projeto busca atender...").
    artigo = re.split(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ])", artigo.strip())[0]
    return (
        tirar_veiculo_do_titulo(limpar_texto_ia(dados["title"]), fonte),
        limpar_texto_ia(dados["description"]),
        artigo
    )

def checar_redacao(manchete, cidade_nome, fonte, title, desc, artigo):
    """Travas da nota curta. Devolve o motivo do descarte ou None."""
    tudo = f"{title}\n{desc}\n{artigo}"
    e = tem_enchimento(tudo)
    if e and normalizar(e) not in normalizar(manchete):  # se a própria manchete diz, não é enchimento
        return f"enchimento ('{e}')"
    # A atribuição ao veículo é colocada depois, por código; no texto ele vira "fato" ou repetição.
    f_norm = normalizar(fonte)
    if f_norm and len(f_norm) > 3 and f_norm not in normalizar(manchete) and not fonte_eh_da_cidade(cidade_nome, fonte) \
            and re.search(r"\b" + re.escape(f_norm) + r"\b", normalizar(tudo)):
        return f"veículo ({fonte}) citado no texto"
    if outra_cidade_homonima(cidade_nome.split("(")[0].strip(), tudo):
        return "texto fala de outra cidade com nome parecido"
    # "A prefeitura de Maringá iniciou o concurso dos Terminais Aéreos": quem fez foi outro órgão.
    for orgao in ("prefeitura", "camara municipal", "prefeito", "vereador"):
        if re.search(rf"\b{orgao}", normalizar(tudo)) and not re.search(rf"\b{orgao}", normalizar(f"{manchete} {fonte}")):
            return f"atribui a '{orgao}' algo que a manchete não diz"
    n = nomes_novos(manchete, cidade_nome, fonte, tudo)
    if n:
        return f"nome que não está na manchete ({', '.join(n[:3])})"
    novo = conteudo_novo(manchete, cidade_nome, fonte, tudo)
    if novo > LIMITE_CONTEUDO_NOVO:
        return f"conteúdo novo demais ({novo:.0%} das palavras não vêm da manchete)"
    return None

def montar_texto(artigo, fonte, link):
    return f"{artigo.strip()}\n\n*A informação é de {fonte}. [Leia a matéria original]({link}).*"

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
        for manchete, link, fonte in buscar_pautas_oficiais(nome, query, slug):
            if eh_duplicada(pasta, manchete, link, nome.split("(")[0]):
                print(f"[DUPLICADA] Ignorando: {manchete[:50]}...", flush=True)
                continue
            print(f"[REDIGINDO {slug}] {manchete[:55]}...", flush=True)
            try:
                agora = datetime.now(tz) - timedelta(minutes=novos * 7)
                title, desc, texto = redigir_com_ia(nome, manchete, fonte, agora.strftime("%d/%m/%Y"))
                if not title or not texto:
                    print("[IA REJEITOU] Pauta considerada invalida/nao-local pela IA.", flush=True)
                    continue
                if eh_duplicada(pasta, title, "", nome.split("(")[0]):
                    print(f"[DUPLICADA] Título reescrito repete matéria já publicada: {title[:50]}...", flush=True)
                    continue
                motivo = checar_fatos(manchete, fonte, agora.strftime("%d/%m/%Y"), title, desc, texto, nome) \
                    or checar_redacao(manchete, nome, fonte, title, desc, texto)
                if motivo:
                    print(f"[DESCARTADO] {motivo}: {title[:50]}...", flush=True)
                    continue
                low_check = (title + " " + texto).lower()
                if len(texto) < 120 or len(desc) < 60 or any(w in low_check for w in [" the ", " with ", " from ", " are ", "<think>", "oitos", "oitavos"]):
                    print("[DESCARTADO] Texto curto ou fora do padrao pt-BR.", flush=True)
                    continue
                texto = montar_texto(texto, fonte, link)
                score, motivos = avaliar_sensibilidade(title, desc, texto)
                if precisa_contraditorio(title, desc, texto) and CLAUSULA_CONTRADITORIO not in texto:
                    texto = f"{texto}\n\n*{CLAUSULA_CONTRADITORIO}*"
                vai_para_fila = score >= LIMITE_SCORE_HUMANO
                destino = os.path.join(FILA_APROVACAO, slug) if vai_para_fila else pasta
                os.makedirs(destino, exist_ok=True)
                arq = f"{destino}/{agora.strftime('%Y-%m-%d')}-{slugify(title)}.md"
                extra = ""
                if vai_para_fila:
                    extra = (
                        f"score_sensibilidade: {score}\n"
                        "requer_aprovacao_humana: true\n"
                        "motivos_revisao:\n" + "".join(f'  - "{m}"\n' for m in motivos)
                    )
                md = (
                    f'---\n'
                    f'title: "{title.replace(chr(34), chr(92)+chr(34))}"\n'
                    f'date: {agora.isoformat()}\n'
                    f'description: "{desc.replace(chr(34), chr(92)+chr(34))}"\n'
                    f'fonte: "{fonte.replace(chr(34), chr(92)+chr(34))}"\n'
                    f'fonte_url: "{link}"\n'
                    f'{extra}'
                    f'---\n\n{texto}\n'
                )
                with open(arq, "w", encoding="utf-8") as f_out:
                    f_out.write(md)
                if vai_para_fila:
                    print(f"[FILA] score {score} ({'; '.join(motivos)}) -> {arq}", flush=True)
                    continue
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
