import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, LogOut, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PLAN_CONFIG, useSubscription } from "@/contexts/SubscriptionContext";
import { PlanCards } from "@/components/PlanCards";
import { toast } from "sonner";

/* Problema con la suscripción (10-11-2026):
   · payment_failed (past_due / unpaid / incomplete): "No hemos podido cobrar tu suscripción" → arreglar
     el método de pago en el portal de Stripe, o "Ya he pagado, comprobar".
   · canceled (o periodo vencido sin renovación): "Tu suscripción ha terminado" → elegir plan para reactivar.
   La pone ProtectedRoute para los registros de pago; el equipo y las cuentas gratis nunca la ven. */
export function SubscriptionProblemScreen({ kind, tier, lastPaymentError, periodEnd }: {
  kind: "payment_failed" | "canceled";
  tier: "free" | "starter" | "growth" | "scale";
  lastPaymentError: string | null;
  periodEnd: string | null;
}) {
  const { signOut } = useAuth();
  const { refreshSubscription } = useSubscription();
  const [checking, setChecking] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const planLabel = tier !== "free" ? PLAN_CONFIG[tier].label : null;

  const comprobar = async () => {
    setChecking(true);
    try {
      await refreshSubscription();
      toast.info("Comprobado. Si acabas de pagar, puede tardar unos segundos en reflejarse.");
    } finally { setChecking(false); }
  };

  const abrirPortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || "No se pudo abrir el portal de pago");
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(e.message || "No se pudo abrir el portal de pago");
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              {kind === "payment_failed" ? <ShieldAlert className="h-8 w-8 text-destructive" /> : <XCircle className="h-8 w-8 text-destructive" />}
            </div>
          </div>
          {kind === "payment_failed" ? (
            <>
              <h1 className="font-display text-3xl font-bold">No hemos podido cobrar tu suscripción</h1>
              <p className="text-muted-foreground text-lg max-w-lg mx-auto">
                {planLabel ? `Tu plan ${planLabel} está en pausa` : "Tu plan está en pausa"} hasta que se complete el pago.
                Actualiza tu método de pago y recuperarás el acceso al instante.
              </p>
              {lastPaymentError && (
                <p className="mx-auto max-w-lg rounded-md bg-muted px-3 py-2 text-sm text-foreground">Motivo del banco: {lastPaymentError}</p>
              )}
            </>
          ) : (
            <>
              <h1 className="font-display text-3xl font-bold">Tu suscripción ha terminado</h1>
              <p className="text-muted-foreground text-lg max-w-lg mx-auto">
                {periodEnd ? `Terminó el ${new Date(periodEnd).toLocaleDateString("es-ES")}. ` : ""}
                Tus campañas, buzones y leads siguen guardados: elige un plan para reactivarla y continuar donde lo dejaste.
              </p>
            </>
          )}
        </div>

        {kind === "payment_failed" ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button className="gap-2" onClick={() => void abrirPortal()} disabled={portalLoading}>
              {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Actualizar método de pago
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => void comprobar()} disabled={checking}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Ya he pagado, comprobar
            </Button>
          </div>
        ) : (
          <>
            <PlanCards currentTier={tier} />
            <div className="flex justify-center">
              <Button variant="outline" className="gap-2" onClick={() => void comprobar()} disabled={checking}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Ya he pagado, comprobar
              </Button>
            </div>
          </>
        )}

        <p className="text-center text-xs text-muted-foreground">¿Algo no cuadra? Escribe a team@onepulso.online.</p>
        <div className="text-center">
          <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}
