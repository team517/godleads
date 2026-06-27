import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Undo2, Loader2, RotateCcw, AlertCircle } from "lucide-react";

type State = "loading" | "unsubscribed" | "resubscribed" | "error";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = (params.get("t") || "").trim();
  const [state, setState] = useState<State>("loading");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const call = async (action: "unsubscribe" | "resubscribe") => {
    const { data, error } = await supabase.functions.invoke("unsubscribe", {
      body: { token, action },
    });
    if (error || !data || (data as any).ok === false) {
      throw new Error((data as any)?.error || error?.message || "error");
    }
    if ((data as any)?.email) setEmail((data as any).email);
    return data;
  };

  // On open → process the unsubscribe automatically
  useEffect(() => {
    if (!token) { setState("error"); return; }
    (async () => {
      try { await call("unsubscribe"); setState("unsubscribed"); }
      catch { setState("error"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = async () => {
    setBusy(true);
    try { await call("resubscribe"); setState("resubscribed"); }
    catch { /* keep current screen */ }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/30 to-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-xl">
        {state === "loading" && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
            <h1 className="text-lg font-semibold">Procesando…</h1>
          </>
        )}

        {state === "unsubscribed" && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Te has dado de baja</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              No volverás a recibir más correos{email ? <> en <span className="font-medium text-foreground">{email}</span></> : ""}.
            </p>
            <button
              onClick={undo}
              disabled={busy}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              No, quiero seguir recibiendo correos
            </button>
            <p className="mt-3 text-[11px] text-muted-foreground">¿Te diste de baja sin querer? Pulsa el botón para deshacerlo.</p>
          </>
        )}

        {state === "resubscribed" && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <RotateCcw className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Suscripción restaurada</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Perfecto, seguirás recibiendo nuestros correos. ¡Gracias!
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
              <AlertCircle className="h-7 w-7 text-amber-600" />
            </div>
            <h1 className="text-lg font-semibold">Enlace no válido</h1>
            <p className="mt-2 text-sm text-muted-foreground">No hemos podido procesar la baja. El enlace puede estar incompleto o caducado.</p>
          </>
        )}
      </div>
    </div>
  );
}
