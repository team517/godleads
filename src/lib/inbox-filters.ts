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

// 12+ digits: warm-up codes are long; real phone / order numbers are 9–11 digits. \d{8,} flagged
// genuine "Me interesa, llámame al 612345678" replies as warm-up (never marked replied, hidden
// from the thread, follow-ups kept going). Mirrors the Unibox stripper's own \d{12,} rule.
const WARMUP_LONG_DIGIT_RE = /\b\d{12,}\b/;
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
// exactly two hyphen-joined lowercase ASCII words, NOT part of a longer chain
// ("state-of-the-art"). The boundaries also reject ACCENTED neighbours (À-ɏ) so a real
// Spanish compound like "técnico-comercial" or "socio-económico" is NOT mis-split into a fake
// ASCII pair ("cnico-comercial") and wrongly counted as warm-up — that hid real replies.
const WARMUP_PAIR_RE = /(?<![a-zÀ-ɏ-])[a-z]{3,9}-[a-z]{3,9}(?![a-zÀ-ɏ-])/g;
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
  // Emails, URLs and bare domains are NOT word pairs: "a.lombardi@tecno-group.eu" in a signature
  // counted "tecno-group" twice and flagged a real client's replies (contract, payment) as
  // warm-up, hiding them from the Unibox (2026-09-15). Strip them before counting.
  const t = (text || "").slice(0, 1200)
    .replace(/\S+@\S+/g, " ")
    .replace(/(https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9][a-z0-9-]*\.(com|es|eu|net|org|io|info|store|online|cat|fr|it|de|uk|co|ai|app|dev|pro|group|tech|biz)\b/gi, " ");
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
/** Warm-up pools generate their threads from a finite list of generic ENGLISH office topics:
 *  "Workshop Confirmation", "Quarterly Goals Review", "Health and Wellness Initiative", "Book
 *  Club Event", "Update on Vendor Negotiations"… 2–6 Title-Case words, at least one from the
 *  office vocabulary, and nothing personal (no name, no company, no "-"). Measured on 30 days
 *  (2026-09-15): 125 of 168 "Interesado" labels in a week were such threads that the short list
 *  in WARMUP_SUBJECT_RE missed — and 99 of them buzzed somebody's phone. A real prospect answers
 *  OUR subject ("Maria - HireTop", "una idea para X"), which never looks like this. */
