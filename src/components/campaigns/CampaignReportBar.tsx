import { useNavigate } from "react-router-dom";
import {
  Send, Users, MessageSquareReply, AlertTriangle,
  Play, Pause, FileEdit, ExternalLink, DollarSign,
} from "lucide-react";
import { autoRepliesLabel, campaignHealthReason, repliesView, sentTooltip, REPLIES_TOOLTIP, type CampaignHealthRow } from "@/lib/campaign-health";
import { CampaignHealthChip } from "@/components/campaigns/CampaignsTable";

type Metrics = {
  sent: number; contacted: number; opened: number; replied: number; positive: number; bounced: number; senderBounced: number; sequences: number;
  /** Personas que contestaron / sólo autorrespuestas / envíos sin confirmación final (campaign_metrics_extra). */
  repliedHuman?: number; repliedAuto?: number; sentUnconfirmed?: number;
};
interface Props { campaign: any; metrics?: Metrics | null; health?: CampaignHealthRow | null; }

const statusMeta: Record<string, { label: string; cls: string; icon: typeof Play }> = {
  active:    { label: "Activa",    cls: "text-emerald-600 dark:text-emerald-400", icon: Play },
  paused:    { label: "Pausada",   cls: "text-amber-600 dark:text-amber-400",     icon: Pause },
  draft:     { label: "Borrador",  cls: "text-muted-foreground", icon: FileEdit },
  completed: { label: "Completada", cls: "text-blue-600 dark:text-blue-400",       icon: FileEdit },
};

const EMPTY: Metrics = { sent: 0, contacted: 0, opened: 0, replied: 0, positive: 0, bounced: 0, senderBounced: 0, sequences: 0 };

/** Instantly-style report bar: campaign details on the left, key metrics on the right.
 *  The numbers come from the parent (single campaign_metrics_v2 RPC, exact, server-side). While
 *  they are not there yet it shows "—": the old fallback downloaded the campaign's sent_emails
 *  rows with no limit, which PostgREST capped at 1000 → wrong totals on any big campaign. */
export default function CampaignReportBar({ campaign, metrics: metricsProp, health }: Props) {
  const navigate = useNavigate();
  const m: Metrics = metricsProp ?? EMPTY;
  const loading = !metricsProp;

  const pct = (n: number) => (m.sent > 0 ? `${((n / m.sent) * 100).toFixed(2)}%` : "0%");
  // Reply rate over CONTACTED leads (people), not emails sent (which include
  // follow-ups). Fall back to sent for old cached metrics with no `contacted`.
  const denom = (m.contacted || 0) || m.sent;
  // "Respuestas" = personas; las automáticas van aparte. Sin el desglose, la cifra de siempre.
  const rv = repliesView(m);
  const replyPct = denom > 0 ? `${((rv.shown / denom) * 100).toFixed(2)}%` : "0%";
  const meta = statusMeta[campaign.status] || statusMeta.draft;
  const StatusIcon = meta.icon;

  const metrics: { key: string; label: string; value: number; sub: string | null; extra?: string | null; hint?: string; icon: typeof Send; color: string; link?: boolean }[] = [
    { key: "sent",     label: "Enviados",      value: m.sent,          sub: null,            icon: Send,               color: "text-primary", hint: sentTooltip(m.sent, m.sentUnconfirmed) },
    { key: "contacted",label: "Contactados",   value: m.contacted,     sub: null,            icon: Users,              color: "text-sky-600 dark:text-sky-400" },
    { key: "replied",  label: "Respuestas",    value: rv.shown,        sub: replyPct,        extra: rv.split ? autoRepliesLabel(rv.auto) : null, hint: REPLIES_TOOLTIP, icon: MessageSquareReply, color: "text-teal-600 dark:text-teal-400" },
    { key: "positive", label: "Positivos",     value: m.positive,     sub: null,            icon: DollarSign,         color: "text-emerald-600 dark:text-emerald-400", link: true },
    { key: "bounced",  label: "Rebotados",     value: m.bounced,       sub: pct(m.bounced),  hint: "Rebotes confirmados: el servidor del destinatario rechazó el correo.", icon: AlertTriangle, color: "text-red-500 dark:text-red-400" },
    // "Sender Bounced" removed — it counted transient SMTP failures (e.g. an IONOS
    // "503" storm that just retries) as if they were bounces, inflating a scary red
    // number. "Bounced" above is the real hard-bounce count.
  ];

  return (
    <div className="rounded-md border border-border/60 bg-card px-4 py-3 shadow-rest">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        {/* Left — Campaign Details */}
        <div className="flex items-center gap-3 lg:w-64 lg:shrink-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60">
            <StatusIcon className={`h-4 w-4 ${meta.cls}`} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Datos de la campaña</p>
            <p className="truncate font-display tracking-[-0.03em] text-sm font-bold">{campaign.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              <span className={meta.cls}>{meta.label}</span>
              {" · "}
              {new Date(campaign.created_at).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {m.sequences} {m.sequences === 1 ? "secuencia" : "secuencias"}
            </p>
            <div className="mt-1"><CampaignHealthChip reason={campaignHealthReason(campaign.status, health)} compact /></div>
          </div>
        </div>

        <div className="hidden h-12 w-px bg-border/60 lg:block" />

        {/* Right — Report */}
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Informe</p>
          <div className="grid grid-cols-3 gap-x-1 gap-y-3 sm:grid-cols-4 lg:grid-cols-7">
            {metrics.map((mt) => (
              <div key={mt.key} className="min-w-[60px] px-1 text-center sm:min-w-[80px]" title={mt.hint}>
                <p className={`text-xl font-bold leading-none ${mt.color}`}>
                  {loading ? "—" : mt.value}
                  {!loading && mt.sub && (
                    <span className="ml-1 align-middle text-[11px] font-medium text-muted-foreground">{mt.sub}</span>
                  )}
                </p>
                {!loading && mt.extra && (
                  <p className="mt-0.5 text-[10.5px] font-medium leading-none text-muted-foreground">{mt.extra}</p>
                )}
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
