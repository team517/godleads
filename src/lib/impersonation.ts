// Cambio de cuenta del equipo ("entrar como cliente", 10-11-2026).
//
// El equipo (hello@onepulso.blog y equipo@onepulso.online) en cualquier cliente; desde el 12-11-2026
// también una agencia, sólo en los accesos de SUS clientes (lo comprueba la función). Al entrar:
//   1. se guarda aparte (localStorage, clave propia) la sesión ORIGINAL del equipo;
//   2. la función `impersonate` (que comprueba de nuevo quién llama) devuelve un token de un solo uso;
//   3. el navegador abre la sesión del cliente con verifyOtp y recarga entero en /dashboard, para que
//      no quede en memoria nada de la cuenta anterior.
// Volver = restaurar la sesión original guardada y recargar. Para cualquier otro usuario nada de
// esto se ejecuta: no hay entrada en el menú y la función responde 403.
import { useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { canImpersonate, type ClienteListado, type ModoCambio } from "../../supabase/functions/_shared/impersonation-rules";

export const IMPERSONATION_KEY = "fl_impersonation_v1";
export const AUTH_NOTICE_KEY = "fl_auth_notice";
const CHANGE_EVENT = "fl-impersonation-change";

export interface ActorSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Caducidad del access token, en segundos (como session.expires_at). */
  expiresAt: number;
}

export interface ImpersonationState {
  actor: ActorSession;
  target: { userId: string; email: string; company: string | null };
  startedAt: string;
  logId: string | null;
  /** "equipo" (hello@, equipo@: cualquier cliente) o "agencia" (sólo los suyos, 12-11-2026). */
  mode?: ModoCambio;
}

/* ── Parte pura (con pruebas) ───────────────────────────────────────────────────────────────── */

const esTexto = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Lee el estado guardado; cualquier cosa rara (o de una cuenta que no puede cambiar) = sin cambio. */
export function parseImpersonationState(raw: string | null | undefined): ImpersonationState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    const a = s?.actor, t = s?.target;
    if (!a || !t) return null;
    if (![a.userId, a.email, a.accessToken, a.refreshToken, t.userId, t.email].every(esTexto)) return null;
    if (typeof a.expiresAt !== "number") return null;
    // El equipo por su correo; una agencia sólo si se guardó al entrar como agencia. (Quien decide si
    // se puede entrar es siempre el servidor; esto sólo es la vuelta a su propia sesión.)
    const mode: ModoCambio = canImpersonate(a.email) ? "equipo" : s.mode === "agencia" ? "agencia" : ("" as ModoCambio);
    if (!mode) return null;
    return {
      actor: { userId: a.userId, email: String(a.email).toLowerCase(), accessToken: a.accessToken, refreshToken: a.refreshToken, expiresAt: a.expiresAt },
      target: { userId: t.userId, email: String(t.email).toLowerCase(), company: esTexto(t.company) ? t.company : null },
      startedAt: esTexto(s.startedAt) ? s.startedAt : new Date(0).toISOString(),
      logId: esTexto(s.logId) ? s.logId : null,
      mode,
    };
  } catch {
    return null;
  }
}

/** ¿El estado guardado corresponde a la sesión que está abierta ahora? (si no, está obsoleto) */
export function stateMatchesUser(state: ImpersonationState | null, currentUserId: string | null | undefined): boolean {
  return !!state && !!currentUserId && state.target.userId === currentUserId;
}

/** Segundos durante los que el estado recién escrito convive con la sesión del EQUIPO: entre
 *  guardar "vengo de mi cuenta" y que la sesión pase al cliente (verifyOtp + recarga). */
export const ENTERING_GRACE_SEC = 120;

/** ¿El estado guardado es un resto que hay que borrar? Sólo si la sesión abierta no es la del cliente
 *  Y no estamos en mitad de entrar. Antes se borraba en ese instante intermedio (la sesión aún era la
 *  del equipo) y, ya dentro del cliente, no salía "Volver a mi cuenta" (10-11-2026). */
