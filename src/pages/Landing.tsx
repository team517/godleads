import { useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { PLAN_CONFIG, clientsFeature, emailsFeature } from "@/contexts/SubscriptionContext";
import "@/styles/onepulso-landing.css";

/* =============================================================================
   Landing pública de OnePulso.

   El ASPECTO es el del sistema de diseño "Primary" (DESIGN.md, extraído del
   proyecto de Claude Design del propietario): Bricolage Grotesque en titulares,
   Inter en el cuerpo, radio 6px, bordes lavanda, sombras tintadas de navy y un
   violeta #6E58F1 como único acento. El MENSAJE es el que ya tenía la página
   (español, producto de correo en frío) y los enlaces son los reales de la app.

   Todo el color sale de tokens (`bg-card`, `text-muted-foreground`,
   `border-border`, `bg-primary`, `shadow-rest/raised/float/modal/primary`), así
   que la página es clara de serie pero no se rompe si `.dark` está puesto.
   Los keyframes del diseño viven en `@/styles/onepulso-landing.css`.
   ========================================================================== */

const SIGNUP = "/auth?mode=signup";
const LOGIN = "/auth";
const CONTACT = "mailto:team@onepulso.online";

/* ── Piezas del sistema de diseño, tal como las especifica DESIGN.md ─────── */
const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-primary px-[18px] py-[10px] text-[15px] font-semibold text-primary-foreground shadow-btn transition-colors hover:bg-primary-hover";
const BTN_PRIMARY_LG =
  "inline-flex items-center justify-center rounded-lg bg-primary px-[26px] py-[14px] text-[16px] font-semibold text-primary-foreground shadow-btn transition-colors hover:bg-primary-hover";
const BTN_SECONDARY =
  "inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-[9px] text-[15px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary";
const BTN_SECONDARY_LG =
  "inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-[13px] text-[16px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary";
const PILL =
  "inline-flex items-center rounded-full border border-border bg-card px-[14px] py-[7px] text-[13px] font-semibold text-primary shadow-rest";
const MINI_TAG =
  "inline-flex items-center rounded-full bg-accent px-2 py-[3px] text-[10.5px] font-semibold text-accent-foreground";
const SHELL = "mx-auto w-full max-w-[1230px] px-6";
const H2 =
  "font-display text-[clamp(30px,4vw,50px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground [text-wrap:balance]";
const H2_SPLIT =
  "font-display text-[clamp(30px,4vw,48px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground [text-wrap:balance]";
const LEAD = "text-[18px] leading-[1.55] text-secondary-foreground";
const BODY = "text-[16px] leading-[1.5] text-secondary-foreground";
const CARD = "rounded-[8px] border border-border bg-card shadow-rest";
/* Panel "ventana de producto": el marco de 10px con sombra flotante. */
const PANEL = "relative overflow-hidden rounded-[10px] border border-border bg-card shadow-float";

/* ── Secciones para el índice pegajoso y el rastreo al hacer scroll ──────── */
const SECTIONS = [
  { id: "producto", label: "Plataforma" },
  { id: "infraestructura", label: "Infraestructura" },
  { id: "flujo", label: "Cómo funciona" },
  { id: "entregabilidad", label: "Entregabilidad" },
  { id: "prospeccion", label: "Prospección" },
  { id: "bandeja", label: "Bandeja maestra" },
  { id: "precios", label: "Precios" },
];

/* ── Datos del mock de la bandeja: los mismos leads que ya mostraba ──────── */
type Lead = { name: string; email: string; time: string; subject: string; intent: string };

const LEADS: Lead[] = [
  {
    name: "Jose Hernández Baena",
    email: "jose@ctomasgracia.com",
    time: "19 jun · 12:33",
    subject: "Re: Una idea para vuestro outbound",
    intent: "Intención de compra · alta",
  },
  {
    name: "Joaquín Villalba",
    email: "joaquin@nextail.co",
    time: "19 jun · 09:42",
    subject: "Re: ¿Hablamos esta semana?",
    intent: "Reunión solicitada",
  },
  {
    name: "Nil Busqué Rodríguez",
    email: "nil@vasava.es",
    time: "18 jun · 18:28",
    subject: "Re: Propuesta de colaboración",
    intent: "En seguimiento",
  },
  {
    name: "Sergi Martínez Juanas",
    email: "sergi.martinez@agoragp.com",
    time: "18 jun · 13:39",
    subject: "Re: Demo de la plataforma",
    intent: "Pidió más info",
  },
];

const BODY_LINES = [
  ["96%", "88%", "92%", "70%", "40%"],
  ["90%", "94%", "62%", "84%", "48%"],
  ["98%", "72%", "90%", "80%", "36%"],
  ["86%", "92%", "78%", "94%", "52%"],
];

/* ── Iconos en línea (el diseño original referenciaba imágenes que no
      podemos resolver, así que se dibujan con SVG/CSS) ──────────────────── */
type IconProps = { className?: string };

const MailIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 8 9 6 9-6" />
  </svg>
);
const ShieldIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3 5 6v5c0 4.2 2.9 8.1 7 9 4.1-.9 7-4.8 7-9V6z" />
  </svg>
);
const KeyIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const GaugeIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 16a8 8 0 1 1 16 0" />
    <path d="m12 16 4-5" />
  </svg>
);
const CheckIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);
const InboxIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);
const UsersIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
  </svg>
);
const SendIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m3 11 18-5v12L3 14v-3z" />
  </svg>
);
const ChartIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 3v18h18" />
    <path d="m7 14 4-4 3 3 5-6" />
  </svg>
);

/* Avatar sin imagen: inicial sobre superficie lavanda. */
function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-full border border-border bg-accent font-semibold text-accent-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {name.charAt(0)}
    </span>
  );
}

/* =============================================================================
   Cabecera pegajosa translúcida
   ========================================================================== */
function Header() {
  return (
    <header className="sticky top-0 z-30 bg-[hsl(var(--card)/0.88)] shadow-[0_2px_4px_rgba(0,0,0,0.06)] backdrop-blur-[8px]">
      <div className="mx-auto flex h-[68px] w-full max-w-[1230px] items-center gap-10 px-6">
        <a href="#top" className="flex flex-none items-center gap-[9px]">
          <Wordmark className="h-[18px]" colorClassName="text-foreground" />
        </a>
        {/* Navegación: 15px, peso 500, navy #1D293D, separación 4px. */}
        <nav className="hidden flex-1 items-center gap-1 text-[15px] font-medium text-[hsl(var(--op-nav))] md:flex">
          <a href="#producto" className="rounded px-[10px] py-[6px] transition-colors hover:bg-accent hover:text-accent-foreground">
            Producto
          </a>
          <a href="#entregabilidad" className="rounded px-[10px] py-[6px] transition-colors hover:bg-accent hover:text-accent-foreground">
            Entregabilidad
          </a>
          <a href="#bandeja" className="rounded px-[10px] py-[6px] transition-colors hover:bg-accent hover:text-accent-foreground">
            Bandeja
          </a>
          <a href="#precios" className="rounded px-[10px] py-[6px] transition-colors hover:bg-accent hover:text-accent-foreground">
            Precios
          </a>
          <a href="#faq" className="rounded px-[10px] py-[6px] transition-colors hover:bg-accent hover:text-accent-foreground">
            Preguntas
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <a href={LOGIN} className="text-[15px] font-medium text-secondary-foreground transition-colors hover:text-primary">
            Iniciar sesión
          </a>
          <a href={CONTACT} className={`${BTN_SECONDARY} hidden sm:inline-flex`}>
            Hablar con ventas
          </a>
          <a href={SIGNUP} className={BTN_PRIMARY}>
            Empezar gratis
          </a>
        </div>
      </div>
    </header>
  );
}

