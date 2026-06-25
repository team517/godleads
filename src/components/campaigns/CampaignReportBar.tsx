import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Send, MailOpen, MessageSquareReply, AlertTriangle, MailX,
  Play, Pause, FileEdit, ExternalLink, DollarSign,
} from "lucide-react";

interface Props { campaign: any; }

const statusMeta: Record<string, { label: string; cls: string; icon: typeof Play }> = {
  active:    { label: "Active",    cls: "text-emerald-600", icon: Play },
  paused:    { label: "Paused",    cls: "text-amber-600",   icon: Pause },
  draft:     { label: "Draft",     cls: "text-muted-foreground", icon: FileEdit },
  completed: { label: "Completed", cls: "text-blue-600",    icon: FileEdit },
};

/** Instantly-style report bar: campaign details on the left, key metrics on the right. */
export default function CampaignReportBar({ campaign }: Props) {
  const navigate = useNavigate();
  const [m, setM] = useState({ sent: 0, opened: 0, replied: 0, positive: 0, bounced: 0, senderBounced: 0, sequences: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      const [sentRes, stepsRes, posRes] = await Promise.all([
        supabase.from("sent_emails")
          .select("status, sent_at, opened_at, replied_at, bounced_at")
          .eq("campaign_id", campaign.id),
        supabase.from("campaign_steps")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id),
        supabase.from("inbox_messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .contains("labels", ["Interesado"]),
      ]);
      if (!alive) return;
      const e = sentRes.data || [];
      const sent = e.filter((x: any) => x.status === "sent" || x.sent_at).length;
      setM({
        sent,
        opened: e.filter((x: any) => x.opened_at).length,
        replied: e.filter((x: any) => x.replied_at).length,
        bounced: e.filter((x: any) => x.bounced_at).length,
        senderBounced: e.filter((x: any) => x.status === "failed").length,
        positive: posRes.count || 0,
        sequences: stepsRes.count || 0,
      });
      setLoading(false);
    };
    load();
    return () => { alive = false; };
  }, [campaign.id]);

  const pct = (n: number) => (m.sent > 0 ? `${((n / m.sent) * 100).toFixed(2)}%` : "0%");
  const meta = statusMeta[campaign.status] || statusMeta.draft;
  const StatusIcon = meta.icon;

  const metrics = [
    { key: "sent",     label: "Sent",          value: m.sent,          sub: null,            icon: Send,               color: "text-indigo-600" },
    { key: "opened",   label: "Opened",        value: m.opened,        sub: pct(m.opened),   icon: MailOpen,           color: "text-fuchsia-600" },
    { key: "replied",  label: "Replied w/OOO", value: m.replied,       sub: pct(m.replied),  icon: MessageSquareReply, color: "text-teal-600" },
    { key: "positive", label: "Positive Reply", value: m.positive,     sub: null,            icon: DollarSign,         color: "text-emerald-600", link: true },
    { key: "bounced",  label: "Bounced",       value: m.bounced,       sub: pct(m.bounced),  icon: AlertTriangle,      color: "text-red-500" },
    { key: "sbounced", label: "Sender Bounced", value: m.senderBounced, sub: pct(m.senderBounced), icon: MailX,         color: "text-red-600" },
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {/* Left — Campaign Details */}
        <div className="flex items-center gap-3 lg:w-64 lg:shrink-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60">
            <StatusIcon className={`h-4 w-4 ${meta.cls}`} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Campaign Details</p>
            <p className="truncate font-display text-sm font-bold">{campaign.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              <span className={meta.cls}>{meta.label}</span>
              {" · "}
              {new Date(campaign.created_at).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {m.sequences} {m.sequences === 1 ? "secuencia" : "secuencias"}
            </p>
          </div>
        </div>

        <div className="hidden h-12 w-px bg-border/60 lg:block" />

        {/* Right — Report */}
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Report</p>
          <div className="grid grid-cols-3 gap-y-3 sm:grid-cols-6">
            {metrics.map((mt) => (
              <div key={mt.key} className="min-w-[80px] px-1 text-center">
                <p className={`text-xl font-bold leading-none ${mt.color}`}>
                  {loading ? "—" : mt.value}
                  {!loading && mt.sub && (
                    <span className="ml-1 align-middle text-[11px] font-medium text-muted-foreground">{mt.sub}</span>
                  )}
                </p>
                {mt.link ? (
                  <button
                    onClick={() => navigate("/unibox")}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> {mt.label}
                  </button>
                ) : (
                  <p className="mt-1 inline-flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                    <mt.icon className="h-3 w-3" /> {mt.label}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
