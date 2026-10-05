/**
 * Cuándo la pantalla de Leads vuelve a CONTAR (count: "exact" sobre toda la cuenta + recuento
 * de cada carpeta). Contar es lo caro: con 100.000 leads cada cambio de página costaba un
 * recuento entero aunque el total no hubiera cambiado. Ahora se cuenta al entrar, al cambiar de
 * carpeta y tras cualquier cambio (alta, borrado, importación: `forced`); pasar de página no.
 */
export function leadsCountKey(userId: string | null | undefined, activeList: string | null): string {
  return `${userId || ""}|${activeList || ""}`;
}

export function needsRecount(lastCountedKey: string | null, key: string, forced: boolean): boolean {
  if (forced) return true;
  return lastCountedKey !== key;
}
