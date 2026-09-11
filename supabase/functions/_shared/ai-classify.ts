// AI classification of a prospect's reply — the same seven categories the rule-based
// classifier produces, decided by a model that reads intent instead of matching phrases.
//
// Why both exist: the rules are free, instant and reliable for the unambiguous cases
// (auto-replies, bounces, "dadme de baja"); everything human and nuanced ("lo tenemos cubierto,
// pero podemos vernos", a question that is really interest, a polite no) is where a regex either
// misses or fires on the wrong phrase. The cron asks the model for those, with the owner's
// classification rules as the system prompt, and falls back to the rules if the model fails.
//
// Cost: ~600 input tokens per reply on deepseek-chat → well under 1 € / month at ~100 replies/day.
// Load: this is an outbound HTTP call from the edge function — it touches neither the database
// nor the sending engine. The only resource it spends is the function's wall time, which the
// caller bounds (parallel batches + a per-run time budget).

export type AiCategory = "interested" | "question" | "not_interested" | "no_contactar" | "derivado" | "out_of_office" | "neutral";

const CATEGORIES: AiCategory[] = ["interested", "question", "not_interested", "no_contactar", "derivado", "out_of_office", "neutral"];

export const AI_CLASSIFY_SYSTEM = `Eres el clasificador de respuestas de una plataforma de cold email B2B. Recibes la respuesta de un prospecto (solo SU texto: la cita de nuestro correo y los pies legales ya se han recortado) y devuelves UNA categoría.

CATEGORÍAS (devuelve exactamente una):
- interested: pide, propone o acepta una reunión, llamada, demo o conversación comercial — AUNQUE ponga objeciones, dudas o poco compromiso ("lo tenemos cubierto pero podemos vernos" = interested). También: pregunta cuánto cuesta, qué incluye, cómo funciona, cómo empezar, pide propuesta/presupuesto/información sobre el servicio, pide casos o referencias, o propone hablar más adelante con fecha concreta ("escríbeme en octubre").
- question: pregunta humana SIN señal comercial suficiente: quién sois, de dónde habéis sacado mi email, dudas administrativas. "¿Cómo funciona vuestro servicio?" es interested; "¿Cómo habéis conseguido mi email?" es question.
- not_interested: rechazo claro ("no estamos interesados", "no nos interesa", "no es el momento", "ya tenemos proveedor y no queremos cambiar", "no forma parte de nuestra estrategia", "sin presupuesto"). Un "gracias pero no" educado es not_interested.
- no_contactar: pide expresamente que no le escribamos más / baja / borrar sus datos ("dadme de baja", "no me escribáis más", "eliminad mi email"). Manda sobre todo lo demás.
- derivado: dice que no es la persona adecuada Y da un contacto o departamento concreto ("habla con María, marketing@…", "lo he pasado a compras"). Si dice "no soy la persona" SIN dar a nadie, es neutral.
- out_of_office: respuesta automática, fuera de oficina, vacaciones, acuse de recibo automático, "ya no trabaja aquí", rebote técnico.
- neutral: no se puede decidir con lo que hay. "Ya tenemos proveedor" a secas, sin más, es neutral (no un rechazo). "Lo miro y te digo" es neutral. Si dudas, neutral.

REGLAS:
1. La apertura comercial GANA a la objeción: si acepta hablar, es interested aunque diga que no cree que cambie.
2. no_contactar gana a todo. Después out_of_office solo si NO hay un humano hablando en el mismo mensaje.
3. Un "sí" / "vale" suelto responde a NUESTRA pregunta anterior (que era proponer una llamada): interested.
4. No inventes. Si el texto es binario, vacío o solo una firma, devuelve neutral.
5. Idioma: cualquiera (español, catalán, inglés, francés, italiano, alemán).

Responde SOLO con JSON: {"category":"<una de las siete>","confidence":0.0-1.0,"reason":"<máx 12 palabras>"}`;

export interface AiVerdict { category: AiCategory; confidence: number; reason: string }
export interface AiResult { verdict: AiVerdict | null; transient: boolean }

/** Ask DeepSeek. Never throws. `transient` tells the caller whether the failure was the kind that
 *  a retry — or a circuit breaker — should care about (429 / 5xx / timeout / network), as opposed
 *  to a malformed answer, which at temperature 0 would come back the same. */
export async function aiClassifyOnce(apiKey: string, subject: string | null, authorText: string, timeoutMs = 12_000): Promise<AiResult> {
  const text = (authorText || "").slice(0, 2500);
  if (!apiKey || text.replace(/\s+/g, "").length < 2) return { verdict: null, transient: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AI_CLASSIFY_SYSTEM },
          { role: "user", content: `ASUNTO: ${(subject || "").slice(0, 200)}\n\nRESPUESTA DEL PROSPECTO:\n${text}` },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return { verdict: null, transient: r.status === 429 || r.status >= 500 };
    const j = await r.json();
    const raw = String(j?.choices?.[0]?.message?.content || "").trim();
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const category = String(parsed?.category || "").trim() as AiCategory;
    if (!CATEGORIES.includes(category)) return { verdict: null, transient: false };
    const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence) || 0));
    return { verdict: { category, confidence, reason: String(parsed?.reason || "").slice(0, 120) }, transient: false };
  } catch (e) {
    return { verdict: null, transient: !(e instanceof SyntaxError) };
  } finally {
    clearTimeout(t);
  }
}

/** One call plus a single retry on a transient failure. Returns the verdict or null. */
export async function aiClassifyReply(apiKey: string, subject: string | null, authorText: string, timeoutMs = 12_000): Promise<AiVerdict | null> {
  const first = await aiClassifyOnce(apiKey, subject, authorText, timeoutMs);
  if (first.verdict || !first.transient) return first.verdict;
  await new Promise((r) => setTimeout(r, 800));
  return (await aiClassifyOnce(apiKey, subject, authorText, timeoutMs)).verdict;
}
