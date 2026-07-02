// Shared "real unread" count for the Unibox notification badge.
//
// The sidebar/mobile-nav badge must show the SAME number the Unibox actually
// displays as unread — i.e. after warm-up/bounce/foreign-language filtering.
// That relevance filter (lead-domain + language heuristics) lives in the Unibox
// component and can't be reproduced by a plain COUNT(*) query (raw unread is
// thousands of warm-up rows → the badge used to show a fake "99+").
//
// So the Unibox is the single source of truth: it publishes its computed count
// here, the nav components subscribe. The value is also persisted to
// localStorage so the badge is already correct on first paint / before the
// Unibox has been opened this session, and stays in sync across browser tabs.

const KEY = "onepulso:unibox_unread";
const EVT = "onepulso:unibox_unread";

export function publishUniboxUnread(n: number) {
  const v = Math.max(0, Math.floor(n || 0));
  try { localStorage.setItem(KEY, String(v)); } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: v })); } catch { /* SSR */ }
}

export function readCachedUniboxUnread(): number {
  try {
    const v = parseInt(localStorage.getItem(KEY) || "", 10);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  } catch { return 0; }
}

/** Subscribe to real-unread changes (same tab via CustomEvent, other tabs via storage). Returns an unsubscribe fn. */
export function subscribeUniboxUnread(cb: (n: number) => void): () => void {
  const onEvt = (e: Event) => cb(Math.max(0, (e as CustomEvent).detail as number));
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue != null) cb(Math.max(0, parseInt(e.newValue, 10) || 0));
  };
  window.addEventListener(EVT, onEvt);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVT, onEvt);
    window.removeEventListener("storage", onStorage);
  };
}
