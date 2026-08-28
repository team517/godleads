/**
 * lazy-retry — makes React.lazy() survive redeploys.
 *
 * The "Failed to fetch dynamically imported module" crash happens when a new build ships:
 * the browser is still running the old index.html, so when a route lazy-loads it asks for a
 * chunk with an OLD hash that no longer exists on the server. That is NOT a bug in our code —
 * it just means "you're on a stale version". The right fix is to reload once to pull the
 * fresh build, instead of dumping the user on the "Algo se ha bloqueado" screen.
 */
import { lazy, type ComponentType } from "react";

const RELOAD_TS_KEY = "op:chunk-reload-ts";
const RELOAD_GUARD_MS = 12000; // don't reload twice inside this window -> breaks any reload loop

/** True when the failure is a stale-deploy chunk problem (recoverable), not a real code error. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err ?? "");
  return (
    // A) the chunk FETCH failed (old hash 404s after a redeploy)
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /dynamically imported module/i.test(msg) ||
    /loading chunk\s+[\w-]+\s+failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    // B) a MIXED old/new chunk set: the chunk loaded but a module resolved to `undefined`, so
    //    React.lazy's `module.default` (or the module runtime's `.call`) throws. This is the
    //    "Cannot read properties of undefined (reading 'default')" screen after a deploy. Matched
    //    across Chrome / Safari / Firefox wording. Very lazy-import-specific → safe to auto-recover
    //    (the 12s guard breaks any loop if it turns out to be a real bug).
    /cannot read propert(?:y|ies) of undefined \(reading '(?:default|call)'\)/i.test(msg) ||
    /undefined is not an object \(evaluating '[^']*\b(?:default|call)'\)/i.test(msg) ||
    /can't access property ["'](?:default|call)["'][^]*\bundefined/i.test(msg) ||
    /['"]default['"] of undefined/i.test(msg)
  );
}

/**
 * Reload once to fetch the fresh index.html + new chunk hashes. Returns true if a reload was
 * actually triggered, false if we already reloaded very recently (loop guard) — in which case
 * the caller should surface the error normally instead of spinning forever.
 */
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_TS_KEY) || "0");
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
  } catch {
    /* sessionStorage blocked (private mode) — still reload once below */
  }
  // Purge any cached chunks + service workers FIRST, so the browser can't re-serve the same stale
  // build and loop us straight back to the error. Best-effort + capped at 1s so we always reload.
  let reloaded = false;
  const doReload = () => { if (reloaded) return; reloaded = true; try { window.location.reload(); } catch { /* */ } };
  try {
    const tasks: Promise<unknown>[] = [];
    if (typeof caches !== "undefined") tasks.push(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {}));
    if (typeof navigator !== "undefined" && navigator.serviceWorker) tasks.push(navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {}));
    setTimeout(doReload, 1000); // safety net: never wait more than 1s
    if (tasks.length) Promise.allSettled(tasks).then(doReload);
    else doReload();
  } catch {
    doReload();
  }
  return true;
}

/**
 * Drop-in replacement for React.lazy(). On a chunk-load failure it retries once (covers a
 * transient network hiccup); if it still fails because a new version shipped, it silently
 * reloads the page to get the fresh build. Any OTHER error is re-thrown so the ErrorBoundary
 * can show it as a genuine crash.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      // Defensive: a MIXED old/new chunk set can resolve to an empty/undefined module — React.lazy
      // would then throw "reading 'default'" and dump the error screen. Catch it here instead and
      // route it through the same silent retry→reload recovery.
      if (!mod || typeof (mod as { default?: unknown }).default === "undefined") {
        throw new Error("dynamically imported module resolved without a default export (stale chunk)");
      }
      return mod;
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      try {
        return await factory(); // one quick retry before the heavier reload
      } catch (err2) {
        if (isChunkLoadError(err2) && reloadForStaleChunk()) {
          // Reload is underway — never resolve, so nothing flashes before the page swaps.
          return await new Promise<{ default: T }>(() => {});
        }
        throw err2;
      }
    }
  });
}