export function isStaleImpersonation(state: ImpersonationState | null, currentUserId: string | null | undefined, nowMs = Date.now()): boolean {
  if (!state || !currentUserId) return false;
  if (state.target.userId === currentUserId) return false;
  if (state.actor.userId === currentUserId) {
    const started = Date.parse(state.startedAt);
    if (!Number.isNaN(started) && nowMs - started < ENTERING_GRACE_SEC * 1000) return false;
  }
  return true;
}

/** La cuenta REAL de quien está delante: la original si está dentro de un cliente. */
export function realAccountEmail(state: ImpersonationState | null, currentEmail: string | null | undefined): string | null {
  return state?.actor.email ?? (currentEmail ? currentEmail.toLowerCase() : null);
}

/** ¿Se enseña "Clientes" en el menú del perfil? Al equipo (hello@, equipo@) siempre; a una agencia
 *  si el servidor dice que tiene clientes con acceso (`agencia`) o si ya está dentro de uno suyo. */
export function canUseAccountSwitcher(state: ImpersonationState | null, currentEmail: string | null | undefined, agencia = false): boolean {
  return canImpersonate(realAccountEmail(state, currentEmail)) || agencia || state?.mode === "agencia";
}

/** ¿Hay que renovar el access token guardado antes de usarlo? (margen de 90 s) */
export function needsRefresh(expiresAtSec: number, nowMs = Date.now(), marginSec = 90): boolean {
  return !expiresAtSec || expiresAtSec * 1000 - nowMs < marginSec * 1000;
}

/* ── Almacenamiento ────────────────────────────────────────────────────────────────────────── */

export function readImpersonation(): ImpersonationState | null {
  try { return parseImpersonationState(localStorage.getItem(IMPERSONATION_KEY)); } catch { return null; }
}
function writeImpersonation(s: ImpersonationState | null) {
  try {
    if (s) localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(s));
    else localStorage.removeItem(IMPERSONATION_KEY);
  } catch { /* sin almacenamiento */ }
  try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch { /* fuera del navegador */ }
}
export function clearImpersonation() { writeImpersonation(null); }

/** ¿Está el equipo dentro de un cliente en este navegador? (frena los avisos push, la bienvenida…) */
export function isImpersonating(): boolean {
  return readImpersonation() !== null;
}

