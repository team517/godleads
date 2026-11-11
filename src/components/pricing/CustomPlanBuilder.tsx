import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { animate, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ExternalLink, Loader2, Lock, Mail, SlidersHorizontal, Users, Zap } from "lucide-react";
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

/* Plan a medida (11-11-2026): una barra de 10 niveles. Al subirla crecen los envíos al mes, los
   contactos y, poco a poco, los clientes; el precio sube, pero cada 1.000 envíos salen más baratos.
   Elegir → confirmar → "Creando tu enlace de pago…" → Stripe. Si la app no puede crear el checkout
   (clave de Stripe mal), abre el enlace de pago de ese nivel con la cuenta dentro y esta pantalla
   espera a que el webhook active el plan. Quien ya tiene una suscripción de Stripe cambia de plan en
   la suya (nunca se le abre un segundo pago). */

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

type Via = { kind: "cargando" } | { kind: "checkout"; url: string } | { kind: "enlace"; url: string } | { kind: "error"; msg: string };
type Fase = "cerrado" | "confirmar" | "creando" | "esperando" | "listo" | "error";

const ESPERA_MS = 3000;

async function leerError(error: any): Promise<string> {
  let msg = error?.message || "";
  try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
  return msg;
}

export function CustomPlanBuilder({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { customPlan, hasStripeSubscription, refreshSubscription, entitlement } = useSubscription();
  const [level, setLevel] = useState<number>(customPlan?.level ?? CUSTOM_DEFAULT_LEVEL);
  const [interval, setInterval_] = useState<CustomInterval>("month");
  const [fase, setFase] = useState<Fase>("cerrado");
  const [via, setVia] = useState<Via>({ kind: "cargando" });
  const [msg, setMsg] = useState<string | null>(null);
  const preparado = useRef<Promise<Via> | null>(null);
  const hecho = useRef(false);

  useEffect(() => { if (customPlan?.level) setLevel(customPlan.level); }, [customPlan?.level]);

  const l = customLevel(level);
  const perMonth = customPerMonth(l, interval);
  const esActual = !!customPlan && customPlan.level === level && (entitlement?.status === "active" || entitlement?.status === "trialing");
  const enlace = user ? paymentLinkFor({ plan: "custom", level, period: interval }, { id: user.id, email: user.email }) : "";

  // Sin suscripción de Stripe: el pago se prepara al abrir la confirmación (así el clic abre Stripe
  // a la primera y la pestaña nueva no la bloquea el navegador). Con suscripción no se prepara nada:
  // create-checkout cambiaría ya su plan.
  const preparar = () => {
    if (!user || hasStripeSubscription) return;
    setVia({ kind: "cargando" });
    const p = (async (): Promise<Via> => {
      try {
        const { data, error } = await supabase.functions.invoke("create-checkout", { body: { price_id: customPriceId(level, interval) } });
        if (error || (data as any)?.error || !(data as any)?.url) return { kind: "enlace", url: enlace };
        return { kind: "checkout", url: (data as any).url };
      } catch { return { kind: "enlace", url: enlace }; }
    })();
    preparado.current = p;
    void p.then(setVia);
  };

  const elegir = () => {
    if (!user) { navigate(`/empezar?plan=custom&nivel=${level}&periodo=${interval}`); return; }
    setMsg(null); hecho.current = false;
    setFase("confirmar");
    preparar();
  };

  const comprobar = async (): Promise<boolean> => {
    if (!user || hecho.current) return hecho.current;
    const { data } = await (supabase as any).from("user_entitlements").select("status, custom_level").eq("user_id", user.id).maybeSingle();
    const ok = (data?.status === "active" || data?.status === "trialing") && Number(data?.custom_level) === level;
    if (ok) { hecho.current = true; setFase("listo"); void refreshSubscription(); }
    return ok;
  };

  // Esperando a Stripe: cada 3 s y al volver a esta pestaña.
  useEffect(() => {
    if (fase !== "esperando") return;
    let vivo = true;
    const tick = () => { if (vivo) void comprobar(); };
    tick();
    const t = setInterval(tick, ESPERA_MS);
    const alVolver = () => { if (document.visibilityState === "visible") tick(); };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", alVolver);
    return () => { vivo = false; clearInterval(t); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", alVolver); };
  }, [fase]); // eslint-disable-line react-hooks/exhaustive-deps

  const abrirEnlace = (url: string) => {
    const w = window.open(url, "_blank");
    if (w) { try { w.opener = null; } catch { /* nada */ } setFase("esperando"); } else { window.location.href = url; }
  };

  const confirmar = async () => {
    setMsg(null);
    if (hasStripeSubscription) {
      // Cambio de plan dentro de su suscripción (se cobra la diferencia prorrateada).
      setFase("creando");
      const { data, error } = await supabase.functions.invoke("create-checkout", { body: { price_id: customPriceId(level, interval) } });
      if (!error && (data as any)?.updated) { setFase("esperando"); return; }
      if (!error && (data as any)?.url) { window.location.href = (data as any).url; return; }
      setMsg("No hemos podido cambiar tu plan ahora mismo. Inténtalo en unos minutos o escríbenos a team@onepulso.online y te lo cambiamos.");
      if (error) console.warn("[plan a medida]", await leerError(error));
      setFase("error");
      return;
    }
    if (via.kind === "enlace") { setFase("creando"); abrirEnlace(via.url); return; }
    if (via.kind === "checkout") { setFase("creando"); window.location.href = via.url; return; }
    setFase("creando");
    const v = await (preparado.current ?? Promise.resolve<Via>({ kind: "enlace", url: enlace }));
    if (v.kind === "checkout") { window.location.href = v.url; return; }
    if (v.kind === "enlace") { abrirEnlace(v.url); return; }
    setMsg("No se pudo abrir el pago. Inténtalo de nuevo en unos minutos.");
    setFase("error");
  };

  const cerrar = () => setFase("cerrado");
  const ticks = CUSTOM_LEVELS.map((x) => x.level);

  return (
    <section className={cn("overflow-hidden rounded-[20px] border border-border bg-card shadow-sm", className)} aria-labelledby="plan-a-medida-title" data-tour="custom-plan">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* Barra y cifras */}
        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary"><SlidersHorizontal className="h-3.5 w-3.5" /> Plan a medida</p>
              <h3 id="plan-a-medida-title" className="mt-1 font-display text-[22px] font-semibold tracking-[-0.03em] text-foreground sm:text-[24px]">¿Necesitas más? Ajusta tu volumen</h3>
            </div>
            <div className="inline-flex rounded-full border border-border bg-muted/50 p-1" role="radiogroup" aria-label="Facturación del plan a medida">
              {(["month", "year"] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={interval === p} onClick={() => setInterval_(p)}
                  className={cn("rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all", interval === p ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {p === "month" ? "Mensual" : <>Anual <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[10.5px]", interval === p ? "bg-white/20" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>-17 %</span></>}
                </button>
              ))}
            </div>
          </div>

          {/* Etiquetas de envíos sobre la barra */}
          <div className="mt-7">
            <div className="relative mb-2 h-5 text-[11.5px] font-medium text-muted-foreground" aria-hidden="true">
              {ticks.map((t, i) => (
                <span key={t}
                  className={cn("absolute -translate-x-1/2 whitespace-nowrap transition-colors", t === level && "font-semibold text-primary", i % 2 === 1 && t !== level && "hidden sm:inline")}
                  style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}>
                  {fmtVolume(CUSTOM_LEVELS[i].emails)}
                </span>
              ))}
            </div>
            <SliderPrimitive.Root
              value={[level]} min={1} max={10} step={1}
              onValueChange={(v) => setLevel(v[0] ?? CUSTOM_DEFAULT_LEVEL)}
              className="relative flex h-8 w-full touch-none select-none items-center"
              aria-label="Envíos al mes"
            >
              <SliderPrimitive.Track className="relative h-2.5 w-full grow overflow-hidden rounded-full bg-primary/10 dark:bg-primary/20">
                <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-r from-[#5B8CFF] via-[#6E58F1] to-[#9B5CF6]" />
              </SliderPrimitive.Track>
              <SliderPrimitive.Thumb
                aria-label="Nivel del plan a medida"
                aria-valuetext={`${fmtNum(l.emails)} envíos al mes`}
                className="block h-6 w-6 cursor-grab rounded-full border-[3px] border-white bg-[#6E58F1] shadow-[0_4px_14px_rgba(110,88,241,.45)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 active:cursor-grabbing dark:border-card"
              />
            </SliderPrimitive.Root>
            <div className="relative mt-1 h-2" aria-hidden="true">
              {ticks.map((t, i) => (
                <span key={t} className={cn("absolute h-2 w-[2px] -translate-x-1/2 rounded-full", t <= level ? "bg-primary/60" : "bg-border")} style={{ left: `${(i / (ticks.length - 1)) * 100}%` }} />
              ))}
            </div>
          </div>

          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { Icon: Mail, label: "Envíos al mes", value: l.emails },
              { Icon: Users, label: "Contactos", value: l.contacts },
              { Icon: Zap, label: "Clientes (workspaces)", value: l.clients },
            ].map(({ Icon, label, value }) => (
              <div key={label} className="rounded-2xl border border-border bg-muted/30 px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground"><Icon className="h-3.5 w-3.5 text-primary" /> {label}</dt>
                <dd className="mt-1 font-display text-[22px] font-semibold tracking-[-0.03em] text-foreground"><AnimatedNumber value={value} /></dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Precio y elegir */}
        <div className="flex flex-col justify-between gap-5 border-t border-border bg-gradient-to-br from-primary/[0.07] via-transparent to-[#9B5CF6]/[0.06] p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary">Nivel {level} de 10</span>
              {esActual && <span className="rounded-full bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground">Tu plan</span>}
            </div>
            <p className="mt-3 flex items-baseline gap-1">
              <AnimatedNumber value={perMonth} format={(n) => fmtEur(n)} className="font-display text-[44px] font-semibold leading-none tracking-[-0.04em] text-foreground" />
              <span className="text-[14px] text-muted-foreground">/mes</span>
            </p>
            <p className="mt-1.5 min-h-[20px] text-[13px] text-muted-foreground" data-testid="custom-billing-note">
              {interval === "year"
                ? <>Facturado {fmtEur(l.eurYear)} al año · ahorras {fmtEur(customYearSavings(l))}</>
                : <>Facturado cada mes · {fmtEur(Math.round((l.eurMonth / l.emails) * 1000 * 100) / 100)} por cada 1.000 envíos</>}
            </p>
            <ul className="mt-4 space-y-1.5">
              {CUSTOM_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-[13.5px] text-foreground"><Check className="h-4 w-4 shrink-0 text-primary" /> {f}</li>
              ))}
            </ul>
          </div>
          <div>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button className="h-12 w-full gap-2 text-[15px]" onClick={elegir} disabled={esActual} data-testid="custom-elegir">
                {esActual ? "Plan actual" : <>Elegir este plan <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </motion.div>
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="h-3 w-3" /> Pago seguro con Stripe · se cobra hoy, sin prueba</p>
          </div>
        </div>
      </div>

      <Dialog open={fase !== "cerrado"} onOpenChange={(o) => { if (!o && fase !== "creando") cerrar(); }}>
        <DialogContent className="max-w-[440px]">
          {fase === "confirmar" && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-[20px] tracking-[-0.02em]">Confirma tu plan a medida</DialogTitle>
                <DialogDescription>Nivel {level} · {interval === "year" ? "facturación anual" : "facturación mensual"}</DialogDescription>
              </DialogHeader>
              <dl className="divide-y divide-border rounded-xl border border-border text-[14px]" data-testid="custom-resumen">
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">Envíos al mes</dt><dd className="font-semibold">{fmtNum(l.emails)}</dd></div>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">Contactos</dt><dd className="font-semibold">{fmtNum(l.contacts)}</dd></div>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">Clientes</dt><dd className="font-semibold">{l.clients}</dd></div>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">{hasStripeSubscription ? "Nuevo precio" : "Se cobra hoy"}</dt><dd className="font-semibold">{fmtEur(interval === "year" ? l.eurYear : l.eurMonth)}{interval === "year" ? " al año" : " al mes"}</dd></div>
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
          {fase === "esperando" && (
            <div className="flex flex-col items-center py-4 text-center" role="status">
              <Loader2 className="h-9 w-9 animate-spin text-primary" />
              <p className="mt-4 font-display text-[18px] font-semibold">{hasStripeSubscription ? "Cambiando tu plan…" : "Completa el pago en la pestaña de Stripe"}</p>
              <p className="mt-1 max-w-[340px] text-[13px] text-muted-foreground">En cuanto Stripe lo confirme, tu plan a medida se activa solo y esta ventana lo detecta.</p>
              {!hasStripeSubscription && via.kind !== "cargando" && (
                <a href={via.kind === "checkout" || via.kind === "enlace" ? via.url : enlace} target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
                  Volver a abrir el pago <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void comprobar()}>Ya he pagado</Button>
            </div>
          )}
          {fase === "listo" && (
            <div className="flex flex-col items-center py-4 text-center" role="status">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-7 w-7" /></motion.span>
              <p className="mt-4 font-display text-[20px] font-semibold">¡Listo! Tu plan a medida está activo</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{fmtNum(l.emails)} envíos al mes · {fmtNum(l.contacts)} contactos · {l.clients} clientes</p>
              <Button className="mt-5" onClick={cerrar}>Perfecto</Button>
            </div>
          )}
          {fase === "error" && (
            <div className="py-2 text-center" role="alert">
              <p className="font-display text-[18px] font-semibold">No se pudo completar</p>
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
