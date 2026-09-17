// Test de entregabilidad (¿Bandeja o Spam?) — lógica pura compartida por la función
// `placement-test` y la página /deliverability (espejo en src/lib/placement.ts, byte a byte).
//
// El cliente NUNCA ve a qué buzones se envía la prueba: los buzones semilla son de la
// plataforma. Lo único que sale de aquí hacia un cliente es proveedor + carpeta.

export type PlacementFolder = "inbox" | "promotions" | "spam" | "missing" | "error";

export interface SeedResult { email?: string; provider: string; folder: PlacementFolder }

export type PlacementVerdict = "inbox" | "mixed" | "spam" | "pending" | "unknown";

export interface PlacementSummary {
  total: number; inbox: number; promotions: number; spam: number; missing: number; error: number;
  /** % en bandeja sobre los correos LOCALIZADOS (los que aún no han llegado no cuentan en contra). */
  inboxPct: number | null;
  verdict: PlacementVerdict;
  byProvider: Array<{ provider: string; inbox: number; promotions: number; spam: number; missing: number; error: number }>;
}

/** Resume los resultados por buzón en un veredicto y un desglose por proveedor. */
export function summarizePlacement(results: SeedResult[]): PlacementSummary {
  const s: PlacementSummary = { total: results.length, inbox: 0, promotions: 0, spam: 0, missing: 0, error: 0, inboxPct: null, verdict: "unknown", byProvider: [] };
  const map = new Map<string, PlacementSummary["byProvider"][number]>();
  for (const r of results) {
    const folder: PlacementFolder = (["inbox", "promotions", "spam", "missing", "error"] as const).includes(r.folder) ? r.folder : "error";
    s[folder]++;
    const key = r.provider || "otro";
    const row = map.get(key) || { provider: key, inbox: 0, promotions: 0, spam: 0, missing: 0, error: 0 };
    row[folder]++;
    map.set(key, row);
  }
  s.byProvider = [...map.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  const located = s.inbox + s.promotions + s.spam;
  if (located > 0) s.inboxPct = Math.round(((s.inbox + s.promotions) / located) * 100);
  if (s.total === 0) s.verdict = "unknown";
  else if (located === 0) s.verdict = s.missing > 0 ? "pending" : "unknown";
  else if (s.spam === 0) s.verdict = "inbox";
  else if (s.inbox + s.promotions === 0) s.verdict = "spam";
  else s.verdict = "mixed";
  return s;
}

/** Lo que puede ver un cliente: proveedor y carpeta, jamás la dirección del buzón semilla. */
export function resultsForClient(results: SeedResult[]): SeedResult[] {
  return results.map((r) => ({ provider: r.provider, folder: r.folder }));
}

export function providerOf(email: string): string {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (/gmail|googlemail/.test(d)) return "Gmail";
  if (/outlook|hotmail|live\.|msn/.test(d)) return "Outlook";
  if (/yahoo|ymail/.test(d)) return "Yahoo";
  if (/zoho/.test(d)) return "Zoho";
  if (/icloud|me\.com|mac\.com/.test(d)) return "iCloud";
  return d || "otro";
}

/** Carpeta de spam a partir de la respuesta de LIST: primero la marca \Junk (RFC 6154), que no
 *  depende del idioma del buzón; si el servidor no la anuncia, por nombre. */
export function findSpamFolder(listResponse: string): string | null {
  const rows: Array<{ flags: string; name: string }> = [];
  for (const m of listResponse.matchAll(/\* LIST \(([^)]*)\)\s+(?:"[^"]*"|\S+)\s+(?:"((?:[^"\\]|\\.)*)"|(\S+))\r?\n/gi)) {
    rows.push({ flags: m[1] || "", name: (m[2] ?? m[3] ?? "").trim() });
  }
  const flagged = rows.find((r) => /\\Junk/i.test(r.flags));
  if (flagged) return flagged.name;
  const named = rows.find((r) => /(^|[./\]])\s*spam$|junk|no[ _]?deseado|deseado|unwanted|bulk|ind&AOk-sirable|courrier ind/i.test(r.name));
  return named ? named.name : null;
}

// ── Quién puede usarlo ────────────────────────────────────────────────────────────────────────
export const PLACEMENT_AGENCY_EMAILS = ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"];
/** Pruebas por usuario cada 24 h (la agencia no tiene tope): protege los buzones semilla. */
export const PLACEMENT_DAILY_CAP = 10;
const TRIAL_CUTOFF_MS = Date.parse("2026-08-29T00:00:00Z");

export interface PlacementAccessInput {
  email: string | null;
  role: string | null;
  isClientManager: boolean;
  allowedRoutes: string[] | null | undefined;
  createdAt: string | null;
  /** user_entitlements: tier + status tal como los guarda check-subscription / el webhook. */
  entitlementTier: string | null;
  entitlementStatus: string | null;
}

export type PlacementAccess = { allowed: true; agency: boolean } | { allowed: false; reason: string };

/** El test usa los buzones semilla de la plataforma, así que es de plan de pago: agencia, clientes
 *  creados por la agencia, cuentas anteriores al muro de pago y suscriptores. Una prueba gratuita
 *  recién registrada no entra (la interfaz le ofrece el plan). */
export function canUsePlacement(i: PlacementAccessInput): PlacementAccess {
  const email = (i.email || "").toLowerCase();
  if (PLACEMENT_AGENCY_EMAILS.includes(email) || i.isClientManager || i.role === "admin") return { allowed: true, agency: true };
  if (i.allowedRoutes && i.allowedRoutes.length > 0) return { allowed: true, agency: false };
  const created = i.createdAt ? Date.parse(i.createdAt) : NaN;
  if (Number.isNaN(created) || created < TRIAL_CUTOFF_MS) return { allowed: true, agency: false };
  const tier = (i.entitlementTier || "free").toLowerCase();
  const status = (i.entitlementStatus || "").toLowerCase();
  if (tier !== "free" && (status === "active" || status === "trialing" || status === "past_due")) return { allowed: true, agency: false };
  return { allowed: false, reason: "El test de entregabilidad está incluido en los planes de pago." };
}

// ── Datos de ejemplo ("que se envíe con los datos cambiados") ─────────────────────────────────
/** Valores de ejemplo para las variables más habituales, por clave normalizada. */
export const SAMPLE_VALUES: Record<string, string> = {
  firstname: "Laura", nombre: "Laura", name: "Laura",
  lastname: "Martín", apellido: "Martín", apellidos: "Martín",
  fullname: "Laura Martín",
  companyname: "Talleres Martín", company: "Talleres Martín", empresa: "Talleres Martín",
  city: "Valencia", ciudad: "Valencia",
  industry: "automoción", sector: "automoción",
  website: "talleresmartin.es", web: "talleresmartin.es", domain: "talleresmartin.es",
  jobtitle: "gerente", cargo: "gerente", position: "gerente",
  phone: "600 123 456", telefono: "600 123 456",
};

const normKey = (s: string) => s.toLowerCase().replace(/[_\-\s]+/g, "");

/** Campos con los que se rellena el copy: primero los datos reales del lead (si hay), y para lo
 *  que falte un valor de ejemplo verosímil — así la prueba mide un correo como el que saldrá, no
 *  uno con huecos. Las variables del remitente las pone quien llama. */
export function sampleFieldsFor(variables: string[], real: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const realNorm = new Map<string, string>();
  for (const [k, v] of Object.entries(real || {})) {
    const val = v == null ? "" : String(v).trim();
    if (val) realNorm.set(normKey(k), val);
  }
  for (const v of variables) {
    const nk = normKey(v);
    if (/^sender/.test(nk)) continue;
    out[v] = realNorm.get(nk) ?? SAMPLE_VALUES[nk] ?? "";
  }
  return out;
}

// ── Revisión del contenido (pistas, no veredicto) ─────────────────────────────────────────────
export interface ContentHint { level: "warn" | "info"; text: string }

// Sin \b: no casa tras vocal acentuada ("aquí") ni tras "%"; los límites son "no-letra" Unicode.
const SPAM_WORDS = /(?<![\p{L}\p{N}])(gratis|100\s?%|garantizad[oa]s?|ofertas?|descuentos?|urgente|gana dinero|sin compromiso|haz clic|clic aqu[ií]|click aqu[ií]|free|guaranteed?|act now|limited time|winner|cash)(?![\p{L}\p{N}])/giu;

/** Señales del propio copy que suelen empujar a spam. Orientativo: el veredicto real es la prueba. */
export function contentHints(subject: string, body: string): ContentHint[] {
  const hints: ContentHint[] = [];
  const text = body.replace(/<[^>]+>/g, " ");
  const links = (body.match(/https?:\/\/[^\s"'<>]+/gi) || []);
  const distinct = new Set(links.map((l) => l.replace(/[).,;]+$/, "")));
  if (distinct.size > 2) hints.push({ level: "warn", text: `Hay ${distinct.size} enlaces. En frío, más de 1–2 enlaces empuja a spam.` });
  if ([...distinct].some((l) => /bit\.ly|tinyurl|t\.co\/|goo\.gl|ow\.ly|rebrand\.ly|cutt\.ly/i.test(l))) hints.push({ level: "warn", text: "Hay un enlace acortado (bit.ly y similares): los filtros los penalizan mucho." });
  if (/<img\b/i.test(body)) hints.push({ level: "warn", text: "El cuerpo lleva imágenes. Un primer correo en frío funciona mejor sólo con texto." });
  const words = [...new Set((`${subject} ${text}`.match(SPAM_WORDS) || []).map((w) => w.toLowerCase()))];
  if (words.length) hints.push({ level: "warn", text: `Palabras que suelen activar filtros: ${words.slice(0, 6).join(", ")}.` });
  const letters = subject.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  if (letters.length >= 6 && letters === letters.toUpperCase()) hints.push({ level: "warn", text: "El asunto está en MAYÚSCULAS." });
  if ((`${subject} ${text}`.match(/!/g) || []).length >= 3) hints.push({ level: "warn", text: "Demasiados signos de exclamación." });
  if (subject.trim().length > 70) hints.push({ level: "info", text: "El asunto es largo (más de 70 caracteres): se corta en el móvil." });
  const wc = text.trim().split(/\s+/).filter(Boolean).length;
  if (wc > 200) hints.push({ level: "info", text: `El correo tiene ${wc} palabras. En frío rinden mejor los de menos de 120.` });
  if (wc > 0 && wc < 15) hints.push({ level: "info", text: "El correo es muy corto: un par de líneas con un enlace es un patrón típico de spam." });
  return hints;
}
