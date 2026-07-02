import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readCachedUniboxUnread, publishUniboxUnread } from "@/lib/uniboxBadge";

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
export function useUniboxUnreadWatcher(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    let domains = new Set<string>();
    let cancelled = false;

    (async () => {
      try {
        const { data } = await (supabase as any).rpc("get_lead_domains");
        if (!cancelled && Array.isArray(data)) {
          for (const r of data) {
            const d = (r?.domain || "").toLowerCase().trim();
            if (d) domains.add(d);
          }
        }
      } catch { /* non-fatal: lead-linked messages still bump the badge */ }
    })();

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

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [userId]);
}
