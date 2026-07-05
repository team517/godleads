// In-memory session cache for page data — Smartlead-style perceived speed.
// A page seeds its state from here on mount, so RE-ENTERING it paints the last
// known data INSTANTLY (no spinner), while the normal load refreshes in the
// background and re-caches. Cleared on full reload (module memory only), so it
// can never show stale data across sessions.
const store = new Map<string, unknown>();

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet<T>(key: string, value: T): void {
  store.set(key, value);
}
