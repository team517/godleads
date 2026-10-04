// Lógica de la app del móvil (Unibox estilo Instantly): estados de contacto, conversaciones,
// pestañas Primary / Others y formatos de fecha. Todo puro para poder probarlo aparte.
import { categoryOf, cleanBodyText, decodeSubject, decodeSubjectKeepCodes, isBounceOrNoise, CATEGORY_LABEL, type MessageCategory } from "@/lib/unibox-text";
import { campaignMatchCounts, isBounceOrFailure, isDeliveryFailureMessage, isWarmupMessage, looksLikePoolThreadSubject } from "@/lib/inbox-filters";

/* ── Estados ─────────────────────────────────────────────────────────────── */

export type LeadStatus =
  | "lead" | "interested" | "meeting_booked" | "meeting_completed"
  | "closed" | "out_of_office" | "wrong_person" | "not_interested";

export interface StatusStyle {
  id: LeadStatus;
  label: string;
  /** Color del rayo y del texto de la pastilla. */
  color: string;
  /** Fondo de la pastilla de la lista. */
  pill: string;
  /** Fondo del cuadrado del icono en el menú de filtros. */
  tile: string;
}

// El orden es el del menú de filtros del diseño.
export const LEAD_STATUSES: StatusStyle[] = [
  { id: "lead",              label: "Lead",              color: "#3B6CF6", pill: "#E7EEFE", tile: "#DFE8FD" },
  { id: "interested",        label: "Interested",        color: "#16BE8E", pill: "#E2F7F0", tile: "#DDF4EC" },
  { id: "meeting_booked",    label: "Meeting booked",    color: "#7B4DF3", pill: "#EFE8FE", tile: "#ECE5FD" },
  { id: "meeting_completed", label: "Meeting completed", color: "#F5A425", pill: "#FFF1DF", tile: "#FFF0DC" },
  { id: "closed",            label: "Closed",            color: "#93CB1B", pill: "#F1F8DE", tile: "#F0F8DA" },
  { id: "out_of_office",     label: "Out of office",     color: "#36B2EE", pill: "#E1F4FD", tile: "#DDF2FC" },
  { id: "wrong_person",      label: "Wrong person",      color: "#5F667B", pill: "#ECEEF3", tile: "#EBEDF2" },
  { id: "not_interested",    label: "Not Interested",    color: "#F0375D", pill: "#FFE5EB", tile: "#FDE3E9" },
];

export const STATUS_BY_ID: Record<LeadStatus, StatusStyle> =
  Object.fromEntries(LEAD_STATUSES.map((s) => [s.id, s])) as Record<LeadStatus, StatusStyle>;

export function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === "string" && v in STATUS_BY_ID;
}

/** Categoría del clasificador → estado del contacto. */
export function statusFromCategory(cat: MessageCategory): LeadStatus {
  switch (cat) {
    case "interested":
    case "question":
      return "interested";
    case "not_interested":
    case "no_contactar":
      return "not_interested";
    case "derivado":
      return "wrong_person";
    case "out_of_office":
      return "out_of_office";
    default:
      return "lead";
  }
}

const CATEGORY_LABELS = new Set(Object.values(CATEGORY_LABEL).filter(Boolean));

/**
 * Etiquetas que debe llevar un mensaje cuando el usuario cambia el estado del contacto en el
 * móvil, para que la Unibox de escritorio diga lo mismo. Devuelve null si no hay que tocarlas.
 *   - Interested / Meeting booked / Meeting completed / Closed → "Interesado"
 *   - Not Interested → "No interesado" (un "No contactar" ya puesto se respeta: es más fuerte)
 *   - Out of office → "Fuera / Auto";  Wrong person → "Derivado"
 *   - Lead → no se toca nada (es "sin clasificar", no una etiqueta)
 */
export function labelsForStatus(current: string[] | null | undefined, status: LeadStatus): string[] | null {
  const cur = Array.isArray(current) ? current : [];
  let target: string | null = null;
  switch (status) {
    case "interested":
    case "meeting_booked":
    case "meeting_completed":
    case "closed":
      target = CATEGORY_LABEL.interested; break;
    case "not_interested":
      if (cur.includes(CATEGORY_LABEL.no_contactar)) return null;
      target = CATEGORY_LABEL.not_interested; break;
    case "out_of_office":
      target = CATEGORY_LABEL.out_of_office; break;
    case "wrong_person":
      target = CATEGORY_LABEL.derivado; break;
    default:
      return null;
  }
  const cats = cur.filter((l) => CATEGORY_LABELS.has(l));
  if (cats.length === 1 && cats[0] === target) return null;
  return [...cur.filter((l) => !CATEGORY_LABELS.has(l)), target];
}

