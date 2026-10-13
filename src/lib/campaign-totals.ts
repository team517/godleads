// Totales GLOBALES de Estadísticas y del Dashboard (06-10-2026).
//
// Antes la tasa global salía de user_email_stats: respuestas de las campañas ÷ TODOS los
// destinatarios a los que se ha escrito alguna vez (campañas borradas, respuestas manuales,
// copias…). Con support@ daba 0,1 % mientras cada campaña de la tabla iba al 1-2 %. Ahora sale de las
// MISMAS cifras de la tabla de Campañas (contactados = leads ya escritos de cada campaña, como la
// columna). Decisión del dueño: la tasa global es la MEDIA de los porcentajes de la columna
// «Respondidos» (campañas con algún contactado); los totales de las tarjetas son sumas.

import { fetchCampaignMetrics } from "@/lib/campaign-metrics";
import { fetchMetricsExtra, replyRatePct, repliesView, type MetricsExtra } from "@/lib/campaign-health";

type RpcError = { message: string; code?: string } | null;
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }> };

export type CampaignTotals = { sent: number; contacted: number; replied: number; bounced: number; campaigns: number; avgRate: number; ratedCampaigns: number };

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Una campaña entra en la media con al menos estos contactados: una prueba con 1-2 envíos (en
 *  hello@, «PRUEBA» con 1 contactado) daba 100-800 % y disparaba la media a 162 %. */
export const MIN_CONTACTED_FOR_AVG = 20;

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
  const t: CampaignTotals = { sent: 0, contacted: 0, replied: 0, bounced: 0, campaigns: 0, avgRate: 0, ratedCampaigns: 0 };
  const rates: { pct: number; contacted: number }[] = [];
  for (const r of rows || []) {
    const id = String(r.campaign_id || "");
    const ex = id && extra ? extra[id] : undefined;
    const sent = n(r.sent);
    const fromProgress = id && leadsSent && leadsSent[id] != null ? n(leadsSent[id]) : null;
    const contacted = fromProgress ?? (n(r.contacted) || sent);
    const replied = Math.min(repliesView({ replied: n(r.replied), repliedHuman: ex?.repliedHuman, repliedAuto: ex?.repliedAuto }).shown, contacted || Infinity);
    t.sent += sent;
    t.contacted += contacted;
    t.bounced += n(r.bounced);
    t.replied += replied;
    t.campaigns += 1;
    const pct = replyRatePct(replied, contacted);
    if (pct != null) rates.push({ pct, contacted });
  }
  // Media de los % de las campañas con muestra (>= MIN_CONTACTED_FOR_AVG contactados); si ninguna
  // llega, de todas las que tienen algún contactado.
  const big = rates.filter((x) => x.contacted >= MIN_CONTACTED_FOR_AVG);
  const used = big.length ? big : rates;
  t.ratedCampaigns = used.length;
  t.avgRate = used.length ? used.reduce((a, x) => a + x.pct, 0) / used.length : 0;
  return t;
}

/** Tasa global en % = media de los porcentajes de cada campaña (decisión del dueño, 06-10-2026). */
export function globalReplyRate(t: Pick<CampaignTotals, "avgRate"> | null | undefined): number {
  return t ? t.avgRate : 0;
}

/** Las cifras de cada campaña tal cual llegan (métricas + desglose de respuestas + leads escritos).
 *  Estadísticas las guarda así para poder sumar sólo las campañas elegidas (13-10-2026). */
export type CampaignBreakdown = {
  rows: Record<string, unknown>[];
  extra: Record<string, MetricsExtra>;
  leadsSent: Record<string, number> | null;
};

/** Para useWidget: { data, error } con las cifras de todas las campañas del usuario. */
export async function fetchCampaignBreakdown(client: RpcClient, userId: string): Promise<{ data: CampaignBreakdown | null; error: RpcError }> {
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
  return { data: { rows: m.data as Record<string, unknown>[], extra: ex, leadsSent }, error: null };
}

/** Sólo las filas de las campañas elegidas; sin selección (null o vacía) = todas. */
export function rowsFor(b: CampaignBreakdown | null | undefined, ids?: readonly string[] | null): Record<string, unknown>[] {
  if (!b) return [];
  if (!ids || ids.length === 0) return b.rows;
  const want = new Set(ids);
  return b.rows.filter((r) => want.has(String(r.campaign_id || "")));
}

/** Totales (las mismas reglas que la tabla de Campañas) de las campañas elegidas. */
export function totalsFor(b: CampaignBreakdown | null | undefined, ids?: readonly string[] | null): CampaignTotals | null {
  if (!b) return null;
  return sumCampaignTotals(rowsFor(b, ids), b.extra, b.leadsSent);
}

/** Suma de una columna de las métricas (abiertos, fallidos…) en las campañas elegidas. */
export function sumFieldFor(b: CampaignBreakdown | null | undefined, ids: readonly string[] | null | undefined, field: string): number {
  return rowsFor(b, ids).reduce((a, r) => a + n(r[field]), 0);
}

/** Una fila por campaña para la tabla «Por campaña» (contactados como la columna de Campañas). */
export type CampaignStatRow = { id: string; sent: number; contacted: number; replied: number; bounced: number; pct: number | null };
export function campaignStatRows(b: CampaignBreakdown | null | undefined, ids?: readonly string[] | null): CampaignStatRow[] {
  if (!b) return [];
  return rowsFor(b, ids).map((r) => {
    const id = String(r.campaign_id || "");
    const t = sumCampaignTotals([r], b.extra, b.leadsSent);
    return { id, sent: t.sent, contacted: t.contacted, replied: t.replied, bounced: t.bounced, pct: replyRatePct(t.replied, t.contacted) };
  });
}

/** Para useWidget: { data, error } con los totales de todas las campañas del usuario. */
export async function fetchCampaignTotals(client: RpcClient, userId: string): Promise<{ data: CampaignTotals | null; error: RpcError }> {
  const b = await fetchCampaignBreakdown(client, userId);
  if (b.error || !b.data) return { data: null, error: b.error };
  return { data: totalsFor(b.data), error: null };
}
