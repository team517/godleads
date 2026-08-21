// Pure helpers for the customer-service agent (client-service-agent).
//
// Extracted out of the edge function so the vitest suite can exercise the exact code
// that runs in production: what the model gets to read, what the client gets to read,
// and which messages the agent must never answer.

/** Turn an HTML fragment into readable plain text (block tags → newlines). */
export function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Strip quoted history + MIME/header noise so the model reads ONLY the client's new
 * message. Accepts the plain-text part when there is one, else falls back to the HTML
 * body — which must be de-tagged first, or the model reads markup instead of words.
 */
export function cleanBody(rawText: string | null | undefined, rawHtml?: string | null): string {
  const plain = String(rawText ?? "").trim();
  let t = (plain || htmlToText(rawHtml ?? "")).replace(/\r/g, "");
  const markers = [
    /\nOn .+ wrote:/i,
    /\nEl .+ escribi[oó]:/i,
    /\n-{2,}\s*Forwarded/i,
    /\n_{5,}/,
    /\nDe: .+\nEnviado:/i,
    /\nFrom: .+\nSent:/i,
  ];
  for (const rx of markers) {
    const mm = t.match(rx);
    if (mm && mm.index != null && mm.index > 20) t = t.slice(0, mm.index);
  }
  t = t
    .split("\n")
    .filter(
      (l) =>
        !/^--[0-9a-f]{8,}/i.test(l) &&
        !/^BODY\[/i.test(l) &&
        !/^Content-(Type|Transfer|Disposition)/i.test(l) &&
        !/^>+/.test(l.trim()),
    )
    .join("\n");
  return t.trim().slice(0, 2500);
}

/** Pictographs, dingbats, arrows and flag letters. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu;
/** Variation selectors + ZWJ. Matched by alternation: these are combining marks, and
 *  mixing them into a character class is exactly what makes one misleading. */
const EMOJI_JOINERS = /\u{200D}|\u{FE0F}|\u{FE0E}|\u{FE0D}|\u{FE0C}|\u{FE0B}|\u{FE0A}|\u{FE09}|\u{FE08}|\u{FE07}|\u{FE06}|\u{FE05}|\u{FE04}|\u{FE03}|\u{FE02}|\u{FE01}|\u{FE00}/gu;

/** Emojis / pictographs — OnePulso emails are clean and professional, no emojis. */
export function stripEmojis(text: string): string {
  return String(text ?? "")
    .replace(EMOJI, "")
    .replace(EMOJI_JOINERS, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export const SIGN = "Un saludo,\nEquipo de OnePulso · OnePulso Team";

/** Every client-facing message: no emojis + the OnePulso sign-off (once). */
export function withSignoff(text: string): string {
  const t = stripEmojis(text || "");
  if (/onepulso team|equipo de onepulso/i.test(t)) return t;
  return `${t}\n\n${SIGN}`;
}

export function textToHtml(text: string): string {
  if (/<(p|div|br)\b/i.test(text)) return text;
  return String(text ?? "")
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const AUTO_SUBJECT = [
  /out\s*of\s*(the\s*)?office/i,
  /fuera\s*de\s*(la\s*)?oficina/i,
  /auto[\s-]?reply/i,
  /auto[\s-]?respuesta/i,
  /automatic(al)?\s*reply/i,
  /respuesta\s*autom[áa]tica/i,
  /vacation\s*(reply|response|auto)/i,
  /^undeliverable/i,
  /undelivered\s*mail/i,
  /delivery\s*(status\s*notification|failure|failed|has\s*failed)/i,
  /mail\s*delivery\s*(failed|subsystem)/i,
  /returned\s*mail/i,
  /correo\s*no\s*entregado/i,
];

const AUTO_BODY = [
  /estar[ée]\s*(de\s*vuelta|fuera|ausente)/i,
  /actualmente\s*(no\s*disponible|ausente|fuera\s*de)/i,
  /currently\s*(unavailable|away|out\s*of)/i,
  /will\s*be\s*(back|returning|out\s*of\s*the\s*office)/i,
  /this\s*is\s*an\s*automated\s*(message|reply|response)/i,
  /mensaje\s*autom[áa]tico/i,
  /no\s*responda[s]?\s*a\s*este\s*(correo|mensaje)/i,
  /do\s*not\s*reply\s*to\s*this\s*(email|message)/i,
];

const NO_REPLY_LOCAL = /^(no[-_.]?reply|noreply|donotreply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounce[sd]?|abuse|failure-notice|notifications?)$/i;

/**
 * Should the agent stay silent on this message? Covers the two ways an auto-responder
 * turns into an embarrassing loop: an unattended address (never write to it) and an
 * out-of-office / bounce (answering it means talking to a robot).
 *
 * Deliberately does NOT skip "no me interesa" style opt-outs the way the cold-email
 * bot does: on a support inbox those are real clients who need a real answer.
 */
export function isAutomatedMessage(input: {
  fromEmail?: string | null;
  subject?: string | null;
  body?: string | null;
}): boolean {
  const email = String(input.fromEmail ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at > 0 && NO_REPLY_LOCAL.test(email.slice(0, at))) return true;

  const subject = String(input.subject ?? "");
  if (AUTO_SUBJECT.some((rx) => rx.test(subject))) return true;

  const body = String(input.body ?? "").slice(0, 800);
  return AUTO_BODY.some((rx) => rx.test(body));
}
