import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  BadgeCheck, BarChart3, Bot, Check, Crown, Flame, Inbox, Infinity as InfinityIcon, KeyRound, Layers, Loader2, Lock, Mail, MailCheck, Sparkles, Users, Wand2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { PaymentProgress } from "@/components/pricing/PaymentProgress";
import { PAYMENT_PROCESSING_MS, type PaymentStage } from "@/hooks/usePaymentConfirmation";
import {
  COSTE_PERSONALIZAR, COSTE_VERIFICAR, PACKS_MONEDAS, coinPackUrl, fmtEur, fmtNum, precioPorVerificacion, queHacerCon,
  type CoinStatus, type PackMonedas,
} from "@/lib/coins";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import coin from "@/assets/coin-funny.webp";

/* Tienda de monedas (13-11-2026): se abre casi a pantalla completa desde la barra de arriba. Las
   monedas sólo pagan verificar correos (1) y personalizar con IA (2); todo lo demás es gratis. Se
   compra con el enlace de pago de Stripe del pack (con la cuenta dentro) y las monedas las suma el
   webhook firmado: esta pantalla sólo espera a ver el saldo subir (sin botón de "ya he pagado"). */

const DESTACADOS: Record<number, { label: string; icon: typeof Flame }> = {
  5_000: { label: "Popular", icon: Flame },
  25_000: { label: "Mejor valor", icon: Crown },
};

const GRATIS = [
  { icon: Layers, t: "Campañas y secuencias" },
  { icon: Mail, t: "Buzones y warm-up" },
  { icon: Inbox, t: "Unibox" },
  { icon: Bot, t: "Agentes de IA" },
  { icon: BarChart3, t: "Estadísticas" },
  { icon: Users, t: "Clientes" },
];

/** Montoncito de monedas para cada pack (más monedas, más montón). */
function Pila({ n, big = false }: { n: number; big?: boolean }) {
  const size = big ? 74 : 58;
  const pos = [
    { x: 0, y: 0, r: -8 }, { x: 30, y: -14, r: 10 }, { x: -30, y: -10, r: -14 }, { x: 14, y: -34, r: 4 }, { x: -14, y: -40, r: -6 },
  ].slice(0, n);
  return (
    <div className="relative mx-auto flex h-[104px] w-[150px] items-end justify-center" aria-hidden="true">
      <span className="absolute bottom-1 left-1/2 h-4 w-28 -translate-x-1/2 rounded-full bg-[#7B5CF6]/20 blur-md" />
      {pos.map((p, i) => (
        <img key={i} src={coin} alt="" draggable={false}
          className="absolute bottom-2 drop-shadow-[0_8px_14px_rgba(110,88,241,.35)] transition-transform duration-300 group-hover:-translate-y-1"
          style={{ width: size, height: size, transform: `translate(${p.x}px, ${p.y}px) rotate(${p.r}deg)`, zIndex: 10 - i }} />
      ))}
      {n >= 4 && <Sparkles className="absolute right-3 top-2 h-4 w-4 text-[#A78BFA]" />}
      {n >= 5 && <Sparkles className="absolute left-3 top-6 h-3.5 w-3.5 text-[#7DD3FC]" />}
    </div>
  );
}

