import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BarChart3, Bot, Check, Globe, Inbox, Link2, Loader2, Mail,
  MessageSquare, Search, Send, Sparkles, Target, Megaphone, Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { Wordmark } from "@/components/Wordmark";
import { SourceMark } from "@/components/welcome/BrandMarks";
import { GOALS, MAX_GOALS, SOURCES, normalizeWebsite, toggleGoal } from "@/lib/first-run";
import { markWelcomeDone } from "@/hooks/useWelcomeGate";
import { cn } from "@/lib/utils";

/* =============================================================================
   Bienvenida — lo primero que ve alguien que entra por primera vez.

   Cuatro pantallas encadenadas (cómo nos ha encontrado · qué es esto · su web · qué quiere
   conseguir) sobre el fondo del diseño: lavanda, piezas flotando y el camino de puntos.
   Las respuestas se guardan en `user_onboarding`; en cuanto termina, no vuelve a salir.

   Si el guardado falla NO se le deja encerrado aquí: entra igual y se le avisa.
   ========================================================================== */

type Step = "source" | "intro" | "website" | "goals";
const STEPS: Step[] = ["source", "intro", "website", "goals"];

const GOAL_ICON: Record<string, typeof Send> = {
  cold_email: Send, leads: Target, campaigns: Megaphone, analytics: BarChart3,
  ai_agents: Sparkles, automation: Workflow, unibox: Inbox,
};

/* ── Piezas del decorado ──────────────────────────────────────────────────── */

/** Pieza flotante: uno de los iconos que rodean la pantalla en el diseño. */
function Tile({ at, delay, children }: { at: string; delay: string; children: React.ReactNode }) {
  return (
    <span
      className={cn("wv-float absolute hidden place-items-center rounded-[14px] border border-white bg-white/85 p-2.5 shadow-[0_10px_26px_rgba(21,17,60,.08)] backdrop-blur-sm md:grid", at)}
      style={{ animationDelay: delay }}
    >
      {children}
    </span>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Luz de fondo: los tres colores de la marca, muy diluidos. */}
      <div className="absolute -left-48 top-[-18%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(139,107,255,.20),transparent)]" />
      <div className="absolute -right-40 top-[6%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(47,198,238,.16),transparent)]" />
      <div className="absolute bottom-[-28%] left-[28%] h-[640px] w-[640px] rounded-full bg-[radial-gradient(closest-side,rgba(255,111,197,.12),transparent)]" />
      {/* El camino de puntos que sube por los lados. */}
      <svg className="absolute inset-0 hidden h-full w-full md:block" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <path className="wv-dash" d="M170 250 C 95 390, 215 500, 150 680" fill="none" stroke="#C9BFFA" strokeWidth="1.7" />
        <path className="wv-dash" d="M1285 230 C 1365 370, 1240 470, 1320 650" fill="none" stroke="#C9BFFA" strokeWidth="1.7" />
      </svg>
      <Tile at="left-[5%] top-[24%]" delay="0s"><Send className="h-5 w-5 text-[#6E58F1]" strokeWidth={1.8} /></Tile>
      <Tile at="left-[8%] bottom-[22%]" delay="1.4s"><MessageSquare className="h-5 w-5 text-[#3B89E9]" strokeWidth={1.8} /></Tile>
      <Tile at="left-[4%] bottom-[38%]" delay="2.6s"><BarChart3 className="h-5 w-5 text-[#05A063]" strokeWidth={1.8} /></Tile>
      <Tile at="right-[6%] top-[20%]" delay=".7s"><Search className="h-5 w-5 text-[#6E58F1]" strokeWidth={1.8} /></Tile>
      <Tile at="right-[4%] top-[42%]" delay="2s"><Mail className="h-5 w-5 text-[#3B89E9]" strokeWidth={1.8} /></Tile>
      <Tile at="right-[8%] bottom-[24%]" delay="3.1s"><Link2 className="h-5 w-5 text-[#8B5CF6]" strokeWidth={1.8} /></Tile>
      {/* Chispas sueltas, como en el diseño. */}
      <Sparkles className="absolute left-[13%] top-[18%] hidden h-5 w-5 text-[#8B6BFF]/60 md:block" />
      <Sparkles className="absolute right-[14%] top-[33%] hidden h-4 w-4 text-[#2FC6EE]/70 md:block" />
      <Sparkles className="absolute left-[16%] bottom-[18%] hidden h-4 w-4 text-[#FF6FC5]/60 md:block" />
    </div>
  );
}