/* =============================================================================
   Hero: pastilla de cejilla, h1 con blurFadeIn palabra a palabra y CTAs reales
   ========================================================================== */
const HERO_WORDS = ["Todo", "el", "outbound.", "Un", "solo", "flujo."];

function Hero() {
  return (
    <section
      id="top"
      className="relative pt-24"
      style={{
        background:
          "radial-gradient(191.62% 100% at 50% 0%, hsl(var(--card)) 0%, hsl(var(--primary)/0.22) 68.61%, hsl(var(--background)/0) 100%)",
      }}
    >
      <div className={`${SHELL} text-center`}>
        <span data-anim className={PILL} style={{ animation: "blurFadeIn .7s both" }}>
          Outbound con IA · desde 2021
        </span>
        <h1 className="mx-auto mt-6 max-w-[18ch] font-display text-[clamp(30px,4vw,50px)] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground [text-wrap:balance]">
          {HERO_WORDS.map((word, i) => (
            <span
              key={word + i}
              data-anim
              className="inline-block"
              style={{ animation: `blurFadeIn .7s ${0.05 + i * 0.09}s both` }}
            >
              {word === "outbound." ? (
                <span className="bg-gradient-brand bg-clip-text text-transparent">outbound.</span>
              ) : word === "flujo." ? (
                <span className="text-primary">flujo.</span>
              ) : (
                word
              )}
              &nbsp;
            </span>
          ))}
        </h1>
        <p className={`mx-auto mt-6 max-w-[640px] ${LEAD}`}>
          Prospecta, calienta, envía y cierra desde una sola plataforma. Una infraestructura de entregabilidad construida
          para que tus correos lleguen a la bandeja principal — no al ruido.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href="#producto" className={BTN_SECONDARY_LG}>
            Ver cómo funciona
          </a>
          <a href={SIGNUP} className={BTN_PRIMARY_LG}>
            Empezar gratis
          </a>
        </div>
        <p className="mt-4 text-[14px] text-muted-foreground">Prueba gratis · sin tarjeta</p>
      </div>

      {/* Tira de confianza con el ciclo de etiquetas (logoCycle / logoCycleB) */}
      <div className={`${SHELL} mt-14`}>
        <div className="mb-[26px] text-center text-[15px] font-medium text-secondary-foreground">
          Con la confianza de 100.000+ equipos de outbound
        </div>
        <div className="grid grid-cols-2 gap-2 border-y border-border md:grid-cols-3 lg:grid-cols-6">
          {[
            ["Calentamiento con IA", "Buzones ilimitados"],
            ["Entregabilidad propia", "IPs limpias"],
            ["Prospección verificada", "Triple verificación"],
            ["Bandeja maestra", "Multicliente"],
            ["Secuencias con IA", "Agentes 24/7"],
            ["DNS automático", "SPF · DKIM · DMARC"],
          ].map(([a, b], i) => (
            <div key={a} className="relative h-[68px]">
              <span
                className="absolute inset-0 flex items-center justify-center px-2 text-center text-[15px] font-semibold tracking-[-0.02em] text-muted-foreground"
                style={{ animation: `logoCycle 7s ${i * 0.4}s infinite` }}
              >
                {a}
              </span>
              <span
                className="absolute inset-0 flex items-center justify-center px-2 text-center text-[15px] font-semibold tracking-[-0.02em] text-muted-foreground"
                style={{ animation: `logoCycleB 7s ${i * 0.4}s infinite` }}
              >
                {b}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Ventana de producto: la bandeja maestra, dibujada con CSS */}
      <div className={`${SHELL} pt-12`}>
        <InboxWindow height={520} />
      </div>
    </section>
  );
}

/* =============================================================================
   Índice pegajoso con rastreo de la sección visible
   ========================================================================== */
function SectionNav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const spy = () => {
      let current: string | null = null;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= 220 && r.bottom > 220) current = s.id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", spy, { passive: true });
    spy();
    return () => window.removeEventListener("scroll", spy);
  }, []);

  return (
    <div className="sticky top-[68px] z-20 mt-10 bg-[linear-gradient(180deg,hsl(var(--background)/0.82)_0%,hsl(var(--background)/0.82)_82%,hsl(var(--background)/0)_100%)] py-6 backdrop-blur-[2px]">
      <div className={`${SHELL} flex flex-wrap justify-center gap-[10px]`}>
        {SECTIONS.map((s) => {
          const on = active === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`whitespace-nowrap rounded-lg border bg-card px-4 py-[9px] text-[14px] font-semibold transition-colors ${
                on ? "border-primary/50 text-primary shadow-[inset_0_-7px_11px_hsl(var(--primary)/0.24)]" : "border-border text-secondary-foreground"
              }`}
            >
              {s.label}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* =============================================================================
   Mock de la bandeja maestra (sustituye a la captura del diseño original)
   ========================================================================== */
function InboxWindow({ height = 480 }: { height?: number }) {
  const [sel, setSel] = useState(0);
  const lead = LEADS[sel];

  return (
    <div className={PANEL} style={{ boxShadow: "var(--shadow-modal)" }}>
      <div className="grid" style={{ gridTemplateColumns: "48px 226px 1fr", height }}>
        {/* Raíl de navegación */}
        <div className="flex flex-col items-center gap-[22px] border-r border-border bg-accent py-4">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-primary text-primary-foreground">
            <InboxIcon className="h-[15px] w-[15px]" />
          </span>
          <UsersIcon className="h-[17px] w-[17px] text-primary/50" />
          <SendIcon className="h-[17px] w-[17px] text-primary/50" />
          <MailIcon className="h-[17px] w-[17px] text-primary/50" />
          <ChartIcon className="h-[17px] w-[17px] text-primary/50" />
        </div>

        {/* Lista de respuestas */}
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="border-b border-border px-4 pb-[10px] pt-[14px]">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Para mí</div>
            <div className="flex items-center justify-between">
              <span className="font-display text-[18px] font-semibold tracking-[-0.02em] text-foreground">Bandeja</span>
              <span className="text-[11px] text-muted-foreground">{LEADS.length}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {LEADS.map((l, i) => (
              <button
                key={l.email}
                type="button"
                onClick={() => setSel(i)}
                className={`block w-full border-b border-border px-4 py-[13px] text-left transition-colors ${
                  i === sel ? "border-l-[3px] border-l-primary bg-accent" : "border-l-[3px] border-l-transparent bg-card hover:bg-accent/50"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-foreground">{l.name}</span>
                  <span className="whitespace-nowrap text-[10.5px] text-muted-foreground">{l.time}</span>
                </div>
                <div className="mt-[2px] truncate text-[12px] text-primary">{l.email}</div>
                <div className="mt-[7px] text-[12px] text-muted-foreground">Respondió el lead</div>
                <span className={`mt-[9px] ${MINI_TAG} gap-[5px]`}>
                  <span className="h-[5px] w-[5px] rounded-full bg-primary" />
                  Prueba
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Detalle */}
        <div className="flex min-h-0 flex-col bg-background px-[26px] py-[22px] max-[900px]:hidden">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <div className="font-display text-[18px] font-semibold tracking-[-0.02em] text-foreground">{lead.name}</div>
              <div className="mt-[2px] text-[12px] text-primary">{lead.email}</div>
            </div>
            <span className="text-[11px] text-muted-foreground">{lead.time}</span>
          </div>
          <div className="my-[18px] font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">{lead.subject}</div>
          <div className="flex flex-col gap-[9px]">
            {BODY_LINES[sel].map((w, i) => (
              <div
                key={i}
                className={`h-[9px] rounded-full ${i === 1 ? "bg-accent" : "bg-muted"}`}
                style={{ width: w }}
              />
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
            <div className="flex items-center gap-[9px] rounded-full bg-accent px-3 py-[6px] text-[12px] font-semibold text-accent-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" style={{ animation: "pulseDot 1.8s ease-in-out infinite" }} />
              {lead.intent}
            </div>
            <svg width="118" height="42" viewBox="0 0 118 42" fill="none" aria-hidden="true">
              <polyline
                points="2,34 22,28 40,30 58,18 76,22 96,8 116,12"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="96" cy="8" r="3" fill="hsl(var(--primary))" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   Visuales animados que van DENTRO de las tarjetas de "Plataforma"
   ========================================================================== */
const MAILBOX_ROWS = [
  { name: "Olivia Bennett", role: "Operaciones de GTM" },
  { name: "Daniel Foster", role: "Dirección de ingresos" },
  { name: "Michael Carter", role: "Dirección comercial" },
  { name: "Hailey Rogers", role: "Marketing" },
];

function MailboxListVisual() {
  return (
    <div className="relative mt-auto h-[272px] overflow-hidden rounded-t-[8px] border border-b-0 border-border bg-gradient-to-b from-background to-accent px-[14px] pt-[14px]">
      <div className="mb-[10px] flex items-center gap-2">
        <MailIcon className="h-[15px] w-[15px] text-primary" />
        <span className="text-[12px] font-semibold text-secondary-foreground">Buzones conectados</span>
        <span className="ml-auto flex items-center gap-[5px] text-[11px] font-semibold text-success">
          <span className="block h-[6px] w-[6px] rounded-full bg-success" style={{ animation: "pulseDot 1.8s ease-in-out infinite" }} />
          En directo
        </span>
      </div>
      <div
        className="relative h-[218px] overflow-hidden"
        style={{
          maskImage: "linear-gradient(180deg,transparent 0%,#000 9%,#000 62%,transparent 100%)",
          WebkitMaskImage: "linear-gradient(180deg,transparent 0%,#000 9%,#000 62%,transparent 100%)",
        }}
      >
        <div className="flex flex-col gap-2" style={{ animation: "listUp 16s linear infinite", willChange: "transform" }}>
          {[...MAILBOX_ROWS, ...MAILBOX_ROWS].map((r, i) => (
            <div key={i} className="flex items-center gap-[10px] rounded-lg border border-border bg-card px-[10px] py-2">
              <Avatar name={r.name} />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold text-foreground">{r.name}</span>
                <span className="block text-[11px] text-muted-foreground">{r.role}</span>
              </span>
              <span className="ml-auto flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] border border-success/30 bg-success/10 text-success">
                <CheckIcon className="h-[11px] w-[11px]" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WarmupGaugeVisual() {
  return (
    <div className="mt-auto flex h-[272px] flex-col items-center overflow-hidden rounded-t-[8px] border border-b-0 border-border bg-gradient-to-b from-background to-accent px-[14px] pt-[14px]">
      <svg viewBox="0 0 200 118" className="block h-[118px] w-[206px] flex-none" aria-hidden="true">
        <defs>
          <linearGradient id="op-gauge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="55%" stopColor="hsl(var(--info))" />
            <stop offset="100%" stopColor="hsl(var(--brand-teal))" />
          </linearGradient>
        </defs>
        <path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="hsl(var(--border))" strokeWidth="13" strokeLinecap="round" />
        <path
          d="M10,100 A90,90 0 0 1 190,100"
          fill="none"
          stroke="url(#op-gauge)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray="283"
          style={{ strokeDashoffset: 283, animation: "gaugeSweep 7s cubic-bezier(.4,0,.2,1) infinite" }}
        />
        <g style={{ transformOrigin: "100px 100px", transformBox: "view-box", animation: "needleSweep 7s cubic-bezier(.4,0,.2,1) infinite" }}>
          <line x1="100" y1="100" x2="100" y2="60" stroke="hsl(var(--brand-sky))" strokeWidth="5" strokeLinecap="round" />
          <circle cx="100" cy="58" r="8" fill="hsl(var(--brand-teal))" />
        </g>
        <circle cx="100" cy="100" r="11" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="3" />
      </svg>
      <div className="mt-[2px] flex items-baseline gap-2">
        <span className="block h-[29px] overflow-hidden">
          <span className="block" style={{ animation: "numStrip 7s steps(4, end) infinite", willChange: "transform" }}>
            {["12%", "31%", "48%", "66%", "78%"].map((n) => (
              <span key={n} className="block h-[29px] font-display text-[24px] font-semibold leading-[29px] tracking-[-0.03em] text-foreground">
                {n}
              </span>
            ))}
          </span>
        </span>
        <span className="text-[12.5px] text-secondary-foreground">de llegada a bandeja</span>
      </div>
      <div className="my-[2px] mb-3 text-[12px] text-muted-foreground">Rampa lenta en marcha</div>
      <div className="grid w-full grid-cols-3 gap-2">
        {[
          ["Día 1", "10%", "12 correos", "0.2s"],
          ["Día 3", "28%", "30 correos", "0.9s"],
          ["Día 5", "54%", "60 correos", "1.6s"],
        ].map(([day, pct, vol, delay]) => (
          <div key={day} className="rounded-lg border border-border bg-card px-[9px] py-2" style={{ animation: `riseIn 7s ease-in-out ${delay} infinite` }}>
            <span className="mb-1 flex items-center gap-[5px]">
              <GaugeIcon className="h-3 w-3 text-primary" />
              <span className="text-[10.5px] font-semibold text-secondary-foreground">{day}</span>
              <span className="ml-auto text-[10px] font-semibold text-success">Bien</span>
            </span>
            <span className="block text-[16px] font-semibold tracking-[-0.02em] text-foreground">{pct}</span>
            <span className="block text-[10.5px] text-muted-foreground">{vol}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MasterInboxVisual() {
  return (
    <div className="relative mt-auto h-[272px] overflow-hidden rounded-t-[8px] border border-b-0 border-border bg-gradient-to-b from-background to-accent px-[14px] pt-[14px]">
      <div className="h-full rounded-t-[8px] border border-border bg-card p-3 shadow-[0_-2px_10px_rgba(21,17,60,0.04)]">
        <div className="flex min-w-0 items-center gap-2 border-b border-border pb-[10px]">
          <InboxIcon className="h-[17px] w-[17px] flex-none text-primary" />
          <span className="truncate text-[13px] font-semibold text-foreground">Bandeja maestra</span>
          <span className={`ml-auto flex-none whitespace-nowrap ${MINI_TAG}`}>4 nuevas</span>
        </div>
        <div className="flex flex-col gap-2 pt-[10px]">
          <div className="min-w-0 rounded-lg border border-primary/30 bg-accent/40 px-[10px] py-[9px]" style={{ animation: "riseIn 8s ease-in-out .2s infinite" }}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold text-foreground">Re: ¿Hablamos esta semana?</span>
              <span
                className="ml-auto flex-none whitespace-nowrap rounded bg-info px-[7px] py-[3px] text-[10px] font-semibold text-info-foreground"
                style={{ animation: "badgePop 8s ease-in-out .9s infinite" }}
              >
                Respondió
              </span>
            </span>
            <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">Hola, sí — el outbound es algo que…</span>
          </div>
          <div className="min-w-0 rounded-lg border border-border px-[10px] py-[9px]" style={{ animation: "riseIn 8s ease-in-out 1.4s infinite" }}>
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name="Michael Thompson" size={22} />
              <span className="truncate text-[12px] font-semibold text-foreground">Michael Thompson</span>
              <span className="ml-auto flex-none text-[10px] text-muted-foreground">08:24</span>
            </span>
            <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">Re: merece un repaso — ¿horarios de envío?</span>
          </div>
          <div className="min-w-0 rounded-lg border border-border px-[10px] py-[9px]" style={{ animation: "riseIn 8s ease-in-out 2.6s infinite" }}>
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name="Sarah Collins" size={22} />
              <span className="truncate text-[12px] font-semibold text-foreground">Sarah Collins</span>
              <span className="ml-auto flex-none rounded bg-success/10 px-[7px] py-[3px] text-[10px] font-semibold text-success">Interesado</span>
            </span>
            <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">¿Podéis el jueves por la mañana?</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   Pestañas que rotan solas (infraestructura y prospección)
   ========================================================================== */
type Tab = { title: string; body: string; panel: ReactNode };

function RotatingTabs({ tabs }: { tabs: Tab[] }) {
  const [i, setI] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const step = (60 / 6000) * 100;
    const timer = window.setInterval(() => {
      setProgress((p) => {
        const next = p + step;
        if (next >= 100) {
          setI((cur) => (cur + 1) % tabs.length);
          return 0;
        }
        return next;
      });
    }, 60);
    return () => window.clearInterval(timer);
  }, [tabs.length]);

  const pick = (n: number) => {
    setI(n);
    setProgress(0);
  };

  return (
    <div data-split className="grid items-center gap-16 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div data-split-copy className="flex flex-col">
        {tabs.map((t, n) => (
          <button
            key={t.title}
            type="button"
            onClick={() => pick(n)}
            className="cursor-pointer border-b border-muted py-6 text-left transition-opacity"
            style={{ opacity: n === i ? 1 : 0.45 }}
          >
            <div className="relative flex items-center gap-3 pb-[14px]">
              <span className={`h-[9px] w-[9px] flex-none rounded-full ${n === 0 ? "bg-primary" : n === 1 ? "bg-info" : "bg-success"}`} />
              <span className="text-[19px] font-semibold tracking-[-0.02em] text-foreground">{t.title}</span>
              <span className="absolute bottom-0 left-0 h-[2px] w-full bg-foreground/[0.06]">
                <span
                  className="block h-full rounded-[2px] bg-primary"
                  style={{ width: n === i ? `${progress}%` : "0%" }}
                />
              </span>
            </div>
            <p className={`mt-3 ${BODY}`}>{t.body}</p>
          </button>
        ))}
      </div>
      <div data-split-media className={`relative h-[480px] ${PANEL}`}>
        {tabs.map((t, n) => (
          <div
            key={t.title}
            className="absolute inset-0 transition-opacity duration-500"
            style={{ opacity: n === i ? 1 : 0, pointerEvents: n === i ? "auto" : "none" }}
          >
            {t.panel}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Paneles de los carruseles: mocks de CSS, no capturas. */
function PanelFrame({ title, chip, children }: { title: string; chip?: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card px-5 py-[14px]">
        <span className="h-[9px] w-[9px] rounded-full bg-primary" />
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        {chip ? <span className={`ml-auto ${MINI_TAG}`}>{chip}</span> : null}
      </div>
      <div className="flex-1 overflow-hidden p-5">{children}</div>
    </div>
  );
}

function ReputationPanel() {
  return (
    <PanelFrame title="Reputación de remitente" chip="Inquilino dedicado">
      <div className="grid grid-cols-2 gap-3">
        {[
          ["IP dedicada", "Sólo tu tráfico"],
          ["Servidor propio", "Sin vecinos"],
          ["Rotación", "Reparto entre remitentes"],
          ["Credibilidad", "Dominio bajo control"],
        ].map(([k, v], n) => (
          <div key={k} className={`${CARD} p-4`} style={{ animation: `riseIn 9s ease-in-out ${n * 0.5}s infinite` }}>
            <div className="text-[13px] font-semibold text-foreground">{k}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">{v}</div>
          </div>
        ))}
      </div>
      <div className={`mt-4 ${CARD} p-5`}>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-foreground">Entregas en bandeja principal</span>
          <span className="font-display text-[22px] font-semibold tracking-[-0.03em] text-primary">98,4%</span>
        </div>
        <svg viewBox="0 0 300 90" className="h-[90px] w-full" aria-hidden="true">
          <polyline
            points="4,74 44,66 84,68 124,44 164,50 204,26 244,30 296,14"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="296" cy="14" r="4" fill="hsl(var(--primary))" style={{ animation: "floatY 3.2s ease-in-out infinite" }} />
        </svg>
      </div>
    </PanelFrame>
  );
}

const AUTH_ROWS: { icon: ReactNode; title: string; sub: string; delay: string }[] = [
  { icon: <ShieldIcon className="h-[18px] w-[18px] text-primary" />, title: "SPF publicado", sub: "v=spf1 include:… -all", delay: "0.3s" },
  { icon: <KeyIcon className="h-[18px] w-[18px] text-success" />, title: "DKIM verificado", sub: "2 claves · 2048 bits", delay: "1s" },
  { icon: <ShieldIcon className="h-[18px] w-[18px] text-info" />, title: "DMARC alineado", sub: "p=quarantine · rua", delay: "1.7s" },
  { icon: <GaugeIcon className="h-[18px] w-[18px] text-primary" />, title: "Calentamiento activo", sub: "Rampa lenta día a día", delay: "2.4s" },
];

function AuthPanel() {
  return (
    <PanelFrame title="Autenticación del dominio" chip="Automático">
      <div className="flex flex-col gap-3">
        {AUTH_ROWS.map((r) => (
          <div key={r.title} className="flex items-center gap-3 rounded-[8px] border border-border bg-card px-3 py-[10px]">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[8px] border border-border bg-accent">{r.icon}</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-foreground">{r.title}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{r.sub}</span>
            </span>
            <span
              className="ml-auto flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-success text-success-foreground"
              style={{ animation: `checkIn 7s ease-in-out ${r.delay} infinite` }}
            >
              <CheckIcon className="h-[13px] w-[13px]" />
            </span>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

function MonitoringPanel() {
  return (
    <PanelFrame title="Monitorización" chip="Tiempo real">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Rebotes", "0,4%", "text-success"],
          ["Marcas de spam", "0,0%", "text-success"],
          ["Respuestas", "12,8%", "text-primary"],
        ].map(([k, v, tone]) => (
          <div key={k} className={`${CARD} p-4`}>
            <div className="text-[12px] text-muted-foreground">{k}</div>
            <div className={`mt-1 font-display text-[22px] font-semibold tracking-[-0.03em] ${tone}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className={`mt-4 ${CARD} p-5`}>
        <div className="mb-4 text-[13px] font-semibold text-foreground">Volumen por día</div>
        <div className="flex h-[150px] items-end gap-[6px]">
          {[38, 52, 44, 66, 58, 74, 62, 86, 78, 94, 88, 100].map((h, n) => (
            <span
              key={n}
              className="flex-1 rounded-t-[3px] bg-primary/70"
              style={{ height: `${h}%`, animation: `riseIn 9s ease-in-out ${n * 0.12}s infinite` }}
            />
          ))}
        </div>
      </div>
    </PanelFrame>
  );
}

function LeadCreditsPanel() {
  return (
    <PanelFrame title="Leads del plan" chip="3 correos = 1 lead">
      <div className={`${CARD} p-5`}>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-foreground">Leads ganados este mes</span>
          <span className="font-display text-[28px] font-semibold tracking-[-0.03em] text-primary">1.240</span>
        </div>
        <div className="mt-4 h-[10px] w-full overflow-hidden rounded-full bg-muted">
          <span className="block h-full w-[72%] rounded-full bg-primary" />
        </div>
        <div className="mt-2 text-[12px] text-muted-foreground">Crece al ritmo al que envías</div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {MAILBOX_ROWS.map((r, n) => (
          <div key={r.name} className="flex items-center gap-3 rounded-[8px] border border-border bg-card px-3 py-[10px]" style={{ animation: `riseIn 9s ease-in-out ${n * 0.6}s infinite` }}>
            <Avatar name={r.name} size={30} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-foreground">{r.name}</span>
              <span className="block text-[11.5px] text-muted-foreground">{r.role}</span>
            </span>
            <span className="ml-auto rounded bg-success/10 px-2 py-[3px] text-[10.5px] font-semibold text-success">Verificado</span>
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

function VerificationPanel() {
  return (
    <PanelFrame title="Triple verificación" chip="Antes de entrar en campaña">
      <div className="flex flex-col gap-3">
        {["Primera fuente", "Segunda fuente", "Tercera fuente"].map((s, n) => (
          <div key={s} className="flex items-center gap-3 rounded-[8px] border border-border bg-card px-4 py-[14px]">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border bg-accent text-[13px] font-semibold text-accent-foreground">
              {n + 1}
            </span>
            <span className="text-[15px] font-semibold text-foreground">{s}</span>
            <span
              className="ml-auto flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-success text-success-foreground"
              style={{ animation: `checkIn 7s ease-in-out ${0.3 + n * 0.7}s infinite` }}
            >
              <CheckIcon className="h-[13px] w-[13px]" />
            </span>
          </div>
        ))}
      </div>
      <div className={`mt-4 ${CARD} flex items-baseline justify-between p-5`}>
        <span className="text-[13px] font-semibold text-foreground">Direcciones descartadas</span>
        <span className="font-display text-[22px] font-semibold tracking-[-0.03em] text-foreground">antes de enviar</span>
      </div>
    </PanelFrame>
  );
}

function BouncePanel() {
  return (
    <PanelFrame title="Rebotes bajo control" chip="Lista de exclusión">
      <div className={`${CARD} p-5`}>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-foreground">Tasa de rebote</span>
          <span className="font-display text-[28px] font-semibold tracking-[-0.03em] text-success">0,4%</span>
        </div>
        <div className="mt-4 flex h-[120px] items-end gap-2">
          {[26, 20, 15, 12, 9, 7, 5, 4].map((h, n) => (
            <span key={n} className="flex-1 rounded-t-[3px] bg-success/60" style={{ height: `${h * 3}%`, animation: `riseIn 9s ease-in-out ${n * 0.15}s infinite` }} />
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {["Dirección inválida · excluida", "Dominio sin MX · excluido", "Baja solicitada · respetada"].map((t, n) => (
          <div key={t} className="flex items-center gap-3 rounded-[8px] border border-border bg-card px-4 py-3 text-[13px] text-secondary-foreground" style={{ animation: `riseIn 9s ease-in-out ${n * 0.8}s infinite` }}>
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-muted-foreground" />
            {t}
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}

function WarmupPanel() {
  return (
    <PanelFrame title="Panel de calentamiento" chip="Pool privado">
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Aperturas", "de cuentas reales"],
          ["Lecturas", "a horas irregulares"],
          ["Respuestas", "con hilo de verdad"],
          ["Reputación", "sube día a día"],
        ].map(([k, v], n) => (
          <div key={k} className={`${CARD} p-4`} style={{ animation: `riseIn 9s ease-in-out ${n * 0.5}s infinite` }}>
            <div className="text-[13px] font-semibold text-foreground">{k}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">{v}</div>
          </div>
        ))}
      </div>
      <div className={`mt-4 ${CARD} p-4`}>
        <WarmupGaugeInner />
      </div>
    </PanelFrame>
  );
}

/* El indicador del calentamiento, reutilizado dentro del panel grande. */
function WarmupGaugeInner() {
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 118" className="block h-[118px] w-[206px]" aria-hidden="true">
        <defs>
          <linearGradient id="op-gauge-2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="55%" stopColor="hsl(var(--info))" />
            <stop offset="100%" stopColor="hsl(var(--brand-teal))" />
          </linearGradient>
        </defs>
        <path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="hsl(var(--border))" strokeWidth="13" strokeLinecap="round" />
        <path
          d="M10,100 A90,90 0 0 1 190,100"
          fill="none"
          stroke="url(#op-gauge-2)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray="283"
          style={{ strokeDashoffset: 283, animation: "gaugeSweep 7s cubic-bezier(.4,0,.2,1) infinite" }}
        />
        <g style={{ transformOrigin: "100px 100px", transformBox: "view-box", animation: "needleSweep 7s cubic-bezier(.4,0,.2,1) infinite" }}>
          <line x1="100" y1="100" x2="100" y2="60" stroke="hsl(var(--brand-sky))" strokeWidth="5" strokeLinecap="round" />
          <circle cx="100" cy="58" r="8" fill="hsl(var(--brand-teal))" />
        </g>
        <circle cx="100" cy="100" r="11" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="3" />
      </svg>
      <div className="text-[12px] text-muted-foreground">Rampa lenta en marcha</div>
    </div>
  );
}

/* =============================================================================
   Secciones de contenido
   ========================================================================== */
function SectionHeading({ pill, title }: { pill: string; title: string }) {
  return (
    <div className="mb-12 flex flex-col items-center gap-5">
      <span className={PILL}>{pill}</span>
      <h2 className={`${H2} text-center`}>{title}</h2>
    </div>
  );
}

function Plataforma() {
  return (
    <section id="producto" className="pb-[88px] pt-16">
      <div className={SHELL}>
        <h2 className={`${H2} mb-12 text-center`}>Escala el outbound sin límites</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Cuentas y almacenamiento ilimitados",
              body: "Conecta tantos buzones como necesites y guarda leads sin coste extra. Pagas por el envío, no por el espacio.",
              visual: <MailboxListVisual />,
            },
            {
              title: "Setup y calentamiento integrados",
              body: "OnePulso resuelve DNS, SPF, DKIM, DMARC y la rotación de remitentes automáticamente. Listo para enviar desde el primer día.",
              visual: <WarmupGaugeVisual />,
            },
            {
              title: "Bandeja maestra unificada",
              body: "Todas las respuestas de todas las campañas y clientes en un solo lugar. Categoriza por intención y sincroniza con tu CRM.",
              visual: <MasterInboxVisual />,
            },
          ].map((c) => (
            <article key={c.title} className={`${CARD} flex min-w-0 flex-col px-8 pb-0 pt-8`}>
              <h3 className="mb-3 text-[22px] font-semibold tracking-[-0.02em] text-foreground">{c.title}</h3>
              <p className={`mb-7 ${BODY}`}>{c.body}</p>
              {c.visual}
            </article>
          ))}
        </div>

        {/* Las otras tres capacidades, en tarjetas planas */}
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Prospección verificada",
              body: "Por cada tres correos que envías, ganas un lead verificado. Cada contacto se valida en tres fuentes para mantener los rebotes al mínimo.",
              tags: ["3x leads", "Triple verificación"],
            },
            {
              title: "Buzones para la bandeja principal",
              body: "IPs limpias e infraestructura de confianza mantienen tus correos fuera de spam. Reparte campañas entre proveedores sin cuellos de botella.",
              tags: ["IPs limpias", "Multiproveedor"],
            },
            {
              title: "Secuencias con agentes IA",
              body: "Agentes que investigan al lead, escriben el correo, actualizan el CRM y ajustan los tiempos de envío. Tú solo entras cuando toca cerrar.",
              tags: ["Sin código", "24/7"],
            },
          ].map((c) => (
            <article key={c.title} className={`${CARD} flex min-w-0 flex-col p-8`}>
              <h3 className="mb-3 text-[19px] font-semibold tracking-[-0.02em] text-foreground">{c.title}</h3>
              <p className="text-[15px] leading-[1.5] text-secondary-foreground">{c.body}</p>
              <div className="mt-auto flex flex-wrap gap-[6px] pt-5">
                {c.tags.map((t) => (
                  <span key={t} className={MINI_TAG}>
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Infraestructura() {
  return (
    <section id="infraestructura" className="pb-24 pt-6">
      <div className={SHELL}>
        <SectionHeading pill="Infraestructura" title="Un motor de envío hecho para el correo en frío" />
        <RotatingTabs
          tabs={[
            {
              title: "Tu reputación de remitente es tuya",
              body: "Infraestructura de inquilino dedicado e IPs propias ponen la entregabilidad bajo tu control — protegida de los errores de otros remitentes.",
              panel: <ReputationPanel />,
            },
            {
              title: "Autenticación resuelta por ti",
              body: "OnePulso configura y vigila SPF, DKIM y DMARC, y ajusta los patrones de envío a los límites de cada proveedor.",
              panel: <AuthPanel />,
            },
            {
              title: "Reputación vigilada en tiempo real",
              body: "Rebotes, marcas de spam y señales de reputación medidos en tiempo real, con el volumen ajustándose antes de que el daño se extienda.",
              panel: <MonitoringPanel />,
            },
          ]}
        />
      </div>
    </section>
  );
}

function Flujo() {
  const Connector = () => (
    <div data-connector className="flex w-[78px] flex-none items-center gap-[6px] px-[6px]">
      <span className="h-[9px] w-[9px] flex-none rotate-45 bg-brand-sky" />
      <span
        className="h-[2px] flex-1"
        style={{
          backgroundImage: "repeating-linear-gradient(90deg,hsl(var(--brand-sky)) 0 5px, transparent 5px 10px)",
          backgroundSize: "20px 2px",
          animation: "dashMove 1.1s linear infinite",
        }}
      />
      <span className="h-[9px] w-[9px] flex-none rotate-45 bg-brand-sky" />
    </div>
  );

  return (
    <section id="flujo" className="pb-24">
      <div className={SHELL}>
        <SectionHeading pill="Cómo funciona" title="Del primer envío a la bandeja principal" />
        <div
          className="relative rounded-[14px] border border-border p-8"
          style={{
            backgroundColor: "hsl(var(--background))",
            backgroundImage: "radial-gradient(var(--op-dot) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 rounded-[14px]"
            style={{
              background:
                "radial-gradient(90% 70% at 50% 30%, var(--op-veil) 0%, hsl(var(--background)/0.55) 60%, hsl(var(--background)/0) 100%)",
            }}
          />
          <div className="relative flex flex-wrap items-center justify-center gap-y-7">
            {/* 1 · La secuencia */}
            <div className="flex min-w-[300px] max-w-[380px] flex-1 flex-col gap-4">
              <div className="rounded-[10px] border border-border bg-card p-5 shadow-raised">
                <div className="relative pl-[38px]">
                  <span className="absolute bottom-[14px] left-[13px] top-[26px] w-0 border-l-2 border-dashed border-success/40" />
                  {[
                    ["Correo inicial", "Día 1"],
                    ["Seguimiento #1", "Día 2"],
                    ["Seguimiento #2", "Día 4"],
                  ].map(([step, day], n) => (
                    <div key={step}>
                      <div className="relative -ml-[38px] flex items-center gap-3">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
                          <MailIcon className="h-[14px] w-[14px]" />
                        </span>
                        <span className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">{step}</span>
                        <span className="ml-auto text-[13px] text-muted-foreground">{day}</span>
                      </div>
                      {n === 0 ? (
                        <div className="my-3 rounded-[8px] border border-border bg-background px-[14px] py-3">
                          <span className="mb-[6px] block text-[14px] font-semibold text-foreground">Una idea para vuestro outbound</span>
                          <span className="flex items-center gap-[7px] text-[12.5px] text-muted-foreground">
                            <MailIcon className="h-[13px] w-[13px] flex-none" />
                            <span className="truncate">Hola Jordan, soy Alex de OnePulso…</span>
                          </span>
                        </div>
                      ) : (
                        <div className="h-4" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[10px] border border-border bg-card px-5 py-[18px] shadow-raised">
                <div className="mb-[14px] flex items-center">
                  <span className="text-[15px] font-semibold text-foreground">Leads añadidos</span>
                  <span className="ml-auto text-[13px] font-semibold text-primary">+ Añadir</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex">
                    {MAILBOX_ROWS.map((r, n) => (
                      <span key={r.name} className={n ? "-ml-3" : ""}>
                        <Avatar name={r.name} size={44} />
                      </span>
                    ))}
                  </span>
                  <span className="ml-auto text-right">
                    <span className="block text-[12.5px] text-muted-foreground">Programados</span>
                    <span className="block font-display text-[24px] font-semibold tracking-[-0.03em] text-foreground">12+</span>
                  </span>
                </div>
              </div>
            </div>

            <Connector />

            {/* 2 · La autenticación */}
            <div className="flex min-w-[300px] max-w-[400px] flex-1 flex-col gap-3 rounded-[12px] border border-success/30 bg-card p-[22px] shadow-float">
              {[
                ["SPF conectado", "0.3s", "text-primary", "bg-accent"],
                ["DKIM verificado", "1s", "text-success", "bg-success/10"],
                ["DMARC alineado", "1.7s", "text-info", "bg-info/10"],
                ["Calentamiento activo", "2.4s", "text-primary", "bg-accent"],
              ].map(([label, delay, tone, tint]) => (
                <div key={label} className="flex items-center gap-3 rounded-[8px] border border-border bg-background px-3 py-[10px]">
                  <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-[8px] border border-border ${tint} ${tone}`}>
                    <ShieldIcon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[15.5px] font-semibold text-foreground">{label}</span>
                  <span
                    className="ml-auto flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-success text-success-foreground"
                    style={{ animation: `checkIn 7s ease-in-out ${delay} infinite` }}
                  >
                    <CheckIcon className="h-[13px] w-[13px]" />
                  </span>
                </div>
              ))}
            </div>

            <Connector />

            {/* 3 · Las respuestas */}
            <div className="flex min-w-[300px] flex-1 flex-col items-center gap-[10px]">
              {[
                { name: "Brian Turner", w: "84%", op: 0.45, d: "0.1s", size: 28, fs: "12.5px" },
                { name: "Michael Anderson", w: "92%", op: 0.72, d: "0.8s", size: 32, fs: "13.5px" },
                { name: "Sarah Johnson", w: "100%", op: 1, d: "1.5s", size: 38, fs: "15px" },
                { name: "Jessica Brown", w: "92%", op: 0.72, d: "2.2s", size: 32, fs: "13.5px" },
                { name: "Kevin Roberts", w: "84%", op: 0.45, d: "2.9s", size: 28, fs: "12.5px" },
              ].map((r) => (
                <div
                  key={r.name}
                  className="rounded-[8px] border border-border bg-card px-3 py-[10px] shadow-rest"
                  style={{ width: r.w, opacity: r.op, animation: `replyIn 7s ease-in-out ${r.d} infinite` }}
                >
                  <span className="flex items-center gap-[10px]">
                    <Avatar name={r.name} size={r.size} />
                    <span className="truncate font-semibold text-foreground" style={{ fontSize: r.fs }}>
                      {r.name}
                    </span>
                    <span className="ml-auto whitespace-nowrap rounded bg-success/10 px-2 py-[3px] text-[10.5px] font-semibold text-success">
                      Bandeja principal
                    </span>
                  </span>
                  <span className="mt-[6px] flex items-center gap-[7px] text-[12.5px] text-muted-foreground">
                    <MailIcon className="h-[13px] w-[13px] flex-none" />
                    <span className="truncate">Una idea para vuestro outbound</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Entregabilidad() {
  return (
    <section
      id="entregabilidad"
      className="border-y border-border py-24"
      style={{ background: "radial-gradient(120% 90% at 50% 0%, hsl(var(--accent)) 0%, hsl(var(--background)) 62%, hsl(var(--background)) 100%)" }}
    >
      <div data-split className={`${SHELL} grid items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]`}>
        <div data-split-copy>
          <span className={`${PILL} mb-5`}>Calentamiento</span>
          <h2 className={`${H2_SPLIT} mb-9`}>El motor que llega a la bandeja</h2>
          <div className="flex flex-col gap-7">
            {[
              [
                "Privado",
                "Pool de calentamiento exclusivo y basado en recompensas: las señales que gana tu dominio vienen de cuentas con historial.",
                "bg-primary",
              ],
              [
                "Humano",
                "Aperturas, lecturas y respuestas que parecen reales, a horas irregulares y con la profundidad de una conversación normal.",
                "bg-info",
              ],
              [
                "Limpio",
                "El calentamiento sigue funcionando por debajo de las campañas activas y mantiene los rebotes bajo control mientras sube el volumen.",
                "bg-success",
              ],
            ].map(([title, body, dot]) => (
              <div key={title} className="flex gap-[18px]">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] border border-border bg-accent">
                  <span className={`h-[14px] w-[14px] rounded-[4px] ${dot}`} />
                </span>
                <div>
                  <h4 className="mb-2 text-[19px] font-semibold tracking-[-0.02em] text-foreground">{title}</h4>
                  <p className={BODY}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div data-split-media className={`h-[520px] ${PANEL}`}>
          <WarmupPanel />
        </div>
      </div>
    </section>
  );
}

function Prospeccion() {
  return (
    <section id="prospeccion" className="py-24">
      <div className={SHELL}>
        <SectionHeading pill="Prospección" title="Llena el pipeline con compradores verificados" />
        <RotatingTabs
          tabs={[
            {
              title: "Leads incluidos en el plan",
              body: "Por cada tres correos que envías, ganas un lead verificado: la lista crece al ritmo al que envía el equipo.",
              panel: <LeadCreditsPanel />,
            },
            {
              title: "Verificados en tres fuentes",
              body: "Cada dirección se comprueba contra tres fuentes independientes antes de entrar en una campaña.",
              panel: <VerificationPanel />,
            },
            {
              title: "Rebotes al mínimo",
              body: "Las direcciones inválidas y las bajas se excluyen solas, así que el rebote no se come la reputación del dominio.",
              panel: <BouncePanel />,
            },
          ]}
        />
      </div>
    </section>
  );
}

function Bandeja() {
  return (
    <section
      id="bandeja"
      className="border-y border-border py-24"
      style={{ background: "radial-gradient(120% 90% at 50% 0%, hsl(var(--accent)) 0%, hsl(var(--background)) 62%, hsl(var(--background)) 100%)" }}
    >
      <div data-split className={`${SHELL} grid items-center gap-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]`}>
        <div data-split-media>
          <InboxWindow height={520} />
        </div>
        <div data-split-copy>
          <span className={`${PILL} mb-5`}>Bandeja maestra</span>
          <h2 className={`${H2_SPLIT} mb-9`}>Una bandeja para todo el negocio</h2>
          <div className="flex flex-col gap-7">
            {[
              [
                "Centraliza cada respuesta",
                "Todas las contestaciones, de todas las campañas y todos los clientes, en una sola bandeja compartida.",
              ],
              [
                "Organizado y receptivo",
                "Categoriza por intención, deja notas, programa seguimientos y aplica acciones en bloque.",
              ],
              [
                "Mantén los tratos en movimiento",
                "Un gestor con IA prioriza los leads calientes y sincroniza todo con tu CRM.",
              ],
            ].map(([title, body], n) => (
              <div key={title} className="flex gap-[18px]">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] border border-border bg-accent text-accent-foreground">
                  {n === 0 ? <InboxIcon className="h-5 w-5" /> : n === 1 ? <ChartIcon className="h-5 w-5" /> : <CheckIcon className="h-[18px] w-[18px]" />}
                </span>
                <div>
                  <h4 className="mb-2 text-[19px] font-semibold tracking-[-0.02em] text-foreground">{title}</h4>
                  <p className={BODY}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* Casos de éxito en el marquee del diseño (dos filas, sentidos opuestos). */
const CASES = [
  {
    name: "Danish Lead Co.",
    meta: "Agencia de leads · Copenhague",
    setup: "Buzones ilimitados + API · 9 meses",
    metric: "10k reuniones",
    sub: "de ventas generadas",
  },
  {
    name: "Sponja",
    meta: "B2B SaaS · Madrid",
    setup: "Calentamiento + secuencias · 5 semanas",
    metric: "50%",
    sub: "tasa de respuesta positiva",
  },
  {
    name: "LeadLead BangBang",
    meta: "Outbound agency · Europa",
    setup: "Infraestructura dedicada · 6 meses",
    metric: "4,7x",
    sub: "pipeline cualificado",
  },
];

function CaseCard({ c }: { c: (typeof CASES)[number] }) {
  return (
    <div className="w-[380px] flex-none rounded-lg border border-border bg-card p-6">
      <div className="font-display text-[28px] font-semibold leading-none tracking-[-0.03em] text-primary">{c.metric}</div>
      <p className="mb-[18px] mt-2 text-[15px] leading-[1.55] text-secondary-foreground">{c.sub} · {c.setup}</p>
      <div className="text-[14px] font-semibold text-foreground">{c.name}</div>
      <div className="text-[13px] text-muted-foreground">{c.meta}</div>
    </div>
  );
}

function Casos() {
  const row = [...CASES, ...CASES, ...CASES];
  return (
    <section id="casos" className="overflow-hidden py-24">
      <div className={`${SHELL} mb-12 text-center`}>
        <h2 className={H2}>Equipos que ahora cierran más rápido</h2>
      </div>
      <div data-marquee className="mb-5 flex w-full">
        <div className="flex gap-5 pr-5" style={{ animation: "marquee 46s linear infinite", willChange: "transform" }}>
          {row.map((c, i) => (
            <CaseCard key={`a${i}`} c={c} />
          ))}
        </div>
      </div>
      <div data-marquee className="flex w-full">
        <div className="flex gap-5 pr-5" style={{ animation: "marqueeRev 52s linear infinite", willChange: "transform" }}>
          {[...row].reverse().map((c, i) => (
            <CaseCard key={`b${i}`} c={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* Precios: salen de PLAN_CONFIG, la misma fuente que cobra Stripe (en euros). */
function Precios() {
  const plans = [
    {
      key: "starter" as const,
      desc: "1.000 leads guardados, 3 cuentas de correo y calentamiento incluido.",
      cta: { href: SIGNUP, label: "Empezar gratis", primary: false },
      featured: false,
    },
    {
      key: "growth" as const,
      desc: "10.000 leads, 15 cuentas, bandeja maestra y secuencias con agentes IA.",
      cta: { href: SIGNUP, label: "Empezar gratis", primary: true },
      featured: true,
    },
    {
      key: "scale" as const,
      desc: "Leads y cuentas sin límite, entregabilidad dedicada y acceso por API.",
      cta: { href: SIGNUP, label: "Empezar gratis", primary: false },
      featured: false,
    },
  ];

  return (
    <section id="precios" className="pb-24 pt-10">
      <div className={SHELL}>
        <SectionHeading pill="Precios" title="Un plan para cada volumen" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const cfg = PLAN_CONFIG[p.key];
            return (
              <div
                key={p.key}
                className={`flex flex-col rounded-[8px] border bg-card p-7 ${
                  p.featured ? "border-primary shadow-[0_12px_32px_hsl(var(--primary)/0.14)]" : "border-border"
                }`}
              >
                <div className="mb-[10px] flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-primary">{cfg.label}</span>
                  {p.featured ? (
                    <span className="rounded-full bg-accent px-[9px] py-1 text-[12px] font-semibold text-accent-foreground">El más elegido</span>
                  ) : null}
                </div>
                <div className="font-display text-[40px] font-semibold tracking-[-0.03em] text-foreground">
                  {cfg.monthly.price} €
                  <span className="font-sans text-[15px] font-medium text-muted-foreground">/mes</span>
                </div>
                <p className="mb-2 mt-3 text-[15px] leading-[1.5] text-secondary-foreground">{p.desc}</p>
                {/* Clientes incluidos — la misma cifra que aplica el plan. */}
                <p className="mb-1 text-[13px] font-semibold text-primary">{emailsFeature(p.key)}</p>
                <p className="mb-5 text-[13px] font-semibold text-primary">{clientsFeature(p.key)}</p>
                <a
                  href={p.cta.href}
                  className={`mt-auto rounded-lg px-[18px] text-center text-[15px] font-semibold transition-colors ${
                    p.cta.primary
                      ? "bg-primary py-3 text-primary-foreground shadow-btn hover:bg-primary-hover"
                      : "border border-border py-[11px] text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {p.cta.label}
                </a>
              </div>
            );
          })}
          {/* Agencia: multicliente, informes por cliente y responsable asignado. */}
          <div className="flex flex-col rounded-[8px] border border-border bg-accent p-7">
            <div className="mb-[10px] text-[15px] font-semibold text-primary">Agencia</div>
            <div className="font-display text-[40px] font-semibold tracking-[-0.03em] text-foreground">A medida</div>
            <p className="my-3 mb-5 text-[15px] leading-[1.5] text-secondary-foreground">
              Varios clientes en una cuenta, informes por cliente y un responsable asignado.
            </p>
            <a
              href={CONTACT}
              className="mt-auto rounded-lg border border-border bg-card px-[18px] py-[11px] text-center text-[15px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Hablar con ventas
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: "¿Cuántos buzones puedo conectar?",
    a: "Los que necesites: 3 en Starter, 15 en Growth y sin límite en Scale. Google, Outlook o cualquier SMTP, y el almacenamiento de leads nunca se cobra aparte.",
  },
  {
    q: "¿Cuánto tarda el calentamiento antes de poder enviar?",
    a: "El calentamiento arranca en cuanto conectas el buzón y sigue funcionando por debajo de las campañas. La rampa lenta sube el volumen día a día en lugar de soltarlo de golpe.",
  },
  {
    q: "¿Puedo traer mis propios dominios?",
    a: "Sí. Conectas el dominio y OnePulso publica y verifica SPF, DKIM, DMARC y MX por ti; si algo se rompe, se vuelve a configurar desde la pantalla de Cuentas.",
  },
  {
    q: "¿Sirve para una agencia con varios clientes?",
    a: "Es la mayor parte de nuestra base. Cada cliente tiene su propio acceso, la bandeja maestra reúne todas las respuestas y los informes de campaña salen por cliente.",
  },
];

function Preguntas() {
  return (
    <section id="faq" className="pb-24">
      <div className="mx-auto w-full max-w-[860px] px-6">
        <h2 className="mb-8 text-center font-display text-[clamp(28px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
          Preguntas que nos llegan cada semana
        </h2>
        {FAQ.map((f) => (
          <details key={f.q} className="mb-3 rounded-lg border border-border bg-card">
            <summary className="flex items-center justify-between gap-5 px-6 py-[22px] text-[17px] font-semibold text-foreground">
              {f.q}
              <span data-plus className="text-[22px] font-normal leading-none text-primary">
                +
              </span>
            </summary>
            <p className="m-0 px-6 pb-[22px] text-[16px] leading-[1.55] text-secondary-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CierreCTA() {
  return (
    <section className="pb-24">
      <div className={SHELL}>
        <div
          className="relative overflow-hidden rounded-[12px] border border-border px-6 py-20 text-center"
          style={{
            background:
              "radial-gradient(140% 120% at 50% 0%, hsl(var(--card)) 0%, hsl(var(--primary)/0.22) 62%, hsl(var(--accent)) 100%)",
          }}
        >
          <h2 className="mx-auto mb-5 max-w-[760px] font-display text-[clamp(30px,4.4vw,56px)] font-semibold leading-[1.08] tracking-[-0.035em] text-foreground [text-wrap:balance]">
            Empieza tu primer flujo hoy
          </h2>
          <p className={`mx-auto mb-8 max-w-[560px] ${LEAD}`}>
            Crea tu cuenta gratis, conecta un buzón y mira cómo OnePulso calienta, envía y llena tu bandeja de respuestas
            reales.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={CONTACT} className={BTN_SECONDARY_LG}>
              Hablar con ventas
            </a>
            <a href={SIGNUP} className={BTN_PRIMARY_LG}>
              Empezar gratis
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className={`${SHELL} grid gap-10 pb-8 pt-14 md:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]`}>
        <div>
          <Wordmark className="mb-[14px] h-[20px]" colorClassName="text-foreground" />
          <p className="max-w-[280px] text-[15px] leading-[1.55] text-muted-foreground">
            Outbound con IA y entregabilidad propia. Prospecta, calienta, envía y cierra desde una sola plataforma.
          </p>
        </div>
        <div className="flex flex-col gap-[10px]">
          <div className="mb-1 text-[13px] font-semibold text-foreground">Producto</div>
          {[
            ["#producto", "Plataforma"],
            ["#entregabilidad", "Entregabilidad"],
            ["#bandeja", "Bandeja maestra"],
            ["#precios", "Precios"],
          ].map(([href, label]) => (
            <a key={label} href={href} className="text-[15px] text-secondary-foreground transition-colors hover:text-primary">
              {label}
            </a>
          ))}
        </div>
        <div className="flex flex-col gap-[10px]">
          <div className="mb-1 text-[13px] font-semibold text-foreground">Empresa</div>
          {[
            ["#casos", "Casos de éxito"],
            ["#faq", "Preguntas"],
            [SIGNUP, "Empezar"],
          ].map(([href, label]) => (
            <a key={label} href={href} className="text-[15px] text-secondary-foreground transition-colors hover:text-primary">
              {label}
            </a>
          ))}
        </div>
        <div className="flex flex-col gap-[10px]">
          <div className="mb-1 text-[13px] font-semibold text-foreground">Contacto</div>
          <a href={CONTACT} className="text-[15px] text-secondary-foreground transition-colors hover:text-primary">
            team@onepulso.online
          </a>
          <span className="text-[15px] text-secondary-foreground">Barcelona · España</span>
        </div>
      </div>
      <div className={`${SHELL} flex flex-wrap justify-between gap-4 border-t border-border py-5 pb-10 text-[14px] text-muted-foreground`}>
        <span>© 2026 OnePulso. Todos los derechos reservados.</span>
        <span className="flex gap-5">
          <a href={LOGIN} className="transition-colors hover:text-primary">
            Iniciar sesión
          </a>
          <a href={SIGNUP} className="transition-colors hover:text-primary">
            Crear cuenta
          </a>
        </span>
      </div>
    </footer>
  );
}

/* =============================================================================
   Página
   ========================================================================== */
export default function Landing() {
  return (
    <div className="op-landing">
      {/* Franja de anuncio, como en el diseño */}
      <div className="flex flex-wrap items-center justify-center gap-4 bg-gradient-brand px-6 py-[11px] text-[14px] font-medium tracking-[-0.01em] text-primary-foreground">
        <span>Buzones y almacenamiento ilimitados. Sin tarifa por buzón.</span>
        <a href={SIGNUP} className="whitespace-nowrap font-semibold underline-offset-2 hover:underline">
          Empezar ahora →
        </a>
      </div>
      <Header />
      <Hero />
      <SectionNav />
      <Plataforma />
      <Infraestructura />
      <Flujo />
      <Entregabilidad />
      <Prospeccion />
      <Bandeja />
      <Casos />
      <Precios />
      <Preguntas />
      <CierreCTA />
      <Footer />
    </div>
  );
}
