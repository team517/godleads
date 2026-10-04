// Métricas de campaña: una sola puerta para las tres pantallas que las piden.
//
// `campaign_metrics_v2` es la que respeta el "Reiniciar analíticas" (campaigns.analytics_reset_at:
// los contadores sólo cuentan lo ocurrido después; no se borra nada). Si por lo que sea no existe
// todavía en la base de datos, se cae a la función de siempre en vez de enseñar ceros.

import { isMissingRpc } from "@/lib/widget-state";

type RpcError = { message: string; code?: string } | null;
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }> };

export async function fetchCampaignMetrics(client: RpcClient, userId: string): Promise<{ data: any[] | null; error: RpcError }> {
  const v2 = await client.rpc("campaign_metrics_v2", { p_user_id: userId });
  if (!v2.error && Array.isArray(v2.data)) return { data: v2.data as any[], error: null };
  // Sólo si la función NO EXISTE se cae a la de siempre. Cualquier otro fallo (timeout, token
  // caducado) se devuelve tal cual: la vieja ignora "Reiniciar analíticas" y enseñaría números de
  // antes del reinicio como si fueran buenos.
  if (v2.error && !isMissingRpc(v2.error)) return { data: null, error: v2.error };
  const v1 = await client.rpc("campaign_metrics_for_user", { p_user_id: userId });
  return { data: Array.isArray(v1.data) ? (v1.data as any[]) : null, error: v1.error ?? (Array.isArray(v1.data) ? null : { message: "Sin datos de métricas" }) };
}

/** "21 sept, 20:15" — para el aviso «contando desde…». */
export function formatResetAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Texto de búsqueda listo para el servidor: sin espacios sobrantes; menos de 2 letras = no buscar. */
export function normalizeLeadQuery(raw: string): string {
  const q = (raw || "").replace(/\s+/g, " ").trim();
  return q.length >= 2 ? q : "";
}

/** Rebotes de una campaña por causa (campaign_bounce_breakdown). */
export type BounceBreakdown = { policy: number; recipient_gone: number; temporary: number; other: number };

/**
 * Texto de la celda "Rebotados" al pasar el ratón: cuántos y por qué. Separa el bloqueo del
 * servidor emisor (lista negra / reputación: IONOS, Spamhaus) —infraestructura, no la lista— del
 * buzón inexistente —calidad de la lista—. Sin desglose, sólo el total.
 */
export function bounceBreakdownText(total: number, b: BounceBreakdown | null | undefined): string {
  if (!total) return "Sin rebotes";
  const parts: string[] = [`${total.toLocaleString("es-ES")} rebotes`];
  if (b) {
    if (b.policy > 0) parts.push(`${b.policy.toLocaleString("es-ES")} por bloqueo del servidor emisor (lista negra/reputación: IONOS, Spamhaus)`);
    if (b.recipient_gone > 0) parts.push(`${b.recipient_gone.toLocaleString("es-ES")} buzón inexistente`);
    if (b.temporary > 0) parts.push(`${b.temporary.toLocaleString("es-ES")} temporales`);
    if (b.other > 0) parts.push(`${b.other.toLocaleString("es-ES")} otros`);
  }
  return parts.join(" · ");
}

/** Lee el RPC del desglose; si no existe o falla, mapa vacío (la celda enseña sólo el total). */
export async function fetchBounceBreakdown(client: RpcClient, userId: string): Promise<Record<string, BounceBreakdown>> {
  const r = await client.rpc("campaign_bounce_breakdown", { p_user_id: userId });
  const map: Record<string, BounceBreakdown> = {};
  if (r.error || !Array.isArray(r.data)) return map;
  for (const row of r.data as { campaign_id: string; policy: unknown; recipient_gone: unknown; temporary: unknown; other: unknown }[]) {
    map[row.campaign_id] = {
      policy: Number(row.policy) || 0, recipient_gone: Number(row.recipient_gone) || 0,
      temporary: Number(row.temporary) || 0, other: Number(row.other) || 0,
    };
  }
  return map;
}

