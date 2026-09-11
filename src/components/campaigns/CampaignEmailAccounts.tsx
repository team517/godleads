import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * "Cuentas" tab of a campaign — the Smartlead-style Email Accounts table.
 *
 * The campaign's accounts are the union of the direct picks (campaign_accounts) and the
 * tag matches (email_accounts.tags && campaigns.account_tags); the SQL side of that union
 * (plus the per-account counters) lives in the RPC campaign_account_stats — see
 * supabase/migrations/20260911150000_campaign_account_stats.sql.
 * Accounts are read from the masked view email_accounts_safe (passwords never leave the DB).
 */

/** Row shape returned by the RPC (bigints arrive as numbers over PostgREST). */
type AccountStats = {
  account_id: string;
  in_campaign_direct: boolean;
  in_campaign_by_tag: boolean;
  leads_assigned: number;
  sent_total: number;
  sent_today: number;
  replied: number;
  bounced: number;
  campaigns_total: number;
  campaigns_active: number;
};

type Row = AccountStats & { account: any };

type SortKey = "email" | "sent" | "leads";

/**
 * Effective daily limit per account = smallest of the stored daily_limit, the engine's hard
 * cap and the account slow ramp. Duplicated on purpose from CampaignOptions.tsx (effLimitFor)
 * so this tab stays standalone — the SOURCE OF TRUTH is the engine's
 * process-campaign-queue.getEffectiveLimit; the campaign-level slow ramp (a further cap shown
 * in the Opciones tab) is not applied here, this column is the per-ACCOUNT ceiling.
 */
const HARD_DAILY_CAP = 30;
function effLimitFor(acc: any): { limit: number; accRampDay: number | null } {
  let limit = Math.min(acc?.daily_limit ?? HARD_DAILY_CAP, HARD_DAILY_CAP);
  let accRampDay: number | null = null;
  if (acc?.warmup_enabled && acc?.warmup_started_at) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(acc.warmup_started_at).getTime()) / 86400000));
    const inc = acc.warmup_increment || 2;
    const target = acc.warmup_limit || limit;
    accRampDay = days + 1;
    limit = Math.min(limit, Math.min((days + 1) * inc, target));
  }
  return { limit: Math.max(1, limit), accRampDay };
}

/** PostgREST chokes on very long `in` lists — ask in slices. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const pill =
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

const PILLS = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  warn: "bg-amber-50 text-amber-700 border-amber-600/30 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  bad: "bg-red-50 text-red-700 border-red-600/30 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

const DOTS = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", neutral: "bg-muted-foreground/60" };

type Tone = keyof typeof PILLS;

/** Status pill, mirroring email_accounts.status + last_error. */
function statusOf(acc: any): { tone: Tone; label: string; title?: string } {
  const s = acc?.status;
  if (s === "connected") {
    return acc?.last_error
      ? { tone: "warn", label: "Aviso", title: String(acc.last_error).slice(0, 200) }
      : { tone: "ok", label: "Preparada" };
  }
  if (s === "error" || s === "auth_failed") {
    return { tone: "bad", label: "Error", title: acc?.last_error ? String(acc.last_error).slice(0, 200) : undefined };
  }
  return { tone: "neutral", label: "Pendiente" };
}

function nameOf(acc: any): string {
  const full = [acc?.first_name, acc?.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  const email = String(acc?.email || "");
  return email ? email.split("@")[0] : "Cuenta sin nombre";
}

function StatusPill({ acc }: { acc: any }) {
  const st = statusOf(acc);
  return (
    <span className={cn(pill, PILLS[st.tone])} title={st.title}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[st.tone])} />
      {st.label}
    </span>
  );
}

/** Warm-up pill: the score when we have it, otherwise just "Activo". */
function WarmupCell({ acc }: { acc: any }) {
  if (!acc?.warmup_enabled) return <span className="text-xs text-muted-foreground">—</span>;
  const score = typeof acc?.warmup_score === "number" ? acc.warmup_score : null;
  if (score === null) {
    return (
      <span className={cn(pill, PILLS.ok)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", DOTS.ok)} /> Activo
      </span>
    );
  }
  const tone: Tone = score >= 90 ? "ok" : score >= 60 ? "warn" : "bad";
  return (
    <span className={cn(pill, PILLS[tone])} title={`Puntuación de warm-up: ${score}%`}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} />
      {score}%
    </span>
  );
}

