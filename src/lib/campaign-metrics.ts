// Métricas de campaña: una sola puerta para las tres pantallas que las piden.
//
// `campaign_metrics_v2` es la que respeta el "Reiniciar analíticas" (campaigns.analytics_reset_at:
// los contadores sólo cuentan lo ocurrido después; no se borra nada). Si por lo que sea no existe
// todavía en la base de datos, se cae a la función de siempre en vez de enseñar ceros.

type RpcError = { message: string } | null;
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }> };

export async function fetchCampaignMetrics(client: RpcClient, userId: string): Promise<{ data: any[] | null; error: RpcError }> {
  const v2 = await client.rpc("campaign_metrics_v2", { p_user_id: userId });
  if (!v2.error && Array.isArray(v2.data)) return { data: v2.data as any[], error: null };
  const v1 = await client.rpc("campaign_metrics_for_user", { p_user_id: userId });
  return { data: Array.isArray(v1.data) ? (v1.data as any[]) : null, error: v1.error };
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
