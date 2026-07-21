import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Send, Users, MailOpen, MessageSquareReply, DollarSign, AlertTriangle } from "lucide-react";

type Stats = { sent: number; contacted: number; opened: number; replied: number; positive: number; bounced: number; senderBounced: number };

/** Compact metrics strip for a campaign card. When `metrics` is passed by the
 *  parent (from the single campaign_metrics_for_user RPC) it renders instantly
 *  with ZERO queries. Falls back to its own load only if none is provided. */
export default function CampaignMetricsInline({ campaignId, metrics }: { campaignId: string; metrics?: Stats | null }) {
  const [m, setM] = useState<Stats | null>(metrics ?? null);

  useEffect(() => {
    if (metrics !== undefined) { setM(metrics); return; } // parent-provided → no query
    let alive = true;
    const count = async (q: any): Promise<number> => {
      const { count } = await q;
      return count || 0;
    };
    (async () => {
      const sentBase = () => supabase.from("sent_emails").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
      const [sent, opened, bounced, positive, rowsRes] = await Promise.all([
        count(sentBase().not("sent_at", "is", null)),
        count(sentBase().not("opened_at", "is", null)),
        count(sentBase().not("bounced_at", "is", null)),
        count(supabase.from("inbox_messages").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).contains("labels", ["Interesado"])),
        // One row pull drives Replied (distinct leads) AND Sender Bounced (distinct
        // recipients) — counting raw rows double-counts a lead who replied to two
        // steps, or one address retried N times.
        supabase.from("sent_emails").select("to_email, status, sent_at, lead_id, replied_at").eq("campaign_id", campaignId).limit(5000),
      ]);
      const rows: any[] = (rowsRes as any)?.data || [];
      const okEmails = new Set(rows.filter((x) => x.sent_at || x.status === "sent" || x.status === "bounced").map((x) => (x.to_email || "").toLowerCase()));
      const senderBounced = new Set(rows.filter((x) => x.status === "failed").map((x) => (x.to_email || "").toLowerCase()).filter((em) => em && !okEmails.has(em))).size;
      // Contacted = DISTINCT people we emailed (not raw rows w/ follow-ups) → the
      // correct denominator for the reply rate.
      const contacted = new Set(rows.filter((x) => x.sent_at || x.status === "sent").map((x) => x.lead_id || (x.to_email || "").toLowerCase()).filter(Boolean)).size;
      // Replied = DISTINCT leads who replied (people, not send-rows).
      const replied = new Set(rows.filter((x) => x.replied_at).map((x) => x.lead_id || (x.to_email || "").toLowerCase()).filter(Boolean)).size;
      if (!alive) return;
      setM({ sent, contacted, opened, replied, bounced, senderBounced, positive });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, metrics]);

  const pct = (n: number) => (m && m.sent > 0 ? `${((n / m.sent) * 100).toFixed(1)}%` : "0%");
  // Reply rate is over CONTACTED leads (people), not emails sent (which include
  // follow-ups). Fall back to sent for old cached metrics with no `contacted`.
  const denom = (m?.contacted ?? 0) || (m?.sent ?? 0);
  const replyPct = m && denom > 0 ? `${(((m.replied ?? 0) / denom) * 100).toFixed(1)}%` : "0%";

  const items = [
    { label: "Sent",      value: m?.sent ?? 0,          sub: null,                 icon: Send,               color: "text-indigo-600" },
    { label: "Contacted", value: m?.contacted ?? 0,     sub: null,                 icon: Users,              color: "text-sky-600" },
    { label: "Opened",    value: m?.opened ?? 0,        sub: pct(m?.opened ?? 0),  icon: MailOpen,           color: "text-fuchsia-600" },
    { label: "Replied",   value: m?.replied ?? 0,       sub: replyPct,             icon: MessageSquareReply, color: "text-teal-600" },
    { label: "Positive",  value: m?.positive ?? 0,      sub: null,                 icon: DollarSign,         color: "text-emerald-600" },
    { label: "Bounced",   value: m?.bounced ?? 0,       sub: pct(m?.bounced ?? 0), icon: AlertTriangle,      color: "text-red-500" },
    // "Sender B." (failed-send recipients) removed: it conflated transient SMTP
    // failures (e.g. an IONOS "503" storm that simply retries) with real bounces,
    // showing an alarming inflated number. "Bounced" above = real hard bounces.
  ];

  return (
    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar sm:gap-6">
      {items.map((it) => (
        <div key={it.label} className="min-w-[40px] shrink-0 text-center sm:min-w-[48px]">
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