/* ── Conversaciones ──────────────────────────────────────────────────────── */

export interface InboxRow {
  id: string;
  account_id: string;
  lead_id?: string | null;
  campaign_id?: string | null;
  message_id?: string | null;
  from_email: string | null;
  from_name?: string | null;
  subject?: string | null;
  body_text?: string | null;
  received_at: string;
  is_read?: boolean | null;
  is_archived?: boolean | null;
  folder_id?: string | null;
  labels?: string[] | null;
  ref_chain?: string | null;
  auto_signal?: string | null;
  to_emails?: string | null;
  cc_emails?: string | null;
  /** Lo marca el servidor (mobile_inbox_feed): quien escribe es un lead de alguna campaña, o
   *  su dominio es el de algún lead de alguna campaña. */
  in_campaign?: boolean | null;
  /** Campaña del lead que coincide (por email o por dominio), para lo que no trae campaign_id. */
  campaign_hint?: string | null;
  /** Por qué es de campaña según el servidor: lead · dominio · hilo (cita un envío nuestro) · warmup. */
  match_why?: string | null;
  /** Cuándo lo guardó la sincronización (para pedir sólo lo nuevo, aunque llegue con retraso). */
  created_at?: string | null;
  /** Marca de warm-up de la sincronización (lo trae mobile_inbox_others). */
  is_warmup?: boolean | null;
  in_reply_to?: string | null;
}

/* ── Primary / Others: UNA regla para la app del móvil y la pestaña Campañas del escritorio ── */

/** Ventana de Primary (y de la pestaña Campañas del escritorio): las respuestas enlazadas más
 *  nuevas y, aparte, lo demás que no es warm-up. Suman 1.000: PostgREST no devuelve más filas
 *  por petición, y con más el corte se llevaba lo más viejo de forma distinta en cada sitio. */
export const PRIMARY_FEED = { linked: 700, other: 300 } as const;

/**
 * ¿Es este mensaje DE CAMPAÑA (Primary en el móvil = pestaña Campañas del escritorio)?
 * La regla del servidor (inbox_campaign_match: lead de la base, su dominio, su marca, cita un envío
 * nuestro de campaña o contesta a uno de nuestros buzones; nunca la etiqueta del warm-up ni
 * nuestros propios buzones) + el filtro del pool (campaignMatchCounts). Nunca lo es el warm-up sin
 * enlazar (is_warmup, el mismo conjunto que mira mobile_inbox_feed), ni un aviso de
 * correo no entregado (va a Others, petición del dueño 03-10-2026) ni el ruido de sistema.
 * Filas viejas de la caché, sin la marca del servidor: lo enlazado que no tenga pinta de warm-up.
 */
export function isPrimaryRow(m: InboxRow): boolean {
  if (m.match_why === "warmup") return false;
  // Warm-up sin enlazar: nunca (el warm-up también cita nuestros buzones; 565 se colaban en 7 días).
  if (m.is_warmup === true && !m.lead_id && !m.campaign_id) return false;
  if (isDeliveryFailureMessage(m)) return false;
  if (isBounceOrNoise(m.from_email ?? null) || isBounceOrFailure(m.from_email ?? null)) return false;
  return isCampaignMessage(m);
}

/** ¿Es parte de un hilo de verdad? (bloquear a alguien no borra lo que ya nos contestó). */
export function isThreadReplyRow(m: InboxRow): boolean {
  return !!(m.ref_chain || m.in_reply_to || m.lead_id || m.campaign_id);
}

export type BlockedCheck = (email: string | null | undefined) => boolean;

