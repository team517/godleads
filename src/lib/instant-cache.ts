// Instant page cache — Smartlead-style perceived speed, in two layers:
//   1) In-memory (this Map): re-entering a page during the session paints the
//      last known data instantly, while the normal load refreshes behind.
//   2) localStorage (PERSIST_KEYS only): survives closing the browser, so even
//      a FRESH open (days later) paints the last known data immediately and
//      refreshes in the background. Nothing can be preloaded while the site is
//      closed — persisting the last snapshot is the honest equivalent.
// Security: persisted entries are wrapped with the owner's user id and only
// hydrate for that same user (bindCacheUser). On sign-out everything is purged,
// so another login on the same browser can never see cached data.
const store = new Map<string, unknown>();

const PERSIST_PREFIX = "op_cache:";
const PERSIST_KEYS = new Set([
  "unibox:messages",
  "campaigns:list",
  "leads:first",
  "accounts:list",
  "dash:stats",
  "dash:campaigns",
]);

let boundUid: string | null = null;

/** Bind the cache to the signed-in user (null = signed out → purge disk). */
export function bindCacheUser(uid: string | null): void {
  if (boundUid === uid) return;
  boundUid = uid;
  if (!uid) {
    store.clear();
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(PERSIST_PREFIX)) localStorage.removeItem(key);
      }
    } catch { /* storage unavailable */ }
  }
}

/** Shrink big datasets so they fit localStorage (~5MB) — the persisted copy is
 *  only a first-paint placeholder; the live load replaces it within seconds. */
function shrinkForDisk(key: string, value: unknown): unknown {
  if (key === "unibox:messages" && Array.isArray(value)) {
    return value.slice(0, 150).map((m: any) => ({
      ...m,
      body_text: typeof m.body_text === "string" ? m.body_text.slice(0, 600) : m.body_text,
    }));
  }
  return value;
}

export function cacheGet<T>(key: string): T | undefined {
  if (store.has(key)) return store.get(key) as T;
  // Hydrate from disk (once) — only for the same user that persisted it.
  if (PERSIST_KEYS.has(key) && boundUid) {
    try {
      const raw = localStorage.getItem(PERSIST_PREFIX + key);
      if (raw) {
        const env = JSON.parse(raw) as { uid: string; v: unknown };
        if (env && env.uid === boundUid) {
          store.set(key, env.v);
          return env.v as T;
        }
      }
    } catch { /* corrupt/unavailable — ignore */ }
  }
  return undefined;
}

export function cacheSet<T>(key: string, value: T): void {
  store.set(key, value);
  if (PERSIST_KEYS.has(key) && boundUid) {
    try {
      localStorage.setItem(
        PERSIST_PREFIX + key,
        JSON.stringify({ uid: boundUid, v: shrinkForDisk(key, value) }),
      );
    } catch { /* quota exceeded — memory layer still works */ }
  }
}
