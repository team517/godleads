// Consumo del plan, en cifras y en palabras.
//
// El plan se vende por CORREOS AL MES y por BUZONES (PLAN_CONFIG: emailsPerMonth,
// maxAccounts). El consumo lo cuenta el servidor sumando toda la "familia" del plan
// — el dueño y sus cuentas de cliente — con my_monthly_send_usage() y
// my_mailbox_usage(), porque lo que envía un cliente gasta el plan de su dueño.
//
// Aquí sólo hay presentación: formatos, porcentaje y el tono del aviso. NO se
// decide nada — pasado el 100 % la interfaz avisa en rojo, pero no bloquea: el
// motor de envío es quien topa, y el tope de plazas lo aplica la edge function.

/** Qué tan grave es el consumo. `over` = ya se pasó de lo que incluye el plan. */
export type UsageTone = "ok" | "warn" | "over";

/** Desde el 80 % avisa (ámbar) y al llegar al 100 % lo dice en rojo. Un plan sin
 *  tope (Infinity, o un plan gratuito) nunca avisa: no hay nada de lo que avisar. */
export function usageTone(used: number, limit: number): UsageTone {
  if (!Number.isFinite(limit) || limit <= 0) return "ok";
  const pct = used / limit;
  if (pct >= 1) return "over";
  if (pct >= 0.8) return "warn";
  return "ok";
}

/** Porcentaje para la barra, recortado a 0–100 (la barra no crece más allá del tope). */
export function usagePct(used: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

const fmt = (n: number) => Math.max(0, Math.round(n)).toLocaleString("es-ES");

/** "12.345 de 180.000 correos este mes" — sin tope, sólo la cifra enviada. */
export function monthlyEmailsLine(enviados: number, limit: number): string {
  return Number.isFinite(limit)
    ? `${fmt(enviados)} de ${fmt(limit)} correos este mes`
    : `${fmt(enviados)} correos este mes`;
}

/** "37 de 200 buzones conectados" — sin tope, "buzones conectados" a secas. */
export function mailboxLine(conectados: number, limit: number): string {
  return Number.isFinite(limit)
    ? `${fmt(conectados)} de ${fmt(limit)} buzones conectados`
    : `${fmt(conectados)} buzones conectados`;
}

/** Aclara que la cifra NO es sólo la del dueño. `cuentas` es el tamaño de la
 *  familia que ha sumado el servidor (1 = sólo él), así que con 1 no hay nada que
 *  explicar y devuelve null. */
export function familyNote(cuentas: number): string | null {
  const clientes = Math.max(0, (cuentas || 1) - 1);
  if (clientes < 1) return null;
  return clientes === 1
    ? "Incluye lo que envía la cuenta de tu cliente."
    : `Incluye lo que envían las ${fmt(clientes)} cuentas de tus clientes.`;
}
