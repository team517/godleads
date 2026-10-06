// Panel que dice la verdad: por qué una campaña "Activa" no envía, y respuestas humanas vs. automáticas.
//
// Los datos vienen de dos RPC (supabase/migrations/20261006144000_* y 20261006144001_*):
//   * campaign_health_mine()    → una fila por campaña ACTIVA con lo necesario para decir por qué no sale nada.
//   * campaign_metrics_extra()  → por campaña: replied_human, replied_auto, sent_unconfirmed.
// Ambas son opcionales: si la migración aún no está aplicada (o la llamada falla) la pantalla se ve
// como antes — sin chip, con la cifra de respuestas de siempre — en vez de enseñar ceros inventados.

type RpcError = { message: string; code?: string } | null;
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }> };

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// ───────────────────────── Salud de una campaña activa ─────────────────────────

/** Fila de campaign_health_mine() ya normalizada (todo número; `in_window` null si no se sabe). */
export type CampaignHealthRow = {
  campaign_id: string;
  pending_leads: number;
  in_progress_leads: number;
  total_accounts: number;
  connected_accounts: number;
  /** Buzones conectados con cupo hoy. */
  sendable_accounts: number;
  sent_today: number;
  /** Tope del día (campaña ∧ suma de buzones); 0 = desconocido. */
  day_cap: number;
  in_window: boolean | null;
  minutes_into_window: number | null;
  last_sent_at: string | null;
  sent_24h: number;
};

export type HealthReasonKey = "no_mailboxes" | "off_hours" | "daily_cap" | "no_leads" | "no_sends_24h";

export type HealthReason = {
  key: HealthReasonKey;
  /** Texto del chip. */
  label: string;
  /** "warn" = algo que arreglar; "muted" = informativo (p. ej. es de noche). */
  tone: "warn" | "muted";
  /** Explicación al pasar el ratón. */
  title: string;
};

/** Pasada la apertura de la franja: antes de esto, "sin envíos en 24 h" puede ser sólo que acaba de abrir. */
const GRACE_MINUTES_AFTER_OPEN = 30;

/**
 * Primera razón por la que una campaña ACTIVA no puede (o no está) enviando; null si todo cuadra o si
 * no hay datos. El orden importa: la causa más "de fondo" gana. Pura: sin red ni reloj.
 */
export function campaignHealthReason(
  status: string | null | undefined,
  h: CampaignHealthRow | null | undefined,
): HealthReason | null {
  if (status !== "active" || !h) return null;

  if (h.connected_accounts <= 0) {
    return {
      key: "no_mailboxes", label: "Sin buzones", tone: "warn",
      title: h.total_accounts > 0
        ? `Ninguno de los ${h.total_accounts.toLocaleString("es-ES")} buzones de la campaña está conectado: no puede enviar.`
        : "La campaña no tiene buzones asignados (ni directos ni por etiqueta): no puede enviar.",
    };
  }

  if (h.in_window === false) {
    return {
      key: "off_hours", label: "Fuera de horario", tone: "muted",
      title: "Ahora mismo queda fuera de los días y la franja horaria de envío de la campaña; retomará sola dentro de su franja.",
    };
  }

  const capReached = h.sendable_accounts <= 0 || (h.day_cap > 0 && h.sent_today >= h.day_cap);
  if (capReached) {
    return {
      key: "daily_cap", label: "Tope diario alcanzado", tone: "muted",
      title: h.sendable_accounts <= 0
        ? "Todos los buzones conectados han llegado a su límite diario; seguirá mañana."
        : `Ha enviado ${h.sent_today.toLocaleString("es-ES")} de ${h.day_cap.toLocaleString("es-ES")} permitidos hoy; seguirá mañana.`,
    };
  }

  if (h.pending_leads + h.in_progress_leads <= 0) {
    return {
      key: "no_leads", label: "Sin leads pendientes", tone: "warn",
      title: "No quedan leads por escribir ni en secuencia: añade leads o marca la campaña como completada.",
    };
  }

  if (h.sent_24h <= 0 && (h.minutes_into_window == null || h.minutes_into_window >= GRACE_MINUTES_AFTER_OPEN)) {
    return {
      key: "no_sends_24h", label: "Sin envíos en 24 h", tone: "warn",
      title: h.last_sent_at
        ? `Hay buzones, leads y franja abierta, pero el último envío fue el ${new Date(h.last_sent_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Revisa el estado de los buzones o espera a la próxima pasada del motor.`
        : "Hay buzones, leads y franja abierta, pero no ha enviado nada todavía. Revisa el estado de los buzones o espera a la próxima pasada del motor.",
    };
  }

  return null;
}

/** Clases del chip (mismos tokens que el resto de pastillas de la tabla). */
export function healthChipClass(tone: HealthReason["tone"]): string {
  return tone === "warn"
    ? "bg-warning/15 text-warning border-warning/30"
    : "bg-muted text-muted-foreground border-border";
}

