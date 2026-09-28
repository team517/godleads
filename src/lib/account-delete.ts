// ¿Se pueden borrar estas cuentas? Sólo si NINGUNA está en una campaña ACTIVA (pausada sí vale).
// Una cuenta está en una campaña si se añadió a mano (campaign_accounts) o si una de sus etiquetas
// coincide EXACTAMENTE con las etiquetas de cuentas de la campaña (la misma regla que el motor).

export interface CuentaBorrable { id: string; tags?: string[] | null }
export interface CampanaBorrado { id: string; name: string; status: string; account_tags?: string[] | null }
export interface EnlaceDirecto { campaign_id: string; account_id: string }

export interface Bloqueo { campana: string; cuentas: number }

export function campanasActivasQueUsan(
  ids: string[],
  cuentas: CuentaBorrable[],
  campanas: CampanaBorrado[],
  directas: EnlaceDirecto[],
): Bloqueo[] {
  const elegidas = new Set(ids);
  const tagsDe = new Map(cuentas.map((c) => [c.id, c.tags || []]));
  const out: Bloqueo[] = [];
  for (const camp of campanas) {
    if (camp.status !== "active") continue;
    const tagsCamp = new Set(camp.account_tags || []);
    const usadas = new Set<string>();
    for (const d of directas) if (d.campaign_id === camp.id && elegidas.has(d.account_id)) usadas.add(d.account_id);
    if (tagsCamp.size) {
      for (const id of elegidas) if ((tagsDe.get(id) || []).some((t) => tagsCamp.has(t))) usadas.add(id);
    }
    if (usadas.size) out.push({ campana: camp.name, cuentas: usadas.size });
  }
  return out.sort((a, b) => b.cuentas - a.cuentas);
}

export function mensajeBloqueo(bloqueos: Bloqueo[]): string {
  const total = bloqueos.length;
  const nombres = bloqueos.slice(0, 3).map((b) => `"${b.campana}" (${b.cuentas})`).join(", ");
  const resto = total > 3 ? ` y ${total - 3} más` : "";
  return `No se pueden borrar: están en ${total === 1 ? "una campaña activa" : `${total} campañas activas`}: ${nombres}${resto}. Pausa ${total === 1 ? "esa campaña" : "esas campañas"} y vuelve a intentarlo.`;
}
