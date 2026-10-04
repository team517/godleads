// Estado de un "widget" de datos (una tarjeta, una gráfica): cada uno carga por su cuenta, guarda lo
// último que tuvo y, si falla, lo dice EN SU SITIO con su propio "Reintentar". Así un RPC lento o
// caído (statement_timeout de 8 s, token caducado, red) nunca deja toda la pantalla en blanco ni en
// el spinner: lo demás se pinta igual. Lógica pura, sin React, para poder probarla.

export type RpcLike<T> = { data?: T | null; error?: { message?: string; code?: string } | null };

export type WidgetState<T> = {
  /** Último dato bueno (de caché o de una carga que fue bien). `undefined` = aún no hay nada. */
  data: T | undefined;
  /** Mensaje del último fallo; se conserva el dato anterior si lo había. */
  error: string | null;
  loading: boolean;
};

export function initialWidget<T>(cached?: T): WidgetState<T> {
  return { data: cached, error: null, loading: true };
}

/** Texto legible de cualquier error (Error, {message}, string, PostgREST…). */
export function errorText(e: unknown): string {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  const m = (e as { message?: unknown }).message;
  if (typeof m === "string" && m.trim()) return m;
  return "Error desconocido";
}

/** Aplica el resultado de una petición (Promise.allSettled) al estado del widget. */
export function applySettled<T>(prev: WidgetState<T>, res: PromiseSettledResult<RpcLike<T>>): WidgetState<T> {
  if (res.status === "rejected") return { ...prev, loading: false, error: errorText(res.reason) };
  const v = res.value;
  // Las RPC de supabase-js no "lanzan": devuelven { error }. Un error no es "no hay datos".
  if (v?.error) return { ...prev, loading: false, error: errorText(v.error) };
  return { data: (v?.data ?? undefined) as T | undefined, error: null, loading: false };
}

/** Envuelve una promesa para que nunca rechace: siempre un PromiseSettledResult. */
export async function settle<T>(p: PromiseLike<RpcLike<T>>): Promise<PromiseSettledResult<RpcLike<T>>> {
  try {
    return { status: "fulfilled", value: await p };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

/**
 * ¿El error es "esa función no existe todavía"? (migración aún sin aplicar). Sirve para caer a la
 * consulta de antes sólo en ese caso; cualquier otro error se enseña tal cual.
 */
export function isMissingRpc(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const m = (error.message || "").toLowerCase();
  return m.includes("could not find the function") || m.includes("does not exist");
}

/** Número seguro desde lo que devuelva el servidor (bigint llega como string). */
export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