/** Lee campaign_health_mine(); mapa vacío si falla o la función aún no existe (sin chips, sin ruido). */
export async function fetchCampaignHealth(client: RpcClient): Promise<Record<string, CampaignHealthRow>> {
  const map: Record<string, CampaignHealthRow> = {};
  const r = await client.rpc("campaign_health_mine", {});
  if (r.error || !Array.isArray(r.data)) return map;
  for (const row of r.data as Record<string, unknown>[]) {
    const id = String(row.campaign_id || "");
    if (!id) continue;
    map[id] = {
      campaign_id: id,
      pending_leads: n(row.pending_leads),
      in_progress_leads: n(row.in_progress_leads),
      total_accounts: n(row.total_accounts),
      connected_accounts: n(row.connected_accounts),
      sendable_accounts: n(row.sendable_accounts),
      sent_today: n(row.sent_today),
      day_cap: n(row.day_cap),
      in_window: typeof row.in_window === "boolean" ? row.in_window : null,
      minutes_into_window: row.minutes_into_window == null ? null : n(row.minutes_into_window),
      last_sent_at: row.last_sent_at ? String(row.last_sent_at) : null,
      sent_24h: n(row.sent_24h),
    };
  }
  return map;
}

// ───────────────────── Respuestas humanas vs. automáticas, envíos sin confirmar ─────────────────────

export type MetricsExtra = { repliedHuman: number; repliedAuto: number; sentUnconfirmed: number };

/** Lee campaign_metrics_extra(); mapa vacío si falla o no existe (la pantalla cae a `replied`). */
export async function fetchMetricsExtra(client: RpcClient): Promise<Record<string, MetricsExtra>> {
  const map: Record<string, MetricsExtra> = {};
  const r = await client.rpc("campaign_metrics_extra", {});
  if (r.error || !Array.isArray(r.data)) return map;
  for (const row of r.data as Record<string, unknown>[]) {
    const id = String(row.campaign_id || "");
    if (!id) continue;
    map[id] = { repliedHuman: n(row.replied_human), repliedAuto: n(row.replied_auto), sentUnconfirmed: n(row.sent_unconfirmed) };
  }
  return map;
}

type ReplyFields = { replied?: number; repliedHuman?: number | null; repliedAuto?: number | null };

/**
 * Qué enseñar en "Respondidos" (06-10-2026, decisión del dueño): una sola cifra, también con las
 * automáticas, sin «+N automáticas». Es `replied` de campaign_metrics_v2: leads de la campaña a los
 * que se escribió y que contestaron (sent_emails.replied_at), así que nunca supera a los contactados.
 * El desglose por mensajes entrantes NO se usa para la cifra: cuenta también a gente que escribió a
 * la campaña sin haber sido contactada (pruebas, compañeros del mismo dominio) y en hello@ una
 * campaña de prueba con 1 contactado salía con 8 respuestas = 800 %.
 */
export function repliesView(m: ReplyFields | null | undefined): { shown: number; auto: number; split: boolean } {
  return { shown: Math.max(0, Number(m?.replied) || 0), auto: 0, split: false };
}

/** % de respuesta de una campaña, acotado a 0-100 (respondidos nunca por encima de contactados). */
export function replyRatePct(replied: number, contacted: number): number | null {
  if (!(contacted > 0)) return null;
  return (Math.min(Math.max(0, replied), contacted) / contacted) * 100;
}

/** "+12 automáticas" (vacío si no hay). */
export function autoRepliesLabel(auto: number): string {
  if (!auto || auto <= 0) return "";
  return `+${auto.toLocaleString("es-ES")} ${auto === 1 ? "automática" : "automáticas"}`;
}

export const REPLIES_TOOLTIP =
  "Destinatarios que han contestado, incluidas las respuestas automáticas (fuera de oficina…).";

/** Tooltip de "Enviados": son aceptados por el servidor, no entregados. */
export function sentTooltip(sent: number, unconfirmed: number | null | undefined): string {
  const base = "Aceptados por el servidor de correo: no garantiza que lleguen a la bandeja. Los rebotes confirmados salen aparte en «Rebotados».";
  const u = Number(unconfirmed) || 0;
  if (u <= 0) return base;
  return `${base} ${u.toLocaleString("es-ES")} de ${sent.toLocaleString("es-ES")} se dieron por enviados sin confirmación final (el servidor tardó en responder tras el envío).`;
}

/** Suma de las respuestas de todas las campañas (para Estadísticas y Dashboard). null si no hay datos. */
export function sumMetricsExtra(map: Record<string, MetricsExtra> | null | undefined): { human: number; auto: number } | null {
  const vals = map ? Object.values(map) : [];
  if (!vals.length) return null;
  return {
    human: vals.reduce((s, v) => s + v.repliedHuman, 0),
    auto: vals.reduce((s, v) => s + v.repliedAuto, 0),
  };
}
