/**
 * Route prefetch — fires dynamic import thunks before the user clicks,
 * so Vite's chunk is already in the browser cache when React.lazy needs it.
 *
 * Import specifiers intentionally match App.tsx so Vite deduplicates chunks.
 */

type ImportThunk = () => Promise<unknown>;

/** Every lazy route of App.tsx. Used for the hover prefetch and for the FIRST-PAINT prefetch of
 *  the route being opened (main.tsx), so its chunk downloads in parallel with the auth/profile
 *  queries instead of after them. */
const routeMap: Record<string, ImportThunk> = {
  "/":               () => import("@/pages/Landing"),
  "/install":        () => import("@/pages/Install"),
  "/auth":           () => import("@/pages/Auth"),
  "/acceso-cliente": () => import("@/pages/Auth"),
  "/bienvenida":     () => import("@/pages/Welcome"),
  "/o":              () => import("@/pages/OnboardingPortal"),
  "/dashboard":      () => import("@/pages/Dashboard"),
  "/email-accounts": () => import("@/pages/EmailAccounts"),
  "/campaigns":      () => import("@/pages/Campaigns"),
  "/leads":          () => import("@/pages/Leads"),
  "/clientes":       () => import("@/pages/Clientes"),
  "/unibox":         () => import("@/pages/Unibox"),
  "/stats":          () => import("@/pages/Stats"),
  "/personalizacion": () => import("@/pages/Personalizacion"),
  "/deliverability": () => import("@/pages/DeliverabilityTest"),
  "/ai-prompts":     () => import("@/pages/AIPrompts"),
  "/settings":       () => import("@/pages/SettingsPage"),
  "/community":      () => import("@/pages/Community"),
  "/onboarding":     () => import("@/pages/Onboarding"),
  "/modificaciones-ia": () => import("@/pages/ModificacionesIA"),
  "/copy":           () => import("@/pages/CopyClientes"),
  "/automatizacion": () => import("@/pages/AutomationFlow"),
  "/seguimiento":    () => import("@/pages/Seguimiento"),
  "/godtube":        () => import("@/pages/GodTube"),
  "/partners":       () => import("@/pages/Partners"),
  "/admin":          () => import("@/pages/AdminPanel"),
  "/admin/clients":  () => import("@/pages/ClientPortal"),
  "/metrics":        () => import("@/pages/Metrics"),
};

/**
 * Routes warmed in the background while the user is idle. Deliberately NOT every route:
 *  - /godtube is an owner-only page with a heavy chunk; prefetching it downloaded it for every
 *    user on every session.
 *  - /modificaciones-ia and /stats are the heaviest chunks (~30 KB + recharts) and few users open
 *    them: they still prefetch on hover, just not for everyone at boot.
 */
export const IDLE_PREFETCH_PATHS: readonly string[] = [
  "/dashboard",
  "/email-accounts",
  "/campaigns",
  "/leads",
  "/clientes",
  "/unibox",
  "/deliverability",
  "/ai-prompts",
  "/settings",
  "/onboarding",
];

/** Delay before the idle prefetch starts: the first screen's own data must win the network. */
export const IDLE_PREFETCH_DELAY_MS = 8_000;

/** Tracks which paths have already been fetched so we never import twice. */
const fetched = new Set<string>();

/**
 * Which route entry serves a pathname: exact match first, then the longest prefix
 * ("/admin/clients" before "/admin", "/o/<slug>" → "/o"). Null when nothing matches.
 * Pure — tested.
 */
export function routeKeyForPathname(pathname: string, keys: readonly string[] = Object.keys(routeMap)): string | null {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  if (keys.includes(path)) return path;
  let best: string | null = null;
  for (const k of keys) {
    if (k === "/") continue;
    if (path.startsWith(k + "/") && (!best || k.length > best.length)) best = k;
  }
  return best;
}

/**
 * Fire the import thunk for a single route path.
 * Safe to call repeatedly — subsequent calls for the same path are no-ops.
 */
export function prefetchRoute(path: string): void {
  if (fetched.has(path)) return;
  const thunk = routeMap[path];
  if (!thunk) return;
  fetched.add(path);
  thunk().catch(() => {
    // Network hiccup — remove from fetched so a hover retry can try again.
    fetched.delete(path);
  });
}

/** Prefetch the chunk of the page the browser is opening RIGHT NOW (called from main.tsx, before
 *  React even mounts). The chunk then downloads alongside the session/profile queries instead of
 *  starting only after ProtectedRoute lets the route render. */
export function prefetchCurrentRoute(pathname: string): void {
  const key = routeKeyForPathname(pathname);
  if (key) prefetchRoute(key);
}

/** Guard: prefetchAllRoutesOnIdle() runs at most once per session. */
let idlePrefetchScheduled = false;

export type IdlePrefetchEnv = {
  /** A phone (narrow + touch) — see isPhoneDevice. */
  phone: boolean;
  /** Viewport narrower than 768 px (a phone-sized browser window). */
  narrow: boolean;
  /** navigator.connection.saveData — the user asked for less data. */
  saveData: boolean;
};

/** Pure decision: should the background prefetch of all routes run at all? */
export function shouldIdlePrefetch(env: IdlePrefetchEnv): boolean {
  if (env.saveData) return false;
  if (env.phone || env.narrow) return false;
  return true;
}

function readIdlePrefetchEnv(): IdlePrefetchEnv {
  const w = typeof window !== "undefined" ? window : undefined;
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean } }) : undefined;
  const mq = (q: string) => !!w?.matchMedia?.(q)?.matches;
  const narrow = mq("(max-width: 767px)");
  const touch = mq("(pointer: coarse)") || (nav?.maxTouchPoints || 0) > 0;
  return {
    phone: narrow && touch,
    narrow,
    saveData: !!nav?.connection?.saveData,
  };
}

/**
 * Stagger-prefetch the idle-list routes (one per 300 ms), starting IDLE_PREFETCH_DELAY_MS after
 * the call. Uses requestIdleCallback when available, falls back to setTimeout. Runs at most once
 * per session regardless of how many times it is called. Skipped on phones, narrow viewports and
 * when the user asked the browser to save data (~460 KB gz is a lot for a phone that will only
 * ever open the Unibox).
 */
export function prefetchAllRoutesOnIdle(env: IdlePrefetchEnv = readIdlePrefetchEnv()): void {
  if (idlePrefetchScheduled) return;
  idlePrefetchScheduled = true;
  if (!shouldIdlePrefetch(env)) return;

  const schedule = (fn: () => void, delay: number) => {
    if (typeof requestIdleCallback !== "undefined") {
      setTimeout(() => requestIdleCallback(fn, { timeout: 2000 }), delay);
    } else {
      setTimeout(fn, delay);
    }
  };

  IDLE_PREFETCH_PATHS.forEach((path, i) => {
    schedule(() => prefetchRoute(path), IDLE_PREFETCH_DELAY_MS + i * 300);
  });
}
