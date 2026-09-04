// Shared inbox filters — single source of truth for warmup / bounce / language.
// =====================================================================
// KEEP IN SYNC (byte-identical) WITH:
//   - src/lib/inbox-filters.ts                     (frontend, Vite/TS)
//   - supabase/functions/_shared/inbox-filters.ts  (edge, Deno)
// Must stay pure & dependency-free so both runtimes can import it.
// NOTE: `subject` passed to hasWarmupCodes / shouldHideMessage must already be
// MIME-decoded by the caller (decodeSubject on the client, decodeMimeWords on
// the server).
// =====================================================================

/** Brands / acronyms that look like warmup codes but must NEVER be hidden. */
export const WARMUP_WHITELIST: Set<string> = new Set([
  "TCX", "AWS", "GCP", "API", "S3", "AI", "ML", "CRM", "ERP", "UX", "UI",
  "SEO", "SEM", "B2B", "B2C", "SAAS", "VAT", "IVA", "IBAN", "CIF", "NIF",
  "DNI", "VIP", "CEO", "CTO", "CFO", "COO", "RRHH", "HR", "IT", "PM", "QA",
  "SLA", "KPI", "ROI", "MVP", "GDPR", "RGPD", "MICRO", "MACRO", "PRO",
  "PREMIUM", "STANDARD", "BASIC", "PLUS", "ULTRA", "ALPHA", "BETA",
]);

/**
 * A single token is a warmup code when it is an UPPERCASE alphanumeric string of
 * 5–16 chars mixing letters AND digits with a letter/digit adjacency (e.g.
 * "9XAT619", "CHBV6J7"), is not whitelisted, and is not a plain word or year.
 */
export function isWarmupCode(token: string): boolean {
  if (!token) return false;
  const t = token.trim();
  if (t.length < 5 || t.length > 16) return false;
  if (!/^[A-Za-z0-9]+$/.test(t)) return false;
  if (/[a-z]/.test(t)) return false;            // spec: codes are UPPERCASE
  if (WARMUP_WHITELIST.has(t.toUpperCase())) return false;
  if (!/[A-Z]/.test(t) || !/[0-9]/.test(t)) return false; // need letters AND digits
  if (!/[A-Z][0-9]|[0-9][A-Z]/.test(t)) return false;     // interleaved code
  return true;
}

const WARMUP_LONG_DIGIT_RE = /\b\d{8,}\b/;
const WARMUP_UUID_LIKE_RE = /\b[a-f0-9]{4,}-[a-f0-9-]{8,}\b/i;
const WARMUP_DOTTED_LOWER_RE = /\b[a-z]+\.[a-z]+(?:\.[a-z]+)+\b/;
const WARMUP_MARKER_RE = /#warmup|instantly-warmup|warmup-|x-warmup/i;

/** Detect warmup signatures in a (decoded) subject / body. */
export function hasWarmupCodes(subject: string | null, body: string | null): boolean {
  const s = (subject || "").trim();
  const b = (body || "").slice(0, 800);
  if (WARMUP_MARKER_RE.test(s + " " + b)) return true;

  // Any whitelisted-aware mixed code in the subject = warmup.
  const subjectTokens = s.match(/[A-Za-z0-9]+/g) || [];
  if (subjectTokens.some(isWarmupCode)) return true;

  if (WARMUP_LONG_DIGIT_RE.test(s)) return true;
  if (WARMUP_UUID_LIKE_RE.test(s) || WARMUP_UUID_LIKE_RE.test(b.slice(0, 300))) return true;
  if (WARMUP_DOTTED_LOWER_RE.test(s)) return true;
  if (WARMUP_LONG_DIGIT_RE.test(b.slice(0, 300))) return true;

  // 2+ mixed codes near the body start = warmup.
  const bodyTokens = b.match(/[A-Za-z0-9]+/g) || [];
  if (bodyTokens.filter(isWarmupCode).length >= 2) return true;

  return false;
}


