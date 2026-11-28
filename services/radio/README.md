# Rádio CNB News

Música instrumental 24h + boletins de notícia, tudo na rig. Design: `docs/superpowers/specs/2026-11-28-radio-cnb-design.md`.

```
segmentos da TV (/mnt/hd/tv/segmentos) ─┐
                                         ├─ montar_boletim.py (timer :57 completo, :27 manchetes)
Piper (hora certa, títulos) ────────────┘        └─ /mnt/hd/radio/boletins/proximo-<tipo>.mp3 (vinheta + boletim)
/mnt/hd/radio/musicas (acervo) ─┐
/mnt/hd/radio/vinhetas ─────────┼─ radio.liq (Liquidsoap, cnbnews-radio.service) ─ Icecast 127.0.0.1:8000/radio
boletins ───────────────────────┘                                                    └─ Tailscale Funnel /radio
```

URL pública: `https://rig1660s.tail4a859f.ts.net/radio` (MP3 128 kbps). No site: `params.radio` no `config.toml`,
`layouts/partials/radio.html` (botão do topo), `radio-barra.html` (barra fixa) e `static/js/radio.js`.

## Grade
- `:00` vinheta + boletim completo (hora certa + até ~3 min de matérias) — entra na hora, a música sai em fade.
- `:30` vinheta + manchetes (só os títulos).
- `:15` / `:45` vinheta curta com o crédito das músicas (espera a faixa acabar).
- Boletim sem matéria nova suficiente = só a vinheta. Matéria não repete no bloco seguinte do mesmo tipo (90 min).

## Arquivos
| | |
|---|---|
| `boletim.py` | lógica pura (escolha das matérias, hora certa) — `python -m unittest discover -s services/radio` |
| `montar_boletim.py` | gera o próximo boletim; log `~/cnbnews/radio-boletim.log` |
| `acervo.py` | `--verificar` (lista branca de licenças) e `--site <repo>` → `data/radio.json` (página `/radio/`) |
| `vinhetas.py` | `--trilha <mp3 do acervo>` refaz as vinhetas (voz Faber) |
| `radio.liq` | grade do Liquidsoap 2.2; log `~/cnbnews/radio.log` |
| `deploy/` | units systemd (copiar para `/etc/systemd/system/`) |

Senha da fonte do Icecast: `/etc/cnbnews-radio.env` (fora do git). Config do Icecast: `/etc/icecast2/icecast.xml`
(backup `.bak-2026-11-28`), só em 127.0.0.1, até 500 ouvintes.

## Acervo
147 faixas do Kevin MacLeod (incompetech.com, **CC BY 4.0**: exige crédito — vai no ar na vinheta curta e na
página `/radio/`). Normalizadas a -18 LUFS (voz a -16). Para pôr música nova: mp3 em `musicas/` + entrada em
`creditos.json` + `acervo.py --verificar` (0 erros) + `acervo.py --site ~/cnbnews` e commit do `data/radio.json`.
Nunca: NC, ND, Biblioteca de Áudio do YouTube, licença dada por quem só fez upload (Internet Archive tem NIN "CC0").

## Limites medidos (28/11/2026)
- **Funnel: 20 conexões simultâneas POR IP de origem.** 50 ouvintes da mesma casa: 20 ok, 30 recusados no TLS;
  com 20 ocupados, um celular no 4G conectou (21 no Icecast). Risco: CGNAT de operadora móvel junta muita gente
  num IP. Se aparecer, a saída é um repetidor (host de streaming) puxando da rig.
- **PC na tailnet não toca pelo site** (Chrome: página pública → IP 100.x = rede local, bloqueia/pede permissão).
  Fora da tailnet toca normal.
- CPU/RAM: Liquidsoap + Icecast leves no G4560 (Icecast ~0 %, ~4,4 GB livres).

## Operação
```
sudo systemctl restart cnbnews-radio          # Liquidsoap (Icecast: icecast2)
systemctl list-timers | grep radio            # boletins
curl -s 127.0.0.1:8000/status-json.xsl        # ouvintes
sudo tailscale funnel status                  # /radio deve apontar p/ 127.0.0.1:8000/radio
```
