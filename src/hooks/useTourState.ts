import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TourState } from "@/lib/tour";

/* ¿Qué contestó esta cuenta al mini tutorial? Se guarda en user_onboarding (tour_state), así que
 * no vuelve a salir en ningún dispositivo. Si la consulta falla, `loaded` se queda en false y el
 * tutorial no se ofrece: mejor no preguntar que preguntar dos veces. */

const cache = new Map<string, TourState>();

export function useTourState(userId: string | null | undefined): {
  loaded: boolean;
  state: TourState;
  save: (next: Exclude<TourState, null>) => Promise<boolean>;
} {
  const [loaded, setLoaded] = useState(() => !!userId && cache.has(userId));
  const [state, setState] = useState<TourState>(() => (userId ? cache.get(userId) ?? null : null));

  useEffect(() => {
    if (!userId) { setLoaded(false); setState(null); return; }
    if (cache.has(userId)) { setState(cache.get(userId) ?? null); setLoaded(true); return; }
    let alive = true;
    setLoaded(false);
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("user_onboarding").select("tour_state").eq("user_id", userId).maybeSingle();
      if (!alive) return;
      if (error || !data) return; // sin fila (aún en la bienvenida) o error: no se ofrece
      const s: TourState = data.tour_state === "done" || data.tour_state === "skipped" ? data.tour_state : null;
      cache.set(userId, s);
      setState(s);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [userId]);

  const save = useCallback(async (next: Exclude<TourState, null>) => {
    if (!userId) return false;
    // Se apunta ya en memoria: aunque falle la red, en esta sesión no vuelve a salir.
    cache.set(userId, next);
    setState(next);
    // UPDATE, no upsert: la fila existe desde la bienvenida, y un insert nuevo (sin completed_at)
    // volvería a mandar a la persona a la bienvenida.
    const { error } = await (supabase as any)
      .from("user_onboarding")
      .update({ tour_state: next, tour_answered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    return !error;
  }, [userId]);

  return { loaded, state, save };
}

/** Sólo para las pruebas. */
export function __resetTourStateCache() { cache.clear(); }