// ── Warm-up network traffic (2026-09-04) ─────────────────────────────────────
// The uppercase-code detector above misses the newer warm-up pools: lowercase nonsense word
// pairs dropped mid-sentence ("noise-waste", "clock-speed"), generic office subjects ("Book
// Club Meeting", "Sprint Retrospective"), base64 bodies, and mail exchanged between OUR OWN
// mailboxes. ~84% of daily inbound is this traffic; it must never be labelled or counted.
const HYPHEN_WHITELIST = /\b(e-?mail|follow-?up|cold-?email|in-?house|third-?party|up-to-date|long-?term|short-?term|on-?site|real-?time|co-?founder|opt-?in|opt-?out|sign-?up|log-?in|check-?in|one-on-one|face-to-face|end-to-end|know-?how|start-?up|pop-?up|add-?on|plug-?in|built-?in|hands-?on|drop-?down|e-?commerce|re-?engagement|self-?service|well-?known|state-of-the-art|b2b|b2c|non-?profit|part-?time|full-?time|high-?level|low-?cost|out-of-office|pre-?sales|post-?sales|cross-?sell|up-?sell|go-to-market|multi-?channel|omni-?channel|open-?source|white-?label|pay-?as-you-go|well-?being|decision-?makers?|high-?speed|high-?end|top-?notch|first-?class|world-?class|user-?friendly|cost-?effective|data-?driven|time-?consuming|long-?standing|cutting-?edge|problem-?solving)\b/i;
// exactly two hyphen-joined lowercase words, NOT part of a longer chain ("state-of-the-art").
const WARMUP_PAIR_RE = /(?<![a-z-])[a-z]{3,9}-[a-z]{3,9}(?![a-z-])/g;
const WARMUP_SUBJECT_RE = /^(re|fw|fwd|rv)?\s*:?\s*(book (club|recommendation)|(upcoming |virtual |quarterly |weekly |monthly |team )?(project|team|marketing|sales|client|budget|planning|strategy|status|kickoff|sync|review) (meeting|update|review|recap|reminder)|sprint retrospective|retrospective meeting|(annual|upcoming) (conference|industry conference|networking event|training( event)?)|webinar invite|volunteer program|wellness workshop|customer service workshop|leadership training|feature request|task priorities|financial report|sales performance|quarterly performance review|year-end review|new (software|internal compliance) (training|policy)|corporate social responsibility|travel plans|operations improvement)\b/i;
const BASE64_BODY_RE = /^\s*(?:BODY\[TEXT\](?:<\d+>)?\s*\{\d+\}\s*)?[A-Za-z0-9+\/=]{40,}(?:\s+[A-Za-z0-9+\/=]{16,})*\s*$/;

/** A REAL hyphenated compound usually has an adjective/participle side ("cost-effective",
 *  "data-driven", "user-friendly", "well-being"); warm-up pairs are two bare nouns/verbs glued at
 *  random ("noise-waste", "clock-speed", "sugar-place", "write-clear"). */
const COMPOUND_SIDE_RE = /(ed|ing|ly|ive|able|ible|ful|less|ness|ous|al|er|est|ic|ish|ward|wise|free|based|like|proof|wide|ready|made|led|tech|time|term)$/i;
/** Count nonsense lowercase word pairs. Whitelisted real terms never count. In STRICT mode
 *  (mail linked to a lead/campaign, or unknown) compound-looking pairs are also excluded so a
 *  real prospect's "cost-effective" never counts; in non-strict mode (mail NOT linked to any
 *  lead — never a campaign reply) any remaining pair counts ("clock-speed", "noise-waste"). */
export function warmupPairCount(text: string | null, strict = true): number {
  const t = (text || "").slice(0, 1200);
  let n = 0;
  for (const m of t.match(WARMUP_PAIR_RE) || []) {
    if (HYPHEN_WHITELIST.test(m)) continue;
    if (strict) { const [a, b] = m.split("-"); if (COMPOUND_SIDE_RE.test(a) || COMPOUND_SIDE_RE.test(b)) continue; }
    n++;
  }
  return n;
}

