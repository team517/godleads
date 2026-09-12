import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  Building2,
  Copy,
  MessageSquareReply,
  Megaphone,
  Pause,
  Play,
  Search,
  Send,
  Settings2,
  Shuffle,
  Smile,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import CampaignProgressRing from "@/components/campaigns/CampaignProgressRing";

export type CampaignMetrics = {
  sent: number;
  contacted: number;
  opened: number;
  replied: number;
  positive: number;
  bounced: number;
  senderBounced?: number;
  sequences?: number;
};

export type CampaignManager = { id: string; name: string; color: string };

export type CampaignClient = { id: string; name: string };

export interface CampaignsTableProps {
  /** FULL list of campaigns (tab counts are always computed over this, never over the filtered view). */
  campaigns: any[];
  managers?: CampaignManager[];
  /** Clients of the account, loaded ONCE by the page — never one query per row. */
  clients?: CampaignClient[];
  /** leads emailed / total leads, per campaign id (already computed by the page, count-only queries). */
  progressMap: Record<string, { sent: number; total: number }>;
  /** Metrics resolver from the page (single RPC) — may return null/undefined while loading. */
  metricsFor: (id: string) => CampaignMetrics | null | undefined;
  onSelect: (id: string) => void;
  onToggleStatus: (campaign: any) => void;
  onDuplicate: (campaign: any) => void;
  onRemix: (campaign: any) => void;
  onDelete: (id: string) => void;
}

