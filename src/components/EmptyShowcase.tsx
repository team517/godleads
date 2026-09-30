import type { ReactNode } from "react";
import { BarChart3, Bot, Mail, MessageSquareReply, Plus, Settings2, Sparkles, Users, Zap } from "lucide-react";
import { SparkMark } from "@/components/SparkMark";
import { cn } from "@/lib/utils";

/* Pantallas vacías con el diseño del propietario (30-09-2026): la chispa de OnePulso en el centro
   con sus anillos, tarjetas de cristal flotando alrededor unidas por caminos de puntos, una ola de
   fondo, el título, el texto y el botón degradado. Cada sección tiene su propia ilustración:
   campañas, Unibox, agentes y analítica. En móvil sólo queda el centro (las tarjetas no caben). */

export type EmptyVariant = "campaigns" | "unibox" | "agents" | "analytics";

interface Props {
  variant: EmptyVariant;
  title: string;
  text: string;
  cta?: { label: string; onClick: () => void };
  secondary?: ReactNode;
  className?: string;
}

/* ── Piezas ────────────────────────────────────────────────────────────────────────── */

function Glass({ className, rotate, delay = 0, children }: { className: string; rotate: number; delay?: number; children: ReactNode }) {
  return (
    <div className={cn("absolute hidden lg:block", className)} style={{ transform: `rotate(${rotate}deg)` }}>
      <div className="wv-float rounded-[18px] border border-white/90 bg-white/70 px-5 py-4 shadow-[0_18px_40px_rgba(82,78,200,.10)] backdrop-blur-md dark:border-border dark:bg-card/70" style={{ animationDelay: `${delay}s` }}>
        {children}
      </div>
    </div>
  );
}

const Bars = () => (
  <span className="flex items-end gap-[3px]" aria-hidden>
    {[10, 16, 22, 30].map((h, i) => <span key={i} className="w-[5px] rounded-full bg-gradient-to-t from-[#b9b0ff] to-[#8b7bff]" style={{ height: h, opacity: 0.35 + i * 0.2 }} />)}
  </span>
);
const Squiggle = () => (
  <svg viewBox="0 0 80 28" className="h-7 w-20" aria-hidden><path d="M2 20 C 14 26, 20 6, 32 16 S 52 26, 58 12 S 72 4, 78 8" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" /></svg>
);
const Lines = () => (
  <span className="mt-2 block space-y-1.5" aria-hidden>
    <span className="block h-2 w-28 rounded-full bg-[#e6e3fb] dark:bg-muted" />
    <span className="block h-2 w-16 rounded-full bg-[#eeecfb] dark:bg-muted/70" />
  </span>
);

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="flex min-w-[170px] items-end justify-between gap-6">
      <div>
        <p className="text-[13.5px] text-[#6b73a8] dark:text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-[26px] font-medium leading-none text-[#3d44a8] dark:text-foreground">{value}</p>
      </div>
      {icon}
    </div>
  );
}

function Person({ initials, label, time, tone }: { initials: string; label: string; time: string; tone: string }) {
  return (
    <div className="flex min-w-[210px] items-center gap-3">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold", tone)}>{initials}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-[#4b5382] dark:text-muted-foreground">{label}</p>
        <Lines />
      </div>
      <span className="self-start text-[12px] text-[#9aa0c2]">{time}</span>
    </div>
  );
}

function AgentChip({ Icon, label, tone }: { Icon: typeof Bot; label: string; tone: string }) {
  return (
    <div className="flex min-w-[230px] items-center gap-3">
      <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-[14px]", tone)}><Icon className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-semibold text-[#1d2260] dark:text-foreground">{label}</p>
        <Lines />
      </div>
    </div>
  );
}

function IconTile({ Icon, className, delay = 0, tone = "text-[#6a4cff]" }: { Icon: typeof Bot; className: string; delay?: number; tone?: string }) {
  return (
    <div className={cn("absolute hidden xl:block", className)}>
      <span className={cn("wv-float grid h-14 w-14 place-items-center rounded-[16px] border border-white/90 bg-white/80 shadow-[0_12px_28px_rgba(82,78,200,.12)] dark:border-border dark:bg-card", tone)} style={{ animationDelay: `${delay}s` }}>
        <Icon className="h-6 w-6" />
      </span>
    </div>
  );
}

