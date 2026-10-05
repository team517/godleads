import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readCachedUniboxUnread, publishUniboxUnread } from "@/lib/uniboxBadge";
import { domainOf, readLeadDomainMemo, resolveLeadDomains } from "@/lib/lead-domains";

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
//
// Lead domains (05-10-2026): it no longer downloads ALL of them on startup (get_lead_domains:
// 2.5–6 s cold for support@, and PostgREST only returned 1,000). It asks about the domain of the
// message that has just arrived (lead_domains_in, one index lookup) only when it is needed: an
// unread, unlinked, non-warm-up message. The answer is remembered for the session, shared with
// the Unibox.

export function useUniboxUnreadWatcher(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const ch = supabase
      .channel("unibox-badge-watcher")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inbox_messages", filter: `user_id=eq.${userId}` },
        (payload: any) => {
          const m = payload?.new;
          if (!m || m.is_read || m.is_archived) return;
          if (m.lead_id || m.campaign_id) { publishUniboxUnread(readCachedUniboxUnread() + 1); return; }
          // Unlinked warm-up never counts (almost everything that arrives in the big accounts).
          if (m.is_warmup === true) return;
          const dom = domainOf(m.from_email);
          if (!dom) return;
          const memo = readLeadDomainMemo();
          if (memo.asked.has(dom)) {
            if (memo.hits.has(dom)) publishUniboxUnread(readCachedUniboxUnread() + 1);
            return;
          }
          void resolveLeadDomains((fn, args) => (supabase as any).rpc(fn, args), [dom]).then((r) => {
            if (!cancelled && r.hits.has(dom)) publishUniboxUnread(readCachedUniboxUnread() + 1);
          }).catch(() => { /* not fatal: linked messages still bump the badge */ });
        }
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [userId]);
}
