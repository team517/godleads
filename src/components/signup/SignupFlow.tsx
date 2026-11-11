import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, CreditCard, Eye, EyeOff, Loader2, Lock, LogOut, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Wordmark } from "@/components/Wordmark";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription, PLAN_CONFIG } from "@/contexts/SubscriptionContext";
import { cn } from "@/lib/utils";
import {
  SIGNUP_PLANS, SIGNUP_STORAGE_KEY, SIGNUP_TRIAL_DAYS, accountErrors, choiceFromParams, fmtDay, fmtEur, parseSavedChoice,
  passwordStrength, priceIdFor, priceInfo, signupErrorMessage, stepFromParams, trialEndDate,
  type AccountForm, type SignupChoice, type SignupStep,
} from "@/lib/signup-flow";

/* Alta con prueba gratuita de 14 días (11-11-2026). Tres pasos —plan, cuenta, tarjeta— y la vuelta
   de Stripe. "activar" = una cuenta ya creada sin prueba con tarjeta (sólo plan y tarjeta). El acceso
   NUNCA lo da esta pantalla: lo da la suscripción que el webhook de Stripe guarda en el servidor. */

const PLAN_LINES: Record<SignupChoice["plan"], string[]> = {
  starter: ["15.000 correos al mes", "5.000 contactos", "Buzones y warm-up ilimitados"],
  growth: ["180.000 correos al mes", "60.000 contactos", "Respuestas con IA"],
  scale: ["500.000 correos al mes", "Contactos ilimitados", "Soporte 1:1"],
};

const STEPS_ALTA: { id: SignupStep; label: string }[] = [
  { id: "plan", label: "Tu prueba" },
  { id: "cuenta", label: "Tu cuenta" },
  { id: "tarjeta", label: "Tu tarjeta" },
];
const STEPS_ACTIVAR: { id: SignupStep; label: string }[] = [
  { id: "plan", label: "Tu prueba" },
  { id: "tarjeta", label: "Tu tarjeta" },
];

