import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PLAN_CONFIG, PlanTier, clientsFeature, emailsFeature } from "@/contexts/SubscriptionContext";
import { toast } from "sonner";

/* Las tres tarjetas de plan de Funnyleads con el pago por Stripe (create-checkout). Las usan la
   pantalla de prueba terminada y la de suscripción terminada; Ajustes → Plan tiene las suyas. */

export const PLAN_FEATURES: { tier: Exclude<PlanTier, "free">; features: string[] }[] = [
  { tier: "starter", features: ["5.000 contactos", "Buzones y warm-up ilimitados", "Campañas ilimitadas", "Follow-ups automáticos", "Soporte por email"] },
  { tier: "growth", features: ["60.000 contactos", "Buzones y warm-up ilimitados", "A/B Testing", "Respuestas con IA", "Unibox centralizado"] },
  { tier: "scale", features: ["Contactos ilimitados", "Buzones y warm-up ilimitados", "Respuestas con IA", "Analíticas avanzadas", "Soporte 1:1"] },
];

export async function abrirCheckout(priceId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("create-checkout", { body: { price_id: priceId } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  if (!(data as any)?.url) throw new Error("No se pudo abrir el pago");
  window.location.href = (data as any).url;
}

export function PlanCards({ currentTier, highlight = "growth" }: { currentTier?: PlanTier; highlight?: PlanTier }) {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const handleCheckout = async (priceId: string, planTier: string) => {
    setCheckoutLoading(planTier);
    try { await abrirCheckout(priceId); }
    catch (e: any) { toast.error(e.message || "Error al abrir el pago"); }
    setCheckoutLoading(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => setBillingPeriod("monthly")} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${billingPeriod === "monthly" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>Mensual</button>
        <button type="button" onClick={() => setBillingPeriod("annual")} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${billingPeriod === "annual" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
          Anual <span className="text-xs opacity-80">(-17 %)</span>
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLAN_FEATURES.map(({ tier: planTier, features }) => {
          const config = PLAN_CONFIG[planTier];
          const perMonth = billingPeriod === "monthly" ? config.monthly.price : config.annual.perMonth;
          const priceId = billingPeriod === "monthly" ? config.monthly.priceId : config.annual.priceId;
          const popular = planTier === highlight;
          const isCurrent = currentTier === planTier;
          const feats = [features[0], emailsFeature(planTier), clientsFeature(planTier), ...features.slice(1)];
          return (
            <Card key={planTier} className={`relative ${popular ? "border-primary ring-2 ring-primary/20" : ""}`}>
              {popular && <Badge className="absolute -top-2.5 left-4 bg-primary">Recomendado</Badge>}
              <CardHeader>
                <CardTitle className="font-display">{config.label}</CardTitle>
                <CardDescription>
                  <span className="text-3xl font-bold text-foreground">{perMonth} €</span>
                  <span className="text-muted-foreground">/mes</span>
                  {billingPeriod === "annual" && <span className="block text-xs text-muted-foreground">Facturado {config.annual.price} € al año</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {feats.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 flex-shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button className="w-full gap-2" onClick={() => handleCheckout(priceId, planTier)} disabled={checkoutLoading === planTier}>
                  {checkoutLoading === planTier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {checkoutLoading === planTier ? "Redirigiendo…" : isCurrent ? "Reactivar este plan" : "Elegir plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
