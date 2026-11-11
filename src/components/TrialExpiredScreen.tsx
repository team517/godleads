import { Button } from "@/components/ui/button";
import { LogOut, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { PlanCards } from "@/components/PlanCards";
import { useAutoRefreshSubscription } from "@/hooks/usePaymentConfirmation";
import { PaymentHelpLine } from "@/components/pricing/PaymentProgress";

/* Prueba gratuita de 14 días terminada sin pagar: se elige plan (pago por Stripe). Sin botón de "ya he
   pagado" (11-11-2026): la pantalla vuelve a leer el estado del servidor sola (al volver a la pestaña y
   cada 20 s) y desaparece en cuanto el webhook de Stripe confirma el pago. */
export function TrialExpiredScreen() {
  const { signOut, user } = useAuth();
  const { refreshSubscription } = useSubscription();
  useAutoRefreshSubscription(refreshSubscription, user?.id);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <ShieldAlert className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <h1 className="font-display text-3xl font-bold">Tu prueba de 14 días ha terminado</h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            Para seguir usando la plataforma, elige un plan y continúa donde lo dejaste.
          </p>
        </div>

        <PlanCards />

        <div className="flex flex-col items-center gap-3">
          <PaymentHelpLine className="justify-center text-center" />
          <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}