/** Only the statuses the app actually writes/knows (see statusConfig in Campaigns.tsx). */
const TABS = [
  { key: "all", label: "Todas" },
  { key: "active", label: "Activas" },
  { key: "paused", label: "Pausadas" },
  { key: "draft", label: "Borradores" },
  { key: "completed", label: "Completadas" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Pastilla de estado del diseño "Primary" (DESIGN.md): radio 999px, 13px/600,
 *  fondo tintado con el texto de SU MISMO tono. Los tonos son TOKENS
 *  (`success`/`warning`/`info`/`muted`), que ya se aclaran en `.dark`, así que la
 *  pastilla sigue al tema sin necesidad de variantes `dark:`. */
const STATUS_PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-[3px] text-[13px] font-semibold leading-none";

const statusPill: Record<string, { label: string; className: string; dot: string }> = {
  active: {
    label: "Activa",
    className: "bg-success/12 text-success border-success/25",
    dot: "bg-success",
  },
  paused: {
    label: "Pausada",
    className: "bg-warning/15 text-warning border-warning/30",
    dot: "bg-warning",
  },
  draft: {
    label: "Borrador",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/60",
  },
  completed: {
    label: "Completada",
    className: "bg-info/12 text-info border-info/25",
    dot: "bg-info",
  },
};

/** Ring colour mirrors the state: green running, amber paused, blue done, grey draft. */
const ringColor: Record<string, string> = {
  // Tokens, not literals: each one is already lifted in `.dark` so the ring and its
  // centred % label keep their contrast on a dark row.
  active: "hsl(var(--success))",
  paused: "hsl(var(--warning))",
  completed: "hsl(var(--info))",
  draft: "hsl(var(--muted-foreground))",
};

const pctOf = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : null);

function HeadCell({
  icon: Icon,
  label,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  className?: string;
}) {
  return (
    <th scope="col" className={cn("px-4 py-2.5 text-left font-semibold whitespace-nowrap", className)}>
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
    </th>
  );
}

function Metric({
  value,
  pct,
  className,
  icon: Icon,
  warn,
}: {
  value: number | null;
  pct?: string | null;
  className: string;
  icon?: React.ComponentType<{ className?: string }>;
  warn?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      {Icon && <Icon className={cn("h-3.5 w-3.5 self-center", className)} />}
      <span className={cn("text-[15px] font-semibold tabular-nums", className)}>{value === null ? "—" : value}</span>
      {value !== null && pct && <span className="text-[13px] font-semibold text-muted-foreground">{pct}</span>}
      {warn && <AlertTriangle className="h-3.5 w-3.5 self-center text-warning" aria-label="Tasa de rebote alta" />}
    </span>
  );
}

export default function CampaignsTable({
  campaigns,
  managers = [],
  clients = [],
  progressMap,
  metricsFor,
  onSelect,
  onToggleStatus,
  onDuplicate,
  onRemix,
  onDelete,
}: CampaignsTableProps) {
  const [tab, setTab] = useState<TabKey>("all");
  const [q, setQ] = useState("");

  // Counts ALWAYS over the full list (not the filtered view).
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: campaigns.length, active: 0, paused: 0, draft: 0, completed: 0 };
    for (const camp of campaigns) {
      const s = camp?.status && c[camp.status] !== undefined ? camp.status : "draft";
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  }, [campaigns]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return campaigns.filter((c) => {
      const status = statusPill[c?.status] ? c.status : "draft";
      if (tab !== "all" && status !== tab) return false;
      if (needle && !String(c?.name || "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [campaigns, tab, q]);

  return (
    <div className="space-y-3">
      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Filtrar campañas por estado">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 font-display text-[13px] font-semibold tracking-[-0.03em] transition-colors",
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label} ({counts[t.key] ?? 0})
            </button>
          ))}
        </div>
        <div className="relative pb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar campaña…"
            aria-label="Buscar campaña"
            className="h-9 w-56 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-border bg-card shadow-rest">
        <table className="w-full min-w-[900px] border-collapse text-[15px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <HeadCell icon={Megaphone} label="Campaña" className="min-w-[280px]" />
              <HeadCell icon={Users} label="Leads" />
              <HeadCell icon={Send} label="Enviados" />
              <HeadCell icon={MessageSquareReply} label="Respondidos" />
              <HeadCell icon={Smile} label="Positivos" />
              <HeadCell icon={AlertTriangle} label="Rebotados" />
              <HeadCell icon={Settings2} label="Acciones" className="text-right" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-[13px] text-muted-foreground">
                  {q.trim()
                    ? `Ninguna campaña coincide con «${q.trim()}».`
                    : "No hay campañas en esta pestaña."}
                </td>
              </tr>
            )}
            {rows.map((campaign) => {
              const status = statusPill[campaign.status] ? campaign.status : "draft";
              const pill = statusPill[status];
              const prog = progressMap[campaign.id] || { sent: 0, total: 0 };
              const m = metricsFor(campaign.id) || null;
              const sent = m?.sent ?? 0;
              const replied = m?.replied ?? 0;
              const contacted = (m?.contacted ?? 0) || sent;
              const bounced = m?.bounced ?? 0;
              const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
              const steps = m?.sequences ?? 0;
              const mgr = campaign.manager_id ? managers.find((x) => x.id === campaign.manager_id) : null;
              const client = campaign.client_id ? clients.find((x) => x.id === campaign.client_id) : null;
              const created = campaign.created_at ? new Date(campaign.created_at) : null;

              return (
                <tr
                  key={campaign.id}
                  onClick={() => onSelect(campaign.id)}
                  className="cursor-pointer border-b border-border/60 transition-colors last:border-b-0 hover:bg-muted/50"
                >
                  {/* Campaña */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CampaignProgressRing sent={prog.sent} total={prog.total} color={ringColor[status]} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[15px] font-semibold text-foreground">{campaign.name}</span>
                          <span className={cn(STATUS_PILL_BASE, pill.className)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", pill.dot)} />
                            {pill.label}
                          </span>
                          {/* Cliente de la campaña — chip CUADRADO (6px), no pastilla. */}
                          {client && (
                            <span
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-accent px-2 py-[2px] text-[10.5px] font-semibold text-accent-foreground"
                              title={`Cliente: ${client.name}`}
                            >
                              <Building2 className="h-3 w-3" />
                              {client.name}
                            </span>
                          )}
                          {/* Manager colour is user data → tint/border/text derived from it with
                              color-mix, stronger + lighter under `dark:` so the chip reads on a
                              dark row. */}
                          {mgr && (
                            <span
                              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border py-0.5 pl-0.5 pr-2 text-[10.5px] font-semibold bg-[color-mix(in_srgb,var(--mgr)_9%,transparent)] border-[color-mix(in_srgb,var(--mgr)_22%,transparent)] text-[color:var(--mgr)] dark:bg-[color-mix(in_srgb,var(--mgr)_22%,transparent)] dark:border-[color-mix(in_srgb,var(--mgr)_42%,transparent)] dark:text-[color:color-mix(in_srgb,var(--mgr)_70%,white)]"
                              style={{ "--mgr": mgr.color } as any}
                              title={"Responsable: " + mgr.name}
                            >
                              <span
                                className="flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                                style={{ backgroundColor: mgr.color, width: 16, height: 16 }}
                              >
                                {mgr.name.charAt(0).toUpperCase()}
                              </span>
                              {mgr.name}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          {steps} {steps === 1 ? "secuencia" : "secuencias"}
                          {created && !isNaN(created.getTime()) && (
                            <> · Creada {format(created, "d MMM, HH:mm", { locale: es })}</>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Numbers */}
                  <td className="px-4 py-3">
                    <Metric value={prog.total} className="text-violet-600 dark:text-violet-400" />
                  </td>
                  <td className="px-4 py-3">
                    <Metric value={m === null ? null : sent} className="text-indigo-600 dark:text-indigo-400" />
                  </td>
                  <td className="px-4 py-3">
                    <Metric
                      value={m === null ? null : replied}
                      pct={pctOf(replied, contacted)}
                      className="text-teal-600 dark:text-teal-400"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Metric
                      value={m === null ? null : m.positive}
                      pct={pctOf(m?.positive ?? 0, replied)}
                      icon={Smile}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Metric
                      value={m === null ? null : bounced}
                      pct={pctOf(bounced, sent)}
                      className="text-red-500 dark:text-red-400"
                      warn={m !== null && bounceRate > 2}
                    />
                  </td>

                  {/* Acciones */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={
                          campaign.status === "active"
                            ? `Pausar la campaña ${campaign.name}`
                            : `Activar la campaña ${campaign.name}`
                        }
                        title={campaign.status === "active" ? "Pausar" : "Activar"}
                        onClick={() => onToggleStatus(campaign)}
                      >
                        {campaign.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Duplicar la campaña ${campaign.name}`}
                        title="Duplicar"
                        onClick={() => onDuplicate(campaign)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Remix — fusionar otra campaña en ${campaign.name}`}
                        title="Remix — fusionar otra campaña aquí"
                        onClick={() => onRemix(campaign)}
                      >
                        <Shuffle className="h-3.5 w-3.5 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Eliminar la campaña ${campaign.name}`}
                        title="Eliminar"
                        onClick={() => onDelete(campaign.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
