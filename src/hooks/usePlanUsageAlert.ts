// Aviso de consumo del plan para el DUEÑO (12-11-2026): una sola llamada compartida entre el
// aviso de la página y la campana, y como mucho una vez cada 10 minutos por usuario. La función
// del servidor manda además el correo (una vez por umbral y mes). Las cuentas de cliente y las
// cuentas sin plan de pago no preguntan nada.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { toPlanAlert, type PlanAlert } from "@/lib/plan-alerts";

const TTL_MS = 10 * 60 * 1000;
type Entry = { at: number; alert: PlanAlert | null; promise?: Promise<PlanAlert | null> };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

async function fetchAlert(userId: string): Promise<PlanAlert | null> {
  const prev = cache.get(userId);
  if (prev?.promise) return prev.promise;
  if (prev && Date.now() - prev.at < TTL_MS) return prev.alert;
  const promise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("plan-usage-alerts", { body: {} });
      return error ? null : toPlanAlert(data);
    } catch {
      return null;
    }
  })();
  cache.set(userId, { at: Date.now(), alert: prev?.alert ?? null, promise });
  const alert = await promise;
  cache.set(userId, { at: Date.now(), alert });
  listeners.forEach((l) => l());
  return alert;
}

/** Para las pruebas. */
export function __resetPlanAlertCache() { cache.clear(); }

export function usePlanUsageAlert(): PlanAlert | null {
  const userId = useAuth().user?.id ?? null;
  const { profile } = useProfile();
  const { status, loading } = useSubscription();
  const eligible = !!userId && !loading && !profile.client_login_of && (status === "active" || status === "trialing");
  const [alert, setAlert] = useState<PlanAlert | null>(() => (userId ? cache.get(userId)?.alert ?? null : null));

  useEffect(() => {
    if (!eligible || !userId) { setAlert(null); return; }
    const sync = () => setAlert(cache.get(userId)?.alert ?? null);
    listeners.add(sync);
    void fetchAlert(userId).then(sync);
    return () => { listeners.delete(sync); };
  }, [eligible, userId]);

  return eligible ? alert : null;
}
