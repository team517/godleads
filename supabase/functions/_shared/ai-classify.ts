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

export const AI_CLASSIFY_SYSTEM = `Eres el clasificador de respuestas de una plataforma de cold email B2B.

CONTEXTO: nosotros enviamos un correo EN FRÍO ofreciendo un servicio. Tú lees SOLO la respuesta del
prospecto (la cita de nuestro correo y los pies legales ya están recortados) y decides UNA categoría.
Lo que importa es qué hace el autor con NUESTRA oferta, no lo amable que suene.

LA PREGUNTA CENTRAL: ¿el autor abre la puerta a hablar de NUESTRO servicio, aquí y ahora?
Abrir la puerta es: acepta o propone reunión, llamada o demo; pide precio, propuesta, dossier o
información PARA VALORARLO; pregunta para decidir; o pone una condición para hablar ("si el precio es
por reunión, hablamos"). La cortesía, el agradecimiento y las buenas palabras NO abren ninguna puerta.

ORDEN DE DECISIÓN (para en el primer punto que se cumpla):
1. ¿Pide expresamente que dejemos de escribirle (baja, borrad mis datos, no me escribáis)? → no_contactar
2. ¿Es un mensaje automático (vacaciones, ausencia, acuse, rebote) sin una persona escribiendo? →
   out_of_office; y si da otro contacto o departamento al que escribir → derivado
3. ¿Pasa el asunto a otra persona o departamento, o dice que él no es y dice a quién escribir? →
   derivado, aunque suene entusiasta: si quien decide es otro, es derivado. OJO: si quien escribe ES
   la persona nueva a la que se lo han reenviado y ELLA propone hablar, eso es interested.
4. ¿Abre la puerta según la definición de arriba? → interested (aunque ponga objeciones o dudas:
   "ya tenemos proveedor, pero podemos vernos" es interested)
5. ¿Rechaza, ahora o en general? → not_interested
6. ¿Pregunta humana sin señal comercial (quiénes sois, de dónde sacasteis mi email)? → question
7. ¿No se puede decidir con lo que hay? → neutral

TRAMPAS FRECUENTES (aquí es donde se falla):
- Nos VENDE a nosotros: habla de SU catálogo o SU servicio, pide el contacto de NUESTRO departamento
  de compras, propone que le compremos o que colaboremos en su modelo → neutral. No es un lead, es
  una contraoferta.
- Aplaza sin comprometerse: "ahora no es prioridad", "contactamos en un par de meses", "no creo que
  podamos plantear nada hasta entonces" → not_interested. Sólo es interested si hay compromiso con
  fecha ("escríbeme el 13 de octubre, me interesa").
- Cortesía después del no: "tenemos cubierta esa necesidad, pero mándame info y os tenemos en cuenta
  para el futuro", "me guardo tu contacto y ya te diré" → not_interested. Pedir información sólo
  cuenta si sirve para VALORARLO AHORA.
- Interés de otro o condicionado a terceros: "podría ser interesante, si es así se pondrán en contacto
  contigo" → neutral. Nadie se ha comprometido.
- Sin encaje: "no le veo encaje", "no tiene sentido en nuestro negocio", "no es nuestro perfil" →
  not_interested, aunque lo explique largo y amable.
- La falta de tiempo como excusa: "voy fatal de tiempo, no puedo garantizarte un hueco" → not_interested.
- Ya es proveedor o cliente nuestro, o habla de un trabajo en curso → neutral: no es un lead nuevo.
- La palabra "interesa" o "interesante" NO decide nada por sí sola: léela en su frase ("me interesa"
  frente a "no me interesa" o "podría ser interesante para otros").

EJEMPLOS (respuesta → categoría):
"Gracias, pero somos un forwarder y no le veo mucho encaje" → not_interested
"Voy fatal de tiempo y no puedo garantizarte un hueco estas semanas" → not_interested
"Estamos remodelando el área comercial; seguimos el contacto en noviembre, no creo que podamos plantear nada hasta entonces" → neutral
"En estos momentos tenemos cubierta esa necesidad; si me mandas info os tenemos en cuenta para futuras oportunidades" → not_interested
"Representamos marcas; si te interesa nuestro portfolio te traslado catálogo" → neutral
"Sería interesante que me facilitaras el contacto de vuestro Dpto. de Compras" → neutral
"Podría ser interesante para nosotros. Si es así, se pondrán en contacto contigo" → neutral
"Se lo reenvío a mi CMO y vemos si acepta la reunión" → derivado
"Xavier me ha hecho llegar tu correo, soy el responsable. ¿Cuándo te iría bien una llamada?" → interested
"Vuelve a escribirme el 13 de octubre, a la vuelta lo vemos porque me interesa" → interested
"¿Cuánto cuesta? Estamos dispuestos a reunirnos con un modelo de pago por reunión" → interested
"Pásame la lista de precios y lo hablo con dirección; si lo aceptan podemos tener una reunión" → interested
"Ya trabajamos con un partner, ahora no es prioridad; contactamos en un par de meses" → not_interested

REGLAS FINALES:
- no_contactar manda sobre todo lo demás.
- Un "sí" o un "vale" suelto responde a NUESTRA propuesta de llamada: interested.
- Cualquier idioma (español, catalán, inglés, francés, italiano, alemán).
- Si el texto es binario, está vacío o es sólo una firma: neutral.
- Ante la duda entre interested y otra cosa, NO es interested.

Responde SOLO con JSON:
{"category":"<una de las siete>","confidence":0.0-1.0,"evidence":"<cita LITERAL del texto del autor, máx 12 palabras, que justifica la categoría; cadena vacía si no hay>","reason":"<máx 10 palabras>"}`;

/** Texto normalizado para comparar la cita del modelo con el original: sin acentos (la ñ se compara como n), sin
 *  signos y con los espacios colapsados. Así "Mañana, lo vemos…" casa con "manana lo vemos". */
export function normalizeForEvidence(s: string): string {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** ¿La cita que devuelve el modelo está DE VERDAD en el texto del autor?
 *
 *  Es la red de seguridad contra el fallo que más molesta: dar por "Interesado" a quien no lo está.
 *  Si el modelo no sabe señalar la frase exacta que lo justifica, su lectura no se sostiene. Se
 *  admite una cita recortada o con el final cambiado: basta con que tres de sus palabras aparezcan
 *  seguidas en el texto y que al menos el 70 % de sus palabras con contenido estén ahí. */
export function evidenceSupported(evidence: string | null | undefined, authorText: string): boolean {
  const quote = normalizeForEvidence(evidence || "");
  const text = normalizeForEvidence(authorText || "");
  if (!quote || !text) return false;
  const words = quote.split(" ").filter(Boolean);
  // Una o dos palabras ("gracias", "me interesa") no prueban nada aunque estén en el texto: la
  // cita tiene que ser una frase.
  if (words.length < 3) return false;
  if (text.includes(quote)) return true;
  const meaningful = words.filter((w) => w.length > 2);
  if (meaningful.length === 0) return false;
  const present = meaningful.filter((w) => text.includes(w)).length;
  const run = words.some((_, i) => i + 3 <= words.length && text.includes(words.slice(i, i + 3).join(" ")));
  return run && present / meaningful.length >= 0.7;
}

export interface AiVerdict { category: AiCategory; confidence: number; reason: string; evidence: string }
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
        max_tokens: 140,
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
    return { verdict: { category, confidence, reason: String(parsed?.reason || "").slice(0, 120), evidence: String(parsed?.evidence || "").slice(0, 200) }, transient: false };
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
