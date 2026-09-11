/**
 * Variable substitution for campaign copy — ONE implementation shared by the
 * engine (process-campaign-queue), manual/Unibox sends (send-email) and the
 * sequence preview, so a test email renders EXACTLY like the real one.
 *
 * WHY THIS EXISTS
 * ---------------
 * The three copies used to fall back to the literal placeholder when a lead had
 * no value for a field:
 *
 *     text.replace(/\{\{(\w+)\}\}/g, (m, k) => fields[k] ?? m)   // ← leaks "{{city}}"
 *
 * Result, measured live on 2026-09-11: 455 cold emails sent in 7 days containing
 * a raw "{{city}}" / "{{industry}}" in the middle of a sentence ("esos clientes
 * de {{city}} acaban llamando a otro"). 9% of the active leads have no `city`,
 * so it kept happening on every run. A visible placeholder screams "mass mail",
 * kills the reply rate and is a spam signal.
 *
 * WHAT IT DOES NOW
 * ----------------
 * 1. A value is used when present and non-blank ("" counts as missing).
 * 2. A missing value falls back to a natural Spanish phrase when the variable is
 *    one of the well-known ones (city → "tu zona", industry → "tu sector",
 *    company → "tu empresa"), so the sentence still reads correctly.
 * 3. Any other missing variable is DROPPED and the surrounding text is tidied
 *    (double spaces, a space before punctuation, an empty greeting comma).
 * 4. A placeholder is NEVER left visible in an outgoing email.
 *
 * Keys are matched case/underscore-insensitively: first_name == firstName ==
 * FirstName == {{ first name }}.
 */

/** {{var}} — tolerates inner spaces, dashes and underscores. */
const VAR_RE = /\{\{\s*([\w\-\s]+?)\s*\}\}/g;

/** lowercase + strip separators, so every spelling of a key collapses to one. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]+/g, "");
}

/**
 * Natural Spanish stand-ins, keyed by normalized name. Chosen so the sentence
 * keeps working where these variables are actually used in our templates:
 *   "esos clientes de {{city}} acaban…"      → "esos clientes de tu zona acaban…"
 *   "mirando a X dentro de {{industry}}…"    → "…dentro de tu sector…"
 *   "la idea es que {{company_name}} …"      → "la idea es que tu empresa …"
 * A variable NOT listed here is dropped instead (see cleanupGaps).
 */
export const VARIABLE_FALLBACKS: Record<string, string> = {
  city: "tu zona",
  ciudad: "tu zona",
  location: "tu zona",
  localidad: "tu zona",
  region: "tu zona",
  province: "tu zona",
  provincia: "tu zona",
  industry: "tu sector",
  sector: "tu sector",
  vertical: "tu sector",
  niche: "tu sector",
  nicho: "tu sector",
  companyname: "tu empresa",
  company: "tu empresa",
  empresa: "tu empresa",
  organization: "tu empresa",
  organisation: "tu empresa",
  account: "tu empresa",
  website: "vuestra web",
  web: "vuestra web",
  domain: "vuestra web",
};

/**
 * Tidy the text after a placeholder was dropped: collapse runs of spaces/tabs,
 * remove a space left before punctuation, drop a dangling comma after a greeting
 * ("Hola ," → "Hola,") and collapse an empty "()" pair. Newlines are preserved —
 * only horizontal whitespace is touched, so plain-text layout survives.
 */
export function cleanupGaps(text: string): string {
  return text
    .replace(/\(\s*\)/g, "")                                   // empty "()" left by a dropped var
    .replace(/[ \t]{2,}/g, " ")                                // collapse horizontal runs
    .replace(/[ \t]+([,.;:!?)\]])/g, "$1")                     // no space before punctuation
    .replace(/([(\[])[ \t]+/g, "$1")                           // no space after an opening bracket
    .replace(/([,;:])\s*([,.;:!?])/g, "$2")                    // ", ." → "."
    .replace(/[ \t]+(<\/(?:p|div|span|strong|em|b|i|a|li)>)/gi, "$1")
    .replace(/[ \t]+$/gm, "");
}

/**
 * Replace every {{variable}} in `text` using `fields`.
 * Missing/blank values use VARIABLE_FALLBACKS, or are dropped + tidied.
 * The literal placeholder is never returned.
 */
export function replaceVariables(text: string, fields: Record<string, string>): string {
  if (!text) return "";
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const val = typeof v === "string" ? v : v == null ? "" : String(v);
    const nk = normalizeKey(k);
    // A filled value wins when two spellings of the same key collide.
    if (!(nk in normalized) || (!normalized[nk].trim() && val.trim())) normalized[nk] = val;
  }
  let dropped = false;
  const out = text.replace(VAR_RE, (_match, rawKey: string) => {
    const key = String(rawKey);
    const direct = fields?.[key];
    const value = (typeof direct === "string" && direct.trim())
      ? direct
      : (normalized[normalizeKey(key)] || "");
    if (value.trim()) return value.trim();
    const fallback = VARIABLE_FALLBACKS[normalizeKey(key)];
    if (fallback) return fallback;
    dropped = true;
    return "";
  });
  return dropped ? cleanupGaps(out) : out;
}

/**
 * Names of the {{variables}} used in a template — for the UI to warn which
 * fields a lead list must carry.
 */
export function variablesUsed(text: string): string[] {
  const out: string[] = [];
  for (const m of (text || "").matchAll(VAR_RE)) {
    const k = String(m[1]).trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}