/** La chispa de la marca, en su baldosa blanca. */
function SparkBadge() {
  return (
    <span className="wv-float relative mb-7 inline-grid h-[72px] w-[72px] place-items-center rounded-[18px] border border-white bg-white shadow-[0_14px_34px_rgba(21,17,60,.10)]">
      <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden="true">
        <defs>
          <linearGradient id="wv-spark" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#2FC6EE" />
            <stop offset=".5" stopColor="#8B6BFF" />
            <stop offset="1" stopColor="#FF6FC5" />
          </linearGradient>
        </defs>
        <path d="M12 2.4l1.9 5.4c.3.8.9 1.4 1.7 1.7l5.4 1.9-5.4 1.9c-.8.3-1.4.9-1.7 1.7L12 20.4l-1.9-5.4a3 3 0 0 0-1.7-1.7L3 11.4l5.4-1.9c.8-.3 1.4-.9 1.7-1.7z" fill="url(#wv-spark)" />
      </svg>
      <span aria-hidden className="absolute -right-3 -top-2 hidden rotate-[18deg] text-[#6E58F1] sm:block">
        <svg viewBox="0 0 22 22" className="h-5 w-5"><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 12L1.5 14" /><path d="M8 7L7 4" /><path d="M12 9l2.6-2" /></g></svg>
      </span>
    </span>
  );
}

/* ── Controles ────────────────────────────────────────────────────────────── */

function Choice({ selected, onClick, delay, children }: { selected: boolean; onClick: () => void; delay: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{ animationDelay: `${delay}s` }}
      className={cn(
        "chip-pop inline-flex items-center gap-2.5 rounded-[12px] border px-4 py-3 text-[15px] font-semibold text-[#1D293D]",
        "bg-white/90 shadow-[0_2px_6px_rgba(21,17,60,.05)] backdrop-blur-sm transition-all duration-200",
        "hover:-translate-y-[2px] hover:border-[#C9BFFA] hover:shadow-[0_10px_24px_rgba(110,88,241,.14)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6BFF]/50",
        selected ? "border-[#8B6BFF] bg-[#F4F1FE] shadow-[0_8px_20px_rgba(110,88,241,.16)]" : "border-[#EAE7F4]",
      )}
    >
      {children}
      {selected && <Check className="h-4 w-4 shrink-0 text-[#6E58F1]" strokeWidth={2.6} />}
    </button>
  );
}

function Continue({ label = "Continuar", disabled, busy, onClick }: { label?: string; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "group mt-9 inline-flex items-center gap-2.5 rounded-[12px] px-11 py-4 text-[16px] font-semibold text-white",
        "bg-[linear-gradient(90deg,#3B82F6_0%,#7C5CFB_52%,#7C3AED_100%)] shadow-[0_12px_26px_rgba(110,88,241,.30)]",
        "transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[0_16px_34px_rgba(110,88,241,.36)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6BFF]/50",
        "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
      )}
    >
      {label}
      {busy
        ? <Loader2 className="h-[18px] w-[18px] animate-spin" />
        : <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-1" />}
    </button>
  );
}

