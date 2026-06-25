import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Send, MailOpen, MessageSquareReply, DollarSign, AlertTriangle, MailX } from "lucide-react";

type Stats = { sent: number; opened: number; replied: number; positive: number; bounced: number; senderBounced: number };

/** Compact metrics strip for a campaign card in the list view. Uses cheap HEAD
 *  count queries (no row transfer) so it scales to many campaigns. */
export default function CampaignMetricsInline({ campaignId }: { campaignId: string }) {
  const [m, setM] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const count = async (q: any): Promise<number> => {
      const { count } = await q;
      return count || 0;
    };
    (async () => {
      const sentBase = () => supabase.from("sent_emails").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
      const [sent, opened, replied, bounced, senderBounced, positive] = await Promise.all([
        count(sentBase().not("sent_at", "is", null)),
        count(sentBase().not("opened_at", "is", null)),
        count(sentBase().not("replied_at", "is", null)),
        count(sentBase().not("bounced_at", "is", null)),
        count(sentBase().eq("status", "failed")),
        count(supabase.from("inbox_messages").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).contains("labels", ["Interesado"])),
      ]);
      if (!alive) return;
      setM({ sent, opened, replied, bounced, senderBounced, positive });
    })();
    return () => { alive = false; };
  }, [campaignId]);

  const pct = (n: number) => (m && m.sent > 0 ? `${((n / m.sent) * 100).toFixed(1)}%` : "0%");

  const items = [
    { label: "Sent",      value: m?.sent ?? 0,          sub: null,                 icon: Send,               color: "text-indigo-600" },
    { label: "Opened",    value: m?.opened ?? 0,        sub: pct(m?.opened ?? 0),  icon: MailOpen,           color: "text-fuchsia-600" },
    { label: "Replied",   value: m?.replied ?? 0,       sub: pct(m?.replied ?? 0), icon: MessageSquareReply, color: "text-teal-600" },
    { label: "Positive",  value: m?.positive ?? 0,      sub: null,                 icon: DollarSign,         color: "text-emerald-600" },
    { label: "Bounced",   value: m?.bounced ?? 0,       sub: pct(m?.bounced ?? 0), icon: AlertTriangle,      color: "text-red-500" },
    { label: "Sender B.", value: m?.senderBounced ?? 0, sub: pct(m?.senderBounced ?? 0), icon: MailX,        color: "text-red-600" },
  ];

  return (
    <div className="flex items-center gap-4 overflow-x-auto sm:gap-6">
      {items.map((it) => (
        <div key={it.label} className="min-w-[48px] shrink-0 text-center">
          <p className={`text-sm font-bold leading-none ${it.color}`}>
            {m === null ? "—" : it.value}
            {m !== null && it.sub && <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{it.sub}</span>}
          </p>
          <p className="mt-1 inline-flex items-center justify-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground">
            <it.icon className="h-2.5 w-2.5" /> {it.label}
          </p>
        </div>
      ))}
    </div>
  );
}