/** Lista de bloqueo → función "¿está bloqueado este remitente?" (por email o por dominio). */
export function blockedChecker(entries: { entry_type: string; value: string }[]): BlockedCheck {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const e of entries) {
    const v = String(e.value || "").trim().toLowerCase();
    if (!v) continue;
    if (e.entry_type === "domain") domains.add(v); else if (e.entry_type === "email") emails.add(v);
  }
  return (email) => {
    const e = String(email || "").trim().toLowerCase();
    if (!e) return false;
    if (emails.has(e)) return true;
    const dom = e.split("@")[1] || "";
    return !!dom && domains.has(dom);
  };
}

export interface Conversation {
  /** cuenta + remitente: es exactamente el hilo que se abre (y desde donde se responde). */
  key: string;
  accountId: string;
  email: string;
  name: string;
  latest: InboxRow;
  subject: string;
  preview: string;
  receivedAt: string;
  unreadIds: string[];
  messageIds: string[];
  campaignId: string | null;
  leadId: string | null;
  folderId: string | null;
  important: boolean;
  /** ¿Alguno de sus mensajes es de campaña? (lead de una campaña o de su dominio) */
  inCampaign: boolean;
  /** Primary = TODO lo de campaña (respuestas, fuera de la oficina, avisos automáticos…: lo que
   *  venga de un lead o de su empresa); Others = todo lo demás (warm-up, rebotes, avisos…). */
  tab: "primary" | "others";
  /** Lo que dicen las etiquetas del clasificador (sin la elección manual). */
  derivedStatus: LeadStatus;
}

export const IMPORTANT = "Importante";

/** ¿Pinta de warm-up? (hilo de pool en inglés de oficina, códigos en el asunto, pares sin sentido…) */
const warmupCache = new WeakMap<object, boolean>();
function looksLikeWarmup(m: InboxRow): boolean {
  const hit = warmupCache.get(m);
  if (hit !== undefined) return hit;
  const v = looksLikePoolThreadSubject(m.subject)
    || isWarmupMessage({ subject: m.subject ?? null, body: m.body_text ?? null, fromEmail: m.from_email, linked: false, senderKnown: false });
  warmupCache.set(m, v);
  return v;
}

/**
 * ¿Es de campaña? Exactamente la regla de la Unibox de campaña, marcada por el servidor
 * (inbox_campaign_match): quien escribe es un lead de una campaña (o alguien a quien escribimos
 * desde una), escribe desde el dominio de empresa de un lead de una campaña, o contesta citando un
 * correo nuestro de campaña. Nunca lo es lo que lleva la etiqueta del warm-up, ni un hilo del pool
 * desde una empresa que también está en la red de warm-up (campaignMatchCounts).
 * Filas viejas de la caché, sin la marca: lo enlazado que no tenga pinta de warm-up.
 */
export function isCampaignMessage(m: InboxRow): boolean {
  if (typeof m.in_campaign === "boolean") return campaignMatchCounts(m);
  return !!(m.lead_id || m.campaign_id) && !looksLikeWarmup(m);
}

/** Lo que se enseña: TODO lo que enseña "Todos" en el escritorio (warm-up, rebotes y avisos
 *  incluidos, petición del dueño 05-10-2026: Others = Todos menos Primary). Sólo se quita lo
 *  archivado y, como en "Todos", lo de un remitente bloqueado que no sea parte de un hilo. */
export function isMobileReply(m: InboxRow, isBlocked?: BlockedCheck): boolean {
  if (m.is_archived) return false;
  if (isBlocked && isBlocked(m.from_email) && !isThreadReplyRow(m)) return false;
  return true;
}

/** ¿Es una respuesta automática (fuera de la oficina, acuse…)? */
export function isAutoReply(m: InboxRow): boolean {
  if (m.auto_signal) return true;
  return categoryOf(m) === "out_of_office";
}

export function conversationKey(accountId: string, email: string | null | undefined): string {
  return `${accountId}|${String(email || "").trim().toLowerCase()}`;
}

/** "Hola, Pedro…" — una línea de texto limpia para la lista. */
export function previewOf(m: InboxRow): string {
  return cleanBodyText(m.body_text ?? null).replace(/\s+/g, " ").trim().slice(0, 220);
}

export function displayName(m: { from_name?: string | null }): string {
  if (!m.from_name || !m.from_name.trim()) return "Unknown";
  const n = decodeSubjectKeepCodes(m.from_name).replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return n && !n.includes("@") ? n : "Unknown";
}

