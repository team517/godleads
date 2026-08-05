// Shared personalization core for personalize-leads / personalize-batch /
// process-personalization. One strong system prompt + robust generation (retries,
// timeout, output cleaning) so every lead gets a REAL 1-to-1 email, in ONE language,
// following the prompt — not "almost the same" text or mixed-language phrases.

export const PERSONALIZE_SYSTEM =
`Eres un copywriter experto en cold email B2B. Tu tarea es generar SOLO el fragmento de texto que se te pide (una línea, un saludo, una apertura o el cuerpo, según el prompt), personalizado para UNA persona concreta.

REGLAS OBLIGATORIAS:
1. IDIOMA ÚNICO: escribe TODO en un solo idioma —el de las instrucciones y los datos del lead; por defecto, español de España—. NUNCA mezcles idiomas ni cambies de idioma a mitad del texto. Ni una sola palabra en otro idioma salvo nombres propios.
2. PERSONALIZACIÓN 1 a 1: usa los datos concretos de ESTE lead (nombre, empresa, sector, web, ciudad, cargo…) para que el texto sea inequívocamente sobre él. Prohibido escribir algo genérico que sirva para cualquiera, y prohibido repetir la misma estructura o las mismas frases entre leads: cada texto debe ser distinto.
3. CUMPLE EL PROMPT AL PIE DE LA LETRA: respeta exactamente lo que pide (longitud, tono, formato, punto de vista). Si pide una línea, devuelve una línea; si pide un párrafo, un párrafo.
4. NATURAL Y VERAZ: suena humano y directo, frases claras, sin sonar a plantilla ni exagerar. No inventes datos que no tienes; si falta un dato, redacta algo natural que no lo necesite. NUNCA dejes marcadores como {empresa}, [nombre] o similares.
5. SALIDA LIMPIA: devuelve SOLO el texto final. Sin comillas, sin prefijos ("Aquí tienes", "Claro"), sin explicaciones, sin notas, sin markdown.`;

/** Replace {col}/{{col}} with the row's value. Case/space/underscore/hyphen tolerant. */
export function applyMapping(prompt: string, data: Record<string, string>): string {
  const norm = (s: string) => String(s).toLowerCase().replace(/[\s_.\-]/g, "");
  const normMap: Record<string, string> = {};
  for (const k of Object.keys(data)) normMap[norm(k)] = data[k];
  return prompt.replace(/\{\{?\s*([^{}]+?)\s*\}?\}/g, (_m, rawKey) => {
    const key = String(rawKey).trim();
    if (key in data) return data[key] ?? "";
    const nk = norm(key);
    return nk in normMap ? (normMap[nk] ?? "") : "";
  });
}

/** Strip code fences, leading fillers ("Aquí tienes:"), and wrapping quotes. */
export function cleanOutput(text: string): string {
  return (text || "")
    .trim()
    .replace(/^```(?:html|text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^\s*(aquí tienes|aqui tienes|here(?:'s| is)|claro|por supuesto)\b[:,\-\s]*/i, "")
    .replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, "")
    .trim();
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function callDeepSeek(key: string, system: string, prompt: string, temperature: number, maxTokens: number): Promise<string> {
  const r = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_tokens: maxTokens, temperature, stream: false,
    }),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return cleanOutput((await r.json()).choices?.[0]?.message?.content || "");
}

async function callClaude(key: string, system: string, prompt: string, temperature: number, maxTokens: number): Promise<string> {
  const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return cleanOutput((d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""));
}

export interface GenOpts {
  provider: "deepseek" | "claude";
  deepseekKey?: string;
  claudeKey?: string;
  system?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
}

/**
 * Generate one personalized text with retries. Retries on transient errors AND on an
 * empty result, so a lead never silently ends up with no output. Throws only after all
 * attempts fail.
 */
export async function generatePersonalized(opts: GenOpts): Promise<string> {
  const system = opts.system || PERSONALIZE_SYSTEM;
  const temperature = opts.temperature ?? 0.7;
  const maxTokens = opts.maxTokens ?? 1000;
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = opts.provider === "claude"
        ? await callClaude(opts.claudeKey!, system, opts.userPrompt, temperature, maxTokens)
        : await callDeepSeek(opts.deepseekKey!, system, opts.userPrompt, temperature, maxTokens);
      if (out && out.trim()) return out;
      lastErr = new Error("empty output");
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("generation failed");
}
