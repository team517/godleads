// Avisos de consumo del plan en pantalla (12-11-2026). Parte pura: se prueba con vitest.
// El servidor (edge function plan-usage-alerts) cuenta los envíos del mes de toda la familia
// del plan (el dueño + las cuentas de sus clientes) y devuelve el nivel: 80, 95 o 100 %.

export type PlanAlert = {
  level: 80 | 95 | 100;
  pct: number;
  sent: number;
  limit: number;
  plan: string;
  periodStart: string;
  accounts: number;
};

/** De la respuesta de la función al aviso (o null si no hay nada que avisar). */
export function toPlanAlert(raw: unknown): PlanAlert | null {
  const r = (raw || {}) as Record<string, unknown>;
  const level = Number(r.level);
  if (!(level === 80 || level === 95 || level === 100)) return null;
  const limit = Number(r.limit);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return {
    level: level as PlanAlert["level"],
    pct: Number(r.pct) || 0,
    sent: Number(r.sent) || 0,
    limit,
    plan: String(r.plan || ""),
    periodStart: String(r.period_start || ""),
    accounts: Number(r.accounts) || 1,
  };
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-ES");

export function planAlertCopy(a: PlanAlert): { title: string; text: string; tone: "info" | "warning" | "danger" } {
  const clientes = a.accounts > 1 ? " (contando lo que envían tus clientes)" : "";
  if (a.level >= 100) {
    return {
      title: "Has llegado al límite de envíos de este mes",
      text: `${fmt(a.sent)} de ${fmt(a.limit)} correos${clientes}. Sube de plan para que tus campañas sigan enviando sin cortes.`,
      tone: "danger",
    };
  }
  return {
    title: `Llevas el ${a.level} % de tus envíos de este mes`,
    text: `${fmt(a.sent)} de ${fmt(a.limit)} correos${clientes}. Deberías aumentar el plan antes de quedarte sin envíos.`,
    tone: a.level >= 95 ? "warning" : "info",
  };
}

/** El aviso cerrado se recuerda por mes y nivel: si sube de nivel, vuelve a salir. */
export function planAlertDismissKey(a: Pick<PlanAlert, "periodStart" | "level">): string {
  return `fl_plan_alert_dismissed:${a.periodStart}:${a.level}`;
}