/** Caminos de puntos que unen las tarjetas con la chispa del centro. */
function Paths() {
  return (
    <svg viewBox="0 0 1000 360" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-6 hidden h-[360px] w-full lg:block" aria-hidden>
      <g fill="none" stroke="#c9c2f5" strokeWidth="1.5" strokeDasharray="4 7" className="wv-dash">
        <path d="M120 260 C 220 180, 300 300, 400 190 S 470 150, 500 180" />
        <path d="M880 250 C 780 170, 720 300, 610 190 S 530 150, 500 180" />
        <path d="M200 120 C 280 60, 360 160, 440 140" />
        <path d="M800 110 C 720 60, 640 160, 560 140" />
      </g>
      {[[400, 190, "#6a8bff"], [610, 190, "#a26bff"], [300, 262, "#c7bfff"], [720, 275, "#c7bfff"], [440, 140, "#8b7bff"], [560, 140, "#b27bff"]].map(([x, y, c], i) => (
        <circle key={i} cx={x as number} cy={y as number} r="6" fill={c as string} opacity=".8" />
      ))}
    </svg>
  );
}

function Center({ variant }: { variant: EmptyVariant }) {
  return (
    <div className="relative mx-auto grid h-[230px] w-[230px] place-items-center">
      <span className="absolute inset-0 rounded-full border border-[#e4e1fb] dark:border-border" />
      <span className="absolute inset-[26px] rounded-full border border-[#ebe8fc] bg-gradient-to-b from-white/40 to-[#f1eeff]/40 dark:border-border dark:from-transparent dark:to-transparent" />
      {variant === "agents" && (
        <svg viewBox="0 0 230 230" className="absolute inset-0 h-full w-full motion-safe:animate-[spin_14s_linear_infinite]" aria-hidden>
          <circle cx="115" cy="115" r="100" fill="none" stroke="url(#es-arc)" strokeWidth="3" strokeLinecap="round" strokeDasharray="120 508" />
          <defs><linearGradient id="es-arc" x1="0" x2="1"><stop offset="0%" stopColor="#6a8bff" /><stop offset="100%" stopColor="#a26bff" /></linearGradient></defs>
        </svg>
      )}
      {variant === "unibox" ? (
        <div className="relative flex flex-col items-center">
          <span className="relative z-[1] -mb-10 rounded-[26px] shadow-[0_16px_36px_rgba(98,86,255,.18)]"><SparkMark size={110} className="rounded-[26px]" /></span>
          <span className="relative h-[92px] w-[150px] rounded-[22px] border border-white bg-gradient-to-b from-white to-[#f3f1fc] shadow-[0_20px_40px_rgba(82,78,200,.14)] dark:border-border dark:from-card dark:to-card">
            <span className="absolute inset-x-3 top-0 h-[46px] rounded-b-[40px] border-b border-[#ebe8fb] dark:border-border" />
          </span>
        </div>
      ) : (
        <span className="pb-breathe relative rounded-[30px] shadow-[0_18px_40px_rgba(98,86,255,.18)]"><SparkMark size={126} className="rounded-[30px]" /></span>
      )}
    </div>
  );
}

