// Totales GLOBALES de Estadísticas y del Dashboard (06-10-2026).
//
// Antes la tasa global salía de user_email_stats: respuestas de las campañas ÷ TODOS los
// destinatarios a los que se ha escrito alguna vez (campañas borradas, respuestas manuales,
// copias…). Con support@ daba 0,1 % mientras cada campaña de la tabla iba al 1-2 %. Ahora sale de las
// MISMAS cifras de la tabla de Campañas (contactados = leads ya escritos de cada campaña, como la
// columna). Decisión del dueño: la tasa global es la MEDIA de los porcentajes de la columna
// «Respondidos» (campañas con algún contactado); los totales de las tarjetas son sumas.

import { fetchCampaignMetrics } from "@/lib/campaign-metrics";
import { fetchMetricsExtra, repliesView, type MetricsExtra } from "@/lib/campaign-health";

type RpcError = { message: string; code?: string } | null;
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }> };

export type CampaignTotals = { sent: number; contacted: number; replied: number; bounced: number; campaigns: number; avgRate: number };

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Totales por campaña (filas de campaign_metrics_v2 + desglose de respuestas + leads ya escritos de
 * campaign_lead_counts). `contacted` de cada campaña = leads ya escritos, como la columna de la tabla;
 * sin ese dato, el de las métricas. `avgRate` = media de los % de cada campaña con contactados.
 */
export function sumCampaignTotals(
  rows: Record<string, unknown>[] | null | undefined,
  extra?: Record<string, MetricsExtra> | null,
  leadsSent?: Record<string, number> | null,
): CampaignTotals {
  const t: CampaignTotals = { sent: 0, contacted: 0, replied: 0, bounced: 0, campaigns: 0, avgRate: 0 };
  let rateSum = 0;
  let rated = 0;
  for (const r of rows || []) {
    const id = String(r.campaign_id || "");
    const ex = id && extra ? extra[id] : undefined;
    const sent = n(r.sent);
    const fromProgress = id && leadsSent && leadsSent[id] != null ? n(leadsSent[id]) : null;
    const contacted = fromProgress ?? (n(r.contacted) || sent);
    const replied = repliesView({ replied: n(r.replied), repliedHuman: ex?.repliedHuman, repliedAuto: ex?.repliedAuto }).shown;
    t.sent += sent;
    t.contacted += contacted;
    t.bounced += n(r.bounced);
    t.replied += replied;
    t.campaigns += 1;
    if (contacted > 0) { rateSum += (replied / contacted) * 100; rated += 1; }
  }
  t.avgRate = rated > 0 ? rateSum / rated : 0;
  return t;
}

/** Tasa global en % = media de los porcentajes de cada campaña (decisión del dueño, 06-10-2026). */
export function globalReplyRate(t: Pick<CampaignTotals, "avgRate"> | null | undefined): number {
  return t ? t.avgRate : 0;
}

/** Para useWidget: { data, error } con los totales de todas las campañas del usuario. */
export async function fetchCampaignTotals(client: RpcClient, userId: string): Promise<{ data: CampaignTotals | null; error: RpcError }> {
  const [m, ex] = await Promise.all([
    fetchCampaignMetrics(client, userId),
    fetchMetricsExtra(client).catch(() => ({} as Record<string, MetricsExtra>)),
  ]);
  if (m.error || !m.data) return { data: null, error: m.error ?? { message: "Sin datos de campañas" } };
  // Leads ya escritos por campaña (la columna «Contactados» de la tabla). Si falla, las métricas.
  const ids = (m.data as Record<string, unknown>[]).map((r) => String(r.campaign_id || "")).filter(Boolean);
  let leadsSent: Record<string, number> | null = null;
  if (ids.length) {
    const lc = await client.rpc("campaign_lead_counts", { p_campaign_ids: ids });
    if (!lc.error && Array.isArray(lc.data)) {
      leadsSent = {};
      for (const r of lc.data as { campaign_id: string; leads_sent: unknown }[]) leadsSent[r.campaign_id] = n(r.leads_sent);
    }
  }
  return { data: sumCampaignTotals(m.data, ex, leadsSent), error: null };
}
