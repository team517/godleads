// Browser-side gatherer: turns the existing metric RPCs + the report-analyze AI
// function into a fully-populated ReportData, ready for buildReportDoc.
//
// Runs on the CALLER's own account (RLS): the agency owner for a "Hacer una prueba",
// or a client sub-user for their own report. The scheduled server path (Phase 3) builds
// the same shape with the service role instead.

import { supabase } from "@/integrations/supabase/client";
import type { ReportData, ReportKind, CampaignReportBlock } from "./types";

const LOW_CONTACTS_THRESHOLD = 200;

export interface GatherOptions {
  kind: ReportKind;
  periodDays: number;
  clientName: string;
  /** Restrict to these campaign ids; omit → all of the caller's non-draft campaigns. */
  campaignIds?: string[];
  provider?: "deepseek" | "claude";
  /** Skip the AI call (faster; leaves narrative mostly empty). Default false. */
  skipAI?: boolean;
}

function periodLabel(kind: ReportKind, days: number): string {
  if (kind === "weekly") return "Repaso de la última semana";
  return days <= 2 ? "Últimas 48 horas" : `Últimos ${days} días`;
}

export async function gatherReportData(opts: GatherOptions): Promise<ReportData> {
  const periodDays = opts.periodDays;
  // The daily chart always shows at least a week of context (a 48h window is only
  // 2 bars — too sparse to read a trend). Period totals still use `periodDays`.
  const chartDays = Math.max(7, periodDays);

  // 1) Campaign list (id + name), lifetime metrics, and window metrics — in parallel.
  const [campRes, metricsRes, periodRes] = await Promise.all([
    supabase.from("campaigns").select("id, name, status").order("created_at", { ascending: false }),
    (supabase as any).rpc("campaign_metrics_for_user", { p_user_id: "00000000-0000-0000-0000-000000000000" }),
    (supabase as any).rpc("campaign_report_period", { p_days: periodDays }),
  ]);

  // Don't silently emit an all-zero report if the metrics RPC failed (not deployed,
  // permissions, transient) — surface it so the caller shows an error instead of
  // sending a plausible-but-wrong "0 respuestas" report to a client.
  if (campRes.error) throw new Error(`No se pudieron cargar las campañas: ${campRes.error.message}`);
  if (metricsRes.error) throw new Error(`No se pudieron cargar las métricas: ${metricsRes.error.message}`);

  const allCamps: { id: string; name: string; status: string }[] = campRes.data || [];
  // Default (no explicit ids, e.g. the scheduled path) → all NON-draft campaigns.
  const wanted = new Set(
    opts.campaignIds && opts.campaignIds.length
      ? opts.campaignIds
      : allCamps.filter((c) => c.status !== "draft").map((c) => c.id),
  );
  const selected = allCamps.filter((c) => wanted.has(c.id));

  const metricsById = new Map<string, any>();
  for (const r of (metricsRes.data || []) as any[]) metricsById.set(r.campaign_id, r);
  const periodById = new Map<string, any>();
  for (const r of (periodRes.data || []) as any[]) periodById.set(r.campaign_id, r);

  // 2) Per-campaign daily series + remaining leads (parallel, bounded to selected set).
  const blocks: CampaignReportBlock[] = await Promise.all(
    selected.map(async (c) => {
      const [dailyRes, totalRes, contactedRes] = await Promise.all([
        (supabase as any).rpc("campaign_daily_sends", { p_campaign_id: c.id, p_days: chartDays }),
        supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id),
        supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).not("last_sent_at", "is", null),
      ]);
      const m = metricsById.get(c.id) || {};
      const p = periodById.get(c.id) || {};
      const total = totalRes.count || 0;
      const contactedLeads = contactedRes.count || 0;
      const replied = Number(m.replied) || 0;
      // `contacted` (people emailed, from campaign_leads) is the reply-rate denominator.
      // The numerator `replied` comes from a different source (sent_emails.replied_at),
      // so if campaign_leads.last_sent_at is under-populated we could get replied >
      // contacted → a nonsensical rate >100%. A person can't reply without being
      // contacted, so the denominator is at least `replied`.
      const contacted = Math.max(contactedLeads || Number(m.contacted) || 0, replied);
      const daily = ((dailyRes.data || []) as any[]).map((d) => ({
        day: String(d.day), sends: Number(d.sends) || 0, replies: Number(d.replies) || 0,
      }));
      return {
        name: c.name,
        sent: Number(m.sent) || 0,
        contacted,
        replied,
        opened: Number(m.opened) || 0,
        bounced: Number(m.bounced) || 0,
        positive: Number(m.positive) || 0,
        sequences: Number(m.sequences) || 0,
        remaining: Math.max(0, total - contactedLeads),
        periodSent: Number(p.sent) || 0,
        periodNewContacts: Number(p.new_contacts) || 0,
        periodReplies: Number(p.replies) || 0,
        daily,
      };
    }),
  );

  // 3) Aggregate totals.
  const sum = (f: (b: CampaignReportBlock) => number) => blocks.reduce((a, b) => a + f(b), 0);
  const totals = {
    sent: sum((b) => b.sent),
    contacted: sum((b) => b.contacted),
    replied: sum((b) => b.replied),
    opened: sum((b) => b.opened),
    bounced: sum((b) => b.bounced),
    positive: sum((b) => b.positive),
    remaining: sum((b) => b.remaining),
    periodSent: sum((b) => b.periodSent),
    periodNewContacts: sum((b) => b.periodNewContacts),
    periodReplies: sum((b) => b.periodReplies),
  };
  const replyRate = totals.contacted > 0 ? (totals.replied / totals.contacted) * 100 : 0;

  const generatedAtLabel = new Date().toLocaleDateString("es", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const data: ReportData = {
    kind: opts.kind,
    clientName: opts.clientName,
    periodLabel: periodLabel(opts.kind, periodDays),
    generatedAtLabel,
    totals,
    replyRate,
    campaigns: blocks.sort((a, b) => b.contacted - a.contacted),
    narrative: { summary: "", highlights: [], nextSteps: [], suggestions: [], alert: null },
  };

  // 4) AI narrative (optional).
  if (!opts.skipAI) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/report-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          kind: opts.kind,
          clientName: opts.clientName,
          periodLabel: data.periodLabel,
          totals,
          replyRate,
          lowContacts: totals.remaining < LOW_CONTACTS_THRESHOLD,
          provider: opts.provider,
          campaigns: blocks.map((b) => ({
            name: b.name, contacted: b.contacted, sent: b.sent, replied: b.replied,
            positive: b.positive, remaining: b.remaining,
            periodNewContacts: b.periodNewContacts, periodReplies: b.periodReplies,
          })),
        }),
      });
      const j = await resp.json();
      if (j?.narrative) data.narrative = j.narrative;
      else if (j?.error) data.narrative.summary = `No se pudo generar el análisis con IA: ${j.error}`;
    } catch (e: any) {
      data.narrative.summary = `No se pudo generar el análisis con IA (${e?.message || "error"}). El resto del informe es correcto.`;
    }
  }

  return data;
}