function saveChoice(c: SignupChoice) {
  try { localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
}
function readChoice(): SignupChoice | null {
  try { return parseSavedChoice(localStorage.getItem(SIGNUP_STORAGE_KEY)); } catch { return null; }
}

async function invokeError(error: any): Promise<string> {
  let msg = error?.message || "Error";
  try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
  return msg;
}

export function SignupFlow({ mode = "alta" }: { mode?: "alta" | "activar" }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { subscribed, loading: subLoading, status, refreshSubscription } = useSubscription();

  const [choice, setChoice] = useState<SignupChoice>(() => choiceFromParams(params, readChoice()));
  const pedido = stepFromParams(params);
  const [step, setStep] = useState<SignupStep>(() => pedido ?? "plan");
  const [dir, setDir] = useState(1);
  const steps = mode === "activar" ? STEPS_ACTIVAR : STEPS_ALTA;

  useEffect(() => { saveChoice(choice); }, [choice]);

  // La pantalla del alta está diseñada en claro (como la landing): con el modo oscuro del navegador
  // los campos salían oscuros sobre fondo blanco. Mientras está abierta, siempre en claro.
  useEffect(() => {
    const root = document.documentElement;
    const eraOscuro = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (eraOscuro) root.classList.add("dark"); };
  }, []);

  // Con sesión ya abierta no hay paso "cuenta": se salta a la tarjeta (o al panel si ya tiene acceso).
  useEffect(() => {
    if (mode !== "alta" || subLoading) return;
    if (user && step === "cuenta") go("tarjeta");
    // Sin cuenta no se puede pedir la tarjeta (create-checkout exige sesión): primero, crearla.
    if (!user && step === "tarjeta") go("cuenta");
    if (user && step !== "listo" && (subscribed || status === "staff" || status === "free")) navigate("/dashboard", { replace: true });
  }, [user, step, subscribed, status, subLoading, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next: SignupStep) => {
    const order: SignupStep[] = ["plan", "cuenta", "tarjeta", "listo"];
    setDir(order.indexOf(next) >= order.indexOf(step) ? 1 : -1);
    setStep(next);
    const p = new URLSearchParams(params);
    p.set("paso", next); p.set("plan", choice.plan); p.set("periodo", choice.period); p.delete("cancelado");
    setParams(p, { replace: true });
  };

  const stepIndex = Math.max(0, steps.findIndex((s) => s.id === step));
  const fin = useMemo(() => trialEndDate(), []);
  const precio = priceInfo(choice);

  return (
    <div className="flex min-h-screen bg-[#FBFAFE]">
      <div className="flex flex-1 flex-col px-5 py-6 sm:px-10 md:px-16">
        <header className="flex items-center justify-between">
          {mode === "alta"
            ? <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Volver</Link>
            : <span />}
          <Wordmark className="h-6" colorClassName="text-[#0F172B]" />
          {user
            ? <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><LogOut className="h-4 w-4" /> Salir</button>
            : <Link to="/auth" className="text-sm font-medium text-primary hover:underline">Iniciar sesión</Link>}
        </header>

        <div className="mx-auto mt-8 w-full max-w-[560px] flex-1">
          {step !== "listo" && (
            <nav aria-label="Pasos del alta" className="mb-8">
              <ol className="flex items-center gap-2">
                {steps.map((s, i) => (
                  <li key={s.id} className="flex flex-1 items-center gap-2">
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                      i < stepIndex ? "bg-[#6E58F1] text-white" : i === stepIndex ? "bg-[#6E58F1]/10 text-[#5B40FB] ring-2 ring-[#6E58F1]" : "bg-[#EEEBF7] text-[#65768D]")}>
                      {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className={cn("hidden text-[13px] font-medium sm:inline", i === stepIndex ? "text-[#0F172B]" : "text-[#65768D]")}>{s.label}</span>
                    {i < steps.length - 1 && <span className="h-[2px] flex-1 rounded-full bg-[#EEEBF7]"><span className="block h-full rounded-full bg-[#6E58F1] transition-all duration-500" style={{ width: i < stepIndex ? "100%" : "0%" }} /></span>}
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -28 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {step === "plan" && <PasoPlan choice={choice} setChoice={setChoice} fin={fin} mode={mode} onNext={() => go(mode === "activar" || user ? "tarjeta" : "cuenta")} />}
              {step === "cuenta" && <PasoCuenta choice={choice} onBack={() => go("plan")} onDone={() => go("tarjeta")} />}
              {step === "tarjeta" && <PasoTarjeta choice={choice} fin={fin} cancelado={params.get("cancelado") === "1"} onBack={() => go("plan")} />}
              {step === "listo" && <PasoListo refresh={refreshSubscription} subscribed={subscribed} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Resumen fijo a la derecha (ordenador): lo que va a pasar, sin letra pequeña. */}
      <aside className="relative m-3 hidden w-[420px] shrink-0 overflow-hidden rounded-[20px] bg-[#312A63] p-9 text-white lg:block [background-image:radial-gradient(120%_90%_at_50%_0%,rgba(160,138,255,.52)_0%,rgba(12,21,18,0)_62%)]">
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(255,255,255,.10)_1px,transparent_1.3px)] [background-size:22px_22px] [mask-image:radial-gradient(circle_at_50%_30%,#000_0%,transparent_72%)]" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold text-[#E0DCFA]"><Sparkles className="h-3.5 w-3.5" /> Prueba gratuita</span>
          <h2 className="mt-5 font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.035em]">{SIGNUP_TRIAL_DAYS} días gratis.<br />Hoy no te cobramos nada.</h2>
          <ol className="mt-8 space-y-5 text-[14.5px] text-[#E0DCFA]">
            <li className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[12px] font-semibold text-white">1</span><span><strong className="text-white">Hoy:</strong> acceso completo al plan {PLAN_CONFIG[choice.plan].label}. Pagas 0 €.</span></li>
            <li className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[12px] font-semibold text-white">2</span><span><strong className="text-white">Durante la prueba:</strong> conecta buzones, lanza campañas y responde desde el Unibox.</span></li>
            <li className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[12px] font-semibold text-white">3</span><span><strong className="text-white">El {fmtDay(fin)}:</strong> empieza tu plan a {precio.chargeLabel}. Si cancelas antes desde Ajustes, no se cobra nada.</span></li>
          </ol>
          <div className="mt-10 flex items-center gap-2 text-[12.5px] text-[#C9C2F2]"><Lock className="h-3.5 w-3.5" /> Pago seguro con Stripe. Tu tarjeta no pasa por nuestros servidores.</div>
        </div>
      </aside>
    </div>
  );
}

/* ── Paso 1: plan ─────────────────────────────────────────────────────────────────────────── */

function PasoPlan({ choice, setChoice, fin, mode, onNext }: { choice: SignupChoice; setChoice: (c: SignupChoice) => void; fin: Date; mode: "alta" | "activar"; onNext: () => void }) {
  return (
    <section>
      <p className="text-[13px] font-semibold uppercase tracking-wider text-[#6E58F1]">{mode === "activar" ? "Activa tu prueba gratuita" : "Empieza gratis"}</p>
      <h1 className="mt-2 font-display text-[30px] font-semibold leading-tight tracking-[-0.03em] text-[#0F172B] sm:text-[34px]">{SIGNUP_TRIAL_DAYS} días gratis, hoy no te cobramos nada</h1>
      <p className="mt-3 text-[15.5px] leading-relaxed text-[#45556C]">
        Te pedimos una tarjeta para activar la prueba, pero no se cobra nada hasta el <strong className="text-[#0F172B]">{fmtDay(fin)}</strong>. Cancela cuando quieras desde Ajustes.
      </p>

      <div className="mt-6 inline-flex rounded-full border border-[#E6E3F0] bg-white p-1" role="radiogroup" aria-label="Facturación">
        {(["month", "year"] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={choice.period === p} onClick={() => setChoice({ ...choice, period: p })}
            className={cn("rounded-full px-4 py-1.5 text-[13.5px] font-semibold transition-all", choice.period === p ? "bg-[#6E58F1] text-white shadow-sm" : "text-[#65768D] hover:text-[#0F172B]")}>
            {p === "month" ? "Mensual" : <>Anual <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[11px]", choice.period === p ? "bg-white/20" : "bg-[#E8F7F0] text-[#0A7A52]")}>-17 %</span></>}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3" role="radiogroup" aria-label="Plan">
        {SIGNUP_PLANS.map((plan) => {
          const c = { ...choice, plan };
          const info = priceInfo(c);
          const sel = choice.plan === plan;
          return (
            <button key={plan} type="button" role="radio" aria-checked={sel} onClick={() => setChoice(c)}
              className={cn("group flex w-full items-center gap-4 rounded-[14px] border bg-white p-4 text-left transition-all",
                sel ? "border-[#6E58F1] shadow-[0_0_0_3px_rgba(110,88,241,.14),0_10px_26px_rgba(110,88,241,.12)]" : "border-[#E6E3F0] hover:border-[#C9BFFA]")}>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors", sel ? "border-[#6E58F1] bg-[#6E58F1]" : "border-[#C9C4DA]")}>
                {sel && <span className="h-2 w-2 rounded-full bg-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-display text-[17px] font-semibold tracking-[-0.02em] text-[#0F172B]">{PLAN_CONFIG[plan].label}</span>
                  {plan === "starter" && <span className="rounded-full bg-[#F1EEF8] px-2 py-0.5 text-[11px] font-semibold text-[#5B40FB]">Para empezar</span>}
                  {plan === "growth" && <span className="rounded-full bg-[#E8F7F0] px-2 py-0.5 text-[11px] font-semibold text-[#0A7A52]">El más elegido</span>}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-[#65768D]">{PLAN_LINES[plan].join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-[20px] font-semibold tracking-[-0.02em] text-[#0F172B]">{fmtEur(info.perMonth)}<span className="text-[12.5px] font-medium text-[#65768D]">/mes</span></span>
                <span className="block text-[11.5px] text-[#65768D]">tras la prueba{choice.period === "year" ? " · anual" : ""}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 rounded-[14px] border border-[#CDEBDD] bg-[#F3FBF7] px-4 py-3">
        <span className="text-[14px] text-[#0F3D2B]">Hoy pagas</span>
        <span className="font-display text-[22px] font-semibold tracking-[-0.02em] text-[#0A7A52]">0 €</span>
      </div>

      <Button className="mt-6 h-12 w-full gap-2 text-[15px]" onClick={onNext}>
        Continuar <ArrowRight className="h-4 w-4" />
      </Button>
    </section>
  );
}

/** A dónde lleva el enlace del correo de confirmación: de vuelta al alta, al paso de la tarjeta. */
function confirmRedirect(choice: SignupChoice): string {
  return `${window.location.origin}/empezar?paso=tarjeta&plan=${choice.plan}&periodo=${choice.period}&verificado=1`;
}
const VERIFIED_FLAG = "fl_signup_verified";
const POLL_MS = 3000;
const POLL_MAX_MS = 45 * 60 * 1000;
const RESEND_COOLDOWN_S = 60;

/* Mientras la persona confirma su correo, esta pestaña pregunta cada 3 s si ya lo hizo (por el id
   que devolvió el alta, nunca por el correo). En cuanto está confirmado: "¡Cuenta verificada!",
   abre la sesión con la contraseña que acaba de escribir y pasa sola a la tarjeta. Si el correo se
   abre en otra pestaña de este navegador, la sesión llega por ahí y también se avanza. */
export function ConfirmaCorreo({ email, userId, password, choice }: { email: string; userId: string | null; password: string; choice: SignupChoice }) {
  const [estado, setEstado] = useState<"esperando" | "verificado" | "entrar">("esperando");
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [aviso, setAviso] = useState<string | null>(null);
  const hecho = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    const inicio = Date.now();
    const comprobar = async () => {
      if (!vivo || hecho.current) return;
      if (Date.now() - inicio > POLL_MAX_MS) { clearInterval(t); return; }
      const { data, error } = await (supabase as any).rpc("signup_email_confirmed", { p_user: userId });
      if (!vivo || hecho.current || error || data !== true) return;
      hecho.current = true;
      clearInterval(t);
      try { sessionStorage.setItem(VERIFIED_FLAG, "1"); } catch { /* sin almacenamiento */ }
      setEstado("verificado");
      // Un momento para que se vea el "verificada" y se abre la sesión: el alta pasa sola a la tarjeta.
      await new Promise((r) => setTimeout(r, 1400));
      const { data: s } = await supabase.auth.getSession();
      if (s.session) return;
      const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (vivo && e2) setEstado("entrar");
    };
    const t = setInterval(() => void comprobar(), POLL_MS);
    const alVolver = () => { if (document.visibilityState === "visible") void comprobar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    void comprobar();
    return () => { vivo = false; clearInterval(t); document.removeEventListener("visibilitychange", alVolver); window.removeEventListener("focus", alVolver); };
  }, [userId, email, password]);

  useEffect(() => {
    if (estado !== "esperando" || cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown, estado]);

  const reenviar = async () => {
    setAviso(null);
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: confirmRedirect(choice) } });
    setAviso(error ? "No se pudo reenviar. Prueba en un minuto." : "Te lo hemos vuelto a enviar.");
    setCooldown(RESEND_COOLDOWN_S);
  };

  if (estado !== "esperando") {
    return (
      <section className="rounded-[16px] border border-[#CDEFD9] bg-white p-6 text-center" aria-live="polite">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 18 }}
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#E7F8EE] text-[#16A34A]"
        >
          <Check className="h-7 w-7" strokeWidth={3} />
        </motion.span>
        <h1 className="mt-4 font-display text-[24px] font-semibold tracking-[-0.03em] text-[#0F172B]">¡Cuenta verificada!</h1>
        {estado === "verificado" ? (
          <p className="mt-2 inline-flex items-center gap-2 text-[15px] text-[#45556C]"><Loader2 className="h-4 w-4 animate-spin" /> Te llevamos al último paso: tu tarjeta…</p>
        ) : (
          <>
            <p className="mt-2 text-[15px] text-[#45556C]">Tu correo ya está confirmado. Inicia sesión para añadir la tarjeta y empezar tu prueba.</p>
            <Button asChild className="mt-4"><Link to="/auth">Iniciar sesión <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-[16px] border border-[#E6E3F0] bg-white p-6 text-center">
      <span className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F1EEF8] text-[#6E58F1]">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#6E58F1]/15 motion-reduce:hidden" aria-hidden="true" />
        <ShieldCheck className="relative h-6 w-6" />
      </span>
      <h1 className="mt-4 font-display text-[24px] font-semibold tracking-[-0.03em] text-[#0F172B]">Confirma tu correo</h1>
      <p className="mt-2 text-[15px] text-[#45556C]">Te hemos enviado un enlace a <strong className="text-[#0F172B]">{email}</strong>. Ábrelo y esta pantalla pasará sola al último paso.</p>
      <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#F6F4FC] px-3 py-1.5 text-[13px] text-[#45556C]" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6E58F1]" /> Esperando la confirmación…
      </p>
      <div className="mt-4 text-[13px] text-[#65768D]">
        ¿No te llega? Mira en spam o{" "}
        {cooldown > 0
          ? <span>reenvíalo en {cooldown} s</span>
          : <button type="button" onClick={() => void reenviar()} className="font-medium text-[#5B40FB] hover:underline">reenvía el correo</button>}
        {aviso && <span className="mt-1 block text-[#45556C]">{aviso}</span>}
      </div>
    </section>
  );
}

/* ── Paso 2: cuenta ───────────────────────────────────────────────────────────────────────── */

function PasoCuenta({ choice, onBack, onDone }: { choice: SignupChoice; onBack: () => void; onDone: () => void }) {
  const [f, setF] = useState<AccountForm>({ name: "", company: "", email: "", password: "", terms: false });
  const [touched, setTouched] = useState<Partial<Record<keyof AccountForm, boolean>>>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; alreadyRegistered: boolean } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ email: string; userId: string | null } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const errors = accountErrors(f);
  const strength = passwordStrength(f.password);
  const set = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const blur = (k: keyof AccountForm) => setTouched((t) => ({ ...t, [k]: true }));
  const showErr = (k: keyof AccountForm) => (touched[k] ? errors[k] : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, company: true, email: true, password: true, terms: true });
    if (Object.keys(errors).length) return;
    setBusy(true); setErr(null);
    try {
      saveChoice(choice);
      const email = f.email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email, password: f.password,
        options: {
          data: { full_name: f.name.trim(), company_name: f.company.trim() },
          emailRedirectTo: confirmRedirect(choice),
        },
      });
      if (error) { setErr(signupErrorMessage(error.message)); return; }
      // Supabase devuelve un usuario sin identidades cuando el correo ya existe (no lo dice como error).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setErr(signupErrorMessage("already registered")); return;
      }
      if (!data.session) { setPendingConfirm({ email, userId: data.user?.id ?? null }); return; }
      if (f.company.trim() && data.user) {
        await (supabase as any).from("profiles").update({ company_name: f.company.trim() }).eq("user_id", data.user.id);
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  if (pendingConfirm) {
    return <ConfirmaCorreo email={pendingConfirm.email} userId={pendingConfirm.userId} password={f.password} choice={choice} />;
  }

  return (
    <section>
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em] text-[#0F172B]">Crea tu cuenta</h1>
      <p className="mt-2 text-[15px] text-[#45556C]">Un minuto y estás dentro. Prueba del plan {PLAN_CONFIG[choice.plan].label}.</p>

      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="su-name" label="Tu nombre" error={showErr("name")}>
            <Input ref={nameRef} id="su-name" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} onBlur={() => blur("name")} placeholder="Ana García" aria-invalid={!!showErr("name")} />
          </Campo>
          <Campo id="su-company" label="Empresa" hint="Opcional">
            <Input id="su-company" autoComplete="organization" value={f.company} onChange={(e) => set("company", e.target.value)} placeholder="Acme S.L." />
          </Campo>
        </div>
        <Campo id="su-email" label="Correo de trabajo" error={showErr("email")}>
          <Input id="su-email" type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} onBlur={() => blur("email")} placeholder="ana@acme.com" aria-invalid={!!showErr("email")} />
        </Campo>
        <Campo id="su-pass" label="Contraseña" error={showErr("password")}>
          <div className="relative">
            <Input id="su-pass" type={show ? "text" : "password"} autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} onBlur={() => blur("password")} placeholder="Mínimo 8 caracteres" className="pr-10" aria-invalid={!!showErr("password")} aria-describedby="su-pass-strength" />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div id="su-pass-strength" className="mt-2 flex items-center gap-2" aria-live="polite">
            <span className="flex flex-1 gap-1">
              {[1, 2, 3].map((n) => (
                <span key={n} className={cn("h-1.5 flex-1 rounded-full transition-colors",
                  f.password && strength.score >= n ? (strength.score === 1 ? "bg-[#C0711C]" : strength.score === 2 ? "bg-[#3B89E9]" : "bg-[#0A7A52]") : "bg-[#EEEBF7]")} />
              ))}
            </span>
            <span className="w-36 text-right text-[12px] text-[#65768D]">{f.password ? strength.label : "Mínimo 8 caracteres"}</span>
          </div>
        </Campo>

        <div className="flex items-start gap-2.5 pt-1">
          <Checkbox id="su-terms" checked={f.terms} onCheckedChange={(v) => { set("terms", v === true); blur("terms"); }} aria-invalid={!!showErr("terms")} />
          <Label htmlFor="su-terms" className="text-[13.5px] font-normal leading-snug text-[#45556C]">
            Acepto las condiciones del servicio y la política de privacidad de Funnyleads. Puedes pedirlas en{" "}
            <a href="mailto:team@onepulso.online?subject=Condiciones%20de%20Funnyleads" className="font-medium text-[#5B40FB] underline">team@onepulso.online</a>.
          </Label>
        </div>
        {showErr("terms") && <p className="text-[12.5px] text-destructive">{showErr("terms")}</p>}

        {err && (
          <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13.5px] text-destructive" role="alert">
            {err.text}{" "}
            {err.alreadyRegistered && <Link to="/auth" className="font-semibold underline">Iniciar sesión</Link>}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="h-12" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <Button type="submit" className="h-12 flex-1 gap-2 text-[15px]" disabled={busy}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Creando tu cuenta…</> : <>Crear cuenta y continuar <ArrowRight className="h-4 w-4" /></>}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Campo({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-[13.5px] font-medium text-[#0F172B]">{label}</Label>
        {hint && <span className="text-[12px] text-[#65768D]">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[12.5px] text-destructive">{error}</p>}
    </div>
  );
}

/* ── Paso 3: tarjeta ──────────────────────────────────────────────────────────────────────── */

function PasoTarjeta({ choice, fin, cancelado, onBack }: { choice: SignupChoice; fin: Date; cancelado: boolean; onBack: () => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [verificado] = useState(() => {
    let flag = false;
    try { flag = sessionStorage.getItem(VERIFIED_FLAG) === "1"; sessionStorage.removeItem(VERIFIED_FLAG); } catch { /* sin almacenamiento */ }
    return flag || params.get("verificado") === "1";
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = priceInfo(choice);

  const abrir = async () => {
    setBusy(true); setErr(null);
    try {
      saveChoice(choice);
      const { data, error } = await supabase.functions.invoke("create-checkout", { body: { price_id: priceIdFor(choice), trial: true, return_to: "empezar" } });
      if (error) {
        const msg = await invokeError(error);
        if (/ya tienes una suscripción/i.test(msg)) { navigate("/dashboard", { replace: true }); return; }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const url = (data as any)?.url;
      if (!url) throw new Error("No se pudo abrir el pago");
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo abrir el pago");
      setBusy(false);
    }
  };

  return (
    <section>
      {verificado && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-[#CDEFD9] bg-[#F0FBF4] px-3.5 py-2.5 text-[14px] font-medium text-[#15803D]" role="status">
          <Check className="h-4 w-4" strokeWidth={3} /> Cuenta verificada. Ya solo falta tu tarjeta.
        </p>
      )}
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em] text-[#0F172B]">Añade tu tarjeta para activar la prueba</h1>
      <p className="mt-2 text-[15px] text-[#45556C]">Es sólo para activar la prueba. <strong className="text-[#0F172B]">Hoy no se cobra nada.</strong></p>

      {cancelado && (
        <p className="mt-4 rounded-[10px] border border-[#F2D9B8] bg-[#FFF8EE] px-3 py-2.5 text-[13.5px] text-[#7A4A12]">No se completó el alta de la tarjeta. Puedes intentarlo de nuevo cuando quieras.</p>
      )}

      <div className="mt-6 overflow-hidden rounded-[16px] border border-[#E6E3F0] bg-white">
        <div className="flex items-center justify-between border-b border-[#EEEBF7] px-5 py-4">
          <div>
            <p className="font-display text-[17px] font-semibold tracking-[-0.02em] text-[#0F172B]">Plan {PLAN_CONFIG[choice.plan].label}</p>
            <p className="text-[13px] text-[#65768D]">{choice.period === "year" ? "Facturación anual" : "Facturación mensual"} · {PLAN_LINES[choice.plan][0]}</p>
          </div>
          <button type="button" onClick={onBack} className="text-[13px] font-medium text-[#5B40FB] hover:underline">Cambiar</button>
        </div>
        <dl className="divide-y divide-[#EEEBF7] text-[14px]">
          <div className="flex items-center justify-between px-5 py-3"><dt className="text-[#45556C]">Hoy</dt><dd className="font-semibold text-[#0A7A52]">0 €</dd></div>
          <div className="flex items-center justify-between px-5 py-3"><dt className="text-[#45556C]">Prueba gratuita</dt><dd className="font-medium text-[#0F172B]">{SIGNUP_TRIAL_DAYS} días, hasta el {fmtDay(fin)}</dd></div>
          <div className="flex items-center justify-between px-5 py-3"><dt className="text-[#45556C]">Después</dt><dd className="font-medium text-[#0F172B]">{info.chargeLabel}</dd></div>
        </dl>
      </div>

      {err && <p className="mt-4 rounded-[10px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13.5px] text-destructive" role="alert">{err}</p>}

      <Button className="mt-6 h-12 w-full gap-2 text-[15px]" onClick={() => void abrir()} disabled={busy}>
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Abriendo el pago seguro…</> : <><CreditCard className="h-4 w-4" /> Añadir tarjeta y empezar mi prueba</>}
      </Button>
      <ul className="mt-5 space-y-2 text-[13px] text-[#65768D]">
        <li className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-[#0A7A52]" /> Pago seguro con Stripe: tu tarjeta no pasa por nuestros servidores.</li>
        <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#0A7A52]" /> Cancela cuando quieras desde Ajustes antes del {fmtDay(fin)} y no se cobra nada.</li>
      </ul>
    </section>
  );
}

/* ── Vuelta de Stripe ─────────────────────────────────────────────────────────────────────── */

const MAX_INTENTOS = 10;

function PasoListo({ refresh, subscribed }: { refresh: () => Promise<void>; subscribed: boolean }) {
  const navigate = useNavigate();
  const [intentos, setIntentos] = useState(0);
  const [agotado, setAgotado] = useState(false);

  // La prueba la confirma el servidor (webhook de Stripe / check-subscription), nunca esta URL.
  useEffect(() => {
    if (subscribed) return;
    let vivo = true;
    (async () => {
      for (let i = 0; i < MAX_INTENTOS && vivo; i++) {
        setIntentos(i + 1);
        try { await supabase.functions.invoke("check-subscription"); } catch { /* reintento */ }
        await refresh();
        if (!vivo) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (vivo) setAgotado(true);
    })();
    return () => { vivo = false; };
  }, [subscribed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (subscribed) { try { localStorage.removeItem(SIGNUP_STORAGE_KEY); } catch { /* nada */ } } }, [subscribed]);

  if (subscribed) {
    return (
      <section className="pt-6 text-center">
        <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#0A7A52] text-white shadow-[0_12px_30px_rgba(10,122,82,.3)]">
          <Check className="h-8 w-8" />
        </motion.span>
        <h1 className="mt-6 font-display text-[32px] font-semibold tracking-[-0.03em] text-[#0F172B]">¡Listo! Tu prueba de {SIGNUP_TRIAL_DAYS} días ha empezado</h1>
        <p className="mx-auto mt-3 max-w-md text-[15.5px] text-[#45556C]">Ya tienes acceso completo. Conecta tus buzones y lanza tu primera campaña.</p>
        <Button className="mt-8 h-12 gap-2 px-8 text-[15px]" onClick={() => navigate("/dashboard", { replace: true })}>Entrar en Funnyleads <ArrowRight className="h-4 w-4" /></Button>
      </section>
    );
  }

  return (
    <section className="pt-6 text-center">
      <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#6E58F1]" />
      <h1 className="mt-6 font-display text-[26px] font-semibold tracking-[-0.03em] text-[#0F172B]">Activando tu prueba…</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-[#45556C]">
        {agotado
          ? "Stripe está tardando en confirmarlo. Suele ser cuestión de un minuto."
          : `Estamos confirmando tu tarjeta con Stripe (${intentos}/${MAX_INTENTOS}).`}
      </p>
      {agotado && (
        <Button variant="outline" className="mt-6" onClick={() => { setAgotado(false); setIntentos(0); void refresh(); window.location.reload(); }}>Comprobar de nuevo</Button>
      )}
    </section>
  );
}
