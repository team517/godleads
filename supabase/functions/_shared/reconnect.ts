// Reconexión automática de cuentas: cuándo volver a probar una cuenta desconectada.
// Parte pura (se prueba con vitest).
//
// Una cuenta pasa a "error" / "auth_failed" cuando el motor recibe un 535 o una verificación falla
// de forma definitiva, y ahí se quedaba para siempre aunque el fallo fuera pasajero (IONOS frena las
// verificaciones en masa, bloqueos que luego se levantan…). Ahora se vuelve a probar sola, cada vez
// más espaciado para no insistir, y en cuanto funciona vuelve a "connected".

/** "pending" = subida pero nunca comprobada (p. ej. tras volver a subir cuentas): también se prueba,
 *  y si entra queda conectada. Si falla, su estado NO se toca (sólo se apunta el intento). */
export const ESTADOS_DESCONECTADOS = ["error", "auth_failed", "pending"];
/** Cuántas cuentas se prueban en cada pasada (cada 5 min) y cuántas a la vez: no agobiar al proveedor. */
export const POR_PASADA = 20;
export const A_LA_VEZ = 5;

const MIN = 60_000;
/** Esperas tras cada intento fallido: 15 min, 1 h, 3 h y luego cada 6 h (un inicio de sesión cada
 *  6 h no molesta a nadie y, cuando el proveedor desbloquea, la cuenta vuelve en pocas horas). */
const ESPERAS = [15 * MIN, 60 * MIN, 180 * MIN, 360 * MIN];
/** Una cuenta que lleva estos días bien sin volver a caerse empieza de cero la próxima vez. */
export const OLVIDAR_TRAS_MS = 3 * 24 * 3600_000;

/** Fallo de red / tiempo agotado: no dice nada de la cuenta, se reintenta pronto sin contarlo. */
export const esTransitorio = (err: string | null | undefined) =>
  /timeout|timed?\s*out|econnreset|connection reset|network|temporar|try again|\b(421|451|454|503)\b|abort/i.test(String(err || ""));

/** Cuánto esperar tras el intento número `intentos` (1 = primer fallo), en milisegundos. */
export function esperaSiguiente(intentos: number, transitorio: boolean): number {
  if (transitorio) return 15 * MIN;
  return ESPERAS[Math.min(Math.max(intentos - 1, 0), ESPERAS.length - 1)];
}

export interface Seguimiento { account_id: string; intentos: number; next_at: string | null; reconectada_at?: string | null; updated_at?: string | null }

/**
 * Qué cuentas desconectadas toca probar ya. Sin seguimiento = recién caída, se prueba la primera.
 * Tras una reconexión se deja `next_at` puesto: si la cuenta vuelve a caerse enseguida no se prueba
 * al momento (así una cuenta que va y viene no entra en bucle de conectar/desconectar).
 */
export function aProbar(desconectadas: string[], seguimiento: Seguimiento[], ahora: number, max = POR_PASADA): string[] {
  const porId = new Map(seguimiento.map((s) => [s.account_id, s]));
  const cuando = (id: string) => {
    const s = porId.get(id);
    return s?.next_at ? Date.parse(s.next_at) : 0;
  };
  return desconectadas
    .filter((id) => cuando(id) <= ahora)
    .sort((a, b) => cuando(a) - cuando(b))
    .slice(0, max);
}

/** Resultado de un intento → cómo queda el seguimiento. */
export function trasIntento(prev: Seguimiento | undefined, id: string, ok: boolean, error: string | null, ahora: number) {
  const intentos = prev?.intentos ?? 0;
  if (ok) {
    // Se guarda cuándo podría volver a probarse si se cae otra vez (con la espera que ya llevaba).
    return {
      account_id: id, intentos, last_error: null,
      next_at: new Date(ahora + (intentos > 0 ? esperaSiguiente(intentos, false) : 0)).toISOString(),
      reconectada_at: new Date(ahora).toISOString(),
    };
  }
  const transitorio = esTransitorio(error);
  const n = transitorio ? intentos : intentos + 1;
  return {
    account_id: id, intentos: n, last_error: (error || "").slice(0, 300),
    next_at: new Date(ahora + esperaSiguiente(Math.max(n, 1), transitorio)).toISOString(),
    reconectada_at: prev?.reconectada_at ?? null,
  };
}

/** Seguimientos que ya se pueden olvidar: cuenta conectada y lleva días sin volver a caerse. */
export function olvidables(seguimiento: Seguimiento[], conectadas: Set<string>, ahora: number): string[] {
  return seguimiento
    .filter((s) => {
      const desde = s.reconectada_at || s.updated_at;
      return conectadas.has(s.account_id) && !!desde && ahora - Date.parse(desde) > OLVIDAR_TRAS_MS;
    })
    .map((s) => s.account_id);
}
