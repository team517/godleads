// Reimportar un CSV en una campaña: los leads que YA están (mismo email) se ACTUALIZAN con las
// columnas nuevas en vez de crearse otra vez. `leads` no tiene índice único por email, así que
// antes cada reimportación creaba filas duplicadas y la campaña volvía a escribir a la misma
// persona (hello tenía 18.575 emails repetidos el 22-09-2026).

export type Fields = Record<string, string>;

/** Campos del lead tras el CSV: lo nuevo con valor pisa a lo viejo; lo vacío no borra nada. */
export function mergeLeadFields(existing: Fields | null | undefined, incoming: Fields | null | undefined): Fields {
  const out: Fields = { ...(existing || {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** ¿Cambia algo al fusionar? (para no escribir filas que quedan igual) */
export function fieldsChanged(existing: Fields | null | undefined, merged: Fields): boolean {
  const a = existing || {};
  const ka = Object.keys(a), kb = Object.keys(merged);
  if (ka.length !== kb.length) return true;
  return kb.some((k) => a[k] !== merged[k]);
}

/**
 * Reparte las filas del CSV en: nuevas (a insertar) y existentes (a actualizar), según el mapa
 * email → lead ya presente en la campaña.
 */
export function splitRows<T extends { email: string; custom_fields: Fields }>(
  rows: T[],
  existingByEmail: Map<string, { id: string; custom_fields: Fields | null }>,
): { toInsert: T[]; toUpdate: { id: string; custom_fields: Fields }[]; unchanged: number } {
  const toInsert: T[] = [];
  const toUpdate: { id: string; custom_fields: Fields }[] = [];
  let unchanged = 0;
  for (const r of rows) {
    const hit = existingByEmail.get(r.email.toLowerCase());
    if (!hit) { toInsert.push(r); continue; }
    const merged = mergeLeadFields(hit.custom_fields, r.custom_fields);
    if (fieldsChanged(hit.custom_fields, merged)) toUpdate.push({ id: hit.id, custom_fields: merged });
    else unchanged++;
  }
  return { toInsert, toUpdate, unchanged };
}
