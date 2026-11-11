import { deleteCampaignOnServer, markCampaignRemoved, unmarkCampaignRemoved } from "@/lib/campaign-delete";
import { TOUR_CAMPAIGN_NAME } from "@/lib/tour";

/* La campaña de ejemplo del tutorial: se crea pulsando «Crear» de verdad (borrador) y aquí sólo se
 * averigua cuál es (la que NO existía antes del clic) y, si el cliente lo pide al final, se borra.
 * Sólo se borra ESE id, con el mismo borrado de la lista de campañas. */

type Sb = { from: (t: string) => any };

/** Ids de las campañas de ejemplo que ya existían (para reconocer la nueva). */
export async function exampleIds(sb: Sb, userId: string): Promise<Set<string>> {
  try {
    const { data } = await sb.from("campaigns").select("id").eq("user_id", userId).eq("name", TOUR_CAMPAIGN_NAME);
    return new Set(((data as { id: string }[] | null) || []).map((r) => r.id));
  } catch { return new Set(); }
}

/** La campaña de ejemplo recién creada: con ese nombre, en borrador y que no estaba antes. */
export async function captureNewExample(
  sb: Sb, userId: string, before: Set<string>, timeoutMs = 9000, signal?: { cancelled: boolean },
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.cancelled) return null;
    try {
      const { data } = await sb.from("campaigns").select("id, status, created_at")
        .eq("user_id", userId).eq("name", TOUR_CAMPAIGN_NAME).order("created_at", { ascending: false }).limit(5);
      const fresh = ((data as { id: string; status: string }[] | null) || []).find((r) => !before.has(r.id) && r.status === "draft");
      if (fresh) return fresh.id;
    } catch { /* reintento */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Borra la campaña de ejemplo (sólo ese id). Devuelve el motivo si falla, o null. */
export async function deleteExample(sb: Sb, id: string, expected: string | null): Promise<string | null> {
  if (!id || id !== expected) return "no es la campaña de ejemplo de este tutorial";
  // Y que siga siendo la de ejemplo (si la ha renombrado, ya es suya: no se toca).
  try {
    const { data } = await sb.from("campaigns").select("name").eq("id", id).maybeSingle();
    if (!data) return null; // ya no existe
    if ((data as { name?: string }).name !== TOUR_CAMPAIGN_NAME) return "la has renombrado, así que la dejo";
  } catch { /* si no se puede comprobar, el borrado de abajo dirá si falla */ }
  markCampaignRemoved(id);
  const err = await deleteCampaignOnServer(sb, id);
  if (err) unmarkCampaignRemoved(id);
  return err;
}
