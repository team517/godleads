import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readCachedUniboxUnread, publishUniboxUnread } from "@/lib/uniboxBadge";
import { cacheGet, cacheSet } from "@/lib/instant-cache";

// Realtime badge bump for NEW prospect replies while the Unibox is CLOSED.
//
// Mounted ONCE (in AppLayout) so the increment has a single owner — running it in
// both the sidebar and the mobile nav would double-count the same INSERT.
//
// It only bumps on a STRONG relevance signal: the message is linked to a
// lead/campaign, OR its sender domain is one of the user's lead domains. Those
// are exactly the "a real prospect replied" notifications and are never warm-up
// noise, so we don't need the Unibox's full language filter here. Home-language
// mail from strangers (the fuzzy part) isn't bumped in real time — it simply
// shows the moment the Unibox is opened.
//
// The Unibox stays the source of truth: whenever it is open it republishes the
// exact filtered count, correcting any drift this optimistic bump introduces.

/** Misma clave y misma frescura que el Unibox (Unibox.tsx): lo que uno carga lo reutiliza el otro. */
export const LEAD_DOMAINS_CACHE_KEY = "unibox:leadDomains";
export const LEAD_DOMAINS_FRESH_MS = 10 * 60_000;
/** La RPC get_lead_domains tarda ~2 s en las cuentas grandes: se pide pasado el arranque, nunca
 *  compitiendo con la primera pantalla. */
export const LEAD_DOMAINS_DEFER_MS = 5_000;

export function useUniboxUnreadWatcher(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    let domains = new Set<string>();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cached = cacheGet<{ at: number; list: string[] }>(LEAD_DOMAINS_CACHE_KEY);
    if (cached && Date.now() - cached.at < LEAD_DOMAINS_FRESH_MS) {
      domains = new Set(cached.list);
    } else {
      timer = setTimeout(async () => {
        try {
          // Pudo cargarlo el Unibox mientras tanto.
          const again = cacheGet<{ at: number; list: string[] }>(LEAD_DOMAINS_CACHE_KEY);
          if (again && Date.now() - again.at < LEAD_DOMAINS_FRESH_MS) { domains = new Set(again.list); return; }
          const { data, error } = await (supabase as any).rpc("get_lead_domains");
          if (cancelled || error || !Array.isArray(data)) return;
          const set = new Set<string>();
          for (const r of data) {
            const d = (r?.domain || "").toLowerCase().trim();
            if (d) set.add(d);
          }
          domains = set;
          cacheSet(LEAD_DOMAINS_CACHE_KEY, { at: Date.now(), list: [...set] });
        } catch { /* non-fatal: lead-linked messages still bump the badge */ }
      }, LEAD_DOMAINS_DEFER_MS);
    }

    const ch = supabase
      .channel("unibox-badge-watcher")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inbox_messages", filter: `user_id=eq.${userId}` },
        (payload: any) => {
          const m = payload?.new;
          if (!m || m.is_read || m.is_archived) return;
          const dom = (m.from_email || "").split("@")[1]?.toLowerCase() || "";
          const strong = !!(m.lead_id || m.campaign_id || (dom && domains.has(dom)));
          if (!strong) return;
          publishUniboxUnread(readCachedUniboxUnread() + 1);
        }
      )
      .subscribe();

    return () => { cancelled = true; if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [userId]);
}
