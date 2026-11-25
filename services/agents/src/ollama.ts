// Cliente do Ollama: um só modelo carregado (zero model swapping), só o system prompt muda.

export interface ConfigOllama {
  endpoint: string;
  modelo: string;
  timeoutMs: number;
  token?: string;
}

export function configDoAmbiente(env: NodeJS.ProcessEnv = process.env): ConfigOllama {
  return {
    endpoint: (env.OLLAMA_ENDPOINT || 'http://localhost:11434').replace(/\/+$/, ''),
    modelo: env.OLLAMA_MODEL || 'qwen2.5:14b-instruct-q4_K_M',
    timeoutMs: Number(env.OLLAMA_TIMEOUT_MS) || 180_000,
    token: env.OLLAMA_TOKEN || undefined,
  };
}

export type Validador<T> = (x: unknown) => T;

export interface Llm {
  gerarJson<T>(system: string, prompt: string, validar: Validador<T>, temperatura?: number): Promise<T>;
}

export class ErroLlm extends Error {}

export function criarLlm(cfg: ConfigOllama, fetchImpl: typeof fetch = fetch, tentativas = 2): Llm {
  return {
    async gerarJson<T>(system: string, prompt: string, validar: Validador<T>, temperatura = 0.2): Promise<T> {
      let ultimoErro: unknown;
      for (let i = 1; i <= tentativas; i++) {
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
          const res = await fetchImpl(`${cfg.endpoint}/api/generate`, {
            method: 'POST',
            headers,
            signal: AbortSignal.timeout(cfg.timeoutMs),
            body: JSON.stringify({
              model: cfg.modelo,
              system,
              prompt,
              stream: false,
              format: 'json',
              keep_alive: '30m',
              options: { temperature: temperatura, num_ctx: 8192 },
            }),
          });
          if (!res.ok) throw new ErroLlm(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const corpo = (await res.json()) as { response?: unknown };
          if (typeof corpo.response !== 'string') throw new ErroLlm('Ollama sem campo "response"');
          let dado: unknown;
          try {
            dado = JSON.parse(corpo.response);
          } catch {
            throw new ErroLlm(`JSON inválido do modelo: ${corpo.response.slice(0, 200)}`);
          }
          return validar(dado);
        } catch (err) {
          ultimoErro = err;
        }
      }
      throw ultimoErro instanceof Error ? ultimoErro : new ErroLlm(String(ultimoErro));
    },
  };
}

// Helpers de validação do JSON devolvido pelo modelo.
export function objeto(x: unknown): Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new ErroLlm('resposta não é um objeto JSON');
  return x as Record<string, unknown>;
}

export function texto(o: Record<string, unknown>, chave: string, minimo = 1): string {
  const v = o[chave];
  if (typeof v !== 'string' || v.trim().length < minimo) throw new ErroLlm(`campo "${chave}" ausente ou curto demais`);
  return v.trim();
}

export function textoOpcional(o: Record<string, unknown>, chave: string): string | undefined {
  const v = o[chave];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function numero(o: Record<string, unknown>, chave: string, padrao: number): number {
  const v = o[chave];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : padrao;
}

export function booleano(o: Record<string, unknown>, chave: string): boolean {
  const v = o[chave];
  return v === true || v === 'true';
}

export function listaTexto(o: Record<string, unknown>, chave: string): string[] {
  const v = o[chave];
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : [];
}
