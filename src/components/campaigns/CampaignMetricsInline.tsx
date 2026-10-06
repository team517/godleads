import { Send, Users, MessageSquareReply, Smile, AlertTriangle } from "lucide-react";
import { autoRepliesLabel, repliesView, sentTooltip, REPLIES_TOOLTIP } from "@/lib/campaign-health";

type Stats = {
  sent: number; contacted: number; opened: number; replied: number; positive: number; bounced: number; senderBounced?: number;
  repliedHuman?: number; repliedAuto?: number; sentUnconfirmed?: number;
};

/** Compact metrics strip for a campaign card. The numbers come from the page's single
 *  campaign_metrics_v2 RPC (exact, server-side); while they are not there yet it shows "—".
 *  (The old self-load pulled up to 5000 sent_emails rows per card and counted in the browser —
 *  capped, slow and wrong on big campaigns.) */
export default function CampaignMetricsInline({ metrics }: { campaignId?: string; metrics?: Stats | null }) {
  const m: Stats | null = metrics ?? null;

  const pct = (n: number) => (m && m.sent > 0 ? `${((n / m.sent) * 100).toFixed(1)}%` : "0%");
  // Reply rate is over CONTACTED leads (people), not emails sent (which include
  // follow-ups). Fall back to sent for old cached metrics with no `contacted`.
  const denom = (m?.contacted ?? 0) || (m?.sent ?? 0);
  // "Respuestas" = personas; las automáticas van aparte (sin el desglose, la cifra de siempre).
  const rv = repliesView(m);
  const replyPct = m && denom > 0 ? `${((rv.shown / denom) * 100).toFixed(1)}%` : "0%";

  const items: { label: string; value: number; sub: string | null; extra?: string | null; hint?: string; icon: typeof Send; color: string }[] = [
    // Same palette as the desktop campaigns table (CampaignsTable.tsx), with dark
    // variants one shade lighter so the numbers stay readable on a dark background.
    { label: "Enviados",    value: m?.sent ?? 0,      sub: null,                 icon: Send,               color: "text-indigo-600 dark:text-indigo-400", hint: sentTooltip(m?.sent ?? 0, m?.sentUnconfirmed) },
    { label: "Contactados", value: m?.contacted ?? 0, sub: null,               icon: Users,              color: "text-violet-600 dark:text-violet-400" },
    { label: "Respuestas",  value: rv.shown,          sub: replyPct,             extra: rv.split ? autoRepliesLabel(rv.auto) : null, hint: REPLIES_TOOLTIP, icon: MessageSquareReply, color: "text-teal-600 dark:text-teal-400" },
    { label: "Positivos",   value: m?.positive ?? 0,  sub: null,                 icon: Smile,              color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Rebotados",   value: m?.bounced ?? 0,   sub: pct(m?.bounced ?? 0), icon: AlertTriangle,      color: "text-red-500 dark:text-red-400" },
    // "Sender B." (failed-send recipients) removed: it conflated transient SMTP
    // failures (e.g. an IONOS "503" storm that simply retries) with real bounces,
    // showing an alarming inflated number. "Bounced" above = real hard bounces.
  ];

  return (
    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar sm:gap-6">
      {items.map((it) => (
        <div key={it.label} className="min-w-[40px] shrink-0 text-center sm:min-w-[48px]" title={it.hint}>
          <p className={`text-sm font-bold leading-none ${it.color}`}>
            {m === null ? "—" : it.value}
            {m !== null && it.sub && <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{it.sub}</span>}
          </p>
          <p className="mt-1 inline-flex items-center justify-center gap-1 whitespace-nowrap text-[9px] uppercase tracking-wide text-muted-foreground">
            <it.icon className="h-2.5 w-2.5" /> {it.label}
          </p>
          {m !== null && it.extra && <p className="mt-0.5 whitespace-nowrap text-[9px] font-medium leading-none text-muted-foreground">{it.extra}</p>}
        </div>
      ))}
    </div>
  );
}
