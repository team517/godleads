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

/** Idiomas con respaldo natural. Cualquier otro (o duda) → español, como siempre. */
export type TemplateLang = "es" | "fr" | "it" | "pt" | "en";

// Palabras muy frecuentes y bastante exclusivas de cada idioma. Se cuentan como palabras enteras.
const LANG_MARKERS: Record<TemplateLang, string[]> = {
  es: ["hola", "buenas", "buenos", "gracias", "vuestra", "vuestro", "vosotros", "usted", "ustedes", "equipo", "nosotros", "ayudamos", "saludo", "una", "del", "pensé", "podría", "soy", "he", "visto", "creo", "cuando", "esto", "también", "aquí"],
  fr: ["bonjour", "votre", "vos", "vous", "nous", "entreprise", "équipe", "chez", "pour", "avec", "merci", "cordialement", "des", "les", "une", "est", "dans", "sur", "je", "notre"],
  it: ["buongiorno", "salve", "vostra", "vostro", "voi", "azienda", "siamo", "aiutiamo", "grazie", "cordiali", "saluti", "della", "delle", "degli", "nel", "che", "per", "con", "sono", "nostro"],
  pt: ["olá", "obrigado", "obrigada", "você", "vocês", "sua", "seu", "vossa", "vosso", "equipe", "equipa", "não", "são", "também", "é", "está", "estamos", "uma", "nós", "cumprimentos", "sou", "nosso", "nossa", "poderia", "pensei", "ao", "dia", "contacto", "podemos", "mesmo", "até"],
  en: ["hello", "hi", "your", "you", "we", "our", "company", "team", "with", "the", "and", "for", "thanks", "regards", "best", "help", "are", "this", "i'm", "thought"],
};

/**
 * Idioma de una plantilla, por sus palabras más frecuentes. Empate o texto muy corto → "es".
 * Existe porque el 22-09-2026 salieron 93 correos en francés, italiano y portugués con
 * "En découvrant tu empresa…": el respaldo era siempre en español.
 */
