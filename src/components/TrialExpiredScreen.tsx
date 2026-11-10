import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { PlanCards } from "@/components/PlanCards";
import { toast } from "sonner";

/* Prueba gratuita de 14 días terminada sin pagar: se elige plan (pago por Stripe). "Ya he pagado"
   vuelve a comprobar en Stripe por si el webhook aún no ha llegado. */
export function TrialExpiredScreen() {
  const { signOut } = useAuth();
  const { refreshSubscription } = useSubscription();
  const [checking, setChecking] = useState(false);

  const comprobar = async () => {
    setChecking(true);
    try {
      await refreshSubscription();
      toast.info("Comprobado. Si acabas de pagar, puede tardar unos segundos en reflejarse.");
    } finally { setChecking(false); }
  };

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

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => void comprobar()} disabled={checking}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Ya he pagado, comprobar
          </Button>
          <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}
