// The Reply Agent's prompt: what an agent is told before it writes a reply on a lead's thread.
// =====================================================================
// KEEP IN SYNC (byte-identical) WITH:
//   - supabase/functions/_shared/reply-agent.ts  (edge, Deno)
//   - src/lib/reply-agent.ts                     (frontend, Vite/TS)
// Pure & dependency-free so both runtimes can import it and a test can diff them.
// =====================================================================
//
// Why the prompt lives here and not inside the edge function: the configuration screen previews
// the agent to the operator, and the cron builds the real call. If those were two prompts they
// would drift, and the agent would send an email different from the one the operator approved.
// The tests next to this file pin the instructions that keep an automatic reply SAFE — one
// language, no invented prices, and `__SKIP__` when the other side is a robot or a rejection.

export type ReplyAgentResource = { name: string; url: string };

export type ReplyAgentConfig = {
  primary_goal: string;      // book_meeting | share_info | qualify | custom
  custom_goal: string;
  tone: string;              // professional | casual | friendly | direct
  length: string;            // short | medium | long
  style_prompt: string;
  business_context: string;
  objection_handling: string;
  resources: ReplyAgentResource[];
  signature_name: string;
  company?: string;
};

/** Word ranges per length setting. The generator enforces the upper bound loosely (1.6x). */
export const REPLY_LENGTH_WORDS: Record<string, [number, number]> = {
  short: [30, 50],
  medium: [80, 120],
  long: [150, 200],
};

/** A resource that is really a calendar. With goal=book_meeting it is pasted verbatim, because
 *  "¿te viene bien el martes?" without a link is one more round trip the lead rarely makes. */
const BOOKING_URL = /(calendly\.com|cal\.com|meetings\.hubspot\.com|tidycal\.com|zcal\.co)/i;

const TONE_TEXT: Record<string, string> = {
  professional: "TONO profesional: formal pero cercano, frases cortas y limpias, sin coloquialismos ni exclamaciones.",
  casual: "TONO casual: de tú a tú, lenguaje del día a día, frases cortas, sin sonar a folleto comercial.",
  friendly: "TONO cercano y amable: agradece lo que te cuentan, muestra interés genuino, cálido sin exagerar.",
  direct: "TONO directo: al grano desde la primera línea, sin preámbulos ni cortesías largas, una idea por frase.",
};

const GOAL_TEXT: Record<string, string> = {
  book_meeting: "OBJETIVO: conseguir una reunión. Termina SIEMPRE con una invitación clara a agendar una llamada de 10-15 minutos.",
  share_info: "OBJETIVO: informar. Responde exactamente a lo que preguntan y ofrece el recurso más relevante de la lista.",
  qualify: "OBJETIVO: cualificar. Haz UNA sola pregunta de cualificación, la más útil para saber si encajan, y ninguna más.",
};

function resourceLines(resources: ReplyAgentResource[]): string[] {
  return (resources || [])
    .filter((r) => r && String(r.url || "").trim())
    .map((r) => `- ${String(r.name || "recurso").trim()}: ${String(r.url).trim()}`);
}

/** The system prompt: who the agent is, what it wants, how it sounds and what it may never do. */
export function buildReplyAgentSystemPrompt(cfg: ReplyAgentConfig): string {
  const company = String(cfg.company || "").trim();
  const blocks: string[] = [];

  blocks.push(
    `Eres un SDR que escribe la respuesta de un correo en nombre de ${company || "la empresa del remitente"}. ` +
    `Escribes el correo que enviaría una persona del equipo comercial, no un asistente de IA.`
  );

  const goal = GOAL_TEXT[cfg.primary_goal];
  if (goal) {
    blocks.push(goal);
  } else {
    const custom = String(cfg.custom_goal || "").trim();
    blocks.push(`OBJETIVO: ${custom || "responder de forma útil y hacer avanzar la conversación."}`);
  }

  if (cfg.primary_goal === "book_meeting") {
    const booking = resourceLines(cfg.resources).find((l) => BOOKING_URL.test(l));
    if (booking) {
      blocks.push(`Incluye el enlace de agenda TAL CUAL, completo, en la invitación:\n${booking}`);
    }
  }

  blocks.push(TONE_TEXT[cfg.tone] || TONE_TEXT.professional);

  const [min, max] = REPLY_LENGTH_WORDS[cfg.length] || REPLY_LENGTH_WORDS.medium;
  blocks.push(`LONGITUD: entre ${min} y ${max} palabras. Es un límite, no una sugerencia: cuenta las palabras antes de responder.`);

  const style = String(cfg.style_prompt || "").trim();
  if (style) blocks.push(`ESTILO DE COMUNICACIÓN (imítalo):\n${style}`);

  const context = String(cfg.business_context || "").trim();
  if (context) blocks.push(`CONTEXTO Y LÓGICA DE NEGOCIO (única fuente de verdad):\n${context}`);

  const objections = String(cfg.objection_handling || "").trim();
  if (objections) {
    blocks.push(
      `MANEJO DE OBJECIONES:\n${objections}\n` +
      `Aplica la pauta que corresponda SOLO cuando el lead plantee esa objeción; no la menciones si no sale.`
    );
  }

  const resources = resourceLines(cfg.resources);
  if (resources.length > 0) {
    blocks.push(
      `RECURSOS:\n${resources.join("\n")}\n` +
      `Comparte un recurso SOLO cuando sea relevante para lo que te han preguntado; escribe las URLs completas.`
    );
  }

  const signer = String(cfg.signature_name || "").trim();
  blocks.push(
    `REGLAS (obligatorias):\n` +
    `- Responde en el MISMO IDIOMA que el mensaje del lead: detéctalo de su texto, no del nuestro.\n` +
    `- Devuelve SOLO el cuerpo del correo: sin "Asunto:", sin encabezados, sin comentarios tuyos, sin markdown.\n` +
    `- Saluda por su nombre de pila si lo conoces.\n` +
    `- Firma como ${signer || "el nombre del remitente que se te indique"}.\n` +
    `- No inventes precios, plazos, cifras ni funcionalidades que no estén en el contexto.\n` +
    `- No prometas nada que no esté en el contexto.\n` +
    `- Sin emojis.\n` +
    `- Un único siguiente paso claro al final.\n` +
    `- Si el mensaje del lead es una respuesta automática, un rechazo, una petición de no volver a contactar o un rebote, responde EXACTAMENTE __SKIP__ y nada más.`
  );

  return blocks.join("\n\n");
}

/** The user prompt: the thread as the agent needs to see it — our last email, then their reply. */
export function buildReplyAgentUserPrompt(input: {
  fromName?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  replyText: string;
  ourLastEmail?: string | null;
  senderName: string;
}): string {
  const parts: string[] = [];
  const name = String(input.fromName || "").trim();
  const email = String(input.fromEmail || "").trim();
  parts.push(`DE: ${name ? `${name} <${email}>` : email || "(desconocido)"}`);
  parts.push(`ASUNTO: ${String(input.subject || "").trim() || "(sin asunto)"}`);

  const ours = String(input.ourLastEmail || "").trim();
  if (ours) parts.push(`LO QUE LE ENVIAMOS NOSOTROS (contexto del hilo):\n${ours.slice(0, 1200)}`);

  parts.push(`RESPUESTA DEL LEAD:\n${String(input.replyText || "").trim() || "(vacío)"}`);
  parts.push(`Firmas como: ${String(input.senderName || "").trim()}`);
  parts.push("Responde a este correo.");
  return parts.join("\n\n");
}
