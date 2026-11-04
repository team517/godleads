/* Carga paginada de la lista de cuentas (04-11-2026). Antes, un fallo de la consulta (corte por tiempo,
   columna que la vista no tenía, base reiniciándose) dejaba la lista vacía y la pantalla enseñaba
   "Conecta una cuenta de envío" como si el cliente no tuviera buzones. Ahora: se reintenta una vez
   y, si vuelve a fallar, se devuelve el error para que la pantalla lo diga y ofrezca Reintentar. */

export type PageResult = { data: unknown[] | null; error: { message?: string } | null };
export type ListResult = { accounts: any[]; error: string | null; attempts: number };

export const PAGE_SIZE = 1000;
export const RETRY_DELAY_MS = 1500;

export async function loadAccountsPaged(
  fetchPage: (offset: number) => PromiseLike<PageResult>,
  opts: { retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ListResult> {
  const delay = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempts = 0;
  let lastError = "";
  for (let intento = 0; intento < 2; intento++) {
    attempts++;
    try {
      const all: any[] = [];
      let failed = false;
      for (let off = 0; ; off += PAGE_SIZE) {
        const { data, error } = await fetchPage(off);
        if (error) { lastError = error.message || "Error desconocido"; failed = true; break; }
        const page = (data || []) as any[];
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      if (!failed) return { accounts: all, error: null, attempts };
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
    if (intento === 0) await sleep(delay);
  }
  return { accounts: [], error: lastError || "Error desconocido", attempts };
}
