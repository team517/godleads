// Freno ante un bloqueo de login de IONOS (19-10-2026).
//
// Lo que pasó el 14-10 y el 19-10: a las 9:00 IONOS ya rechazaba TODOS los logins ("535
// Authentication credentials invalid") con contraseñas buenas. El motor no lo distinguía de una
// contraseña mala: cada 2 minutos probaba otros 50-70 buzones, los marcaba "auth_failed" (650 cuentas
// caídas) y, de tanto intento fallido, IONOS los dejó bloqueados hasta las 10:40.
//
// Regla: si en pocos minutos fallan con 535 VARIOS buzones de IONOS de VARIOS clientes, no son sus
// contraseñas, es IONOS. Entonces se pausan 15 min los envíos por IONOS (sin marcar ninguna cuenta) y
// se devuelven a "connected" las que se marcaron justo antes por lo mismo. Un cliente con muchas
// contraseñas malas (un solo usuario) NO dispara el freno: sus cuentas se marcan como siempre.

export const STORM_WINDOW_MIN = 5;      // ventana en la que se cuentan los 535
export const STORM_MIN_ACCOUNTS = 5;    // buzones distintos con 535 en esa ventana
export const STORM_MIN_USERS = 2;       // de al menos estos clientes distintos
export const STORM_PAUSE_MIN = 15;      // pausa de los envíos por IONOS
export const STORM_FLAG_KEY = "ionos_auth_pause";

/** ¿El servidor SMTP es de IONOS (smtp.ionos.es/.com/.de…, 1&1)? */
export function isIonosHost(host: string | null | undefined): boolean {
  return /(^|\.)ionos\.[a-z.]+$|(^|\.)1and1\.[a-z.]+$|(^|\.)ionos$/i.test(String(host || "").trim());
}

export type AuthFailure = { account_id: string | null; user_id: string | null };

/** ¿Estos fallos 535 recientes son un bloqueo del proveedor y no contraseñas malas? */
export function isAuthStorm(fails: AuthFailure[]): boolean {
  const accounts = new Set<string>();
  const users = new Set<string>();
  for (const f of fails || []) {
    if (f?.account_id) accounts.add(String(f.account_id));
    if (f?.user_id) users.add(String(f.user_id));
  }
  return accounts.size >= STORM_MIN_ACCOUNTS && users.size >= STORM_MIN_USERS;
}

/** ¿Sigue activa la pausa? (`until` ISO o null). */
export function pauseActive(until: string | null | undefined, now = Date.now()): boolean {
  const t = until ? Date.parse(until) : NaN;
  return Number.isFinite(t) && t > now;
}

export function pauseUntilIso(now = Date.now()): string {
  return new Date(now + STORM_PAUSE_MIN * 60_000).toISOString();
}