/**
 * El estado que dicen las etiquetas, mirando del mensaje más nuevo al más viejo: manda la última
 * respuesta con intención comercial. Un "fuera de la oficina" que llega DESPUÉS de un "me
 * interesa" no lo pisa (es un estado operativo, no comercial).
 */
export function deriveStatus(msgsNewestFirst: InboxRow[]): LeadStatus {
  let sawOoo = false;
  for (const m of msgsNewestFirst) {
    const cat = categoryOf(m);
    if (cat === "neutral") continue;
    if (cat === "out_of_office") { sawOoo = true; continue; }
    return statusFromCategory(cat);
  }
  return sawOoo ? "out_of_office" : "lead";
}

/** Agrupa los mensajes en conversaciones (buzón + remitente), de la más reciente a la más vieja.
 *  Una conversación es Primary si alguno de sus mensajes lo es (isPrimaryRow); si no, Others. */
export function buildConversations(rows: InboxRow[], opts: { isBlocked?: BlockedCheck } = {}): Conversation[] {
  const groups = new Map<string, InboxRow[]>();
  const seen = new Set<string>();
  for (const m of rows) {
    if (seen.has(m.id)) continue;   // la misma fila puede venir de los dos carriles
    seen.add(m.id);
    if (!isMobileReply(m, opts.isBlocked)) continue;
    const k = conversationKey(m.account_id, m.from_email);
    const g = groups.get(k);
    if (g) g.push(m); else groups.set(k, [m]);
  }
  const out: Conversation[] = [];
  for (const [key, msgs] of groups) {
    msgs.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
    const latest = msgs[0];
    // Un aviso de rebote (correo nuestro no entregado) no cuenta: va a Others aunque lo mande el
    // servidor de la empresa del lead (petición del dueño, 03-10-2026).
    const inCampaign = msgs.some(isPrimaryRow);
    const withCampaign = msgs.find((m) => m.campaign_id);
    const withLead = msgs.find((m) => m.lead_id);
    out.push({
      key,
      accountId: latest.account_id,
      email: String(latest.from_email || "").trim().toLowerCase(),
      name: displayName(msgs.find((m) => displayName(m) !== "Unknown") || latest),
      latest,
      subject: decodeSubject(latest.subject ?? null) || "(sin asunto)",
      preview: previewOf(latest),
      receivedAt: latest.received_at,
      unreadIds: msgs.filter((m) => !m.is_read).map((m) => m.id),
      messageIds: msgs.map((m) => m.id),
      // La del envío al que contesta; si no la hay, la del lead que coincide (por email o dominio).
      campaignId: withCampaign?.campaign_id ?? msgs.find((m) => m.campaign_hint)?.campaign_hint ?? null,
      leadId: withLead?.lead_id ?? null,
      folderId: msgs.find((m) => m.folder_id)?.folder_id ?? null,
      important: msgs.some((m) => (m.labels || []).includes(IMPORTANT)),
      inCampaign,
      // Petición del dueño (03-10-2026): cualquier mensaje de un lead o de su empresa va a Primary,
      // también los "fuera de la oficina". Others es sólo lo que no es de ninguna campaña.
      tab: inCampaign ? "primary" : "others",
      derivedStatus: deriveStatus(msgs),
    });
  }
  out.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  return out;
}

/* ── Mezclar lo que llega del servidor con lo que ya hay ─────────────────── */

const ts = (iso: string | null | undefined) => {
  const t = Date.parse(String(iso || ""));
  return Number.isNaN(t) ? 0 : t;
};

