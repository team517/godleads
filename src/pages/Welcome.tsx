import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BarChart3, Bot, Check, Globe, Inbox, Link2, Loader2, Mail,
  Search, Send, Sparkles, Target, Megaphone, Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { Wordmark } from "@/components/Wordmark";
import { SparkMark } from "@/components/SparkMark";
import { SourceMark } from "@/components/welcome/BrandMarks";
import { markWelcomeDone } from "@/hooks/useWelcomeGate";
import PortalBuilding from "@/components/welcome/PortalBuilding";
import { pasosDelPortal, type PasoPortal } from "@/lib/portal-build";
import { GOALS, MAX_GOALS, SOURCES, normalizeWebsite, toggleGoal } from "@/lib/first-run";
import { cn } from "@/lib/utils";

/* =============================================================================
   Bienvenida — lo primero que ve alguien que entra por primera vez.

   Cuatro pantallas encadenadas (cómo nos ha encontrado · qué es esto · su web · qué quiere
   conseguir) con el diseño del propietario: fondo de tres luces, piezas de cristal flotando,
   opciones de 80px con su baldosa de icono y el botón degradado. Las medidas viven en la capa
   "suave" de index.css (.soft-*), que es la misma que usa el editor de secuencia.

   Las respuestas se guardan en `user_onboarding`; en cuanto termina, no vuelve a salir.
   Si el guardado falla NO se le deja encerrado aquí: entra igual y se le avisa.
   ========================================================================== */

type Step = "source" | "intro" | "website" | "goals";
const STEPS: Step[] = ["source", "intro", "website", "goals"];

const GOAL_ICON: Record<string, typeof Send> = {
  cold_email: Send, leads: Target, campaigns: Megaphone, analytics: BarChart3,
  ai_agents: Sparkles, automation: Workflow, unibox: Inbox,
};

/* ── Decorado ─────────────────────────────────────────────────────────────── */

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <span className="soft-wave absolute -left-[10%] -bottom-[38%] h-[60%] w-[120%]" />
      <span className="soft-dots-grid absolute left-10 top-[70px] hidden h-[95px] w-[95px] md:block" />
      <span className="soft-dots-grid absolute bottom-[45px] right-[60px] hidden h-[95px] w-[95px] md:block" />
      <span className="soft-float wv-float absolute left-[5%] top-[26%] hidden rotate-[-10deg] lg:flex"><Send className="h-7 w-7" strokeWidth={1.8} /></span>
      <span className="soft-float wv-float absolute right-[5%] top-[24%] hidden rotate-[9deg] lg:flex" style={{ animationDelay: "1.2s" }}><Mail className="h-7 w-7" strokeWidth={1.8} /></span>
      <span className="soft-float wv-float absolute bottom-[20%] left-[5%] hidden lg:flex" style={{ animationDelay: "2.4s" }}><BarChart3 className="h-7 w-7" strokeWidth={1.8} /></span>
      <span className="soft-float wv-float absolute bottom-[22%] right-[5%] hidden rotate-[-8deg] lg:flex" style={{ animationDelay: "3.1s" }}><Search className="h-7 w-7" strokeWidth={1.8} /></span>
    </div>
  );
}

/** El logo de Funnyleads (baldosa con la estrella), el mismo que en el resto de la app. */
function SparkBadge({ compactHide = false }: { compactHide?: boolean }) {
  return (
    <span className={cn("wv-badge mx-auto flex w-fit rounded-[22%] shadow-[0_15px_35px_rgba(82,78,200,.14)]", compactHide && "wv-badge-optional")} data-testid="welcome-logo">
      <SparkMark size="var(--wv-badge)" className="rounded-[22%]" />
    </span>
  );
}

/* ── Controles ────────────────────────────────────────────────────────────── */

function Choice({ selected, small, onClick, delay, icon, children }: {
  selected: boolean; small?: boolean; onClick: () => void; delay: number; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{ animationDelay: `${delay}s` }}
      className={cn("chip-pop soft-option text-left", small && "soft-option-sm", selected && "soft-option-on")}
    >
      <span className="soft-option-icon">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {selected && <Check className="h-5 w-5 shrink-0 text-[#6b51ff]" strokeWidth={2.6} />}
    </button>
  );
}

