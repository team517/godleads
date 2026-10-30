// Métricas de campaña: una sola puerta para las tres pantallas que las piden.
//
// `campaign_metrics_v2` es la que respeta el "Reiniciar analíticas" (campaigns.analytics_reset_at:
// los contadores sólo cuentan lo ocurrido después; no se borra nada). Si por lo que sea no existe
// todavía en la base de datos, se cae a la función de siempre en vez de enseñar ceros.

import { isMissingRpc } from "@/lib/widget-state";

type RpcError = { message: string; code?: string } | null;
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }> };

/** Para los widgets: la copia que guarda el servidor (cached_rpc, 31-10-2026: la cifra ya calculada,
 *  el cron la refresca cada 5 min). Si falla o no existe, la llamada de siempre. */
export async function cachedOr<T>(client: RpcClient, key: string, live: () => PromiseLike<{ data: T; error: RpcError }>): Promise<{ data: T; error: RpcError }> {
  const c = await client.rpc("cached_rpc", { p_key: key, p_force: false });
  if (!c.error && c.data !== null && c.data !== undefined) return { data: c.data as T, error: null };
  return live();
}

/** `force`: recalcular ya (tras "Reiniciar analíticas" o para un informe), sin esperar al cron. */
export async function fetchCampaignMetrics(client: RpcClient, userId: string, opts: { force?: boolean } = {}): Promise<{ data: any[] | null; error: RpcError }> {
  // Cifras precalculadas: support@ tardaba 17,8 s en frío y la pantalla corta a los 8 ("—" y "0 secuencias").
  const c = await client.rpc("cached_rpc", { p_key: "campaign_metrics_v2", p_force: !!opts.force });
  if (!c.error && Array.isArray(c.data)) return { data: c.data as any[], error: null };
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
  // 06-10-2026: "Rebotados" sólo suma los rebotes por la dirección del lead (bounce_is_lead_fault);
  // los bloqueos del servidor emisor (lista negra/reputación: IONOS, Spamhaus) se dicen aparte.
  const blocked = b && b.policy > 0 ? `Aparte, ${b.policy.toLocaleString("es-ES")} bloqueos del servidor emisor (IONOS/Spamhaus) que no cuentan como rebote` : "";
  if (!total) return blocked || "Sin rebotes";
  const parts: string[] = [`${total.toLocaleString("es-ES")} rebotes`];
  if (b && b.recipient_gone > 0) parts.push(`${b.recipient_gone.toLocaleString("es-ES")} buzón inexistente`);
  if (blocked) parts.push(blocked);
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


/**
 * % de rebote = rebotes ÷ INTENTOS (enviados + rebotados), como Instantly/Smartlead (19-10-2026).
 * Desde el 06-10 «Enviados» ya no cuenta los rebotados (un correo que no existe no es un envío), así
 * que dividir sólo entre enviados inflaba el porcentaje: Coco salía al 38,4 % cuando es el 27,7 %.
 */
export function bounceRatePct(bounced: number, sentDelivered: number): number {
  const b = Math.max(0, Number(bounced) || 0);
  const attempts = Math.max(0, Number(sentDelivered) || 0) + b;
  return attempts > 0 ? (b / attempts) * 100 : 0;
}
