// O botão "CNB News ao vivo" do site só acende quando o canal está transmitindo DE VERDADE.
// A rig olha a página /live do canal a cada 2 min (IP residencial: o YouTube não barra) e o
// site pergunta em /aovivo.json (Vercel → Funnel → servidor.ts). Se a rig cair, o site
// fica no neutro "TV CNB": nunca promete uma live que não está no ar.
//   Ao vivo:     /live tem "isLiveNow":true e o canonical é /watch?v=<id>
//   Fora do ar:  canonical é a página do canal; agendada ("isUpcoming") também NÃO conta.

export const CANAL_LIVE_PADRAO = 'https://www.youtube.com/@rafaelmarianobr/live';

export interface StatusAoVivo {
  aoVivo: boolean;
  url: string; // link do botão: o vídeo da live quando no ar, senão /live do canal
  videoId?: string;
  desde?: string; // quando a rig viu a live começar
  verificadoEm?: string;
  erro?: string;
}

export function analisarPaginaLive(html: string): { aoVivo: boolean; videoId?: string } {
  const aoVivo = /"isLiveNow"\s*:\s*true/.test(html);
  const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  return aoVivo && m ? { aoVivo: true, videoId: m[1] } : { aoVivo: false };
}

export async function verificarAoVivo(urlLive: string, fetchImpl: typeof fetch = fetch): Promise<{ aoVivo: boolean; videoId?: string }> {
  const r = await fetchImpl(urlLive, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Cookie: 'CONSENT=YES+1',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`YouTube HTTP ${r.status}`);
  return analisarPaginaLive(await r.text());
}

// Guarda o estado e só registra mudança (entrou/saiu do ar). Erro de rede NÃO derruba um "ao vivo"
// confirmado na hora: mantém por até 10 min e depois cai para o neutro.
export function criarVigiaAoVivo(urlLive = CANAL_LIVE_PADRAO, fetchImpl: typeof fetch = fetch, log: (m: string) => void = console.log) {
  let st: StatusAoVivo = { aoVivo: false, url: urlLive };
  let ultimoOk = 0;
  async function checar(agora = Date.now()): Promise<StatusAoVivo> {
    try {
      const r = await verificarAoVivo(urlLive, fetchImpl);
      ultimoOk = agora;
      const iso = new Date(agora).toISOString();
      if (r.aoVivo !== st.aoVivo) log(`[aovivo] ${r.aoVivo ? 'ENTROU no ar' : 'saiu do ar'}${r.videoId ? ' · ' + r.videoId : ''}`);
      st = r.aoVivo
        ? { aoVivo: true, videoId: r.videoId, url: `https://www.youtube.com/watch?v=${r.videoId}`, desde: st.aoVivo ? st.desde : iso, verificadoEm: iso }
        : { aoVivo: false, url: urlLive, verificadoEm: iso };
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      if (st.aoVivo && agora - ultimoOk > 10 * 60_000) st = { aoVivo: false, url: urlLive, erro };
      else st = { ...st, erro };
    }
    return st;
  }
  return { checar, status: () => st };
}