export function CoinStore({ open, onOpenChange, status, refresh, waitingFromReturn = false }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  status: CoinStatus | null;
  refresh: () => Promise<CoinStatus | null>;
  /** Vuelve de pagar en Stripe (?monedas=ok): se espera a que el servidor sume las monedas. */
  waitingFromReturn?: boolean;
}) {
  const { user } = useAuth();
  const [esperando, setEsperando] = useState<PackMonedas | "vuelta" | null>(null);
  const [stage, setStage] = useState<PaymentStage>("esperando");
  const base = useRef<number | null>(null);

  useEffect(() => {
    if (open && waitingFromReturn) { setEsperando("vuelta"); setStage("esperando"); }
  }, [open, waitingFromReturn]);
  useEffect(() => { if (!open) { setEsperando(null); setStage("esperando"); } }, [open]);

  // Mientras espera: mira el saldo cada 3 s y al volver a la pestaña. Sólo el servidor suma monedas.
  useEffect(() => {
    if (!open || !esperando || stage !== "esperando") return;
    let vivo = true;
    const mirar = async () => {
      const st = await refresh();
      if (!vivo || !st) return;
      let listo = false;
      if (esperando === "vuelta") {
        // Vuelve de Stripe: vale la última compra suya confirmada por el servidor (últimos 30 min).
        const { data } = await (supabase as any).from("coin_purchases").select("credited_at, created_at").order("created_at", { ascending: false }).limit(1);
        const r = data?.[0];
        listo = !!r?.credited_at && Date.now() - Date.parse(r.created_at) < 30 * 60_000;
      } else {
        if (base.current === null) base.current = st.coins;
        listo = st.coins >= base.current + esperando.coins;
      }
      if (listo) {
        setStage("procesando");
        setTimeout(() => { if (vivo) { setStage("listo"); toast.success(`¡Monedas añadidas! Ahora tienes ${fmtNum(st.coins)}.`); } }, PAYMENT_PROCESSING_MS);
      }
    };
    void mirar();
    const t = setInterval(() => void mirar(), 3000);
    const onFocus = () => void mirar();
    window.addEventListener("focus", onFocus);
    return () => { vivo = false; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [open, esperando, stage, refresh]);

  const comprar = (p: PackMonedas) => {
    base.current = status?.coins ?? 0;
    window.open(coinPackUrl(p, user ? { id: user.id, email: user.email } : null), "_blank", "noopener");
    setStage("esperando");
    setEsperando(p);
  };

  const saldo = status ? (status.free ? "∞" : fmtNum(status.coins)) : "…";
  const ejemplos = useMemo(() => [100, 500, 1_000, 5_000].map((n) => ({ n, ...queHacerCon(n) })), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="flex h-[min(94dvh,1000px)] w-[calc(100vw-16px)] max-w-[1240px] flex-col gap-0 overflow-hidden rounded-[26px] border-[#ebe8f8] bg-[#fbfaff] p-0 dark:border-border dark:bg-background sm:rounded-[26px]" data-testid="coin-store">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-5 sm:px-8 sm:pt-7">
          {/* Cabecera */}
          <div className="flex flex-wrap items-center justify-between gap-4 pr-8">
            <div className="flex items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f4f1ff] to-[#e6defe] shadow-[inset_0_0_0_1px_rgba(110,88,241,.15)] dark:from-primary/25 dark:to-primary/10">
                <img src={coin} alt="" className="h-11 w-11" />
              </span>
              <div>
                <DialogTitle className="font-display text-[clamp(24px,2.6vw,32px)] font-semibold tracking-[-0.03em] text-[#0b1040] dark:text-foreground">Tienda de monedas</DialogTitle>
                <DialogDescription className="text-[15px] text-[#6470a8] dark:text-muted-foreground">Verifica correos y personaliza con IA. Todo lo demás de Funnyleads es gratis.</DialogDescription>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#ebe8f8] bg-white px-4 py-2 text-[15px] font-semibold text-[#0b1040] shadow-sm dark:border-border dark:bg-card dark:text-foreground" aria-label="Tu saldo">
              <img src={coin} alt="" className="h-6 w-6" /> {saldo} <span className="text-[13px] font-medium text-[#6470a8] dark:text-muted-foreground">monedas</span>
            </span>
          </div>

          {/* Banner */}
          <section className="relative mt-6 overflow-hidden rounded-[22px] bg-[#2E2468] px-6 py-7 text-white sm:px-9"
            style={{ backgroundImage: "radial-gradient(120% 140% at 0% 0%, rgba(160,138,255,.5) 0%, rgba(46,36,104,0) 55%), radial-gradient(90% 120% at 100% 100%, rgba(110,88,241,.45) 0%, rgba(46,36,104,0) 60%)" }}>
            <div className="relative grid items-center gap-6 lg:grid-cols-[1.2fr_auto_1fr]">
              <div>
                <span className="inline-flex rounded-full bg-white/12 px-3 py-1 text-[12.5px] font-semibold ring-1 ring-white/20">Más monedas, más resultados</span>
                <h2 className="mt-3 font-display text-[clamp(22px,2.4vw,30px)] font-semibold leading-[1.15] tracking-[-0.02em]">Limpia tus listas y personaliza cada correo con IA</h2>
              </div>
              <div className="relative mx-auto hidden h-[150px] w-[260px] sm:block" aria-hidden="true">
                <span className="absolute inset-x-6 bottom-2 h-6 rounded-full bg-[#A78BFA]/30 blur-xl" />
                <img src={coin} alt="" className="absolute bottom-3 left-[40px] h-[110px] w-[110px] -rotate-12 drop-shadow-[0_14px_24px_rgba(0,0,0,.35)]" />
                <img src={coin} alt="" className="absolute bottom-8 left-[120px] h-[96px] w-[96px] rotate-12 drop-shadow-[0_14px_24px_rgba(0,0,0,.35)]" />
                <img src={coin} alt="" className="absolute bottom-[70px] left-[175px] h-[64px] w-[64px] rotate-[24deg] opacity-95" />
                <Sparkles className="absolute left-2 top-5 h-5 w-5 text-[#C4B5FD]" />
                <Sparkles className="absolute right-0 top-1 h-4 w-4 text-[#7DD3FC]" />
              </div>
              <ul className="space-y-3 text-[15px]">
                <li className="flex items-center gap-3"><MailCheck className="h-5 w-5 text-[#7DE3FF]" /> Verificar un correo · <b>{COSTE_VERIFICAR} moneda</b></li>
                <li className="flex items-center gap-3"><Wand2 className="h-5 w-5 text-[#7DE3FF]" /> Personalizar un lead con IA · <b>{COSTE_PERSONALIZAR} monedas</b></li>
                <li className="flex items-center gap-3"><InfinityIcon className="h-5 w-5 text-[#7DE3FF]" /> Sin caducidad</li>
              </ul>
            </div>
          </section>

          {/* Esperando el pago / listo */}
          {esperando && (
            <section className="mt-6 rounded-2xl border border-[#ebe8f8] bg-white px-5 py-8 dark:border-border dark:bg-card">
              <PaymentProgress
                stage={stage}
                reopenUrl={esperando === "vuelta" ? null : coinPackUrl(esperando, user ? { id: user.id, email: user.email } : null)}
                waitingTitle={esperando === "vuelta" ? "Confirmando tu pago…" : "Esperando tu pago en Stripe…"}
                waitingText={esperando === "vuelta"
                  ? "En cuanto Stripe nos lo confirme, las monedas aparecen en tu saldo (suele ser al momento)."
                  : `Completa el pago de ${fmtNum(esperando.coins)} monedas en la pestaña de Stripe. Se suman solas en cuanto se confirme.`}
                doneTitle="¡Listo! Monedas añadidas"
                doneText={status ? `Ahora tienes ${fmtNum(status.coins)} monedas.` : undefined}
                doneAction={<button type="button" onClick={() => setEsperando(null)} className="mt-2 rounded-xl bg-primary px-5 py-2.5 text-[14px] font-semibold text-white">Seguir</button>}
              />
              {esperando === "vuelta" && stage === "esperando" && (
                <p className="mt-3 text-center text-[12.5px] text-muted-foreground">Tu saldo actual: {saldo} monedas · <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEsperando(null)}>Ver los packs</button></p>
              )}
            </section>
          )}

          {/* Packs */}
          <section className="mt-7" aria-labelledby="cs-packs">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 id="cs-packs" className="flex items-center gap-2.5 font-display text-[21px] font-semibold tracking-[-0.02em] text-[#0b1040] dark:text-foreground">
                <img src={coin} alt="" className="h-7 w-7" /> Elige tu pack de monedas
              </h3>
              <span className="inline-flex items-center gap-1.5 text-[13.5px] text-[#6470a8] dark:text-muted-foreground"><Lock className="h-4 w-4" /> Pago seguro con Stripe · factura incluida</span>
            </div>
            {status?.free ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-[14px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                <BadgeCheck className="h-5 w-5 shrink-0" /> Tu cuenta tiene monedas ilimitadas: verificar y personalizar no te cuesta nada.
              </div>
            ) : status?.payerIsAgency ? (
              <div className="flex items-center gap-3 rounded-2xl border border-[#e2ddfd] bg-[#f7f5ff] p-4 text-[14px] text-[#3b3f6b] dark:border-primary/25 dark:bg-primary/10 dark:text-foreground">
                <Sparkles className="h-5 w-5 shrink-0 text-primary" /> Tu agencia se encarga de las monedas de tu cuenta.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {PACKS_MONEDAS.map((p, i) => {
                  const dest = DESTACADOS[p.coins];
                  const popular = p.coins === 5_000;
                  return (
                    <article key={p.coins} className={cn(
                      "group relative flex flex-col items-center rounded-2xl border bg-white px-4 pb-4 pt-7 text-center transition-all duration-200 hover:-translate-y-1 dark:bg-card",
                      popular ? "border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15),0_18px_36px_-20px_rgba(110,88,241,.7)]" : "border-[#ebe8f8] shadow-[0_1px_2px_rgba(16,24,64,.04)] hover:shadow-[0_18px_36px_-22px_rgba(110,88,241,.6)] dark:border-border",
                    )}>
                      {dest && (
                        <span className="absolute top-3 inline-flex items-center gap-1 rounded-full bg-[#f1eefe] px-2.5 py-1 text-[12px] font-semibold text-primary dark:bg-primary/15">
                          <dest.icon className="h-3.5 w-3.5" /> {dest.label}
                        </span>
                      )}
                      <Pila n={i + 1} big={i === 4} />
                      <p className="mt-2 flex items-center gap-1.5 font-display text-[26px] font-semibold tracking-[-0.02em] text-[#0b1040] dark:text-foreground">
                        <img src={coin} alt="" className="h-6 w-6" /> {fmtNum(p.coins)}
                      </p>
                      <p className="mt-0.5 text-[20px] font-bold text-[#0b1040] dark:text-foreground">{fmtEur(p.cents)}</p>
                      <p className="mt-0.5 text-[12px] text-[#6470a8] dark:text-muted-foreground">{precioPorVerificacion(p)} por correo verificado</p>
                      <button type="button" onClick={() => comprar(p)} disabled={!status}
                        className={cn("mt-4 w-full rounded-xl py-2.5 text-[14.5px] font-semibold transition disabled:opacity-60",
                          popular ? "bg-gradient-to-r from-[#7B5CF6] to-[#A24BF5] text-white shadow-[0_10px_22px_-10px_rgba(123,92,246,.8)] hover:brightness-110" : "border border-[#e3e0f5] bg-white text-[#0b1040] hover:border-primary/50 hover:text-primary dark:border-border dark:bg-background dark:text-foreground")}>
                        {!status ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Comprar"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Para qué sirven */}
          <section className="mt-8 grid gap-4 lg:grid-cols-[1fr_1fr_1.1fr]" aria-label="Para qué sirven las monedas">
            <div className="rounded-2xl border border-[#ebe8f8] bg-white p-5 dark:border-border dark:bg-card">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#7B66F5] to-[#5B45E8] text-white"><MailCheck className="h-5 w-5" /></span>
              <h4 className="mt-3 text-[16px] font-semibold text-[#0b1040] dark:text-foreground">Verificar correos · {COSTE_VERIFICAR} moneda</h4>
              <p className="mt-1 text-[13.5px] leading-relaxed text-[#6470a8] dark:text-muted-foreground">Comprobamos cada correo uno a uno antes de enviar: menos rebotes y tus buzones sanos. Los ya verificados no se vuelven a cobrar.</p>
            </div>
            <div className="rounded-2xl border border-[#ebe8f8] bg-white p-5 dark:border-border dark:bg-card">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#7B66F5] to-[#5B45E8] text-white"><Wand2 className="h-5 w-5" /></span>
              <h4 className="mt-3 text-[16px] font-semibold text-[#0b1040] dark:text-foreground">Personalizar con IA · {COSTE_PERSONALIZAR} monedas</h4>
              <p className="mt-1 text-[13.5px] leading-relaxed text-[#6470a8] dark:text-muted-foreground">Un mensaje único para cada lead con sus datos. Si algún lead falla, no se cobra.</p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-[#4b3fc4] dark:text-primary"><KeyRound className="h-3.5 w-3.5" /> ¿Usas tu propia clave de IA? Entonces personalizar es gratis.</p>
            </div>
            <div className="rounded-2xl border border-[#ebe8f8] bg-white p-5 dark:border-border dark:bg-card">
              <h4 className="text-[16px] font-semibold text-[#0b1040] dark:text-foreground">Qué puedes hacer con…</h4>
              <table className="mt-2 w-full text-[13.5px]">
                <thead><tr className="text-left text-[12px] text-[#6470a8] dark:text-muted-foreground"><th className="py-1 font-medium">Monedas</th><th className="py-1 font-medium">Verificar</th><th className="py-1 font-medium">Personalizar</th></tr></thead>
                <tbody>
                  {ejemplos.map((e) => (
                    <tr key={e.n} className="border-t border-[#f0eef8] dark:border-border">
                      <td className="py-1.5 font-semibold text-[#0b1040] dark:text-foreground"><img src={coin} alt="" className="mr-1 inline h-4 w-4 align-[-3px]" />{fmtNum(e.n)}</td>
                      <td className="py-1.5 text-[#3b3f6b] dark:text-foreground/80">{fmtNum(e.verificaciones)} correos</td>
                      <td className="py-1.5 text-[#3b3f6b] dark:text-foreground/80">{fmtNum(e.personalizaciones)} leads</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Gratis */}
          <section className="mt-6 rounded-2xl border border-dashed border-[#d9d4f7] bg-white/60 p-5 dark:border-border dark:bg-card/60" aria-label="Lo que es gratis">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1040] dark:text-foreground"><Check className="h-4 w-4 text-emerald-500" strokeWidth={3} /> Todo lo demás es gratis y sin límite de monedas</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {GRATIS.map(({ icon: Icon, t }) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f2fd] px-3 py-1.5 text-[13px] font-medium text-[#3b3f6b] dark:bg-white/5 dark:text-foreground/80"><Icon className="h-3.5 w-3.5 text-primary" /> {t}</span>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] text-[#6470a8] dark:text-muted-foreground">
              Las monedas no caducan. ¿Buscas más envíos o más clientes? Eso va con tu plan: <Link to="/settings?tab=plan" onClick={() => onOpenChange(false)} className="font-semibold text-primary hover:underline">Ver planes</Link>.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CoinStore;
