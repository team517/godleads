import { useCallback, useEffect, useRef, useState } from "react";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { applySettled, initialWidget, settle, type RpcLike, type WidgetState } from "@/lib/widget-state";

/**
 * Un dato de pantalla que se carga solo, con caché de "pintado instantáneo" (instant-cache: memoria +
 * localStorage si la clave está en PERSIST_KEYS) y su propio reintento. Si la carga falla se conserva
 * lo último bueno y se expone `error`; la pantalla decide cómo enseñarlo SIN dejar nada en blanco.
 */
export function useWidget<T>(opts: {
  /** Clave de instant-cache (opcional). Al volver a la página se pinta lo cacheado y se refresca detrás. */
  cacheKey?: string;
  /** false = no cargar todavía (p. ej. pestaña cerrada o usuario sin sesión). */
  enabled?: boolean;
  load: () => PromiseLike<RpcLike<T>>;
  deps: unknown[];
}): WidgetState<T> & { reload: () => void } {
  const { cacheKey, enabled = true, deps } = opts;
  const fresh = () => initialWidget<T>(cacheKey ? cacheGet<T>(cacheKey) : undefined);
  const [state, setState] = useState<WidgetState<T>>(fresh);
  const [tick, setTick] = useState(0);
  // La función de carga cambia en cada render: se lee la última desde un ref para no relanzar.
  const loadRef = useRef(opts.load);
  loadRef.current = opts.load;
  // Si cambian la clave o las dependencias (otra campaña, otro usuario) el dato anterior ya no
  // vale: se vuelve al estado inicial de la clave nueva en vez de enseñar el de la vieja.
  const identity = JSON.stringify([cacheKey ?? null, ...deps]);
  const lastIdentity = useRef(identity);

  useEffect(() => {
    if (lastIdentity.current !== identity) {
      lastIdentity.current = identity;
      setState(fresh());
    }
    if (!enabled) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    // Un fallo SÍNCRONO de la carga (cliente sin inicializar, bug) también acaba en `error`, no en
    // una excepción que tumbe el árbol de React.
    settle<T>(Promise.resolve().then(() => loadRef.current())).then((res) => {
      if (!alive) return;
      setState((prev) => {
        const next = applySettled(prev, res);
        if (cacheKey && !next.error && next.data !== undefined) cacheSet(cacheKey, next.data);
        return next;
      });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, identity]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
