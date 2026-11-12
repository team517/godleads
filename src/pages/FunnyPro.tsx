import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ArrowDown, MessageCircle, CalendarCheck, Check, CreditCard, Flame, Inbox, Loader2, Lock, Mail, PenLine, Rocket, Sparkles, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { useFunnyTeamAccess } from "@/hooks/useFunnyTeamAccess";
import { TeamAvatars } from "@/components/chatbot/TeamAvatars";
import { PaymentProgress } from "@/components/pricing/PaymentProgress";
import { PAYMENT_PROCESSING_MS, type PaymentStage } from "@/hooks/usePaymentConfirmation";
import { CalInline } from "@/pages/FunnyTeam";
import { FUNNY_PRO_PRICE, funnyProPagado, funnyProPayUrl } from "@/lib/funny-pro";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* Funny Pro (12-11-2026): formación 1:1 de 350 € con el equipo. Se ve qué se aprende, se paga desde
   aquí (enlace de Stripe con la cuenta dentro) y la agenda sólo se abre cuando el SERVIDOR confirma
   el pago (webhook firmado → funny_pro_purchases → my_funny_pro()). No hay botón de "ya he pagado". */

const MODULOS = [
  { icon: Mail, titulo: "Tu cuenta y tus buzones", puntos: ["Conectar buzones paso a paso", "DNS bien puesto: SPF, DKIM y DMARC", "Límites diarios con cabeza"] },
  { icon: Flame, titulo: "Warm-up y entregabilidad", puntos: ["Calentar los buzones sin quemarlos", "Llegar a la bandeja principal", "Leer las señales antes de que haya problemas"] },
  { icon: Users, titulo: "Listas y leads", puntos: ["A quién escribir y cómo segmentar", "Importar y verificar contactos", "Evitar rebotes desde el principio"] },
  { icon: PenLine, titulo: "Copy y secuencias", puntos: ["Asuntos y primeros correos que se abren", "Seguimientos que consiguen respuesta", "Variantes A/B y personalización con IA"] },
  { icon: Rocket, titulo: "Lanzar y medir campañas", puntos: ["Crear y programar tu campaña", "Las cifras que de verdad importan", "Qué cambiar cuando algo no funciona"] },
  { icon: Inbox, titulo: "Unibox y agentes de IA", puntos: ["Responder rápido desde un solo sitio", "Clasificación automática de respuestas", "Convertir respuestas en reuniones"] },
];

const RESUMEN = ["Configuración de cuenta y buzones", "Tus primeras campañas", "Secuencias, copy y personalización", "Warm-up, entregabilidad e inbox"];

const PASOS = [
  { icon: CreditCard, titulo: "Pagas", texto: `${FUNNY_PRO_PRICE}, pago único con factura. Se confirma solo.` },
  { icon: CalendarCheck, titulo: "Agendas", texto: "Aquí mismo eliges el día y la hora que te vengan bien." },
  { icon: Sparkles, titulo: "Formación 1:1", texto: "Por Google Meet con el equipo, trabajando sobre tu propia cuenta." },
];

export default function FunnyPro() {
  const access = useFunnyTeamAccess();
  if (!access.loading && !access.allowed) return <Navigate to="/" replace />;
  return <FunnyProView />;
}