/** De la más nueva a la más vieja (y, a igualdad, por id: el orden del servidor). */
export function sortRows(rows: InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => ts(b.received_at) - ts(a.received_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Lo nuevo (o cambiado) sustituye por id a lo que había; lo demás se queda. */
export function upsertRows(existing: InboxRow[], fresh: InboxRow[]): InboxRow[] {
  if (fresh.length === 0) return existing;
  const ids = new Set(fresh.map((r) => r.id));
  return sortRows([...fresh.filter((r) => !r.is_archived), ...existing.filter((r) => !ids.has(r.id))]);
}

/**
 * Una página fresca del servidor manda dentro de SU ventana (de su fila más vieja hacia arriba):
 * lo que había ahí y ya no viene (archivado, borrado) se va; lo más viejo que la ventana se queda.
 * El límite es la ÚLTIMA fila de la página en el orden del servidor (received_at desc, id desc):
 * con varias filas a la misma hora, las que quedaron fuera del corte (id menor) se conservan.
 * `laneOf` separa los carriles que el servidor corta por separado (enlazado / resto): cada uno
 * tiene su propia ventana. Un carril que no trae nada no toca lo que había de ese carril.
 */
export function mergeWindow(existing: InboxRow[], fresh: InboxRow[], laneOf: (r: InboxRow) => string = () => "all"): InboxRow[] {
  const floor = new Map<string, { t: number; id: string }>();
  for (const r of fresh) {
    const k = laneOf(r);
    const t = ts(r.received_at);
    const f = floor.get(k);
    if (!f || t < f.t || (t === f.t && r.id < f.id)) floor.set(k, { t, id: r.id });
  }
  const ids = new Set(fresh.map((r) => r.id));
  const keep = existing.filter((r) => {
    if (ids.has(r.id)) return false;
    const f = floor.get(laneOf(r));
    if (!f) return true;
    const t = ts(r.received_at);
    return t < f.t || (t === f.t && r.id < f.id);
  });
  return sortRows([...fresh, ...keep]);
}

/** Carril de mobile_inbox_feed al que pertenece una fila. */
export const feedLane = (r: InboxRow) => (r.lead_id || r.campaign_id ? "linked" : "other");

/** La fecha de guardado más nueva (desde dónde pedir lo nuevo). */
export function newestCreated(rows: InboxRow[], prev: string | null = null): string | null {
  let best = prev;
  for (const r of rows) if (r.created_at && (!best || ts(r.created_at) > ts(best))) best = r.created_at;
  return best;
}

/** Others se pagina: mientras quede más abajo, sólo se enseña hasta donde llega lo cargado (si
 *  no, entre lo de hace una hora y lo de hace días habría un hueco que se rellena al bajar). */
export function withinOthersWindow(c: Conversation, othersFloor: string | null | undefined): boolean {
  if (c.tab !== "others" || !othersFloor) return true;
  return ts(c.receivedAt) >= ts(othersFloor);
}

/** Estado que se enseña: el elegido a mano (si lo hay) o el deducido. */
export function effectiveStatus(c: Conversation, manual: Map<string, LeadStatus>): LeadStatus {
  return manual.get(c.email) ?? c.derivedStatus;
}

export interface MobileFilters {
  tab: "primary" | "others";
  status: LeadStatus | null;
  accountId: string | null;
  campaignId: string | null;
  unreadOnly: boolean;
  importantOnly: boolean;
  folderId: string | null;
  search: string;
}

export const EMPTY_FILTERS: MobileFilters = {
  tab: "primary", status: null, accountId: null, campaignId: null,
  unreadOnly: false, importantOnly: false, folderId: null, search: "",
};

/** Todo lo que no es la pestaña ni el estado (lo comparten la lista y los contadores). */
export function matchesScope(c: Conversation, f: MobileFilters): boolean {
  if (f.accountId && c.accountId !== f.accountId) return false;
  if (f.campaignId && c.campaignId !== f.campaignId) return false;
  if (f.unreadOnly && c.unreadIds.length === 0) return false;
  if (f.importantOnly && !c.important) return false;
  if (f.folderId && c.folderId !== f.folderId) return false;
  const q = f.search.trim().toLowerCase();
  if (q) {
    const hay = `${c.name} ${c.email} ${c.subject} ${c.preview}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function filterConversations(list: Conversation[], f: MobileFilters, manual: Map<string, LeadStatus>, othersFloor: string | null = null): Conversation[] {
  return list.filter((c) =>
    c.tab === f.tab
    && withinOthersWindow(c, othersFloor)
    && matchesScope(c, f)
    && (!f.status || effectiveStatus(c, manual) === f.status));
}

/** Contador por estado del menú de filtros: las conversaciones de la PESTAÑA abierta (y del resto
 *  de filtros), las mismas que se ven al tocar ese estado. Antes sumaba Primary y Others y el
 *  número no cuadraba con la lista (Out of office decía ~450 estando en Primary). */
export function statusCounts(list: Conversation[], f: MobileFilters, manual: Map<string, LeadStatus>, othersFloor: string | null = null) {
  const counts = {} as Record<LeadStatus, { total: number; unread: number }>;
  for (const s of LEAD_STATUSES) counts[s.id] = { total: 0, unread: 0 };
  for (const c of list) {
    if (c.tab !== f.tab || !withinOthersWindow(c, othersFloor) || !matchesScope(c, f)) continue;
    const s = counts[effectiveStatus(c, manual)];
    s.total++;
    if (c.unreadIds.length) s.unread++;
  }
  return counts;
}

/* ── Fechas (en inglés, como el diseño) ──────────────────────────────────── */

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Lista: "10:24 AM" hoy, "Yesterday" ayer y "October 2, 2026" antes. */
export function listDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  if (sameDay(d, now)) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Detalle: "Friday, October 2, 2026 at 8:24 pm". */
export function detailDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return `${day} at ${time}`;
}

/** "El 2 oct 2026, 20:24, Nombre <a@b.com> escribió:" — la misma cabecera que pone el escritorio. */
export function quoteHeader(m: { received_at?: string | null; from_name?: string | null; from_email?: string | null }): string {
  const when = m.received_at
    ? new Date(m.received_at).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const who = [String(m.from_name || "").trim(), m.from_email ? `<${m.from_email}>` : ""].filter(Boolean).join(" ");
  if (!who) return "";
  return when ? `El ${when}, ${who} escribió:` : `${who} escribió:`;
}

/** "Re: Asunto" sin repetir el "Re:". */
export function replySubject(subject: string | null | undefined): string {
  const s = decodeSubject(subject ?? null) || "";
  return /^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`;
}

/* ── Editor: DOM → texto que entiende send-email ─────────────────────────── */

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escHtml(s).replace(/"/g, "&quot;");

/**
 * El contenido del cuadro de respuesta → el "texto fuente" que manda send-email: líneas con \n y,
 * como único marcado, <b>, <i>, <u>, <a href> y <span style="font-size">. send-email arma los
 * párrafos a partir de los saltos de línea. Si no hay ningún formato se manda texto plano sin
 * escapar (el servidor escapa él mismo; si lo hiciéramos aquí saldría "&amp;").
 */
const FONT_SIZES: Record<string, string> = { "1": "12px", "2": "13px", "4": "17px", "5": "19px", "6": "24px" };

/** La etiqueta de formato que corresponde a un elemento del editor (o null si no lleva). */
function formatTags(el: HTMLElement): [string, string] | null {
  const tag = el.tagName;
  const st = el.style;
  if (tag === "B" || tag === "STRONG" || /^(bold|[6-9]00)$/.test(st?.fontWeight || "")) return ["<b>", "</b>"];
  if (tag === "I" || tag === "EM" || st?.fontStyle === "italic") return ["<i>", "</i>"];
  if (tag === "U" || /underline/.test(st?.textDecoration || "")) return ["<u>", "</u>"];
  if (tag === "A") {
    const href = el.getAttribute("href") || "";
    return /^(https?:|mailto:|tel:)/i.test(href) ? [`<a href="${escAttr(href)}">`, "</a>"] : null;
  }
  const size = tag === "FONT" ? FONT_SIZES[el.getAttribute("size") || ""] : st?.fontSize;
  return size && /^\d{1,2}px$/.test(size) ? [`<span style="font-size:${size}">`, "</span>"] : null;
}

export function editorToSource(root: Node): string {
  const render = (withTags: boolean) => {
    let out = "";
    let marked = false;
    const newline = () => { if (out.length > 0 && !out.endsWith("\n")) out += "\n"; };
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.nodeValue || "").replace(/\u00a0/g, " ");
        out += withTags ? escHtml(t) : t;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      if (el.tagName === "BR") { out += "\n"; return; }
      const block = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(el.tagName);
      if (block) newline();
      const tags = (el.textContent || "").trim() ? formatTags(el) : null;
      if (tags) { marked = true; if (withTags) out += tags[0]; }
      el.childNodes.forEach(walk);
      if (tags && withTags) out += tags[1];
      if (block) newline();
    };
    root.childNodes.forEach(walk);
    return { out, marked };
  };
  // Primero sin etiquetas para saber si hay formato; si lo hay, otra vez escapando y con ellas.
  const plain = render(false);
  const out = plain.marked ? render(true).out : plain.out;
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}
