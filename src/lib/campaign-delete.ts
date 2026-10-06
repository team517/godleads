// Borrado de campañas desde la lista: al confirmar, la campaña desaparece AL MOMENTO y el borrado
// real sigue en segundo plano. Si el servidor falla, la campaña vuelve a su sitio.

/** Campañas quitadas de la lista (borrado en curso o ya hecho). Vive a nivel de módulo, no en el
 *  componente: si se sale de Campañas y se vuelve antes de que el servidor termine, la recarga de
 *  la lista no la hace reaparecer. Si el borrado falla, se saca de aquí. Son UUID: no se reutilizan. */
const removed = new Set<string>();

export const markCampaignRemoved = (id: string): void => { removed.add(id); };
export const unmarkCampaignRemoved = (id: string): void => { removed.delete(id); };
export const isCampaignRemoved = (id: string): boolean => removed.has(id);

/** La lista sin las campañas quitadas (para lo que llega de una recarga). */
export function withoutRemovedCampaigns<T extends { id: string }>(list: T[]): T[] {
  return removed.size ? list.filter((c) => !removed.has(c.id)) : list;
}

/** Devuelve `item` a su posición original si no está ya en la lista. */
export function restoreCampaignAt<T extends { id: string }>(list: T[], item: T, index: number): T[] {
  if (list.some((c) => c.id === item.id)) return list;
  const next = list.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

type DeleteResult = { data?: unknown; error: { message?: string } | null };

/**
 * Borra la campaña en el servidor. Mismas tablas y mismo orden de siempre (pasos, cuentas
 * asignadas, leads de campaña y la campaña); se comprueba el error de cada paso. Devuelve el
 * motivo del fallo, o null si se borró.
 */
export async function deleteCampaignOnServer(sb: any, id: string): Promise<string | null> {
  try {
    const r1: DeleteResult = await sb.from("campaign_steps").delete().eq("campaign_id", id);
    const r2: DeleteResult = await sb.from("campaign_accounts").delete().eq("campaign_id", id);
    const r3: DeleteResult = await sb.from("campaign_leads").delete().eq("campaign_id", id);
    // .select("id"): un borrado que no toca ninguna fila (permiso, ya no existe) no da error en
    // PostgREST; sin esto se anunciaba "eliminada" y la campaña volvía en la siguiente visita.
    const r4: DeleteResult = await sb.from("campaigns").delete().eq("id", id).select("id");
    const err = r1.error || r2.error || r3.error || r4.error;
    if (err) return err.message || String(err);
    if (Array.isArray(r4.data) && r4.data.length === 0) {
      return "no se borró ninguna fila (puede que ya no exista o que no tengas permiso)";
    }
    return null;
  } catch (e: any) {
    return e?.message || String(e);
  }
}