/**
 * Full warm-up decision. Signals (any one is enough unless noted):
 *  - the classic uppercase-code detector (hasWarmupCodes);
 *  - the sender is one of OUR OWN mailboxes (ownMailboxes) — agency addresses excluded by the caller;
 *  - a nonsense lowercase pair + (generic office subject OR base64 body OR a second pair);
 *  - generic office subject + base64 body.
 * A single pair alone is NOT enough (a real prospect could write an unusual hyphenation).
 */
export function isWarmupMessage(input: { subject?: string | null; body?: string | null; fromEmail?: string | null; ownMailboxes?: Set<string> | null; linked?: boolean | null }): boolean {
  const s = input.subject || ""; const b = input.body || ""; const from = (input.fromEmail || "").trim().toLowerCase();
  if (hasWarmupCodes(s, b)) return true;
  if (from && input.ownMailboxes && input.ownMailboxes.has(from)) return true;
  const pairs = warmupPairCount(s + " " + b, input.linked !== false);
  const generic = WARMUP_SUBJECT_RE.test(s.trim());
  const b64 = BASE64_BODY_RE.test(b.slice(0, 600));
  if (pairs >= 2) return true;
  if (pairs >= 1 && (generic || b64)) return true;
  // A nonsense pair in a mail that is NOT a reply to any lead/campaign of ours (linked === false)
  // is warm-up: real prospect replies are always attached to the lead we wrote to. When the
  // caller cannot tell (linked undefined/null) a single pair alone is NOT enough.
  if (pairs >= 1 && input.linked === false) return true;
  if (generic && b64) return true;
  return false;
}

const BOUNCE_LOCALPARTS = /^(mailer-daemon|postmaster|bounce|bounces|delivery|deliverability|abuse|failure-notice|mailer)@/i;
const IONOS_DOMAINS = new Set(["ionos.com", "ionos.es", "ionos.de", "ionos.fr", "ionos.co.uk"]);
const IONOS_LOCALS = new Set([
  "no-reply", "noreply", "notification", "info", "servicio", "service",
  "sistema", "system", "billing", "admin", "soporte", "support", "atencion", "contacto",
]);
const INSTANTLY_LOCALS = new Set(["support", "noreply", "notification", "billing", "info"]);

/** Bounce / delivery-failure / known automated-noise senders. Always hidden. */
export function isBounceOrFailure(fromEmail: string | null): boolean {
  const email = (fromEmail || "").trim().toLowerCase();
  if (!email || email.indexOf("@") < 0) return false;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (BOUNCE_LOCALPARTS.test(email)) return true;
  if (domain === "calendly.com" || domain.endsWith(".calendly.com")) return true;
  if (domain === "1stcontact.ai" || domain.endsWith(".1stcontact.ai")) return true;
  if (IONOS_DOMAINS.has(domain) && IONOS_LOCALS.has(local)) return true;
  if ((domain === "instantly.ai" || domain.endsWith(".instantly.ai")) && INSTANTLY_LOCALS.has(local)) return true;

  return false;
}