function Decor({ variant }: { variant: EmptyVariant }) {
  if (variant === "campaigns") return (
    <>
      <Glass className="left-[3%] top-[48%]" rotate={-8} delay={0.2}><Stat label="Leads" value="0" icon={<Bars />} /></Glass>
      <Glass className="left-[19%] top-[20%]" rotate={-5} delay={1.1}><Stat label="Respuestas" value="0" icon={<Mail className="h-9 w-9 text-[#c4bcf7]" strokeWidth={1.4} />} /></Glass>
      <Glass className="right-[19%] top-[16%]" rotate={7} delay={0.6}><Stat label="Tasa de respuesta" value="0%" icon={<Squiggle />} /></Glass>
      <Glass className="right-[3%] top-[46%]" rotate={8} delay={1.6}><Stat label="Oportunidades" value="0" icon={<Bars />} /></Glass>
    </>
  );
  if (variant === "analytics") return (
    <>
      <Glass className="left-[14%] top-[10%]" rotate={-6} delay={0.3}><Stat label="Emails enviados" value="0" icon={<Bars />} /></Glass>
      <Glass className="left-[10%] top-[52%]" rotate={4} delay={1.2}><Stat label="Leads generados" value="0" icon={<Users className="h-9 w-9 text-[#8ea2ff]" strokeWidth={1.5} />} /></Glass>
      <Glass className="right-[12%] top-[8%]" rotate={6} delay={0.7}><Stat label="Tasa de respuesta" value="0%" icon={<Squiggle />} /></Glass>
      <Glass className="right-[8%] top-[50%]" rotate={-5} delay={1.8}><Stat label="Oportunidades" value="0" icon={<Bars />} /></Glass>
    </>
  );
  if (variant === "unibox") return (
    <>
      <Glass className="left-[12%] top-[12%]" rotate={-7} delay={0.2}><Person initials="LC" label="Nuevo lead" time="2h" tone="bg-[#eceafe] text-[#6a4cff]" /></Glass>
      <Glass className="left-[14%] top-[50%]" rotate={4} delay={1.3}><Person initials="JM" label="Reunión agendada" time="1d" tone="bg-[#eef0fb] text-[#5b62a8]" /></Glass>
      <Glass className="right-[12%] top-[10%]" rotate={7} delay={0.8}><Person initials="AP" label="Respuesta" time="5h" tone="bg-[#fde8f6] text-[#c026d3]" /></Glass>
      <Glass className="right-[10%] top-[50%]" rotate={-6} delay={1.7}><Person initials="SR" label="Interesado" time="3d" tone="bg-[#e3f6f9] text-[#0e8fa3]" /></Glass>
    </>
  );
  return (
    <>
      <Glass className="left-[2%] top-[14%]" rotate={-9} delay={0.2}><AgentChip Icon={MessageSquareReply} label="Agente de respuestas" tone="bg-sky-50 text-sky-600" /></Glass>
      <Glass className="left-[4%] top-[54%]" rotate={6} delay={1.2}><AgentChip Icon={Mail} label="Borradores para revisar" tone="bg-fuchsia-50 text-fuchsia-600" /></Glass>
      <Glass className="right-[2%] top-[12%]" rotate={8} delay={0.7}><AgentChip Icon={BarChart3} label="Asistente del Unibox" tone="bg-violet-50 text-violet-600" /></Glass>
      <Glass className="right-[4%] top-[52%]" rotate={-7} delay={1.8}><AgentChip Icon={Users} label="Respuestas automáticas" tone="bg-cyan-50 text-cyan-600" /></Glass>
      <IconTile Icon={Bot} className="left-[38%] top-[0%]" delay={0.4} />
      <IconTile Icon={BarChart3} className="right-[37%] top-[4%]" delay={1.1} />
      <IconTile Icon={Mail} className="left-[34%] top-[40%]" delay={1.6} />
      <IconTile Icon={Zap} className="left-[38%] top-[72%]" delay={0.9} />
      <IconTile Icon={Settings2} className="right-[35%] top-[68%]" delay={1.4} />
    </>
  );
}

/* ── Pantalla vacía ────────────────────────────────────────────────────────────────── */

export default function EmptyShowcase({ variant, title, text, cta, secondary, className }: Props) {
  return (
    <section className={cn("relative overflow-hidden rounded-[26px] border border-[#eceef7] bg-gradient-to-b from-[#fbfbff] to-[#f5f4fd] px-5 pb-12 pt-8 text-center dark:border-border dark:from-card dark:to-background", className)}>
      {/* ola y luces de fondo */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute -left-[10%] bottom-[-45%] h-[80%] w-[70%] rounded-[50%] bg-gradient-to-tr from-[#e7e4ff]/70 to-transparent" />
        <span className="absolute -right-[10%] bottom-[-50%] h-[85%] w-[75%] rounded-[50%] bg-gradient-to-tl from-[#f3e6ff]/70 to-transparent" />
        <span className="absolute left-1/2 top-[18%] h-[260px] w-[260px] -translate-x-1/2 rounded-full bg-[#b9a8ff]/15 blur-3xl" />
      </div>
      <div className="relative mx-auto min-h-[250px] max-w-[1100px] md:min-h-[330px]">
        <Paths />
        <Decor variant={variant} />
        <div className="relative pt-2 md:pt-10"><Center variant={variant} /></div>
      </div>
      <div className="relative mx-auto -mt-2 max-w-[560px]">
        <h2 className="font-display text-[clamp(24px,2.6vw,34px)] font-semibold tracking-[-0.02em] text-[#0b1040] dark:text-foreground">{title}</h2>
        <p className="mt-2 text-[clamp(15px,1.4vw,18px)] leading-[1.5] text-[#6470a8] dark:text-muted-foreground">{text}</p>
        {cta && (
          <button type="button" onClick={cta.onClick}
            className="mt-6 inline-flex h-[54px] items-center gap-2.5 rounded-[16px] bg-gradient-to-r from-[#5b5cf6] to-[#a24bf5] px-8 text-[17px] font-semibold text-white shadow-[0_12px_28px_rgba(106,76,255,.35)] transition hover:brightness-110 active:scale-[.98]">
            <Plus className="h-5 w-5" /> {cta.label}
          </button>
        )}
        {secondary && <div className="mt-4 text-[14px] text-[#6470a8] dark:text-muted-foreground">{secondary}</div>}
      </div>
      <Sparkles aria-hidden className="absolute right-6 top-6 h-5 w-5 text-[#c9c2f5]" />
    </section>
  );
}