export function detectTemplateLanguage(text: string): TemplateLang {
  // Sin etiquetas HTML ni {{variables}} (sus nombres están en inglés y engañaban al recuento).
  const words = (text || "").toLowerCase().replace(/\{\{[^}]*\}\}/g, " ").replace(/<[^>]+>/g, " ").match(/[a-zà-ÿ']+/g) || [];
  if (words.length < 3) return "es";
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  let best: TemplateLang = "es";
  let bestScore = 0;
  for (const lang of Object.keys(LANG_MARKERS) as TemplateLang[]) {
    let score = 0;
    for (const m of LANG_MARKERS[lang]) score += counts.get(m) || 0;
    if (score > bestScore) { bestScore = score; best = lang; }
  }
  return bestScore >= 2 ? best : "es"; // con una sola pista no se cambia de idioma
}

/** Grupo semántico de cada variable conocida → respaldo por idioma. */
type FallbackGroup = "zone" | "sector" | "company" | "web";
const FALLBACK_GROUP: Record<string, FallbackGroup> = {
  city: "zone", ciudad: "zone", location: "zone", localidad: "zone", region: "zone", province: "zone", provincia: "zone",
  industry: "sector", sector: "sector", vertical: "sector", niche: "sector", nicho: "sector",
  companyname: "company", organizationname: "company", organisationname: "company", company: "company", empresa: "company", organization: "company", organisation: "company", organizacion: "company", account: "company",
  website: "web", web: "web", domain: "web",
};
const FALLBACKS_BY_LANG: Record<TemplateLang, Record<FallbackGroup, string>> = {
  es: { zone: "tu zona", sector: "tu sector", company: "tu empresa", web: "vuestra web" },
  fr: { zone: "votre région", sector: "votre secteur", company: "votre entreprise", web: "votre site" },
  it: { zone: "la vostra zona", sector: "il vostro settore", company: "la vostra azienda", web: "il vostro sito" },
  pt: { zone: "a sua região", sector: "o seu setor", company: "a sua empresa", web: "o seu site" },
  en: { zone: "your area", sector: "your industry", company: "your company", web: "your website" },
};

/**
 * Un respaldo con artículo ("la vostra azienda", "a sua empresa") detrás de una preposición pide
 * la contracción propia del idioma; sin esto salía "a la vostra azienda" o "à a sua empresa".
 */
export function fixContractions(text: string, lang: TemplateLang): string {
  if (lang === "it") {
    return text
      .replace(/\b([Aa]) (la vostra|il vostro)\b/g, (_m, a, r) => (a === "A" ? "Al" : "al") + (r.startsWith("la") ? "la vostra" : " vostro"))
      .replace(/\b([Dd]i) la vostra\b/g, (_m, d) => (d === "Di" ? "Della" : "della") + " vostra")
      .replace(/\b([Dd]i) il vostro\b/g, (_m, d) => (d === "Di" ? "Del" : "del") + " vostro")
      .replace(/\b([Ii]n) la vostra\b/g, (_m, i) => (i === "In" ? "Nella" : "nella") + " vostra")
      .replace(/\b([Ii]n) il vostro\b/g, (_m, i) => (i === "In" ? "Nel" : "nel") + " vostro")
      .replace(/\b([Ss]u) la vostra\b/g, (_m, su) => (su === "Su" ? "Sulla" : "sulla") + " vostra");
  }
  if (lang === "pt") {
    return text
      // (^|\s): "\b" no vale delante de una vocal acentuada sin la bandera u.
      .replace(/(^|\s)([Àà]) a sua\b/g, (_m, pre, a) => pre + a + " sua")
      .replace(/\b([Ss]obre|[Pp]ara|[Cc]om) a a sua\b/g, "$1 a sua") // "sobre a {{empresa}}" → "sobre a sua empresa"
      .replace(/\b([Aa]) a sua\b/g, (_m, a) => (a === "A" ? "À" : "à") + " sua")
      .replace(/\b([Aa]) o seu\b/g, (_m, a) => (a === "A" ? "Ao" : "ao") + " seu")
      .replace(/\b([Dd]e) a sua\b/g, (_m, d) => (d === "De" ? "Da" : "da") + " sua")
      .replace(/\b([Dd]e) o seu\b/g, (_m, d) => (d === "De" ? "Do" : "do") + " seu")
      .replace(/\b([Ee]m) a sua\b/g, (_m, e) => (e === "Em" ? "Na" : "na") + " sua")
      .replace(/\b([Ee]m) o seu\b/g, (_m, e) => (e === "Em" ? "No" : "no") + " seu")
      .replace(/\b([Ss]obre|[Pp]ara|[Cc]om) a a sua\b/g, "$1 a sua");
  }
  return text;
}

/** El respaldo de una variable en un idioma (undefined si la variable no tiene respaldo). */
export function fallbackFor(key: string, lang: TemplateLang): string | undefined {
  const group = FALLBACK_GROUP[normalizeKey(key)];
  return group ? FALLBACKS_BY_LANG[lang][group] : undefined;
}

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
 * Sinónimos: si la plantilla pide {{organization_name}} y el lead trae company_name (o al revés),
 * se usa el que haya. Todos normalizados (ver normalizeKey).
 */
const SYNONYM_GROUPS: string[][] = [
  ["companyname", "organizationname", "organisationname", "company", "empresa", "organization", "organisation", "organizacion"],
  ["website", "web", "url", "domain", "sitioweb"],
  ["firstname", "nombre", "name", "first"],
  ["city", "ciudad", "localidad", "town"],
  ["industry", "industria", "sector"],
];
const SYNONYMS: Record<string, string[]> = {};
for (const g of SYNONYM_GROUPS) for (const k of g) SYNONYMS[k] = g;

/** Valor de una clave normalizada, probando sus sinónimos si la propia está vacía. */
function lookupNormalized(normalized: Record<string, string>, nk: string): string {
  const own = normalized[nk] || "";
  if (own.trim()) return own;
  for (const alt of SYNONYMS[nk] || []) {
    const v = normalized[alt] || "";
    if (v.trim()) return v;
  }
  return "";
}

/**
 * Replace every {{variable}} in `text` using `fields`.
 * Missing/blank values use VARIABLE_FALLBACKS, or are dropped + tidied.
 * The literal placeholder is never returned.
 */
/**
 * `lang`: idioma de los respaldos. Si no se pasa, se deduce del propio texto; para un ASUNTO
 * (demasiado corto para deducirlo) hay que pasar el idioma detectado en el cuerpo.
 */
export function replaceVariables(text: string, fields: Record<string, string>, lang?: TemplateLang): string {
  if (!text) return "";
  const useLang: TemplateLang = lang || detectTemplateLanguage(text);
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const val = typeof v === "string" ? v : v == null ? "" : String(v);
    const nk = normalizeKey(k);
    // A filled value wins when two spellings of the same key collide.
    if (!(nk in normalized) || (!normalized[nk].trim() && val.trim())) normalized[nk] = val;
  }
  let dropped = false;
  let usedFallback = false;
  const out = text.replace(VAR_RE, (_match, rawKey: string) => {
    const key = String(rawKey);
    const direct = fields?.[key];
    const value = (typeof direct === "string" && direct.trim())
      ? direct
      : lookupNormalized(normalized, normalizeKey(key));
    if (value.trim()) return value.trim();
    const fallback = fallbackFor(key, useLang);
    if (fallback) { usedFallback = true; return fallback; }
    dropped = true;
    return "";
  });
  const fixed = usedFallback ? fixContractions(out, useLang) : out;
  return dropped ? cleanupGaps(fixed) : fixed;
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