// Word sets are curated to be DISTINCTIVE per language (minimal cross-language
// overlap) so the counters don't muddy each other. Tokens shared by several
// languages (de, la, el, en, un, a, e, o, no, si…) are intentionally omitted.
const ES_STOP = new Set([
  "que", "los", "las", "una", "por", "para", "con", "pero", "más", "mas",
  "está", "esta", "están", "estan", "gracias", "hola", "saludos", "buenos",
  "buenas", "usted", "nosotros", "muchas", "atentamente", "correo", "reunión",
  "reunion", "quería", "queria", "también", "tambien", "cuando", "dónde",
  "donde", "tengo", "tenemos", "podemos", "quiero", "queremos", "estimado",
  "estimada", "adjunto", "información", "informacion", "soy", "somos", "muy",
  "nuestro", "nuestra", "encantado", "disponible", "quedo", "podría", "podria",
  "necesito", "interesa", "interesados", "precio", "presupuesto", "empresa",
]);
const CA_STOP = new Set([
  "els", "amb", "però", "està", "gràcies", "gracies", "salutacions", "aquest",
  "aquesta", "nosaltres", "cordialment", "atentament", "correu", "reunió",
  "tinc", "tenim", "podem", "vull", "volem", "perquè", "després", "aviat",
  "molt", "fem", "som", "nostra", "vostè", "gairebé", "nostre", "vosaltres",
  "necessito", "disponibilitat", "empresa", "preu", "pressupost", "interessa",
]);
const OTHER_STOP = new Set([
  // English
  "the", "and", "you", "your", "for", "with", "please", "thanks", "thank",
  "hello", "would", "could", "should", "our", "their", "there", "this", "that",
  "have", "will", "about", "just", "know", "like", "meeting", "interested",
  "regards", "best", "we", "is", "are", "not", "but", "from", "they", "what",
  // German
  "für", "und", "nicht", "mit", "sehr", "danke", "hallo", "wir", "ich",
  "haben", "ist", "sind", "das", "die", "der", "eine", "aber", "auch", "oder",
  // French
  "bonjour", "merci", "vous", "être", "nous", "votre", "avec", "pour", "dans",
  "pas", "cordialement", "je", "aussi", "votre",
  // Italian / Portuguese
  "grazie", "ciao", "sono", "obrigado", "você", "voce", "muito", "não", "nao",
  "estou", "sou", "perfeito", "molto",
]);

/**
 * Cheap, LLM-free language gate. Returns the consequential value "other" when
 * the text looks like a non-Iberian language; clearly Spanish/Catalan returns
 * "es"/"ca"; very short or ambiguous text returns "uncertain" (never hidden).
 */
export function detectLangHeuristic(text: string | null): "es" | "ca" | "other" | "uncertain" {
  const raw = (text || "").toLowerCase();
  const clean = raw.replace(/https?:\/\/\S+/g, " ").replace(/\S+@\S+/g, " ");
  const tokens = clean.match(/[\p{L}·]+/gu) || [];
  if (clean.replace(/\s+/g, "").length < 25 || tokens.length < 4) return "uncertain";

  let es = 0, ca = 0, other = 0;
  for (const tk of tokens) {
    if (ES_STOP.has(tk)) es++;
    if (CA_STOP.has(tk)) ca++;
    if (OTHER_STOP.has(tk)) other++;
  }
  // Spanish-only punctuation/letters are a very strong ES signal.
  if (/[ñ¿¡]/.test(raw)) es += 2;
  // Catalan geminate "l·l" / middot is distinctive.
  if (/l·l|·/.test(raw)) ca += 1;

  const iberian = es + ca;
  // Clear Iberian dominance → keep, tagged es or ca.
  if (iberian >= 2 && iberian >= other) return ca > es ? "ca" : "es";
  // Clear non-Iberian dominance → hide.
  if (other >= 2 && other > iberian) return "other";
  return "uncertain";
}

export type HideReason = "bounce" | "warmup" | "language" | null;

/**
 * Composite decision used at sync time and in the client. `tcx` account tag
 * bypasses the language filter (international business). Bounce noise is always
 * hidden; warmup + language are gated by the unibox warmup_filter toggle.
 */
export function shouldHideMessage(input: {
  subject?: string | null;
  body?: string | null;
  fromEmail?: string | null;
  accountTags?: string[] | null;
  warmupFilterEnabled?: boolean;
}): { hide: boolean; reason: HideReason; lang?: string } {
  const { subject, body, fromEmail, accountTags, warmupFilterEnabled = true } = input;

  if (isBounceOrFailure(fromEmail || "")) return { hide: true, reason: "bounce" };
  if (!warmupFilterEnabled) return { hide: false, reason: null };
  if (hasWarmupCodes(subject || "", body || "")) return { hide: true, reason: "warmup" };

  const tags = (accountTags || []).map((t) => (t || "").toLowerCase());
  if (!tags.includes("tcx")) {
    const sample = (body && body.trim()) ? body : (subject || "");
    const lang = detectLangHeuristic(sample);
    if (lang === "other") return { hide: true, reason: "language", lang };
  }

  return { hide: false, reason: null };
}
