import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getPushState, isPushSupported, subscribeToPush } from "@/lib/push-notifications";

/**
 * Avisos al móvil/ordenador de ESTE dispositivo: estado real, activar y un aviso de prueba.
 * El 22-09-2026 sólo 4 cuentas tenían un dispositivo registrado: el resto (hello, team…) no
 * recibía nada aunque el servidor avisara bien. Aquí se ve y se comprueba en dos clics.
 */
export function PushDeviceCard() {
  const { user } = useAuth();
  const [state, setState] = useState<"unsupported" | "denied" | "off" | "on" | "loading">("loading");
  const [busy, setBusy] = useState<"on" | "test" | null>(null);

  const refresh = useCallback(async () => { setState(await getPushState()); }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const activate = async () => {
    if (!user) return;
    setBusy("on");
    const ok = await subscribeToPush(user.id);
    setBusy(null);
    if (ok) toast.success("Avisos activados en este dispositivo");
    else toast.error("No se pudieron activar. Revisa que el navegador permita las notificaciones.");
    await refresh();
  };

  const test = async () => {
    setBusy("test");
    const { data, error } = await supabase.functions.invoke("send-push", { body: { test: true } });
    setBusy(null);
    const sent = Number((data as { sent?: number } | null)?.sent || 0);
    if (error) toast.error(`No se pudo enviar la prueba: ${error.message}`);
    else if (sent > 0) toast.success(`Aviso de prueba enviado a ${sent} dispositivo${sent === 1 ? "" : "s"}`);
    else toast.error("Esta cuenta no tiene ningún dispositivo con avisos activos.");
  };

  const iosHint = /iphone|ipad/i.test(navigator.userAgent);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-[17px] font-semibold tracking-[-0.02em] flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" /> Avisos de interesados
        </CardTitle>
        <CardDescription>
          Te avisamos al momento cuando un lead (o alguien de su empresa) responde con interés o con una pregunta.
          Se activa en cada dispositivo donde quieras recibirlos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {state === "loading" && <span className="text-muted-foreground">Comprobando…</span>}
          {state === "on" && <span className="font-semibold text-success">Activos en este dispositivo</span>}
          {state === "off" && <span className="font-semibold text-warning">Desactivados en este dispositivo</span>}
          {state === "denied" && <span className="font-semibold text-destructive">Bloqueados por el navegador</span>}
          {state === "unsupported" && <span className="font-semibold text-muted-foreground">Este navegador no admite avisos</span>}
        </div>
        {state === "denied" && (
          <p className="text-xs text-muted-foreground">Permite las notificaciones para esta web en los ajustes del navegador y vuelve aquí.</p>
        )}
        {state === "unsupported" && iosHint && (
          <p className="text-xs text-muted-foreground">En iPhone: Safari → Compartir → «Añadir a pantalla de inicio», abre la app desde el icono y vuelve aquí.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {state !== "on" && state !== "unsupported" && (
            <Button size="sm" onClick={activate} disabled={busy !== null || state === "denied"} className="gap-1.5">
              {busy === "on" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Activar en este dispositivo
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={test} disabled={busy !== null} className="gap-1.5">
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "on" ? <Send className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            Enviar aviso de prueba
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default PushDeviceCard;
