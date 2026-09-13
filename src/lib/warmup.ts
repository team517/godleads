// Límite diario efectivo de una cuenta con arranque lento (warm-up).
//
// FUENTE DE VERDAD: process-campaign-queue.getEffectiveLimit (el motor). Esta
// función replica esa fórmula EXACTA para que la pantalla muestre el mismo número
// que el motor usa para enviar — ni uno más.
//
// La clave es `realSendDays`: los días en que la cuenta envió DE VERDAD dentro de
// una campaña (del RPC my_account_sending_days), NO los días de calendario. Así:
//   - una cuenta con warm-up pero sin campaña activa → 0 días → se queda en el
//     escalón inicial, no "sube sola";
//   - un fin de semana o un día sin envíos → no cuenta → la rampa no avanza.

export const HARD_DAILY_CAP = 30;

export interface WarmupAccount {
  daily_limit?: number | null;
  warmup_enabled?: boolean | null;
  warmup_started_at?: string | null;
  warmup_increment?: number | null;
  warmup_limit?: number | null;
  warmup_day?: number | null; // reutilizado como límite del día 1 (base de arranque)
}

/**
 * @param acc          la cuenta
 * @param realSendDays días de envío reales previos (my_account_sending_days). Si
 *                     no se ha cargado aún, pasa null: se asume 0 (escalón inicial),
 *                     nunca un número de calendario.
 */
export function effectiveDailyLimit(
  acc: WarmupAccount | null | undefined,
  realSendDays: number | null | undefined,
): { limit: number; accRampDay: number | null; warming: boolean } {
  let limit = Math.min(acc?.daily_limit ?? HARD_DAILY_CAP, HARD_DAILY_CAP);

  if (acc?.warmup_enabled && acc?.warmup_started_at) {
    const days = Math.max(0, realSendDays ?? 0);
    const inc = acc.warmup_increment || 2;
    const target = acc.warmup_limit || limit;
    // warmup_day (reutilizado) = límite del día 1; 0/ausente → arranca en `inc`.
    const startBase = acc.warmup_day && acc.warmup_day > 0 ? acc.warmup_day : inc;
    // Durante el warm-up el valor de la rampa ES el tope del día (no se suelo con
    // daily_limit, igual que el motor), y HARD_DAILY_CAP lo acota.
    const accRamp = Math.min(startBase + days * inc, target);
    return { limit: Math.max(1, Math.min(accRamp, HARD_DAILY_CAP)), accRampDay: days + 1, warming: true };
  }

  return { limit: Math.max(1, limit), accRampDay: null, warming: false };
}

/** Mapa {account_id: días de envío reales} desde el RPC. Tolera fila/array. */
export function sendDaysMap(rows: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
  for (const r of arr as any[]) {
    if (r && r.account_id != null) out[String(r.account_id)] = Number(r.days) || 0;
  }
  return out;
}
