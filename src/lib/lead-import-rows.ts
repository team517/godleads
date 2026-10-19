// Filas de un CSV → filas para guardar como leads (importación de la campaña, 19-10-2026).
// Puro, para poder probar lo que se guarda: variables (custom_fields) y estado del email.
import { findEmailStatusColumn, rowEmailStatus, type LeadVerification } from "@/lib/email-status";
import { elegirColumnasPlantilla } from "@/lib/variable-resolver";

/** Importación «Plantilla»: email + columnas de la plantilla (la columna del CSV con más datos para
 *  cada una) + `email_status` si la lista lo trae (no es variable: va a verification_status). */
export function templateRows(
  headers: string[], rows: Record<string, string>[], templateColumns: readonly string[],
  alias: (h: string) => string, fix: (s: string) => string = (s) => s,
): Record<string, string>[] {
  const origen = elegirColumnasPlantilla(headers, rows, [...templateColumns], alias);
  const statusCol = findEmailStatusColumn(headers);
  return rows.map((row) => {
    const out: Record<string, string> = {};
    const email = origen.email ? fix(String(row[origen.email] ?? "")) : "";
    out.email = email;
    for (const col of templateColumns) out[col] = origen[col] ? fix(String(row[origen[col]] ?? "")) : "";
    const st = statusCol ? String(row[statusCol] ?? "").trim() : "";
    if (st) out.email_status = st;
    return out;
  }).filter((r) => r.email?.trim());
}

/** Una fila → { custom_fields, verification_status }. En la plantilla el estado no se guarda como variable. */
export function leadFieldsFromRow(
  row: Record<string, string>,
  opts: { statusCol: string | null; importAllColumns: boolean; selectedCols?: Set<string> | null },
): { custom_fields: Record<string, string>; verification_status: LeadVerification | null } {
  const useColFilter = !opts.importAllColumns && !!opts.selectedCols && opts.selectedCols.size > 0;
  const custom_fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "email" || !value?.trim()) continue;
    if (useColFilter && !opts.selectedCols!.has(key)) continue;
    if (opts.importAllColumns && key === opts.statusCol) continue;
    custom_fields[key] = value.trim();
  }
  return { custom_fields, verification_status: rowEmailStatus(row, opts.statusCol) };
}
