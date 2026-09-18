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
import { SourceMark } from "@/components/welcome/BrandMarks";
import { markWelcomeDone } from "@/hooks/useWelcomeGate";
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

/** La chispa de la marca dentro de su baldosa de cristal. */
function SparkBadge() {
  return (
    <span className="soft-glass mx-auto mb-[23px] flex h-[110px] w-[110px] items-center justify-center rounded-[28px]">
      <span className="soft-spark block h-[62px] w-[62px]" />
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
    <button type="button" onClick={onClick} disabled={disabled || busy} className="soft-cta group mt-[55px] inline-flex w-[420px] max-w-[90%] items-center justify-center">
      {label}
      {busy
        ? <Loader2 className="ml-[15px] h-6 w-6 animate-spin" />
        : <ArrowRight className="ml-[15px] h-6 w-6 transition-transform duration-200 group-hover:translate-x-1" />}
    </button>
  );
}

const H1 = ({ children }: { children: React.ReactNode }) => (
  <h1 className="font-display text-[clamp(40px,4vw,58px)] font-semibold leading-[1.05] tracking-[-2px] text-[#080d35]">{children}</h1>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <p className="mx-auto mb-[45px] mt-[14px] max-w-[620px] text-[clamp(19px,1.8vw,24px)] leading-[1.4] text-[#6470a8]">{children}</p>
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
    <div className="soft-hero relative min-h-[100dvh] overflow-x-hidden">
      <Backdrop />

      <main className="relative z-[2] mx-auto w-[min(1050px,90%)] pb-20 pt-9 sm:pt-[60px]">
        {/* Progreso */}
        <header>
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-[9px]">
              <strong className="font-display text-[32px] font-semibold leading-none tracking-[-2px] text-[#080d35] sm:text-[43px]">{progress}%</strong>
              <span className="text-[15px] text-[#5f689f] sm:text-[20px]">configurado</span>
            </div>
            <span className="text-[15px] text-[#5f689f] sm:text-[19px]">Paso {stepIndex + 1} de {STEPS.length}</span>
          </div>

          <div className="soft-progress relative mt-4 w-full">
            <span className="soft-progress-fill block" style={{ width: `${progress}%` }} />
            <span className="soft-progress-dot absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${progress}%` }} />
          </div>

          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] text-[#5c6597] sm:text-[17px]">
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
              <button type="button" onClick={() => void finish()} className="text-[15px] font-semibold text-[#9aa2c8] transition-colors hover:text-[#6245ff]">
                Omitir
              </button>
            </div>
          </div>
        </header>

        {/* Cada paso entra con la misma animación del panel. */}
        <section key={step} className="page-enter mt-[55px] text-center sm:mt-[72px]">
          {step === "source" && (
            <>
              <SparkBadge />
              <H1>¿Cómo nos has encontrado?</H1>
              <Sub>Cuéntanos qué canal te ha traído hasta aquí.</Sub>
              <div className="flex flex-wrap justify-center gap-[18px]">
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
                  className="soft-field mx-auto mt-6 max-w-[420px] text-center"
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
              <div className="grid gap-[18px] sm:grid-cols-3">
                {[
                  { Icon: Search, title: "Buzones listos para enviar", text: "Conecta Gmail, Outlook o cualquier SMTP y deja el SPF, el DKIM y el DMARC bien configurados." },
                  { Icon: Sparkles, title: "Secuencias con IA", text: "Escribe y personaliza cada paso, con reparto entre buzones y rampa de envío." },
                  { Icon: BarChart3, title: "Respuestas clasificadas", text: "Una bandeja única donde lo interesado se separa solo de lo que no lo es." },
                ].map(({ Icon, title, text }, i) => (
                  <article
                    key={title}
                    style={{ animationDelay: `${0.08 + i * 0.09}s` }}
                    className="chip-pop soft-glass rounded-[19px] p-7 text-left"
                  >
                    <span className="soft-option-icon mb-5"><Icon className="h-6 w-6" strokeWidth={1.9} /></span>
                    <h2 className="font-display text-[18px] font-semibold tracking-[-0.02em] text-[#080d35]">{title}</h2>
                    <p className="mt-2 text-[15.5px] leading-[1.55] text-[#6470a8]">{text}</p>
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
              <div className="soft-glass mx-auto w-full max-w-[760px] rounded-[25px] p-6 text-left sm:p-8">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="wv-web" className="text-[17px] font-semibold text-[#080d35]">URL de tu empresa</label>
                  <span className="inline-flex items-center gap-2 text-[14px] text-[#6470a8]"><Link2 className="h-4 w-4" /> Usaremos tu web para entender tu negocio</span>
                </div>
                <div className={cn("flex h-[76px] items-center gap-3 rounded-[18px] border bg-white px-6 transition-colors",
                  websiteError ? "border-[#e5484d]" : "border-[#dce1f2] focus-within:border-[#765cff]")}>
                  <Globe className="h-6 w-6 shrink-0 text-[#9299bc]" strokeWidth={1.8} />
                  <input
                    id="wv-web"
                    autoFocus
                    value={website}
                    onChange={(e) => { setWebsite(e.target.value); setWebsiteError(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") next(); }}
                    placeholder="tuempresa.com"
                    inputMode="url"
                    maxLength={200}
                    className="w-full bg-transparent text-[19px] text-[#101640] outline-none placeholder:text-[#9299bc]"
                  />
                </div>
                {websiteError && <p className="mt-3 text-[15px] font-medium text-[#e5484d]">Eso no parece una dirección web. Escríbela como «tuempresa.com».</p>}
              </div>
              <Continue onClick={next} />
              <div>
                <button type="button" onClick={() => { setWebsite(""); setWebsiteError(false); setStepIndex((i) => i + 1); }} className="mt-5 text-[15px] font-semibold text-[#9aa2c8] transition-colors hover:text-[#6245ff]">
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
              <div className="flex flex-wrap justify-center gap-[18px]">
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
              <p className="mt-6 text-[15px] text-[#6470a8]">{goals.length} de {MAX_GOALS} seleccionadas</p>
              <Continue label="Entrar en OnePulso" disabled={!canContinue} busy={saving} onClick={next} />
            </>
          )}
        </section>

        <footer className="mt-14 flex items-center justify-center opacity-70">
          <Wordmark className="h-4" colorClassName="text-[#6E58F1]" />
        </footer>
      </main>
    </div>
  );
}