const OFFICE_WORD_RE = /\b(technology|implementation|adoption|tools?|tasks?|systems?|platform|year-end|quarter|update|updates|review|meeting|training|event|workshop|project|team|budget|finance|financial|report|feedback|strategy|plan|plans|planning|timeline|goals|goal|newsletter|conference|schedule|session|program|initiative|policy|proposal|launch|orientation|retreat|reimbursement|wellness|productivity|tips|volunteer|volunteers|community|holiday|travel|office|vendor|negotiations?|priorities|milestone|downtime|notification|software|marketing|sales|client|customer|employee|staff|leadership|book\s+club|recommendation|retrospective|sprint|bug|fixes?|debrief|performance|quarterly|weekly|monthly|annual|upcoming|arrangements|process|courses?|development|expansion|opening|portfolio|investment|achievement|responsibility|compliance|survey|checklist|agenda|minutes|reminder|kickoff|status|recap|contribution|celebration|lunch|party|potluck|birthday|welcome|farewell|anniversary|award|recognition|deadline|guidelines|resources|benefits|onboarding|hiring|interview|recruitment|inventory|procurement|shipping|maintenance|security|backup|migration|rollout|upgrade|release|testing|audit|payroll|invoice|expenses|contract|partnership|collaboration|sponsorship|charity|donation|fundraiser|mentorship|internship|webinar|podcast|blog|content|brand|website|design|analytics|dashboard|metrics|roadmap|backlog|feature|request|ticket|support|helpdesk|matter|thoughts|ideas|brainstorm|suggestion|confirmation|debrief|assessment|evaluation|improvement|efficiency|opportunity|opportunities|insights?|overview|summary|catch-?up|check-?in|sync|discussion|announcement|invitation|reservation|logistics)\b/i;
export function looksLikeWarmupSubject(subject: string | null | undefined): boolean {
  const s = String(subject || "").replace(/^\s*((re|fw|fwd|rv|aw|tr)\s*:\s*)+/i, "").trim();
  if (!s || s.length > 70) return false;
  // Our own subjects carry a name/company: "Maria - HireTop", "idea para X". A " - " separator,
  // digits, accents, "@", "?" or "|" mean personalised → never a pool subject.
  if (/ - |[0-9@?|¿!€$%]/.test(s) || /[^\x00-\x7F]/.test(s)) return false;
  // ASCII letters, spaces, apostrophes, ONE inner colon ("Task Update: UI Design") and hyphenated
  // Title words ("Year-End Celebration Plans").
  if (!/^[A-Za-z][A-Za-z' :-]*$/.test(s) || (s.match(/:/g) || []).length > 1) return false;
  const words = s.replace(/:/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 7) return false;
  // Every word Title-Case (connectors and short acronyms like UI/HR/IT allowed).
  if (!words.every((w) => /^[A-Z][a-z']*(-[A-Z][a-z']*)?$/.test(w) || /^[A-Z]{2,3}$/.test(w) || /^(on|and|for|of|the|in|to|a|an|with|at|from|vs)$/i.test(w))) return false;
  return OFFICE_WORD_RE.test(s);
}

export function isWarmupMessage(input: { subject?: string | null; body?: string | null; fromEmail?: string | null; ownMailboxes?: Set<string> | null; linked?: boolean | null }): boolean {
  const s = input.subject || ""; const b = input.body || ""; const from = (input.fromEmail || "").trim().toLowerCase();
  // Our OWN seed mailboxes are warm-up whatever they write, and an explicit marker is definitive.
  if (from && input.ownMailboxes && input.ownMailboxes.has(from)) return true;
  if (WARMUP_MARKER_RE.test(`${s} ${b.slice(0, 800)}`)) return true;
  // A message LINKED to a real lead/campaign is a genuine prospect reply — NEVER warm-up. Warm-up
  // traffic comes from other seed mailboxes, never from someone we actually emailed. Without this
  // guard the code detector tripped on ordinary signatures (a phone/reference number, a base64
  // image blob) and silently hid 373 real replies from their own thread.
  if (input.linked === true) return false;
  // Not linked + a generic English office subject = a warm-up pool thread.
  if (looksLikeWarmupSubject(s)) return true;
  if (hasWarmupCodes(s, b)) return true;
  const pairs = warmupPairCount(s + " " + b, input.linked !== false);
  const generic = WARMUP_SUBJECT_RE.test(s.trim());
  const b64 = BASE64_BODY_RE.test(b.slice(0, 600));
  if (pairs >= 2) return true;
  if (pairs >= 1 && (generic || b64)) return true;
  // Un solo par con guion NO basta, ni siquiera sin enlazar: "relación precio-calidad" o
  // "video-llamada" en una respuesta real (a un envío manual, que no se enlaza) la escondían para
  // siempre como warm-up (22-09-2026). Sin enlazar, el recuento ya corre en modo no estricto y
  // hacen falta dos pares (arriba) o un par más otra señal.
  if (generic && b64) return true;
  return false;
}

/** Does the incoming mail's References / In-Reply-To chain carry a Message-ID at OUR mailbox's
 *  domain? Then it answers something we sent (from godleads or any other system) — a genuine
 *  reply, never warm-up, even when no sent_emails row links it to a lead or campaign. */
export function refersToOwnDomain(refChain: string | null | undefined, ownEmail: string | null | undefined): boolean {
  const dom = String(ownEmail || "").split("@")[1]?.toLowerCase().trim();
  if (!dom || !refChain) return false;
  return refChain.toLowerCase().includes("@" + dom);
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
