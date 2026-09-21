// Escalado del motor de envío para campañas GRANDES (decenas de miles de leads, cientos de
// buzones). Puro —sin red ni Deno— para poder probarlo.
//
// Nada de aquí cambia la cadencia de un buzón (1 correo por pasada, 6–9 min de espera, 30/día):
// eso lo sigue mandando el motor. Aquí sólo se decide cuántos buzones DISTINTOS de una misma
// campaña pueden enviar en la misma pasada, y cómo pedir listas largas sin romper la API.

/** Tope histórico: 4 correos por campaña y pasada. Es el suelo — ninguna campaña baja de aquí. */
export const MIN_SENDS_PER_CAMPAIGN_PER_TICK = 4;
/** Techo: un tercio del presupuesto de una pasada (72) → siempre se intercalan ≥3 campañas. */
export const MAX_SENDS_PER_CAMPAIGN_PER_TICK = 24;
/** Margen sobre el ritmo lineal, para recuperar el paso tras una pasada saltada o un buzón en espera. */
const CATCH_UP = 1.25;

/**
 * Cuántos correos puede enviar UNA campaña en una pasada (el cron es de 1 minuto).
 *
 * Con el tope fijo de 4 una campaña no pasaba de ~2.160 correos/día tuviera los buzones que
 * tuviera: con 300 buzones a 30/día (9.000/día) habría usado un 24 % de su capacidad. Ahora el
 * tope sigue a la capacidad diaria REAL de la campaña (suma de los límites de sus buzones, ya
 * con slow-ramp), repartida en su ventana de envío.
 *
 *   1.551/día en 9 h → 2,9/min × 1,25 = 3,6 → 4   (la mayor de hoy: igual que siempre)
 *   9.000/día en 9 h → 16,7/min × 1,25 = 20,8 → 21
 *  12.000/día en 9 h → 22,2/min × 1,25 = 27,8 → 24  (techo)
 */
export function perTickCampaignCap(campaignDailyLimit: number, windowMinutes: number): number {
  const limit = Number(campaignDailyLimit);
  const minutes = Number(windowMinutes);
  if (!Number.isFinite(limit) || !Number.isFinite(minutes) || limit <= 0 || minutes <= 0) {
    return MIN_SENDS_PER_CAMPAIGN_PER_TICK;
  }
  const needed = Math.ceil((limit / minutes) * CATCH_UP);
  return Math.max(MIN_SENDS_PER_CAMPAIGN_PER_TICK, Math.min(MAX_SENDS_PER_CAMPAIGN_PER_TICK, needed));
}

/**
 * Trocea una lista de ids para un `.in()`. La API corta la URL entre 21 y 32 KB (medido:
 * 600 uuids → 200, 900 → HTTP 400) y una campaña con ~900 buzones se quedaba SIN cuentas y no
 * enviaba nada, sin error. 200 uuids ≈ 7 KB: holgado.
 */
export const IN_CHUNK = 200;
export function chunkIds<T>(ids: T[], size: number = IN_CHUNK): T[][] {
  const n = Math.max(1, Math.floor(size) || IN_CHUNK);
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

/** Orden que ya usaba el motor para sus cuentas: las que menos han enviado hoy, primero. */
export function sortBySentToday<T extends { sent_today?: number | null }>(accounts: T[]): T[] {
  return [...accounts].sort((a, b) => (a.sent_today || 0) - (b.sent_today || 0));
}
