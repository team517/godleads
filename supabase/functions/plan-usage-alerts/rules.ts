// Reglas puras de los avisos de consumo del plan (12-11-2026). Sin red: se prueban con vitest.
//
// Lo que se cuenta: los correos ENVIADOS este mes (hora de Madrid) por toda la familia del plan
// — el dueño y las cuentas de sus clientes —, frente a los correos al mes de su plan.

export const ALERT_THRESHOLDS = [80, 95, 100] as const;
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number];

/** Correos al mes de cada plan (los mismos que PLAN_CONFIG en la app). */
export const PLAN_EMAILS_MONTH: Record<string, number> = { starter: 15000, growth: 180000, scale: 500000 };
const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", scale: "Pack Agency" };

export type EntitlementRow = {
  tier?: string | null;
  status?: string | null;
  plan_emails_month?: number | string | null;
  custom_level?: number | string | null;
} | null;

/** Tope de correos al mes del plan de pago, o null si no hay tope (sin plan de pago, equipo,
 *  cuentas antiguas gratis…). Sólo cuentan suscripciones vivas (active / trialing). */
export function monthlyLimitFor(ent: EntitlementRow): { limit: number; label: string } | null {
  if (!ent) return null;
  const status = String(ent.status || "");
  if (status !== "active" && status !== "trialing") return null;
  const custom = Number(ent.plan_emails_month);
  if (Number.isFinite(custom) && custom > 0) {
    return { limit: custom, label: ent.custom_level ? `a medida (nivel ${ent.custom_level})` : "a medida" };
  }
  const tier = String(ent.tier || "");
  const limit = PLAN_EMAILS_MONTH[tier];
  return limit ? { limit, label: PLAN_LABEL[tier] } : null;
}

/** Día (AAAA-MM-DD) en hora de Madrid: el mes empieza el día 1 allí, no en UTC. */
export function madridDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function usagePct(sent: number, limit: number): number {
  if (!limit || limit <= 0) return 0;
  return Math.floor((Math.max(0, sent) / limit) * 1000) / 10;
}

/** Umbrales alcanzados con este consumo, de menor a mayor. */
export function crossedThresholds(sent: number, limit: number): AlertThreshold[] {
  const pct = usagePct(sent, limit);
  return ALERT_THRESHOLDS.filter((t) => pct >= t);
}

/** El aviso que toca mandar por correo: el umbral más alto que aún no se había avisado.
 *  Si de golpe se pasa del 80 al 100 %, sale UN correo (el del 100 %), no tres. */
export function thresholdToEmail(crossed: readonly number[], alreadySent: readonly number[]): number | null {
  const nuevos = crossed.filter((t) => !alreadySent.includes(t));
  return nuevos.length ? Math.max(...nuevos) : null;
}

export function alertSubject(level: number): string {
  if (level >= 100) return "Has llegado al límite de envíos de tu plan este mes";
  return `Llevas el ${level} % de los envíos de tu plan este mes`;
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-ES");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** El correo del aviso: Funnyleads, una barra de consumo y el botón "Mejorar mi plan". */
export function alertEmailHtml(o: { level: number; sent: number; limit: number; planLabel: string; link: string; clientAccounts: number }): string {
  const pct = Math.min(100, usagePct(o.sent, o.limit));
  const color = o.level >= 100 ? "#DC2626" : o.level >= 95 ? "#EA580C" : "#6E58F1";
  const titulo = o.level >= 100
    ? "Has llegado al límite de envíos de este mes"
    : `Llevas el ${o.level} % de tus envíos de este mes`;
  const texto = o.level >= 100
    ? "Para que tus campañas sigan enviando sin cortes, sube de plan o pásate a un plan a medida."
    : "Si vas a seguir a este ritmo, te conviene subir de plan antes de quedarte sin envíos.";
  const familia = o.clientAccounts > 1
    ? `<p style="margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#65768D;">Incluye lo que envían las cuentas de tus clientes (${o.clientAccounts - 1}): todo cuenta en tu plan.</p>`
    : "";
  const link = esc(o.link);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F6F4FC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4FC;padding:32px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E6E3F0;border-radius:16px;">
<tr><td style="padding:32px;">
<p style="margin:0 0 20px 0;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#0F172B;">Funnyleads</p>
<h1 style="margin:0 0 10px 0;font-size:22px;line-height:1.3;font-weight:700;color:#0F172B;">${esc(titulo)}</h1>
<p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#45556C;">${esc(texto)}</p>
<p style="margin:0 0 6px 0;font-size:14px;color:#0F172B;"><strong>${fmt(o.sent)}</strong> de ${fmt(o.limit)} correos · plan ${esc(o.planLabel)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEEBF7;border-radius:999px;"><tr><td style="height:10px;width:${pct}%;background:${color};border-radius:999px;"></td><td></td></tr></table>
${familia}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td style="border-radius:12px;background:#6E58F1;">
<a href="${link}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">Mejorar mi plan</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 28px 32px;"><p style="margin:0;font-size:12px;line-height:1.6;color:#94A0B4;">Te avisamos al 80 %, al 95 % y al 100 % de los envíos de cada mes, una sola vez cada uno.</p></td></tr>
</table>
</td></tr></table>
</body></html>`;
}