export function FunnyProView() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [paid, setPaid] = useState<boolean | null>(null);
  const [esperando, setEsperando] = useState(false);
  const [stage, setStage] = useState<PaymentStage>("esperando");
  const [calReady, setCalReady] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const agendaRef = useRef<HTMLDivElement>(null);
  const esperandoRef = useRef(false);
  esperandoRef.current = esperando;

  useEffect(() => {
    const prev = document.title;
    document.title = "Funny Pro · Funnyleads";
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { document.title = prev; obs.disconnect(); };
  }, []);

  /** Pregunta al servidor si está pagado. Sólo el servidor lo decide. */
  const comprobar = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("my_funny_pro");
    if (error) return;
    const r = funnyProPagado(data);
    if (r.paid) {
      if (esperandoRef.current) {
        // Venía de pagar: "Pago recibido · Procesando…" un instante y luego "¡Listo!".
        setStage("procesando");
        setTimeout(() => {
          setStage("listo");
          setPaid(true);
          toast.success("Pago confirmado. Ya puedes agendar tu formación.");
          setTimeout(() => { setEsperando(false); agendaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 1200);
        }, PAYMENT_PROCESSING_MS);
      } else {
        setPaid(true);
      }
    } else {
      setPaid(false);
    }
  }, []);

  useEffect(() => { void comprobar(); }, [comprobar]);

  // Mientras espera el pago: cada pocos segundos y al volver a la pestaña.
  useEffect(() => {
    if (!esperando || paid) return;
    const t = setInterval(() => void comprobar(), 3000);
    const onFocus = () => void comprobar();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [esperando, paid, comprobar]);

  const payUrl = useMemo(() => funnyProPayUrl(user ? { id: user.id, email: user.email } : null), [user]);
  const pagar = () => {
    window.open(payUrl, "_blank", "noopener");
    setStage("esperando");
    setEsperando(true);
    setTimeout(() => agendaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const irAgenda = () => agendaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const name = (profile as { full_name?: string | null } | null)?.full_name || "";
  const email = (profile as { contact_email?: string | null } | null)?.contact_email || user?.email || "";
  const onReady = useMemo(() => () => setCalReady(true), []);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-1 py-4 sm:px-4">
      {/* Cabecera: el mismo bloque que la landing, en español */}
      <section className="relative overflow-hidden rounded-[24px] bg-[#312A63] px-6 py-7 text-white shadow-[0_24px_60px_-28px_rgba(49,42,99,.9)] sm:px-9 sm:py-9"
        style={{ backgroundImage: "radial-gradient(120% 120% at 0% 0%, rgba(160,138,255,.45) 0%, rgba(49,42,99,0) 60%), radial-gradient(80% 120% at 100% 100%, rgba(110,88,241,.35) 0%, rgba(49,42,99,0) 60%)" }}>
        <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/[.06] blur-2xl" />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[12.5px] font-semibold">
              Formación 1:1 · pago único
            </span>
            <h1 className="mt-4 font-display text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.1] tracking-[-0.03em]">
              Aprende a hacer cold email como un pro
            </h1>
            <p className="mt-3 max-w-xl text-[15.5px] leading-relaxed text-[#E0DCFA]">
              Nos sentamos contigo y te enseñamos todo: desde configurar tu cuenta hasta lanzar campañas que consiguen reuniones.
            </p>
            <ul className="mt-5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {RESUMEN.map((t) => (
                <li key={t} className="flex items-center gap-2.5 text-[14.5px]">
                  <Check className="h-4 w-4 shrink-0 text-[#7DE3FF]" strokeWidth={3} /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-3 text-center lg:w-[290px]">
            <div className="flex items-center gap-3">
              <TeamAvatars size={40} />
              <span className="text-left leading-tight">
                <span className="block text-[14px] font-semibold">Funny Pro Team</span>
                <span className="block text-[12.5px] text-[#CCC7EF]">Tus formadores</span>
              </span>
            </div>
            {paid ? (
              <>
                <span className="mt-1 inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-3.5 py-1.5 text-[14px] font-semibold text-emerald-300 ring-1 ring-emerald-300/30">
                  <Check className="h-4 w-4" strokeWidth={3} /> Formación pagada
                </span>
                <span className="text-[13.5px] text-[#CCC7EF]">Elige día y hora para tu sesión.</span>
                <button type="button" onClick={irAgenda} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#6E58F1] px-5 py-3.5 text-[16px] font-semibold shadow-[0_8px_22px_rgba(110,88,241,.45)] transition hover:brightness-110">
                  Agendar mi formación <ArrowDown className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <span className="mt-1 font-display text-[52px] font-semibold leading-none tracking-[-0.03em]">350€</span>
                <span className="text-[13.5px] text-[#CCC7EF]">Pago único · IVA incluido</span>
                <button type="button" onClick={pagar} disabled={paid === null}
                  className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#6E58F1] px-5 py-3.5 text-[16px] font-semibold shadow-[0_8px_22px_rgba(110,88,241,.45)] transition hover:brightness-110 disabled:opacity-60">
                  {paid === null ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Reservar mi formación
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Lo que vas a aprender */}
      <section aria-labelledby="fp-aprender">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="fp-aprender" className="font-display text-[22px] font-semibold tracking-[-0.02em] text-[#0b1040] dark:text-foreground">Lo que vas a aprender</h2>
            <p className="text-[14px] text-[#6470a8] dark:text-muted-foreground">Seis bloques, adaptados a tu negocio y trabajando sobre tu propia cuenta.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULOS.map(({ icon: Icon, titulo, puntos }, i) => (
            <article key={titulo} className="group relative overflow-hidden rounded-2xl border border-[#ebe8f8] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,64,.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-18px_rgba(110,88,241,.55)] dark:border-border dark:bg-card">
              <span aria-hidden="true" className="absolute right-4 top-3 font-display text-[34px] font-semibold leading-none text-[#f0edfd] dark:text-white/5">{String(i + 1).padStart(2, "0")}</span>
              <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#7B66F5] to-[#5B45E8] text-white shadow-[0_8px_18px_-8px_rgba(91,69,232,.7)]">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="relative mt-3.5 text-[16px] font-semibold text-[#0b1040] dark:text-foreground">{titulo}</h3>
              <ul className="relative mt-2 space-y-1.5">
                {puntos.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-[13.5px] leading-snug text-[#5b6190] dark:text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={3} /> {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section aria-labelledby="fp-como" className="rounded-2xl border border-[#ebe8f8] bg-gradient-to-br from-white to-[#f8f6ff] p-5 dark:border-border dark:from-card dark:to-card sm:p-6">
        <h2 id="fp-como" className="font-display text-[19px] font-semibold tracking-[-0.02em] text-[#0b1040] dark:text-foreground">Cómo funciona</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {PASOS.map(({ icon: Icon, titulo, texto }, i) => {
            const hecho = (i === 0 && paid) || false;
            const actual = (i === 0 && !paid) || (i === 1 && !!paid);
            return (
              <li key={titulo} className="relative flex gap-3">
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold",
                  hecho ? "bg-emerald-500 text-white" : actual ? "bg-primary text-white shadow-[0_0_0_5px_hsl(var(--primary)/0.15)]" : "bg-[#f1eefe] text-primary dark:bg-primary/15")}>
                  {hecho ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-[18px] w-[18px]" />}
                </span>
                <div>
                  <p className="text-[14.5px] font-semibold text-[#0b1040] dark:text-foreground">{i + 1}. {titulo}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-[#6470a8] dark:text-muted-foreground">{texto}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Agenda: sólo con el pago confirmado */}
      <section ref={agendaRef} aria-labelledby="fp-agenda" className="scroll-mt-28 overflow-hidden rounded-2xl border border-[#ebe8f8] bg-card shadow-sm dark:border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id="fp-agenda" className="flex items-center gap-2 text-[14.5px] font-semibold text-foreground">
            <CalendarCheck className="h-4 w-4 text-primary" /> Agenda tu formación
          </h2>
          {!paid && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Se abre al pagar</span>}
        </div>

        {paid ? (
          <div className="relative min-h-[460px]">
            {!calReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
                Cargando la agenda…
              </div>
            )}
            <div role="region" aria-label="Agendar la formación Funny Pro" className={calReady ? "opacity-100 transition-opacity duration-300" : "opacity-0"}>
              <CalInline name={name} email={email} dark={dark} onReady={onReady} />
            </div>
          </div>
        ) : esperando ? (
          <div className="px-5 py-10">
            <PaymentProgress
              stage={stage}
              reopenUrl={payUrl}
              waitingText="Completa el pago en la pestaña de Stripe. En cuanto se confirme, la agenda se abre aquí sola."
              doneTitle="¡Listo! Ya puedes agendar tu formación"
            />
          </div>
        ) : (
          <div className="relative">
            {/* Calendario de muestra, bloqueado */}
            <div aria-hidden="true" className="pointer-events-none select-none p-6 blur-[3px]">
              <div className="mx-auto grid max-w-2xl grid-cols-7 gap-2">
                {Array.from({ length: 35 }).map((_, i) => (
                  <span key={i} className={cn("h-10 rounded-lg", [9, 11, 16, 18, 23, 25].includes(i) ? "bg-primary/25" : "bg-muted")} />
                ))}
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/40 px-6 text-center backdrop-blur-[1px]">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Lock className="h-5 w-5" /></span>
              <p className="max-w-sm text-[15px] font-semibold text-foreground">La agenda se abre en cuanto se confirme tu pago</p>
              <p className="max-w-sm text-[13px] text-muted-foreground">Pagas {FUNNY_PRO_PRICE} con Stripe y aquí mismo eliges día y hora con el equipo.</p>
              <button type="button" onClick={pagar} disabled={paid === null}
                className="mt-1 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#7B66F5] to-[#5B45E8] px-5 py-2.5 text-[14.5px] font-semibold text-white shadow-[0_10px_22px_-10px_rgba(91,69,232,.8)] transition hover:brightness-110 disabled:opacity-60">
                <CreditCard className="h-4 w-4" /> Pagar y desbloquear
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="px-1 pb-2 text-center text-[12.5px] text-muted-foreground">
        <MessageCircle className="mr-1 inline h-3.5 w-3.5" /> ¿Dudas antes de pagar? Escríbenos desde el chat de abajo a la derecha y te contamos.
      </p>
    </div>
  );
}
