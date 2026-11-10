// Lo que el plan lleva consumido este mes: correos y buzones. Y, desde el 10-11-2026, el estado de la
// suscripción de Stripe (prueba, renovación, cancelación programada, pago pendiente) con los botones
// "Gestionar suscripción" (portal de Stripe) y "Comprobar pago".
//
// Es una MEDIDA, no una puerta: aquí no se bloquea nada. Las cifras vienen de las RPC del servidor
// (usePlanUsage), que suman al dueño y a sus cuentas de cliente, y los topes de PLAN_CONFIG.
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CreditCard, Gauge, Loader2, Mail, RefreshCw, Users } from "lucide-react";
import { getPlanLimits, PlanTier, useSubscription, type SubscriptionStatus } from "@/contexts/SubscriptionContext";
import { usePlanUsage } from "@/hooks/usePlanUsage";
import { familyNote, mailboxLine, monthlyEmailsLine, usagePct, usageTone, type UsageTone } from "@/lib/plan-usage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TONE_TEXT: Record<UsageTone, string> = { ok: "text-foreground", warn: "text-warning", over: "text-destructive" };
const TONE_BAR: Record<UsageTone, string> = { ok: "bg-primary", warn: "bg-warning", over: "bg-destructive" };

function UsageBar({ pct, tone, label }: { pct: number; tone: UsageTone; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${TONE_BAR[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const fecha = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Línea de estado de la suscripción. Pura, con prueba. */
export function subscriptionStatusLine(s: {
  status: SubscriptionStatus; trialEnd: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean; lastPaymentError?: string | null;
}): { text: string; tone: "ok" | "warn" | "bad" } | null {
  switch (s.status) {
    case "trialing": return { text: `Prueba gratuita hasta el ${fecha(s.trialEnd || s.periodEnd)} · después se cobra el plan`, tone: "ok" };
    case "active": return s.cancelAtPeriodEnd
      ? { text: `Activo · termina el ${fecha(s.periodEnd)} (cancelación programada)`, tone: "warn" }
      : { text: s.periodEnd ? `Activo · se renueva el ${fecha(s.periodEnd)}` : "Activo", tone: "ok" };
    case "platform_trial": return { text: `Prueba gratuita hasta el ${fecha(s.trialEnd)} · sin método de pago`, tone: "ok" };
    case "expired": return { text: "Prueba gratuita terminada · elige un plan para continuar", tone: "bad" };
    case "payment_failed": return { text: `Pago pendiente${s.lastPaymentError ? ` · ${s.lastPaymentError}` : ""}`, tone: "bad" };
    case "canceled": return { text: s.periodEnd ? `Suscripción terminada el ${fecha(s.periodEnd)}` : "Suscripción terminada", tone: "bad" };
    default: return null; // staff / free: no se enseña nada de pago
  }
}

const STATUS_TONE: Record<"ok" | "warn" | "bad", string> = { ok: "text-foreground", warn: "text-warning", bad: "text-destructive" };

export function SubscriptionStatusBlock() {
  const { status, trialEnd, periodEnd, cancelAtPeriodEnd, entitlement, billable, refreshSubscription } = useSubscription();
  const [checking, setChecking] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const line = subscriptionStatusLine({ status, trialEnd, periodEnd, cancelAtPeriodEnd, lastPaymentError: entitlement?.lastPaymentError });
  if (!billable || !line) return null;
  const tieneStripe = status === "active" || status === "trialing" || status === "payment_failed" || status === "canceled";

  const comprobar = async () => {
    setChecking(true);
    try { await refreshSubscription(); toast.info("Estado del pago comprobado."); } finally { setChecking(false); }
  };
  const portal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || "No se pudo abrir el portal");
      window.location.href = data.url;
    } catch (e: any) { toast.error(e.message || "No se pudo abrir el portal"); setPortalLoading(false); }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className={`flex items-center gap-1.5 text-[13px] font-semibold ${STATUS_TONE[line.tone]}`}>
        <CreditCard className="h-3.5 w-3.5" /> {line.text}
      </p>
      <div className="flex gap-2">
        {tieneStripe && (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void portal()} disabled={portalLoading}>
            {portalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />} Gestionar suscripción
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void comprobar()} disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Comprobar pago
        </Button>
      </div>
    </div>
  );
}

export function PlanUsageCard({ tier, isTrialing }: { tier: PlanTier; isTrialing: boolean }) {
  const { usage, loading, error, reload } = usePlanUsage();
  const limits = getPlanLimits(tier, isTrialing);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-[-0.02em]">
          <Gauge className="h-4 w-4 text-primary" /> Consumo de tu plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SubscriptionStatusBlock />
        {loading ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Contando tus envíos de este mes…
          </p>
        ) : error || !usage ? (
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground">
              No pudimos leer el consumo de tu plan. {error && <span className="text-foreground">{error}</span>}
            </p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>Reintentar</Button>
          </div>
        ) : (
          (() => {
            const emailTone = usageTone(usage.enviados, limits.emailsPerMonth);
            const emailPct = usagePct(usage.enviados, limits.emailsPerMonth);
            const boxTone = usageTone(usage.conectados, limits.maxAccounts);
            const boxPct = usagePct(usage.conectados, limits.maxAccounts);
            const nota = familyNote(usage.cuentas);
            return (
              <>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground"><Mail className="h-3.5 w-3.5" /> Correos</span>
                    <span className={`font-display text-[15px] font-semibold tabular-nums tracking-[-0.02em] ${TONE_TEXT[emailTone]}`}>{monthlyEmailsLine(usage.enviados, limits.emailsPerMonth)}</span>
                  </div>
                  {Number.isFinite(limits.emailsPerMonth) && <UsageBar pct={emailPct} tone={emailTone} label="Correos enviados este mes" />}
                  {emailTone === "over" && <p className="flex items-center gap-1.5 text-[13px] font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> Has llegado a los correos que incluye tu plan este mes.</p>}
                  {emailTone === "warn" && <p className="flex items-center gap-1.5 text-[13px] font-semibold text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Vas por el {emailPct} % de los correos de tu plan.</p>}
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground"><Users className="h-3.5 w-3.5" /> Buzones</span>
                    <span className={`font-display text-[15px] font-semibold tabular-nums tracking-[-0.02em] ${TONE_TEXT[boxTone]}`}>{mailboxLine(usage.conectados, limits.maxAccounts)}</span>
                  </div>
                  {Number.isFinite(limits.maxAccounts) && <UsageBar pct={boxPct} tone={boxTone} label="Buzones conectados" />}
                  {boxTone === "over" && <p className="flex items-center gap-1.5 text-[13px] font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> Has llegado a los buzones que incluye tu plan.</p>}
                  {boxTone === "warn" && <p className="flex items-center gap-1.5 text-[13px] font-semibold text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Vas por el {boxPct} % de los buzones de tu plan.</p>}
                </div>
                {nota && <p className="text-[13px] text-muted-foreground">{nota}</p>}
              </>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}