function Continue({ label = "Continuar", disabled, busy, onClick }: { label?: string; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className="soft-cta wv-cta group inline-flex w-[420px] max-w-full items-center justify-center">
      {label}
      {busy
        ? <Loader2 className="ml-3 h-5 w-5 animate-spin" />
        : <ArrowRight className="ml-3 h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />}
    </button>
  );
}

const H1 = ({ children }: { children: React.ReactNode }) => (
  <h1 className="wv-h1 font-display font-semibold text-[#080d35]">{children}</h1>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <p className="wv-sub mx-auto text-[#6470a8]">{children}</p>
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
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  useEffect(() => {
    const prev = document.title;
    document.title = "Bienvenido a Funnyleads";
    return () => { document.title = prev; };
  }, []);

  const home = useMemo(
    () => (profile.allowed_routes && profile.allowed_routes.length > 0 ? profile.allowed_routes[0] : "/dashboard"),
    [profile.allowed_routes],
  );

  // Al terminar (o al omitir) se enseña "Construyendo tu portal": su primer paso guarda las
  // respuestas y los siguientes precargan cada sección del panel. Después, dentro.
  const [pasos, setPasos] = useState<PasoPortal[] | null>(null);
  const finish = () => {
    if (!user || pasos) return;
    setSaving(true);
    setPasos(pasosDelPortal(guardar));
  };
  const entrar = () => {
    if (!user) return;
    markWelcomeDone(user.id);
    navigate(home, { replace: true });
  };

  const guardar = async () => {
    if (!user) return;
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
  };

  const next = () => {
    if (step === "website") {
      const raw = website.trim();
      if (raw && !normalizeWebsite(raw)) { setWebsiteError(true); return; }
    }
    if (stepIndex === STEPS.length - 1) { finish(); return; }
    setStepIndex((i) => i + 1);
  };

  const canContinue = step === "source" ? !!source : step === "goals" ? goals.length > 0 : true;

  return (
    <div className="soft-hero wv-page relative min-h-[100dvh] overflow-x-hidden">
      <Backdrop />

      {pasos ? (
        <main className="relative z-[2] mx-auto w-[min(1050px,92%)] pt-9 sm:pt-[52px]">
          <PortalBuilding pasos={pasos} onDone={entrar} />
        </main>
      ) : (

      <main className="relative z-[2] mx-auto flex min-h-[100dvh] w-[min(1050px,calc(100%-32px))] flex-col pt-[clamp(14px,3.6dvh,48px)]">
        {/* Progreso */}
        <header>
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-[9px]">
              <strong className="font-display text-[26px] font-semibold leading-none tracking-[-1.5px] text-[#080d35] sm:text-[clamp(28px,4.4dvh,40px)]">{progress}%</strong>
              <span className="text-[14px] text-[#5f689f] sm:text-[18px]">configurado</span>
            </div>
            <span className="text-[14px] text-[#5f689f] sm:text-[17px]">Paso {stepIndex + 1} de {STEPS.length}</span>
          </div>

          <div className="soft-progress relative mt-3 w-full">
            <span className="soft-progress-fill block" style={{ width: `${progress}%` }} />
            <span className="soft-progress-dot absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${progress}%` }} />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] text-[#5c6597] sm:text-[16px]">
              {stepIndex === 0
                ? "Cuatro preguntas rápidas y empezamos."
                : stepIndex === STEPS.length - 1
                  ? "Último paso — ya casi está."
                  : "Vas bien, sigue así."}
            </p>
            <div className="flex items-center gap-4">
              {stepIndex > 0 && (
                <button type="button" onClick={() => setStepIndex((i) => i - 1)} className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-[#5f689f] transition-colors hover:text-[#6245ff]">
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </button>
              )}
              <button type="button" onClick={finish} className="text-[15px] font-semibold text-[#9aa2c8] transition-colors hover:text-[#6245ff]">
                Omitir
              </button>
            </div>
          </div>
        </header>

        {/* Cada paso entra con la misma animación del panel. */}
        <section key={step} className="page-enter flex flex-1 flex-col items-center justify-center py-[clamp(12px,3dvh,40px)] text-center">
          {step === "source" && (
            <>
              <SparkBadge compactHide />
              <H1>¿Cómo nos has encontrado?</H1>
              <Sub>Cuéntanos qué canal te ha traído hasta aquí.</Sub>
              <div className="wv-options wv-options-sm flex w-full flex-wrap justify-center">
                {SOURCES.map((s, i) => (
                  <Choice key={s.id} small selected={source === s.id} delay={i * 0.03} onClick={() => setSource(s.id)} icon={<SourceMark id={s.id} />}>
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
                  className="soft-field mx-auto mt-4 max-w-[420px] text-center"
                />
              )}
              <Continue disabled={!canContinue} onClick={next} />
            </>
          )}

          {step === "intro" && (
            <>
              <SparkBadge />
              <H1>Hola, soy Funnyleads</H1>
              <Sub>Tu plataforma de correo en frío: buzones, secuencias, respuestas y resultados, todo en el mismo sitio.</Sub>
              <div className="grid w-full gap-[clamp(8px,1.6dvh,18px)] sm:grid-cols-3">
                {[
                  { Icon: Search, title: "Buzones listos para enviar", text: "Conecta Gmail, Outlook o cualquier SMTP y deja el SPF, el DKIM y el DMARC bien configurados." },
                  { Icon: Sparkles, title: "Secuencias con IA", text: "Escribe y personaliza cada paso, con reparto entre buzones y rampa de envío." },
                  { Icon: BarChart3, title: "Respuestas clasificadas", text: "Una bandeja única donde lo interesado se separa solo de lo que no lo es." },
                ].map(({ Icon, title, text }, i) => (
                  <article
                    key={title}
                    style={{ animationDelay: `${0.08 + i * 0.09}s` }}
                    className="chip-pop soft-glass wv-card flex gap-3.5 rounded-[19px] text-left sm:block"
                  >
                    <span className="soft-option-icon wv-card-icon sm:mb-[clamp(10px,2dvh,20px)]"><Icon className="h-6 w-6" strokeWidth={1.9} /></span>
                    <div className="min-w-0">
                      <h2 className="font-display text-[16px] font-semibold tracking-[-0.02em] text-[#080d35] sm:text-[18px]">{title}</h2>
                      <p className="mt-1 text-[13.5px] leading-[1.5] text-[#6470a8] sm:mt-2 sm:text-[clamp(14px,1.9dvh,15.5px)]">{text}</p>
                    </div>
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
              <div className="soft-glass wv-card mx-auto w-full max-w-[760px] rounded-[22px] text-left">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <label htmlFor="wv-web" className="text-[16px] font-semibold text-[#080d35] sm:text-[17px]">URL de tu empresa</label>
                  <span className="inline-flex items-center gap-2 text-[13px] text-[#6470a8] sm:text-[14px]"><Link2 className="h-4 w-4" /> Usaremos tu web para entender tu negocio</span>
                </div>
                <div className={cn("wv-field flex items-center gap-3 rounded-[16px] border bg-white px-5 transition-colors",
                  websiteError ? "border-[#e5484d]" : "border-[#dce1f2] focus-within:border-[#765cff]")}>
                  <Globe className="h-5 w-5 shrink-0 text-[#9299bc]" strokeWidth={1.8} />
                  <input
                    id="wv-web"
                    autoFocus
                    value={website}
                    onChange={(e) => { setWebsite(e.target.value); setWebsiteError(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") next(); }}
                    placeholder="tuempresa.com"
                    inputMode="url"
                    maxLength={200}
                    className="w-full bg-transparent text-[17px] text-[#101640] outline-none placeholder:text-[#9299bc] sm:text-[19px]"
                  />
                </div>
                {websiteError && <p className="mt-3 text-[15px] font-medium text-[#e5484d]">Eso no parece una dirección web. Escríbela como «tuempresa.com».</p>}
              </div>
              <Continue onClick={next} />
              <div>
                <button type="button" onClick={() => { setWebsite(""); setWebsiteError(false); setStepIndex((i) => i + 1); }} className="mt-3 text-[15px] font-semibold text-[#9aa2c8] transition-colors hover:text-[#6245ff]">
                  Ahora no
                </button>
              </div>
            </>
          )}

          {step === "goals" && (
            <>
              <SparkBadge />
              <H1>¿Qué quieres lograr?</H1>
              <Sub>Elige hasta {MAX_GOALS} opciones. Así sabemos por dónde empezar contigo.</Sub>
              <div className="wv-options flex w-full flex-wrap justify-center">
                {GOALS.map((g, i) => {
                  const Icon = GOAL_ICON[g.id] ?? Bot;
                  const selected = goals.includes(g.id);
                  return (
                    <Choice
                      key={g.id}
                      selected={selected}
                      delay={i * 0.04}
                      onClick={() => setGoals((gs) => toggleGoal(gs, g.id))}
                      icon={<Icon className="h-6 w-6" strokeWidth={1.9} />}
                    >
                      {g.label}
                    </Choice>
                  );
                })}
              </div>
              <p className="mt-[clamp(8px,1.8dvh,20px)] text-[14px] text-[#6470a8]">{goals.length} de {MAX_GOALS} seleccionadas</p>
              <Continue label="Entrar en Funnyleads" disabled={!canContinue} busy={saving} onClick={next} />
            </>
          )}
        </section>

        <footer className="wv-footer flex items-center justify-center pb-[clamp(10px,2dvh,22px)] opacity-70">
          <Wordmark className="h-4" colorClassName="text-[#6E58F1]" />
        </footer>
      </main>
      )}
    </div>
  );
}
