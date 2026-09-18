// Sesión caducada: por qué una cuenta "no ve sus datos" aunque todo esté bien en el servidor.
//
// El AuthContext NUNCA cierra la sesión por un fallo pasajero (decisión del propietario: la
// aplicación no debe escupirte al login por un parpadeo de red). El efecto secundario es que, si
// el token caduca y no se puede renovar, la aplicación sigue pareciendo conectada pero cada
// consulta va con un token inválido: PostgREST responde 401 y, con RLS, eso se traduce en CERO
// filas sin error visible. La pantalla dice entonces "no hay campañas" cuando sí las hay.
//
// Aquí vive la parte comprobable de la cura: reconocer esas respuestas y decidir qué se reintenta.
// El cliente (integrations/supabase/client.ts) las usa para renovar el token y repetir la petición.

/** Aviso global cuando el token no se pudo renovar: la interfaz lo dice en vez de mentir. */
export const SESSION_EXPIRED_EVENT = "op:session-expired";

/** ¿Es una petición de datos que merece reintento? Las de /auth/v1 no: son las que renuevan. */
export function isGuardedUrl(url: string): boolean {
  const u = String(url || "");
  if (!/\/(rest|functions)\/v1\//.test(u)) return false;
  return !/\/auth\/v1\//.test(u);
}

/** ¿La respuesta dice "tu token no vale"? 401 siempre; 403 sólo si habla del JWT. */
export function isAuthFailure(status: number, body?: string): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  const b = String(body || "").toLowerCase();
  return b.includes("jwt") || b.includes("pgrst301") || b.includes("invalid claim") || b.includes("token");
}

/** Cabeceras de la petición repetida, con el token recién renovado. */
export function withFreshToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return { ...(init || {}), headers };
}

export function announceSessionExpired(): void {
  try { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)); } catch { /* sin ventana */ }
}

// ── El interceptor ───────────────────────────────────────────────────────────────────────────
interface GuardDeps {
  /** fetch real (inyectable para poder probarlo). */
  fetchImpl: typeof fetch;
  /** Renueva la sesión y devuelve el token nuevo, o null si no se pudo. */
  refresh: () => Promise<string | null>;
  onExpired?: () => void;
}

/** Envuelve fetch: ante un "token caducado" renueva UNA vez (compartiendo la renovación entre
 *  todas las peticiones en vuelo) y repite la petición. Si no se puede renovar, avisa y devuelve
 *  la respuesta original — nunca cierra la sesión por su cuenta. */
export function makeGuardedFetch({ fetchImpl, refresh, onExpired }: GuardDeps): typeof fetch {
  let inFlight: Promise<string | null> | null = null;
  const refreshOnce = () => {
    if (!inFlight) {
      inFlight = refresh().finally(() => { setTimeout(() => { inFlight = null; }, 0); });
    }
    return inFlight;
  };

  return async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const res = await fetchImpl(input, init);
    if ((res.status !== 401 && res.status !== 403) || !isGuardedUrl(String(url || ""))) return res;
    // Sólo se lee una COPIA del cuerpo: la respuesta original se devuelve intacta si no hay que
    // reintentar (leerla aquí dejaría al llamante sin poder leerla).
    const body = res.status === 403 ? await res.clone().text().catch(() => "") : "";
    if (!isAuthFailure(res.status, body)) return res;

    const token = await refreshOnce();
    if (!token) { (onExpired ?? announceSessionExpired)(); return res; }
    return fetchImpl(input, withFreshToken(init, token));
  };
}
