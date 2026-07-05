/**
 * Route prefetch — fires dynamic import thunks before the user clicks,
 * so Vite's chunk is already in the browser cache when React.lazy needs it.
 *
 * Import specifiers intentionally match App.tsx so Vite deduplicates chunks.
 */

type ImportThunk = () => Promise<unknown>;

const routeMap: Record<string, ImportThunk> = {
  "/dashboard":      () => import("@/pages/Dashboard"),
  "/email-accounts": () => import("@/pages/EmailAccounts"),
  "/campaigns":      () => import("@/pages/Campaigns"),
  "/leads":          () => import("@/pages/Leads"),
  "/unibox":         () => import("@/pages/Unibox"),
  "/stats":          () => import("@/pages/Stats"),
  "/deliverability": () => import("@/pages/DeliverabilityTest"),
  "/ai-prompts":     () => import("@/pages/AIPrompts"),
  "/settings":       () => import("@/pages/SettingsPage"),
  "/workflows":      () => import("@/pages/Workflows"),
  "/godtube":        () => import("@/pages/GodTube"),
};

/** Tracks which paths have already been fetched so we never import twice. */
const fetched = new Set<string>();

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

/** Guard: prefetchAllRoutesOnIdle() runs at most once per session. */
let idlePrefetchScheduled = false;

/**
 * After first paint, stagger-prefetch every mapped route (one per 300 ms).
 * Uses requestIdleCallback when available, falls back to setTimeout.
 * Runs at most once per session regardless of how many times it is called.
 */
export function prefetchAllRoutesOnIdle(): void {
  if (idlePrefetchScheduled) return;
  idlePrefetchScheduled = true;

  const paths = Object.keys(routeMap);

  const schedule = (fn: () => void, delay: number) => {
    if (typeof requestIdleCallback !== "undefined") {
      setTimeout(() => requestIdleCallback(fn, { timeout: 2000 }), delay);
    } else {
      setTimeout(fn, delay);
    }
  };

  paths.forEach((path, i) => {
    schedule(() => prefetchRoute(path), i * 300);
  });
}