/** "sent / eff" + bar + %, used by both the table and the mobile card. */
function LimitCell({ row, compact }: { row: Row; compact?: boolean }) {
  const { limit, accRampDay } = effLimitFor(row.account);
  const sent = row.account?.sent_today ?? 0;
  const pct = Math.min(100, Math.round((sent / Math.max(1, limit)) * 100));
  const full = pct >= 100;
  return (
    <div className={cn("space-y-1", compact ? "w-full" : "w-32")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold tabular-nums text-foreground">{`${sent} / ${limit}`}</span>
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{`${pct}%`}</span>
      </div>
      <Progress
        value={pct}
        className={cn("h-1.5 bg-muted", full ? "[&>div]:bg-emerald-500" : "[&>div]:bg-violet-500")}
      />
      {accRampDay !== null && (
        <span className="inline-block rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600 dark:text-violet-300">
          🐢 Día {accRampDay}
        </span>
      )}
    </div>
  );
}

function SortHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <th scope="col" className={cn("px-4 py-2.5 text-left font-medium whitespace-nowrap", className)}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        {active &&
          (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function Head({ label, className }: { label: string; className?: string }) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-2.5 text-left text-[13px] font-medium whitespace-nowrap text-muted-foreground", className)}
    >
      {label}
    </th>
  );
}

const EMPTY_TEXT =
  "Esta campaña aún no tiene cuentas. Asígnalas por etiqueta o una a una en la pestaña Opciones.";

export default function CampaignEmailAccounts({ campaignId }: { campaignId: string }) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("email");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [campRes, statsRes] = await Promise.all([
        supabase.from("campaigns").select("id,name,status,account_tags").eq("id", campaignId).single(),
        (supabase as any).rpc("campaign_account_stats", { p_campaign_id: campaignId }),
      ]);

      if ((campRes as any)?.error) toast.error("No se pudo cargar la campaña: " + (campRes as any).error.message);
      setCampaign((campRes as any)?.data ?? null);

      if (statsRes?.error) {
        toast.error("No se pudieron cargar las cuentas: " + statsRes.error.message);
        setRows([]);
        return;
      }

      const stats: AccountStats[] = (statsRes?.data ?? []) as AccountStats[];
      const ids = stats.map((s) => s.account_id).filter(Boolean);

      const accounts: any[] = [];
      for (const part of chunk(ids, 200)) {
        const { data, error } = await (supabase as any)
          .from("email_accounts_safe")
          .select("*")
          .in("id", part);
        if (error) {
          toast.error("No se pudieron cargar las cuentas: " + error.message);
          break;
        }
        accounts.push(...((data ?? []) as any[]));
      }

      const byId = new Map<string, any>(accounts.map((a) => [a.id, a]));
      setRows(stats.map((s) => ({ ...s, account: byId.get(s.account_id) ?? { id: s.account_id } })));
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const campaignTags: string[] = useMemo(() => campaign?.account_tags ?? [], [campaign]);

  /** Which of the campaign's tags this account actually carries (for the tooltip). */
  const matchedTags = useCallback(
    (acc: any) => (acc?.tags ?? []).filter((t: string) => campaignTags.includes(t)),
    [campaignTags],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (!needle) return true;
      return `${nameOf(r.account)} ${r.account?.email ?? ""}`.toLowerCase().includes(needle);
    });
    const sign = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "sent") return (a.sent_total - b.sent_total) * sign;
      if (sortKey === "leads") return (a.leads_assigned - b.leads_assigned) * sign;
      return String(a.account?.email ?? "").localeCompare(String(b.account?.email ?? "")) * sign;
    });
  }, [rows, q, sortKey, sortDir]);

  const summary = useMemo(() => {
    let ready = 0;
    let broken = 0;
    let capacity = 0;
    for (const r of rows) {
      const s = r.account?.status;
      if (s === "connected") ready++;
      if (s === "error" || s === "auth_failed") broken++;
      capacity += effLimitFor(r.account).limit;
    }
    return { ready, broken, capacity };
  }, [rows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "email" ? "asc" : "desc");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando cuentas…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header strip: tags of the campaign + summary + search + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {campaignTags.length > 0 && (
            <span className="mr-1 text-xs text-muted-foreground">Etiquetas:</span>
          )}
          {campaignTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md border border-violet-600/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300"
            >
              <Tag className="h-3 w-3" /> {t}
            </span>
          ))}
          <span className={cn(pill, PILLS.neutral)}>{rows.length} cuentas</span>
          <span className={cn(pill, PILLS.ok)}>{summary.ready} preparadas</span>
          {summary.broken > 0 && <span className={cn(pill, PILLS.bad)}>{summary.broken} con error</span>}
          <span className={cn(pill, PILLS.neutral)}>Capacidad hoy: {summary.capacity}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar cuenta…"
              aria-label="Buscar cuenta"
              className="h-9 w-52 pl-8 text-sm"
            />
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => void load()} aria-label="Actualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {EMPTY_TEXT}
        </div>
      ) : isMobile ? (
        /* ── Mobile: one stacked card per account ── */
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.account_id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{nameOf(r.account)}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.account?.email ?? "—"}</p>
                </div>
                <StatusPill acc={r.account} />
              </div>
              <div className="mt-2">
                <LimitCell row={r} compact />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{r.leads_assigned}</span> leads ·{" "}
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">{r.sent_total}</span> enviados
              </p>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Ninguna cuenta coincide con «{q.trim()}».
            </p>
          )}
        </div>
      ) : (
        /* ── Desktop: the Smartlead-style table ── */
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[1050px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <Head label="Cuenta" className="min-w-[240px]" />
                <Head label="Estado" />
                <Head label="Límite diario" />
                <Head label="Warm-up" />
                <SortHead
                  label="Enviados aquí"
                  active={sortKey === "sent"}
                  dir={sortDir}
                  onClick={() => toggleSort("sent")}
                />
                <Head label="Respuestas" />
                <Head label="Rebotes" />
                <Head label="Campañas" />
                <SortHead
                  label="Leads"
                  active={sortKey === "leads"}
                  dir={sortDir}
                  onClick={() => toggleSort("leads")}
                />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Ninguna cuenta coincide con «{q.trim()}».
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const tags = matchedTags(r.account);
                const byTag = r.in_campaign_by_tag;
                const replyPct =
                  r.leads_assigned > 0 ? `${((r.replied / r.leads_assigned) * 100).toFixed(1)}%` : null;
                const bounceHigh = r.sent_total > 0 && (r.bounced / r.sent_total) * 100 > 2;

                return (
                  <tr
                    key={r.account_id}
                    className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    {/* Cuenta */}
                    <td className="px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-foreground">{nameOf(r.account)}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          {byTag ? (
                            <Tag
                              className="h-3 w-3 flex-shrink-0 text-violet-500"
                              aria-label="Incluida por etiqueta"
                            />
                          ) : (
                            <Link2
                              className="h-3 w-3 flex-shrink-0 text-muted-foreground"
                              aria-label="Elegida directamente"
                            />
                          )}
                          <span
                            className="truncate"
                            title={
                              byTag
                                ? `Incluida por ${tags.length > 1 ? "las etiquetas" : "la etiqueta"} ${tags.join(", ") || "de la campaña"}`
                                : "Elegida directamente en Opciones"
                            }
                          >
                            {r.account?.email ?? "—"}
                          </span>
                        </p>
                      </div>
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3">
                      <StatusPill acc={r.account} />
                    </td>

                    {/* Límite diario */}
                    <td className="px-4 py-3">
                      <LimitCell row={r} />
                    </td>

                    {/* Warm-up */}
                    <td className="px-4 py-3">
                      <WarmupCell acc={r.account} />
                    </td>

                    {/* Enviados aquí */}
                    <td className="px-4 py-3">
                      <span className="text-[15px] font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
                        {r.sent_total}
                      </span>
                      <p className="text-[11px] text-muted-foreground">hoy {r.sent_today}</p>
                    </td>

                    {/* Respuestas */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                        <span className="text-[15px] font-semibold tabular-nums text-teal-600 dark:text-teal-400">
                          {r.replied}
                        </span>
                        {replyPct && <span className="text-xs font-medium text-muted-foreground">{replyPct}</span>}
                      </span>
                    </td>

                    {/* Rebotes */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <span className="text-[15px] font-semibold tabular-nums text-red-500 dark:text-red-400">
                          {r.bounced}
                        </span>
                        {bounceHigh && (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label="Tasa de rebote alta" />
                        )}
                      </span>
                    </td>

                    {/* Campañas (Shared Campaign Status) */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs">
                      <span className="font-medium text-foreground">Total {r.campaigns_total}</span>
                      <span className="mx-1.5 text-muted-foreground">|</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        Activas {r.campaigns_active}
                      </span>
                    </td>

                    {/* Leads */}
                    <td className="px-4 py-3">
                      <span className="text-[15px] font-semibold tabular-nums text-foreground">
                        {r.leads_assigned}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
