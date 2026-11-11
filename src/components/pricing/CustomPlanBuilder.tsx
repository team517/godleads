import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { animate, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Loader2, Lock, Mail, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { cn } from "@/lib/utils";
import {
  CUSTOM_DEFAULT_LEVEL, CUSTOM_FEATURES, CUSTOM_LEVELS, customLevel, customPerMonth, customPriceId, customYearSavings,
  fmtNum, fmtVolume, type CustomInterval,
} from "@/lib/custom-plan";
import { fmtEur, paymentLinkFor } from "@/lib/signup-flow";
import { readEntitlement, usePaymentConfirmation, type EntitlementRow } from "@/hooks/usePaymentConfirmation";
import { PaymentProgress } from "@/components/pricing/PaymentProgress";
import { PlanSlider, StarGlyph, type PlanSliderZone } from "@/components/pricing/PlanSlider";

/* Plan a medida (11-11-2026). Barra de 10 niveles con el diseño de la referencia del dueño (píldoras
   Básico · Profesional · Empresarial, barra cian → violeta y pomo con la estrella). Al subirla crecen
   los envíos al mes, los contactos y, poco a poco, los clientes; el precio sube, pero cada 1.000
   envíos salen más baratos. Elegir → confirmar → "Creando tu enlace de pago…" → Stripe → "Esperando tu
   pago…" → (el servidor confirma) "Pago recibido · Procesando tu plan…" → "¡Listo!". No hay botón de
   "ya he pagado": el plan SÓLO lo da el webhook firmado de Stripe. Quien ya tiene suscripción de
   Stripe cambia de plan en la suya (nunca se le abre un segundo pago). */

export const ZONES_ES: PlanSliderZone[] = [
  { label: "Básico", short: "Básico", from: 1, to: 3 },
  { label: "Profesional", short: "Pro", from: 4, to: 6 },
  { label: "Empresarial", short: "Empresa", from: 7, to: 10 },
];
const VOLUMES = CUSTOM_LEVELS.map((x) => x.emails);

/** Número que se anima al cambiar (framer-motion). */
export function AnimatedNumber({ value, format = fmtNum, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (reduce || prev.current === value) { setShown(value); prev.current = value; return; }
    const c = animate(prev.current, value, { duration: 0.45, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
    prev.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return <span className={cn("tabular-nums", className)}>{format(shown)}</span>;
}

/** ¿Está la app en modo oscuro? (se entera cuando cambia). */
export function useDarkClass(): boolean {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setDark(root.classList.contains("dark")));
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

type Via = { kind: "cargando" } | { kind: "checkout"; url: string } | { kind: "enlace"; url: string };
type Fase = "cerrado" | "confirmar" | "creando" | "pago" | "error";

async function leerError(error: any): Promise<string> {
  let msg = error?.message || "";
  try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
  return msg;
}

export function CustomPlanBuilder({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { customPlan, hasStripeSubscription, refreshSubscription, entitlement } = useSubscription();
  const dark = useDarkClass();
  const [level, setLevel] = useState<number>(customPlan?.level ?? CUSTOM_DEFAULT_LEVEL);
  const [interval, setInterval_] = useState<CustomInterval>("month");
  const [fase, setFase] = useState<Fase>("cerrado");
  const [via, setVia] = useState<Via>({ kind: "cargando" });
  const [msg, setMsg] = useState<string | null>(null);
  // Nivel e intervalo del pago en curso (la barra se puede seguir moviendo detrás).
  const [pedido, setPedido] = useState<{ level: number; interval: CustomInterval } | null>(null);
  // La fila del servidor justo antes de pagar: así un cambio de plan sólo cuenta cuando la fila CAMBIA.
  const [antes, setAntes] = useState<EntitlementRow | null>(null);
  const preparado = useRef<Promise<Via> | null>(null);

  useEffect(() => { if (customPlan?.level) setLevel(customPlan.level); }, [customPlan?.level]);

  const l = customLevel(level);
  const perMonth = customPerMonth(l, interval);
  const esActual = !!customPlan && customPlan.level === level && (entitlement?.status === "active" || entitlement?.status === "trialing");
  const enlaceDe = (lv: number, iv: CustomInterval) => (user ? paymentLinkFor({ plan: "custom", level: lv, period: iv }, { id: user.id, email: user.email }) : "");

  // El servidor confirma el pago (webhook firmado de Stripe): sólo entonces se pasa de fase.
  const pago = usePaymentConfirmation({
    active: fase === "pago" && !!pedido,
    userId: user?.id,
    want: { kind: "custom", level: pedido?.level ?? level },
    baseline: antes,
  });

  // Sin suscripción de Stripe: el pago se prepara al abrir la confirmación (así el clic abre Stripe
  // a la primera y el navegador no bloquea la pestaña nueva). Con suscripción no se prepara nada.
  const preparar = (lv: number, iv: CustomInterval) => {
    if (!user || hasStripeSubscription) return;
    setVia({ kind: "cargando" });
    const enlace = enlaceDe(lv, iv);
    const p = (async (): Promise<Via> => {
      try {
        const { data, error } = await supabase.functions.invoke("create-checkout", { body: { price_id: customPriceId(lv, iv) } });
        if (error || (data as any)?.error || !(data as any)?.url) return { kind: "enlace", url: enlace };
        return { kind: "checkout", url: (data as any).url };
      } catch { return { kind: "enlace", url: enlace }; }
    })();
    preparado.current = p;
    void p.then(setVia);
  };

  const elegir = () => {
    if (!user) { navigate(`/empezar?plan=custom&nivel=${level}&periodo=${interval}`); return; }
    setMsg(null);
    setPedido({ level, interval });
    setAntes(null);
    // Cómo está la fila ahora (antes de pagar), sin esperar: el clic de "Confirmar" abre Stripe al instante.
    void readEntitlement(user.id).then(setAntes);
    setFase("confirmar");
    preparar(level, interval);
  };

  const abrirEnlace = (url: string) => {
    const w = window.open(url, "_blank");
    if (w) { try { w.opener = null; } catch { /* nada */ } setFase("pago"); } else { window.location.href = url; }
  };

  const confirmar = async () => {
    if (!pedido || !user) return;
    setMsg(null);
    if (hasStripeSubscription) {
      // Cambio de plan dentro de su suscripción (se cobra la diferencia prorrateada).
      setFase("creando");
      const { data, error } = await supabase.functions.invoke("create-checkout", { body: { price_id: customPriceId(pedido.level, pedido.interval) } });
      if (!error && (data as any)?.updated) { setFase("pago"); return; }
      if (!error && (data as any)?.url) { window.location.href = (data as any).url; return; }
      setMsg("No hemos podido cambiar tu plan ahora mismo. Inténtalo en unos minutos o escríbenos a team@onepulso.online y te lo cambiamos.");
      if (error) console.warn("[plan a medida]", await leerError(error));
      setFase("error");
      return;
    }
    setFase("creando");
    if (via.kind === "enlace") { abrirEnlace(via.url); return; }
    if (via.kind === "checkout") { window.location.href = via.url; return; }
    const v = await (preparado.current ?? Promise.resolve<Via>({ kind: "enlace", url: enlaceDe(pedido.level, pedido.interval) }));
    if (v.kind === "checkout") { window.location.href = v.url; return; }
    if (v.kind === "enlace") { abrirEnlace(v.url); return; }
    setMsg("No se pudo abrir el pago. Inténtalo de nuevo en unos minutos.");
    setFase("error");
  };

  // Al cerrar tras "¡Listo!" se recarga la suscripción (no antes: recargarla enseña un "cargando" que
  // desmontaría esta ventana a mitad de la animación).
  const cerrar = () => {
    const recargar = fase === "pago" && pago.stage === "listo";
    setFase("cerrado"); setPedido(null);
    if (recargar) void refreshSubscription();
  };
  const lp = customLevel(pedido?.level ?? level);
  const reopen = !hasStripeSubscription && pedido ? (via.kind === "checkout" || via.kind === "enlace" ? via.url : enlaceDe(pedido.level, pedido.interval)) : null;
  // Mientras el servidor no confirma, la ventana de pago no se cierra por accidente al pulsar fuera.
  const bloqueado = fase === "creando" || (fase === "pago" && pago.stage === "procesando");

  return (
    <section
      className={cn("rounded-[24px] p-[1.5px] shadow-[0_18px_50px_-24px_rgba(91,59,255,.45)]", className)}
      style={{ background: "linear-gradient(135deg, rgba(0,200,240,.55), rgba(91,59,255,.45) 45%, rgba(138,28,255,.55))" }}
      aria-labelledby="plan-a-medida-title" data-tour="custom-plan"
    >
      <div className={cn("relative overflow-hidden rounded-[22.5px]", dark ? "bg-[hsl(var(--card))]" : "bg-white/95")}>
        {/* luz de fondo */}
        <span aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#00C8F0]/10 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -right-24 top-10 h-72 w-72 rounded-full bg-[#8A1CFF]/10 blur-3xl" />

        <div className="relative p-5 sm:p-8">
          {/* Cabecera */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-[#6E58F1]/10 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6E58F1] dark:text-[#B9A8FF]">
                <StarGlyph size={13} /> Plan a medida
              </p>
              <h3 id="plan-a-medida-title" className="mt-2.5 font-display text-[24px] font-semibold tracking-[-0.03em] text-foreground sm:text-[28px]">¿Necesitas más? Ajusta tu volumen</h3>
              <p className="mt-1 text-[14px] text-muted-foreground">Mueve la barra: suben los envíos, los contactos y los clientes. Todo lo de Scale incluido.</p>
            </div>
            <div className="inline-flex rounded-full border border-border bg-muted/60 p-1" role="radiogroup" aria-label="Facturación del plan a medida">
              {(["month", "year"] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={interval === p} onClick={() => setInterval_(p)}
                  className={cn("rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all", interval === p ? "bg-gradient-to-r from-[#3B5BFF] to-[#8A1CFF] text-white shadow-[0_6px_16px_rgba(91,59,255,.35)]" : "text-muted-foreground hover:text-foreground")}>
                  {p === "month" ? "Mensual" : <>Anual <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[10.5px]", interval === p ? "bg-white/20" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>-17 %</span></>}
                </button>
              ))}
            </div>
          </div>

          {/* Barra */}
          <div className="mt-7">
            <PlanSlider
              level={level} onChange={setLevel} zones={ZONES_ES} values={VOLUMES} format={fmtVolume} dark={dark}
              ariaLabel="Envíos al mes" valueText={(lv) => `${fmtNum(customLevel(lv).emails)} envíos al mes`}
            />
          </div>

          {/* Cifras + precio */}
          <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div>
              <dl className="grid gap-3 sm:grid-cols-3">
                {[
                  { Icon: Mail, label: "Envíos al mes", value: l.emails },
                  { Icon: Users, label: "Contactos", value: l.contacts },
                  { Icon: Zap, label: "Clientes (workspaces)", value: l.clients },
                ].map(({ Icon, label, value }) => (
                  <div key={label} className="rounded-2xl border border-[#6E58F1]/15 bg-gradient-to-b from-[#6E58F1]/[0.06] to-transparent px-4 py-3.5 dark:border-white/10 dark:from-white/[0.04]">
                    <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground"><Icon className="h-3.5 w-3.5 text-[#6E58F1] dark:text-[#B9A8FF]" /> {label}</dt>
                    <dd className="mt-1 font-display text-[24px] font-semibold tracking-[-0.03em] text-foreground"><AnimatedNumber value={value} /></dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {CUSTOM_FEATURES.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px] text-foreground">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#6E58F1]/12 text-[#6E58F1] dark:text-[#B9A8FF]"><Check className="h-3 w-3" strokeWidth={3} /></span> {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[#6E58F1]/20 bg-gradient-to-br from-[#3B5BFF]/[0.07] via-transparent to-[#8A1CFF]/[0.08] p-5 dark:border-white/10">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#6E58F1]/10 px-2.5 py-1 text-[12px] font-semibold text-[#6E58F1] dark:text-[#B9A8FF]">Nivel {level} de 10</span>
                  {esActual && <span className="rounded-full bg-gradient-to-r from-[#3B5BFF] to-[#8A1CFF] px-2.5 py-1 text-[12px] font-semibold text-white">Tu plan</span>}
                </div>
                <p className="mt-3 flex items-baseline gap-1">
                  <AnimatedNumber value={perMonth} format={(n) => fmtEur(n)} className="font-display text-[46px] font-semibold leading-none tracking-[-0.04em] text-foreground" />
                  <span className="text-[14px] text-muted-foreground">/mes</span>
                </p>
                <p className="mt-1.5 min-h-[20px] text-[13px] text-muted-foreground" data-testid="custom-billing-note">
                  {interval === "year"
                    ? <>Facturado {fmtEur(l.eurYear)} al año · ahorras {fmtEur(customYearSavings(l))}</>
                    : <>Facturado cada mes · {fmtEur(Math.round((l.eurMonth / l.emails) * 1000 * 100) / 100)} por cada 1.000 envíos</>}
                </p>
              </div>
              <div>
                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button className="h-12 w-full gap-2 border-0 bg-gradient-to-r from-[#2E7BFF] via-[#5B3BFF] to-[#8B2CF5] text-[15px] text-white shadow-[0_12px_28px_rgba(91,59,255,.35)] hover:brightness-110" onClick={elegir} disabled={esActual} data-testid="custom-elegir">
                    {esActual ? "Plan actual" : <>Elegir este plan <ArrowRight className="h-4 w-4" /></>}
                  </Button>
                </motion.div>
                <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="h-3 w-3" /> Pago seguro con Stripe · se cobra hoy, sin prueba</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={fase !== "cerrado"} onOpenChange={(o) => { if (!o && !bloqueado) cerrar(); }}>
        <DialogContent className="max-w-[460px]">
          {fase === "confirmar" && pedido && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-[20px] tracking-[-0.02em]">Confirma tu plan a medida</DialogTitle>
                <DialogDescription>Nivel {pedido.level} · {pedido.interval === "year" ? "facturación anual" : "facturación mensual"}</DialogDescription>
              </DialogHeader>
              <dl className="divide-y divide-border rounded-xl border border-border text-[14px]" data-testid="custom-resumen">
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">Envíos al mes</dt><dd className="font-semibold">{fmtNum(lp.emails)}</dd></div>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">Contactos</dt><dd className="font-semibold">{fmtNum(lp.contacts)}</dd></div>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">Clientes</dt><dd className="font-semibold">{lp.clients}</dd></div>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">{hasStripeSubscription ? "Nuevo precio" : "Se cobra hoy"}</dt><dd className="font-semibold">{fmtEur(pedido.interval === "year" ? lp.eurYear : lp.eurMonth)}{pedido.interval === "year" ? " al año" : " al mes"}</dd></div>
              </dl>
              {hasStripeSubscription && <p className="text-[12.5px] text-muted-foreground">Cambiamos tu suscripción actual a este plan y se cobra hoy la diferencia prorrateada.</p>}
              <Button className="mt-1 h-11 w-full gap-2" onClick={() => void confirmar()} data-testid="custom-confirmar">
                <Lock className="h-4 w-4" /> {hasStripeSubscription ? "Cambiar a este plan" : "Confirmar y pagar"}
              </Button>
            </>
          )}
          {fase === "creando" && (
            <div className="flex flex-col items-center py-6 text-center" role="status">
              <Loader2 className="h-9 w-9 animate-spin text-primary" />
              <p className="mt-4 font-display text-[18px] font-semibold">Creando tu enlace de pago…</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Un momento, te llevamos al pago seguro de Stripe.</p>
            </div>
          )}
          {fase === "pago" && (
            <div className="py-2">
              <DialogTitle className="sr-only">Pago del plan a medida</DialogTitle>
              <PaymentProgress
                stage={pago.stage} slow={pago.slow} reopenUrl={pago.stage === "esperando" ? reopen : null}
                waitingTitle={hasStripeSubscription ? "Cambiando tu plan en Stripe…" : "Esperando tu pago en Stripe…"}
                waitingText={hasStripeSubscription ? "Stripe está aplicando el cambio. En cuanto lo confirme, tu nuevo plan se activa." : "Completa el pago en la pestaña de Stripe que se ha abierto. Puedes dejar esta ventana tal cual."}
                doneTitle="¡Listo! Tu plan a medida está activo"
                doneText={<>{fmtNum(lp.emails)} envíos al mes · {fmtNum(lp.contacts)} contactos · {lp.clients} clientes</>}
                doneAction={<Button onClick={cerrar} data-testid="custom-cerrar">Perfecto</Button>}
              />
            </div>
          )}
          {fase === "error" && (
            <div className="py-2 text-center" role="alert">
              <DialogTitle className="font-display text-[18px] font-semibold">No se pudo completar</DialogTitle>
              <p className="mt-2 text-[13.5px] text-muted-foreground">{msg}</p>
              <Button variant="outline" className="mt-4" onClick={cerrar}>Cerrar</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default CustomPlanBuilder;
