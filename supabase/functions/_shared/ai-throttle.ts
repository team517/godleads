// Control de ritmo de las llamadas al modelo: que nunca choquemos con el límite de uso de la API
// ni carguemos la máquina.
//
// Por qué existe: el clasificador llama a DeepSeek desde un cron que se dispara cada 2 minutos.
// El ritmo normal (60 llamadas por tanda = 30/minuto) nunca da problemas, pero un repaso del
// histórico lanzó ~1.000 llamadas en pocos minutos y la API devolvió 429; el cortacircuitos paró
// el modelo y esa tanda se etiquetó sólo con reglas (2026-09-18). La lección: hace falta un
// ritmo que se recuerde ENTRE ejecuciones, no sólo dentro de una.
//
// Aquí vive la parte comprobable: cuántas llamadas caben ahora y cuánto hay que esperar tras un
// 429. El estado se guarda en public.ai_throttle_state (una sola fila).

/** Llamadas al modelo permitidas por minuto. El doble del ritmo normal del cron y muy por debajo
 *  de lo que hizo saltar el límite: no frena el día a día y corta las ráfagas. */
export const CALLS_PER_MINUTE = 60;
/** Espera mínima tras un 429 cuando la API no dice cuánto esperar. */
export const BASE_COOLDOWN_MS = 20_000;
/** Tope de espera: el cron vuelve cada 2 minutos, así que más de esto no aporta nada. */
export const MAX_COOLDOWN_MS = 10 * 60_000;

export interface ThrottleState {
  window_started_at: string | null;
  calls_in_window: number | null;
  cooldown_until: string | null;
  consecutive_limits: number | null;
}

export interface ThrottlePlan {
  /** Cuántas llamadas se pueden hacer en esta tanda (0 = ninguna). */
  allowed: number;
  /** Si es > 0, estamos en enfriamiento: no se llama al modelo y se deja para el próximo tick. */
  cooldownMs: number;
  /** Ventana que hay que guardar (se reinicia sola cada minuto). */
  windowStart: string;
  callsInWindow: number;
}

/** ¿Cuántas llamadas caben AHORA? Reinicia la ventana si ha pasado un minuto, respeta el
 *  enfriamiento pendiente y nunca deja pedir más de lo que queda en la ventana. */
export function planCalls(state: ThrottleState | null, requested: number, nowMs: number, perMinute = CALLS_PER_MINUTE): ThrottlePlan {
  const now = new Date(nowMs).toISOString();
  const cooldownUntil = state?.cooldown_until ? Date.parse(state.cooldown_until) : 0;
  if (cooldownUntil > nowMs) {
    return { allowed: 0, cooldownMs: cooldownUntil - nowMs, windowStart: state?.window_started_at || now, callsInWindow: state?.calls_in_window || 0 };
  }
  const startedMs = state?.window_started_at ? Date.parse(state.window_started_at) : 0;
  const sameWindow = startedMs > 0 && nowMs - startedMs < 60_000;
  const used = sameWindow ? Math.max(0, state?.calls_in_window || 0) : 0;
  const room = Math.max(0, perMinute - used);
  return {
    allowed: Math.max(0, Math.min(requested, room)),
    cooldownMs: 0,
    windowStart: sameWindow ? (state!.window_started_at as string) : now,
    callsInWindow: used,
  };
}

/** Segundos que pide la API en Retry-After (número o fecha), en milisegundos. 0 si no dice nada. */
export function parseRetryAfter(header: string | null | undefined): number {
  const raw = (header || "").trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Math.min(Number(raw) * 1000, MAX_COOLDOWN_MS);
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return 0;
  return Math.min(Math.max(0, when - Date.now()), MAX_COOLDOWN_MS);
}

/** Cuánto esperar tras un 429: lo que pida la API, y si no lo dice, el doble cada vez (20 s, 40 s,
 *  80 s…) con un pellizco aleatorio para que dos ejecuciones no vuelvan a la vez. */
export function cooldownAfterLimit(consecutive: number, retryAfterMs: number, rand: () => number = Math.random): number {
  const n = Math.max(1, Math.min(consecutive, 6));
  const backoff = Math.min(BASE_COOLDOWN_MS * Math.pow(2, n - 1), MAX_COOLDOWN_MS);
  const base = Math.max(retryAfterMs, backoff);
  const jitter = 1 + rand() * 0.25;                 // +0 %..25 %
  return Math.min(Math.round(base * jitter), MAX_COOLDOWN_MS);
}

/** Pausa entre tandas para repartir las llamadas dentro del minuto en vez de soltarlas de golpe.
 *  Con 4 en paralelo y 60/minuto salen ~4 s por tanda; nunca menos de 0 ni más de 2 s. */
export function pacingGapMs(concurrency: number, perMinute = CALLS_PER_MINUTE): number {
  if (perMinute <= 0) return 2000;
  const idealMsPerCall = 60_000 / perMinute;
  return Math.max(0, Math.min(Math.round(idealMsPerCall * Math.max(1, concurrency) - 1200), 2000));
}
