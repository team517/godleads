import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { welcomeDoneKey, type WelcomeStatus } from "@/lib/first-run";

/* ¿A este usuario le toca la pantalla de bienvenida?
 *
 * Se pregunta UNA vez por usuario y sesión, y ni eso si el navegador ya sabe que la hizo. Si la
 * consulta falla por lo que sea, se da por hecha: la bienvenida nunca puede dejar a nadie fuera
 * de su panel. */

const cache = new Map<string, WelcomeStatus>();
const listeners = new Set<() => void>();

function remember(userId: string, status: WelcomeStatus) {
  cache.set(userId, status);
  listeners.forEach((l) => l());
}

/** La bienvenida ha terminado: ni esta sesión ni el navegador vuelven a enseñarla. */
export function markWelcomeDone(userId: string) {
  try { localStorage.setItem(welcomeDoneKey(userId), "1"); } catch { /* navegador sin almacenamiento */ }
  remember(userId, "done");
}

export function useWelcomeGate(): WelcomeStatus {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [, bump] = useState(0);
  const [status, setStatus] = useState<WelcomeStatus>("loading");

  // Re-pinta cuando otro punto de la aplicación marca la bienvenida como hecha.
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => {
    if (!userId) { setStatus("loading"); return; }
    const known = cache.get(userId);
    if (known) { setStatus(known); return; }
    let done = false;
    try { done = localStorage.getItem(welcomeDoneKey(userId)) === "1"; } catch { /* sin almacenamiento */ }
    if (done) { remember(userId, "done"); setStatus("done"); return; }

    let alive = true;
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("user_onboarding").select("completed_at").eq("user_id", userId).maybeSingle();
      if (!alive) return;
      const next: WelcomeStatus = error ? "done" : (data as any)?.completed_at ? "done" : "pending";
      remember(userId, next);
      setStatus(next);
    })();
    return () => { alive = false; };
  }, [userId]);

  return userId ? (cache.get(userId) ?? status) : "loading";
}