const H1 = ({ children }: { children: React.ReactNode }) => (
  <h1 className="font-display text-[clamp(30px,4.2vw,50px)] font-semibold leading-[1.08] tracking-[-0.035em] text-[#0F172B]">{children}</h1>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-4 max-w-[560px] text-[17px] leading-[1.5] text-[#45556C]">{children}</p>
);

/* ── Pantalla ─────────────────────────────────────────────────────────────── */

export default function Welcome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const [stepIndex, setStepIndex] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [sourceOther, setSourceOther] = useState("");
  const [website, setWebsite] = useState("");
  const [websiteError, setWebsiteError] = useState(false);
  const [goals, setGoals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const step = STEPS[stepIndex];
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  useEffect(() => {
    const prev = document.title;
    document.title = "Bienvenido a OnePulso";
    return () => { document.title = prev; };
  }, []);

  const home = useMemo(
    () => (profile.allowed_routes && profile.allowed_routes.length > 0 ? profile.allowed_routes[0] : "/dashboard"),
    [profile.allowed_routes],
  );

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await (supabase as any).from("user_onboarding").upsert({
      user_id: user.id,
      source,
      source_other: source === "other" ? (sourceOther.trim() || null) : null,
      website: normalizeWebsite(website),
      goals,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    setSaving(false);
    // Aunque el guardado falle, nadie se queda encerrado en la bienvenida.
    if (error) toast.error("No hemos podido guardar tus respuestas, pero ya puedes entrar.");
    markWelcomeDone(user.id);
    navigate(home, { replace: true });
  };

  const next = () => {
    if (step === "website") {
      const raw = website.trim();
      if (raw && !normalizeWebsite(raw)) { setWebsiteError(true); return; }
    }
    if (stepIndex === STEPS.length - 1) { void finish(); return; }
    setStepIndex((i) => i + 1);
  };

  const canContinue = step === "source" ? !!source : step === "goals" ? goals.length > 0 : true;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#FBFAFE] font-sans">
      <Backdrop />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1120px] flex-col px-5 pb-10 pt-6 sm:px-8">
        {/* Cabecera: en qué paso va, y cuánto queda. */}
        <header>
          <div className="flex items-end justify-between gap-4">
            <p className="font-display text-[19px] font-semibold tracking-[-0.02em] text-[#0F172B]">
              Paso {stepIndex + 1} <span className="text-[15px] font-medium text-[#65768D]">de {STEPS.length}</span>
            </p>
            <div className="flex items-center gap-4">
              <p className="hidden text-[15px] text-[#65768D] sm:block">Configura tu cuenta</p>
              {stepIndex > 0 && (
                <button type="button" onClick={() => setStepIndex((i) => i - 1)} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#65768D] transition-colors hover:text-[#6E58F1]">
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </button>
              )}
              <button type="button" onClick={() => void finish()} className="text-[14px] font-semibold text-[#93A1B3] transition-colors hover:text-[#6E58F1]">
                Omitir
              </button>
            </div>
          </div>
          <div className="relative mt-3 h-[6px] w-full rounded-full bg-[#E4E4F3]">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#3B82F6_0%,#7C5CFB_60%,#7C3AED_100%)] transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
            <span
              className="absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[#5B40FB] shadow-[0_2px_6px_rgba(21,17,60,.18)] transition-[left] duration-500 ease-out"
              style={{ left: `${progress}%` }}
            />
          </div>
          <p className="mt-2.5 text-[14.5px] text-[#65768D]">
            {stepIndex === 0
              ? "Cuatro preguntas rápidas y empezamos."
              : stepIndex === STEPS.length - 1
                ? "Último paso — ya casi está."
                : "Vas bien, sigue así."}
          </p>
        </header>

        {/* Cada paso entra con la misma animación del panel. */}
        <main key={step} className="page-enter flex flex-1 flex-col items-center justify-center py-8 text-center">
          {step === "source" && (
            <>
              <SparkBadge />
              <H1>¿Cómo nos has encontrado?</H1>
              <Sub>Cuéntanos qué canal te ha traído hasta aquí.</Sub>
              <div className="mt-9 flex max-w-[960px] flex-wrap justify-center gap-3">
                {SOURCES.map((s, i) => (
                  <Choice key={s.id} selected={source === s.id} delay={i * 0.03} onClick={() => setSource(s.id)}>
                    <SourceMark id={s.id} />
                    {s.label}
                  </Choice>
                ))}
              </div>
              {source === "other" && (
                <input
                  autoFocus
                  value={sourceOther}
                  onChange={(e) => setSourceOther(e.target.value)}
                  placeholder="¿Dónde nos viste?"
                  maxLength={120}
                  className="mt-5 w-full max-w-[420px] rounded-[10px] border border-[#EAE7F4] bg-white px-4 py-3 text-center text-[15px] text-[#0F172B] outline-none transition-colors placeholder:text-[#93A1B3] focus:border-[#8B6BFF]"
                />
              )}
              <Continue disabled={!canContinue} onClick={next} />
            </>
          )}

          {step === "intro" && (
            <>
              <SparkBadge />
              <H1>Hola, soy OnePulso</H1>
              <Sub>Tu plataforma de correo en frío: buzones, secuencias, respuestas y resultados, todo en el mismo sitio.</Sub>
              <div className="mt-10 grid w-full max-w-[960px] gap-4 sm:grid-cols-3">
                {[
                  { Icon: Search, tint: "bg-[#E8F1FE] text-[#3B89E9]", title: "Buzones listos para enviar", text: "Conecta Gmail, Outlook o cualquier SMTP y deja el SPF, el DKIM y el DMARC bien configurados." },
                  { Icon: Sparkles, tint: "bg-[#F1EEF8] text-[#6E58F1]", title: "Secuencias con IA", text: "Escribe y personaliza cada paso, con reparto entre buzones y rampa de envío." },
                  { Icon: BarChart3, tint: "bg-[#E8FBF2] text-[#05A063]", title: "Respuestas clasificadas", text: "Una bandeja única donde lo interesado se separa solo de lo que no lo es." },
                ].map(({ Icon, tint, title, text }, i) => (
                  <article
                    key={title}
                    style={{ animationDelay: `${0.08 + i * 0.09}s` }}
                    className="chip-pop rounded-[14px] border border-[#EAE7F4] bg-white/85 p-6 text-left shadow-[0_6px_18px_rgba(21,17,60,.05)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-[2px] hover:border-[#C9BFFA] hover:shadow-[0_14px_32px_rgba(110,88,241,.12)]"
                  >
                    <span className={cn("mb-4 grid h-11 w-11 place-items-center rounded-[12px]", tint)}><Icon className="h-5 w-5" strokeWidth={1.9} /></span>
                    <h2 className="font-display text-[16.5px] font-semibold tracking-[-0.02em] text-[#0F172B]">{title}</h2>
                    <p className="mt-2 text-[14.5px] leading-[1.55] text-[#45556C]">{text}</p>
                  </article>
                ))}
              </div>
              <Continue label="Comenzar ahora" onClick={next} />
            </>
          )}

          {step === "website" && (
            <>
              <SparkBadge />
              <H1>¿Cuál es el sitio web<br className="hidden sm:block" /> de tu empresa?</H1>
              <Sub>Nos ayuda a entender a qué te dedicas y a personalizar tus campañas.</Sub>
              <div className="mt-9 w-full max-w-[720px] rounded-[16px] border border-[#EAE7F4] bg-white/80 p-5 text-left shadow-[0_10px_28px_rgba(21,17,60,.06)] backdrop-blur-sm sm:p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="wv-web" className="text-[15px] font-semibold text-[#0F172B]">URL de tu empresa</label>
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-[#65768D]"><Link2 className="h-4 w-4" /> Usaremos tu web para entender tu negocio</span>
                </div>
                <div className={cn("flex items-center gap-3 rounded-[10px] border bg-[#FBFAFF] px-4 py-3.5 transition-colors", websiteError ? "border-[#E5484D]" : "border-[#EAE7F4] focus-within:border-[#8B6BFF]")}>
                  <Globe className="h-5 w-5 shrink-0 text-[#93A1B3]" strokeWidth={1.8} />
                  <input
                    id="wv-web"
                    autoFocus
                    value={website}
                    onChange={(e) => { setWebsite(e.target.value); setWebsiteError(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") next(); }}
                    placeholder="tuempresa.com"
                    inputMode="url"
                    maxLength={200}
                    className="w-full bg-transparent text-[16px] text-[#0F172B] outline-none placeholder:text-[#93A1B3]"
                  />
                </div>
                {websiteError && <p className="mt-2 text-[13.5px] font-medium text-[#E5484D]">Eso no parece una dirección web. Escríbela como «tuempresa.com».</p>}
              </div>
              <Continue onClick={next} />
              <button type="button" onClick={() => { setWebsite(""); setWebsiteError(false); setStepIndex((i) => i + 1); }} className="mt-4 text-[14px] font-semibold text-[#93A1B3] transition-colors hover:text-[#6E58F1]">
                Ahora no
              </button>
            </>
          )}

          {step === "goals" && (
            <>
              <SparkBadge />
              <H1>¿Qué quieres lograr?</H1>
              <Sub>Elige hasta {MAX_GOALS} opciones. Así sabemos por dónde empezar contigo.</Sub>
              <div className="mt-9 flex max-w-[880px] flex-wrap justify-center gap-3">
                {GOALS.map((g, i) => {
                  const Icon = GOAL_ICON[g.id] ?? Bot;
                  const selected = goals.includes(g.id);
                  const full = goals.length >= MAX_GOALS && !selected;
                  return (
                    <Choice key={g.id} selected={selected} delay={i * 0.04} onClick={() => setGoals((gs) => toggleGoal(gs, g.id))}>
                      <Icon className={cn("h-[19px] w-[19px] transition-colors", selected ? "text-[#6E58F1]" : full ? "text-[#93A1B3]" : "text-[#45556C]")} strokeWidth={1.9} />
                      <span className={cn(full && "text-[#65768D]")}>{g.label}</span>
                    </Choice>
                  );
                })}
              </div>
              <p className="mt-4 text-[13.5px] text-[#65768D]">{goals.length} de {MAX_GOALS} seleccionadas</p>
              <Continue label="Entrar en OnePulso" disabled={!canContinue} busy={saving} onClick={next} />
            </>
          )}
        </main>

        <footer className="flex items-center justify-center gap-2 pt-2 opacity-70">
          <Wordmark className="h-4" colorClassName="text-[#6E58F1]" />
        </footer>
      </div>
    </div>
  );
}
