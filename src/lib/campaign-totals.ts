// Totales GLOBALES de Estadísticas y del Dashboard (06-10-2026).
//
// Antes la tasa global salía de user_email_stats: respuestas de las campañas ÷ TODOS los
// destinatarios a los que se ha escrito alguna vez (campañas borradas, respuestas manuales,
// copias…). Con support@ daba 0,1 % mientras cada campaña de la tabla iba al 1-2 %. Ahora es la suma
// de las MISMAS cifras de la tabla de Campañas: enviados, contactados, respondidos y rebotados de
// cada campaña, y la tasa = respondidos totales ÷ contactados totales (no la media de porcentajes).

import { fetchCampaignMetrics } from "@/lib/campaign-metrics";
import { fetchMetricsExtra, repliesView, type MetricsExtra } from "@/lib/campaign-health";

type RpcError = { message: string; code?: string } | null;
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }> };

export type CampaignTotals = { sent: number; contacted: number; replied: number; bounced: number; campaigns: number };

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Suma por campaña (filas de campaign_metrics_v2 + desglose de respuestas si lo hay). */
export function sumCampaignTotals(rows: Record<string, unknown>[] | null | undefined, extra?: Record<string, MetricsExtra> | null): CampaignTotals {
  const t: CampaignTotals = { sent: 0, contacted: 0, replied: 0, bounced: 0, campaigns: 0 };
  for (const r of rows || []) {
    const id = String(r.campaign_id || "");
    const ex = id && extra ? extra[id] : undefined;
    t.sent += n(r.sent);
    t.contacted += n(r.contacted);
    t.bounced += n(r.bounced);
    t.replied += repliesView({ replied: n(r.replied), repliedHuman: ex?.repliedHuman, repliedAuto: ex?.repliedAuto }).shown;
    t.campaigns += 1;
  }
  return t;
}

/** Tasa global en % = respondidos ÷ contactados (0 si no hay contactados). */
export function globalReplyRate(t: Pick<CampaignTotals, "replied" | "contacted"> | null | undefined): number {
  return t && t.contacted > 0 ? (t.replied / t.contacted) * 100 : 0;
}

/** Para useWidget: { data, error } con los totales de todas las campañas del usuario. */
export async function fetchCampaignTotals(client: RpcClient, userId: string): Promise<{ data: CampaignTotals | null; error: RpcError }> {
  const [m, ex] = await Promise.all([
    fetchCampaignMetrics(client, userId),
    fetchMetricsExtra(client).catch(() => ({} as Record<string, MetricsExtra>)),
  ]);
  if (m.error || !m.data) return { data: null, error: m.error ?? { message: "Sin datos de campañas" } };
  return { data: sumCampaignTotals(m.data, ex), error: null };
}
