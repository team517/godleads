import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PLAN_CONFIG, PlanTier } from "@/contexts/SubscriptionContext";
import { toast } from "sonner";

const planCards: { tier: PlanTier; features: string[] }[] = [
  { tier: "starter", features: ["1,000 leads", "3 cuentas de email", "Campañas ilimitadas", "Follow-ups automáticos"] },
  { tier: "growth", features: ["10,000 leads", "15 cuentas de email", "A/B Testing", "Unibox centralizado", "Analytics avanzados"] },
  { tier: "scale", features: ["Leads ilimitados", "Cuentas ilimitadas", "API completa", "White label", "Account manager dedicado"] },
];

export function TrialExpiredScreen() {
  const { signOut } = useAuth();
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const handleCheckout = async (priceId: string, planTier: string) => {
    setCheckoutLoading(planTier);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { price_id: priceId },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Error al crear checkout");
    }
    setCheckoutLoading(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-4xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <ShieldAlert className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <h1 className="font-display text-3xl font-bold">Tu prueba gratuita ha terminado</h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            Para seguir usando la plataforma, elige un plan y continúa donde lo dejaste.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setBillingPeriod("monthly")} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${billingPeriod === "monthly" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>Mensual</button>
          <button onClick={() => setBillingPeriod("annual")} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${billingPeriod === "annual" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            Anual <span className="text-xs opacity-80">(-17%)</span>
          </button>
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {planCards.map(({ tier: planTier, features }) => {
            const config = PLAN_CONFIG[planTier as keyof typeof PLAN_CONFIG];
            const price = billingPeriod === "monthly" ? config.monthly.price : config.annual.price;
            const priceId = billingPeriod === "monthly" ? config.monthly.priceId : config.annual.priceId;
            const popular = planTier === "growth";

            return (
              <Card key={planTier} className={`relative ${popular ? "border-primary ring-2 ring-primary/20" : ""}`}>
                {popular && <Badge className="absolute -top-2.5 left-4 bg-primary">Recomendado</Badge>}
                <CardHeader>
                  <CardTitle className="font-display">{config.label}</CardTitle>
                  <CardDescription>
                    <span className="text-3xl font-bold text-foreground">€{price}</span>
                    <span className="text-muted-foreground">/{billingPeriod === "monthly" ? "mes" : "año"}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button className="w-full gap-2" onClick={() => handleCheckout(priceId, planTier)} disabled={checkoutLoading === planTier}>
                    {checkoutLoading === planTier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    {checkoutLoading === planTier ? "Redirigiendo…" : "Elegir plan"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Sign out */}
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
