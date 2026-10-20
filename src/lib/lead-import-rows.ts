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

export type ImportRow = { email: string; custom_fields: Record<string, string>; verification_status?: string | null };

/** Un email repetido en el CSV → una sola fila (columnas juntas; ante choque gana la última). */
export function dedupeImportRows(rows: ImportRow[]): ImportRow[] {
  const by = new Map<string, ImportRow>();
  for (const r of rows) {
    const email = String(r.email || "").trim().toLowerCase();
    if (!email.includes("@")) continue;
    const prev = by.get(email);
    by.set(email, prev
      ? { email, custom_fields: { ...prev.custom_fields, ...r.custom_fields }, verification_status: r.verification_status || prev.verification_status || null }
      : { email, custom_fields: { ...r.custom_fields }, verification_status: r.verification_status || null });
  }
  return [...by.values()];
}

/**
 * Sube filas por tandas, varias a la vez, SIN dejarse nada: si una tanda falla (tiempo agotado,
 * red), se parte en dos y se reintenta cada mitad; sólo una fila que falla sola cuenta como fallida.
 * `send` devuelve cuántas se añadieron/actualizaron o lanza error.
 */
export async function importInChunks<T>(
  rows: T[],
  send: (chunk: T[]) => Promise<{ added: number; updated: number }>,
  opts: { chunkSize?: number; concurrency?: number; onProgress?: (done: number) => void } = {},
): Promise<{ added: number; updated: number; failed: T[]; error: string | null }> {
  const size = Math.max(1, opts.chunkSize ?? 1000);
  const queue: T[][] = [];
  for (let i = 0; i < rows.length; i += size) queue.push(rows.slice(i, i + size));
  let added = 0, updated = 0, done = 0, lastError: string | null = null;
  const failed: T[] = [];
  const run = async (chunk: T[]): Promise<void> => {
    try {
      const r = await send(chunk);
      added += r.added; updated += r.updated; done += chunk.length;
      opts.onProgress?.(done);
    } catch (e) {
      lastError = (e as Error)?.message || String(e);
      if (chunk.length === 1) { failed.push(chunk[0]); done += 1; opts.onProgress?.(done); return; }
      const mid = Math.ceil(chunk.length / 2);
      await run(chunk.slice(0, mid));
      await run(chunk.slice(mid));
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, opts.concurrency ?? 3), queue.length) }, async () => {
    while (queue.length) await run(queue.shift()!);
  });
  await Promise.all(workers);
  return { added, updated, failed, error: failed.length ? lastError : null };
}
