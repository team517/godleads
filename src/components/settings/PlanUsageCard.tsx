// Lo que el plan lleva consumido este mes: correos y buzones.
//
// Es una MEDIDA, no una puerta: aquí no se bloquea nada. Las cifras vienen de las
// RPC del servidor (usePlanUsage), que suman al dueño y a sus cuentas de cliente,
// y los topes de PLAN_CONFIG, que es lo que cobra Stripe.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Gauge, Loader2, Mail, Users } from "lucide-react";
import { getPlanLimits, PlanTier } from "@/contexts/SubscriptionContext";
import { usePlanUsage } from "@/hooks/usePlanUsage";
import { familyNote, mailboxLine, monthlyEmailsLine, usagePct, usageTone, type UsageTone } from "@/lib/plan-usage";

const TONE_TEXT: Record<UsageTone, string> = {
  ok: "text-foreground",
  warn: "text-warning",
  over: "text-destructive",
};

const TONE_BAR: Record<UsageTone, string> = {
  ok: "bg-primary",
  warn: "bg-warning",
  over: "bg-destructive",
};

function UsageBar({ pct, tone, label }: { pct: number; tone: UsageTone; label: string }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${TONE_BAR[tone]}`} style={{ width: `${pct}%` }} />
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
        {loading ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Contando tus envíos de este mes…
          </p>
        ) : error || !usage ? (
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground">
              No pudimos leer el consumo de tu plan. {error && <span className="text-foreground">{error}</span>}
            </p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Reintentar
            </Button>
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
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" /> Correos
                    </span>
                    <span className={`font-display text-[15px] font-semibold tabular-nums tracking-[-0.02em] ${TONE_TEXT[emailTone]}`}>
                      {monthlyEmailsLine(usage.enviados, limits.emailsPerMonth)}
                    </span>
                  </div>
                  {Number.isFinite(limits.emailsPerMonth) && (
                    <UsageBar pct={emailPct} tone={emailTone} label="Correos enviados este mes" />
                  )}
                  {emailTone === "over" && (
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" /> Has llegado a los correos que incluye tu plan este mes.
                    </p>
                  )}
                  {emailTone === "warn" && (
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" /> Vas por el {emailPct} % de los correos de tu plan.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> Buzones
                    </span>
                    <span className={`font-display text-[15px] font-semibold tabular-nums tracking-[-0.02em] ${TONE_TEXT[boxTone]}`}>
                      {mailboxLine(usage.conectados, limits.maxAccounts)}
                    </span>
                  </div>
                  {Number.isFinite(limits.maxAccounts) && (
                    <UsageBar pct={boxPct} tone={boxTone} label="Buzones conectados" />
                  )}
                  {boxTone === "over" && (
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" /> Has llegado a los buzones que incluye tu plan.
                    </p>
                  )}
                  {boxTone === "warn" && (
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" /> Vas por el {boxPct} % de los buzones de tu plan.
                    </p>
                  )}
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
