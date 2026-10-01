// Personalización: cómo se guardan y se leen los leads de un trabajo.
//
// Antes todo el CSV viajaba en UNA petición dentro de la fila del trabajo: con 13.000 leads eran
// 40-45 MB y la conexión la cortaba ("No se pudo iniciar: Failed to fetch"). Ahora cada lead es una
// fila de `personalization_csv_rows` y se suben por tandas pequeñas, con reintentos. Los trabajos
// antiguos (storage "json": rows/results dentro del trabajo) se siguen leyendo igual.

export type Fila = Record<string, string> & { __idx: number };
export type Resultados = Record<string, { message: string; error?: string }>;

/** Tamaño máximo de cada tanda de subida. Pequeño a propósito: una petición de varios MB se corta. */
export const TANDA_BYTES = 600_000;
export const TANDA_FILAS = 300;
const PAGINA = 1000;      // PostgREST devuelve como mucho 1000 filas por petición
const EN_PARALELO = 3;

/** Trocea las filas en tandas que no pasen ni de `maxBytes` ni de `maxFilas`. */
export function trocear<T>(filas: T[], maxBytes = TANDA_BYTES, maxFilas = TANDA_FILAS): T[][] {
  const out: T[][] = [];
  let actual: T[] = [], bytes = 0;
  for (const f of filas) {
    const peso = JSON.stringify(f).length;
    if (actual.length && (bytes + peso > maxBytes || actual.length >= maxFilas)) { out.push(actual); actual = []; bytes = 0; }
    actual.push(f);
    bytes += peso;
  }
  if (actual.length) out.push(actual);
  return out;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Repite una operación de red que puede fallar de forma pasajera. */
async function conReintentos<T>(op: () => PromiseLike<{ data?: T; error: { message: string } | null }>, intentos = 4): Promise<T | undefined> {
  let ultimo = "";
  for (let i = 0; i < intentos; i++) {
    try {
      const { data, error } = await op();
      if (!error) return data;
      ultimo = error.message;
    } catch (e) {
      ultimo = e instanceof Error ? e.message : String(e);
    }
    if (i < intentos - 1) await esperar(700 * (i + 1));
  }
  throw new Error(ultimo || "fallo de red");
}

export interface NuevoTrabajo {
  user_id: string; filename: string; prompt: string; provider: string; email_column: string; columns: string[];
}

/**
 * Crea el trabajo y sube sus leads por tandas. Mientras se suben el trabajo está en "uploading"
 * (el servidor no lo toca); al terminar pasa a "pending" y empieza a generarse. Si la subida falla
 * del todo, el trabajo se borra para no dejar uno a medias.
 */
export async function crearTrabajo(db: any, base: NuevoTrabajo, filas: Fila[], onProgress?: (subidas: number, total: number) => void): Promise<string> {
  const job = await conReintentos<{ id: string }>(() => db.from("personalization_csv_jobs").insert({
    ...base, rows: [], results: {}, storage: "rows", status: "uploading", total: filas.length, done: 0, ok: 0, failed: 0,
  }).select("id").single());
  const id = job!.id;
  try {
    const tandas = trocear(filas.map(({ __idx, ...data }) => ({ job_id: id, idx: __idx, data })));
    let subidas = 0;
    onProgress?.(0, filas.length);
    for (let i = 0; i < tandas.length; i += EN_PARALELO) {
      await Promise.all(tandas.slice(i, i + EN_PARALELO).map(async (t) => {
        // upsert: si un reintento repite una tanda que sí había llegado, no duplica ni falla.
        await conReintentos(() => db.from("personalization_csv_rows").upsert(t, { onConflict: "job_id,idx", ignoreDuplicates: true }));
        subidas += t.length;
        onProgress?.(subidas, filas.length);
      }));
    }
    await conReintentos(() => db.from("personalization_csv_jobs").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", id));
    return id;
  } catch (e) {
    try { await db.from("personalization_csv_jobs").delete().eq("id", id); } catch { /* se queda como incompleto */ }
    throw e;
  }
}

/** Lee por páginas una consulta que puede pasar de 1000 filas. */
async function paginas<T>(total: number, pagina: (desde: number, hasta: number) => PromiseLike<{ data?: T[]; error: { message: string } | null }>): Promise<T[]> {
  const n = Math.max(1, Math.ceil(total / PAGINA));
  const out: T[][] = new Array(n);
  for (let i = 0; i < n; i += EN_PARALELO) {
    await Promise.all(Array.from({ length: Math.min(EN_PARALELO, n - i) }, async (_, k) => {
      const p = i + k;
      out[p] = (await conReintentos<T[]>(() => pagina(p * PAGINA, p * PAGINA + PAGINA - 1))) || [];
    }));
  }
  return out.flat();
}

/** Las filas del CSV y los mensajes generados de un trabajo, venga guardado como venga. */
export async function leerTrabajo(db: any, id: string): Promise<{ rows: Fila[]; results: Resultados }> {
  const { data: job } = await db.from("personalization_csv_jobs").select("storage, total").eq("id", id).maybeSingle();
  if (!job) return { rows: [], results: {} };
  if (job.storage !== "rows") {
    const { data } = await db.from("personalization_csv_jobs").select("rows, results").eq("id", id).maybeSingle();
    return { rows: Array.isArray(data?.rows) ? data.rows : [], results: data?.results || {} };
  }
  type R = { idx: number; data: Record<string, string>; message: string | null; error: string | null; done: boolean };
  const filas = await paginas<R>(job.total || 0, (a, b) =>
    db.from("personalization_csv_rows").select("idx, data, message, error, done").eq("job_id", id).order("idx", { ascending: true }).range(a, b));
  const rows: Fila[] = [];
  const results: Resultados = {};
  for (const f of filas) {
    rows.push({ ...(f.data || {}), __idx: f.idx } as Fila);
    if (f.done) results[String(f.idx)] = f.error ? { message: "", error: f.error } : { message: f.message || "" };
  }
  return { rows, results };
}

/** Sólo los mensajes generados (para cuando el CSV ya está cargado en la página). */
export async function leerResultados(db: any, id: string): Promise<Resultados> {
  const { data: job } = await db.from("personalization_csv_jobs").select("storage, total").eq("id", id).maybeSingle();
  if (!job) return {};
  if (job.storage !== "rows") {
    const { data } = await db.from("personalization_csv_jobs").select("results").eq("id", id).maybeSingle();
    return data?.results || {};
  }
  type R = { idx: number; message: string | null; error: string | null };
  const filas = await paginas<R>(job.total || 0, (a, b) =>
    db.from("personalization_csv_rows").select("idx, message, error").eq("job_id", id).eq("done", true).order("idx", { ascending: true }).range(a, b));
  const results: Resultados = {};
  for (const f of filas) results[String(f.idx)] = f.error ? { message: "", error: f.error } : { message: f.message || "" };
  return results;
}
