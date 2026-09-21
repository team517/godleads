// Aplicar un mismo cambio a muchas filas (p. ej. slow-ramp en 400 buzones) en pocos viajes.
//
// Antes era un UPDATE por cuenta, uno detrás de otro y sin avisar de nada: con 400 buzones eran
// ~40 s con el diálogo congelado. Aquí van por tandas (`.in("id", tanda)`), varias a la vez, y
// cada tanda que termina mueve la barra.

export interface BulkProgress { done: number; total: number; failed: number }

/**
 * Tandas de 25 ids, 5 a la vez. Pequeñas a propósito: la barra AVANZA (400 buzones = 16 tandas en
 * 4 oleadas, ~medio segundo) en vez de saltar de 0 a 100, y quedan lejísimos del límite de URL de
 * la API (se rompe entre 600 y 900 uuids).
 */
export const BULK_CHUNK = 25;
export const BULK_PARALLEL = 5;

export function chunk<T>(items: T[], size: number = BULK_CHUNK): T[][] {
  const n = Math.max(1, Math.floor(size) || BULK_CHUNK);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * Ejecuta `apply(tanda)` sobre todos los ids, con `parallel` tandas en vuelo. `apply` devuelve
 * (o lanza) un error si la tanda falló; una tanda fallida NO corta las demás. Devuelve el resumen.
 */
export async function applyInChunks(
  ids: string[],
  apply: (ids: string[]) => Promise<{ error?: unknown } | void>,
  onProgress?: (p: BulkProgress) => void,
  opts: { size?: number; parallel?: number } = {},
): Promise<BulkProgress> {
  const unique = [...new Set(ids)];
  const chunks = chunk(unique, opts.size);
  const state: BulkProgress = { done: 0, total: unique.length, failed: 0 };
  onProgress?.({ ...state });
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const mine = chunks[next++];
      let failed = false;
      try {
        const res = await apply(mine);
        failed = !!(res && (res as { error?: unknown }).error);
      } catch {
        failed = true;
      }
      if (failed) state.failed += mine.length;
      state.done += mine.length;
      onProgress?.({ ...state });
    }
  };
  const lanes = Math.max(1, Math.min(opts.parallel ?? BULK_PARALLEL, chunks.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return { ...state };
}