/** Estado reactivo para la interfaz (también cambia si otra pestaña entra o vuelve). */
export function useImpersonation(): ImpersonationState | null {
  const [s, setS] = useState<ImpersonationState | null>(() => readImpersonation());
  useEffect(() => {
    const on = () => setS(readImpersonation());
    window.addEventListener(CHANGE_EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(CHANGE_EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return s;
}

/* ── Llamadas a la función (siempre con el token de la cuenta del EQUIPO) ─────────────────────── */

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

let actorClient: SupabaseClient | null = null;
/** Cliente aparte, sin guardar nada, sólo para renovar el token de la cuenta original. */
function getActorClient(): SupabaseClient {
  if (!actorClient) {
    actorClient = createClient(URL_BASE, ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fl-impersonation-actor" },
    });
  }
  return actorClient;
}

/** Sesión del equipo lista para usar: la actual si no ha cambiado de cuenta; la guardada (renovada si
 *  hace falta) si está dentro de un cliente. */
async function actorSession(): Promise<ActorSession> {
  const state = readImpersonation();
  if (state) {
    if (!needsRefresh(state.actor.expiresAt)) return state.actor;
    const { data, error } = await getActorClient().auth.refreshSession({ refresh_token: state.actor.refreshToken });
    if (error || !data.session) throw new Error("La sesión de tu cuenta ha caducado. Vuelve a ella e inicia sesión de nuevo.");
    const fresh: ActorSession = {
      ...state.actor,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    };
    writeImpersonation({ ...state, actor: fresh });
    return fresh;
  }
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  // El servidor decide quién puede entrar y dónde (equipo: cualquiera; agencia: sólo sus clientes).
  if (!s?.user?.email) throw new Error("Esta cuenta no puede entrar en otras");
  return {
    userId: s.user.id,
    email: s.user.email.toLowerCase(),
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

async function callImpersonate<T>(accessToken: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${URL_BASE}/functions/v1/impersonate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, apikey: ANON },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as any)?.error || `Error ${res.status}`);
  return j as T;
}

export async function listClientsForSwitch(): Promise<ClienteListado[]> {
  const actor = await actorSession();
  const r = await callImpersonate<{ clients: ClienteListado[] }>(actor.accessToken, { action: "list" });
  return r.clients || [];
}

/** Entra en la cuenta de un cliente. Si ya estaba dentro de otro, salta directamente (la sesión
 *  original del equipo se conserva siempre). Termina recargando la página. */
export async function enterClient(targetUserId: string): Promise<void> {
  const previous = readImpersonation();
  const actor = await actorSession();
  const r = await callImpersonate<{ token_hash: string; target: { id: string; email: string; company: string | null }; log_id: string | null; mode?: ModoCambio }>(
    actor.accessToken, { action: "start", target_user_id: targetUserId },
  );
  if (previous?.logId) void callImpersonate(actor.accessToken, { action: "end", log_id: previous.logId }).catch(() => {});

  // El estado se escribe ANTES de abrir la sesión del cliente: así, en el instante en que la app ve
  // al cliente, los avisos push del dispositivo ya están frenados.
  const next: ImpersonationState = {
    actor: readImpersonation()?.actor ?? actor,
    target: { userId: r.target.id, email: r.target.email, company: r.target.company },
    startedAt: new Date().toISOString(),
    logId: r.log_id,
    mode: r.mode === "agencia" ? "agencia" : "equipo",
  };
  writeImpersonation(next);
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: "magiclink" });
  if (error) {
    writeImpersonation(previous); // nada ha cambiado: se deja como estaba
    throw new Error(`No se pudo entrar en la cuenta: ${error.message}`);
  }
  // Segunda garantía: ya dentro del cliente, se vuelve a guardar "vengo de mi cuenta" por si algo lo
  // hubiera borrado en el instante del cambio. Sin esto, dentro no saldría "Volver a mi cuenta".
  writeImpersonation(next);
  window.location.assign("/dashboard");
}

/** Vuelve a la cuenta del equipo. Si su sesión ya no vale, cierra limpio y pide iniciar sesión. */
export async function returnToOwnAccount(): Promise<void> {
  const state = readImpersonation();
  if (!state) return;
  let actor = state.actor;
  try { actor = await actorSession(); } catch { /* se intenta igualmente con lo guardado */ }
  if (state.logId) void callImpersonate(actor.accessToken, { action: "end", log_id: state.logId }).catch(() => {});
  const { error } = await supabase.auth.setSession({ access_token: actor.accessToken, refresh_token: actor.refreshToken });
  clearImpersonation();
  if (error) {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ya está fuera */ }
    try { sessionStorage.setItem(AUTH_NOTICE_KEY, "Vuelve a iniciar sesión con tu cuenta."); } catch { /* sin almacenamiento */ }
    window.location.assign("/auth");
    return;
  }
  window.location.assign("/dashboard");
}

/** ¿Esta cuenta es una agencia con clientes en los que puede entrar? (sólo para enseñar el menú;
 *  quien decide es la función `impersonate`). */
export function useCanEnterMyClients(userId: string | null | undefined): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (!userId) { setCan(false); return; }
    let vivo = true;
    (supabase as any).rpc("can_enter_my_clients").then(({ data }: { data: unknown }) => { if (vivo) setCan(data === true); }, () => {});
    return () => { vivo = false; };
  }, [userId]);
  return can;
}
