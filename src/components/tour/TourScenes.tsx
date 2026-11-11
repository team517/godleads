import type { ReactNode } from "react";
import {
  type LucideIcon, LayoutDashboard, Send, Inbox, Mail, Users, Sparkles, BotMessageSquare, ShieldCheck, Building2,
  CalendarHeart, BarChart3, Search, Bell, Plus, Upload, FileSpreadsheet, Check, Clock, X, MessageCircle, Play,
  ChevronDown, Wand2, ArrowRight,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { SparkMark } from "@/components/SparkMark";
import { cn } from "@/lib/utils";
import type { ChapterId } from "@/lib/tour";

/* Las escenas del mini tutorial: una maqueta del panel de Funnyleads (barra índigo, menú lateral
 * con las secciones reales de un suscriptor) que cambia de estado según el tiempo `t` del capítulo.
 * Todo es una función pura de `t`: el reproductor sólo avanza el reloj y el cursor va a los
 * elementos marcados con data-tour. Datos de ejemplo inventados, nunca los de la cuenta. */

export const STAGE_W = 960;
export const STAGE_H = 600;
/** Lo que tarda el cursor en llegar a su destino, y cuándo hace clic desde que sale. */
export const CURSOR_MOVE_MS = 700;
export const CLICK_AFTER_MS = 760;

export interface CursorStep { at: number; target: string; click?: boolean }

export type NavId =
  | "dashboard" | "campaigns" | "unibox" | "accounts" | "leads"
  | "personalizacion" | "agentes" | "entregabilidad" | "clientes" | "funnyteam" | "stats";

export interface SceneCtx { t: number; hover: string | null }

export interface Scene {
  id: ChapterId;
  cursor: CursorStep[];
  /** Sección activa del menú en el instante t (null = la del capítulo anterior). */
  nav: (t: number) => NavId | null;
  /** Primer clic en el menú: antes, se sigue viendo la pantalla del capítulo anterior. */
  navClickAt?: number;
  render: (c: SceneCtx) => ReactNode;
}

const clickAt = (s: CursorStep) => s.at + CLICK_AFTER_MS;
const on = (t: number, ms: number) => t >= ms;
/** Progreso 0→1 entre a y b. */
const prog = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
/** Texto que se va escribiendo desde `start`. */
const typed = (text: string, t: number, start: number, cps = 32) =>
  text.slice(0, Math.max(0, Math.floor(((t - start) / 1000) * cps)));
/** 5380 → "5.380" (toLocaleString no agrupa los números de 4 cifras en español). */
const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** Realce del elemento sobre el que está el ratón. */
const hl = (hover: string | null, id: string) =>
  hover === id ? "ring-2 ring-primary/45 ring-offset-1 ring-offset-background" : "";

/* ─────────────────────────────── Marco: barra superior y menú ─────────────────────────────── */

const NAV: { group: string | null; items: { id: NavId; icon: LucideIcon; label: string }[] }[] = [
  { group: null, items: [
    { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { id: "campaigns", icon: Send, label: "Campañas" },
    { id: "unibox", icon: Inbox, label: "Unibox" },
    { id: "accounts", icon: Mail, label: "Cuentas Email" },
    { id: "leads", icon: Users, label: "Leads" },
  ] },
  { group: "Equipo IA", items: [
    { id: "personalizacion", icon: Sparkles, label: "Personalización" },
    { id: "agentes", icon: BotMessageSquare, label: "Agentes" },
  ] },
  { group: "Salud de envío", items: [{ id: "entregabilidad", icon: ShieldCheck, label: "Entregabilidad" }] },
  { group: "Clientes", items: [{ id: "clientes", icon: Building2, label: "Clientes" }] },
  { group: "Soporte", items: [{ id: "funnyteam", icon: CalendarHeart, label: "Funny Team" }] },
  { group: "Rendimiento", items: [{ id: "stats", icon: BarChart3, label: "Estadísticas" }] },
];

export function TourShell({ active, hover, children, chatOpen }: { active: NavId | null; hover: string | null; children: ReactNode; chatOpen?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <div className="topbar-surface flex h-11 shrink-0 items-center gap-3 px-4 text-white">
        <span className="flex w-[170px] items-center gap-2"><SparkMark size={22} variant="star" /><Wordmark className="h-[15px]" colorClassName="text-white" /></span>
        <span className="flex h-7 w-[260px] items-center gap-2 rounded-full bg-white/12 px-3 text-[11.5px] text-white/70"><Search className="h-3.5 w-3.5" /> Buscar campañas, leads, cuentas…</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="rounded-full bg-white/12 px-2.5 py-1 text-[10.5px] font-semibold">Prueba · 14 días</span>
          <Bell className="h-4 w-4 text-white/80" />
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">TÚ</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[190px] shrink-0 border-r border-border bg-card px-2.5 py-3">
          {NAV.map((g, gi) => (
            <div key={gi} className={cn(gi > 0 && "mt-2 border-t border-border/70 pt-2")}>
              {g.group && <p className="mb-1 flex items-center justify-between px-2 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.group}<ChevronDown className="h-3 w-3" /></p>}
              {g.items.map((it) => {
                const isActive = active === it.id;
                return (
                  <div key={it.id} data-tour={`nav-${it.id}`}
                    className={cn("flex items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium transition-colors duration-300",
                      isActive ? "bg-primary/10 font-semibold text-primary" : "text-secondary-foreground",
                      hover === `nav-${it.id}` && !isActive && "bg-secondary")}>
                    <it.icon className="h-[15px] w-[15px]" /> {it.label}
                  </div>
                );
              })}
            </div>
          ))}
        </aside>
        <main className="relative min-w-0 flex-1 overflow-hidden p-5">
          {children}
          {/* FunnyBot: el botón de abajo a la derecha, siempre ahí. */}
          <span data-tour="chat-bubble" className={cn("absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-[0_8px_20px_rgba(110,88,241,.4)] transition-transform", chatOpen && "scale-90", hl(hover, "chat-bubble"))}>
            {chatOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
          </span>
        </main>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Piezas pequeñas ─────────────────────────────── */

const Fade = ({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) => (
  <div className={cn("transition-all duration-500 motion-reduce:transition-opacity", show ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-1.5 motion-reduce:translate-y-0", className)}>{children}</div>
);

const PageTitle = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
  <div className="mb-4 flex items-end justify-between gap-3">
    <div>
      <h3 className="font-display text-[20px] font-semibold tracking-[-0.02em]">{title}</h3>
      {sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}
    </div>
    {right}
  </div>
);

const Btn = ({ id, hover, children, ghost, pressed }: { id: string; hover: string | null; children: ReactNode; ghost?: boolean; pressed?: boolean }) => (
  <span data-tour={id} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-all",
    ghost ? "border border-border bg-card text-foreground" : "bg-primary text-white shadow-[0_2px_4px_rgba(110,88,241,.24)]",
    pressed && "scale-95", hl(hover, id))}>{children}</span>
);

const Toggle = ({ id, hover, on: isOn }: { id?: string; hover: string | null; on: boolean }) => (
  <span data-tour={id} className={cn("relative inline-flex h-[18px] w-8 shrink-0 rounded-full transition-colors duration-300", isOn ? "bg-primary" : "bg-muted-foreground/30", id && hl(hover, id))}>
    <span className={cn("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all duration-300", isOn ? "left-[16px]" : "left-[2px]")} />
  </span>
);

const Card = ({ children, className, id, hover }: { children: ReactNode; className?: string; id?: string; hover?: string | null }) => (
  <div data-tour={id} className={cn("rounded-lg border border-border bg-card shadow-[0_2px_6px_rgba(21,17,60,.04)] transition-shadow", id && hl(hover ?? null, id), className)}>{children}</div>
);

const Chip = ({ children, tone = "violet", className }: { children: ReactNode; tone?: "violet" | "green" | "sky" | "pink" | "red" | "grey" | "amber"; className?: string }) => {
  const tones = {
    violet: "bg-primary/10 text-primary",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
    pink: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300",
    red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    grey: "bg-muted text-muted-foreground",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[10.5px] font-semibold", tones[tone], className)}>{children}</span>;
};

/** Pinta {{variables}} como en el editor: en violeta. */
const WithVars = ({ text, hover }: { text: string; hover?: string | null }) => (
  <>{text.split(/(\{\{[a-z_]+\}?\}?)/g).map((p, i) => p.startsWith("{{")
    ? <span key={i} data-tour={p === "{{personalized_message}}" ? "var-personalized" : undefined}
        className={cn("rounded bg-primary/10 px-1 font-medium text-primary", p === "{{personalized_message}}" && hl(hover ?? null, "var-personalized"))}>{p}</span>
    : <span key={i}>{p}</span>)}</>
);

/* ─────────────────────────────── 1 · Panel ─────────────────────────────── */

const dashCursor: CursorStep[] = [
  { at: 300, target: "nav-dashboard", click: true },
  { at: 2200, target: "kpi-replies" },
  { at: 4200, target: "range-30", click: true },
  { at: 6600, target: "kpi-interested" },
  { at: 8800, target: "chart" },
];
const D_NAV = clickAt(dashCursor[0]);
const D_RANGE = clickAt(dashCursor[2]);

const LINE_7 = [22, 30, 26, 41, 38, 52, 60];
const LINE_30 = [10, 14, 12, 20, 18, 24, 22, 30, 28, 35, 33, 40, 38, 46, 44, 52, 49, 55, 58, 62];

function DashboardView({ t, hover }: SceneCtx) {
  const is30 = on(t, D_RANGE);
  const k = prog(t, D_NAV, D_NAV + 1400);
  const k2 = prog(t, D_RANGE, D_RANGE + 1000);
  const sent = is30 ? 1240 + (5380 - 1240) * k2 : 1240 * k;
  const interested = is30 ? 18 + (41 - 18) * k2 : 18 * k;
  const pts = is30 ? LINE_30 : LINE_7;
  const draw = is30 ? k2 : k;
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * 700},${120 - v * 1.6}`).join(" ");
  const kpis = [
    { id: "kpi-sent", label: "Enviados", value: fmt(sent), sub: is30 ? "últimos 30 días" : "últimos 7 días" },
    { id: "kpi-replies", label: "Respuestas", value: `${(6.2 * k).toFixed(1).replace(".", ",")} %`, sub: "de los contactados" },
    { id: "kpi-interested", label: "Interesados", value: fmt(interested), sub: "listos para reunión", accent: true },
    { id: "kpi-bounce", label: "Rebotes", value: `${(0.8 * k).toFixed(1).replace(".", ",")} %`, sub: "sano: por debajo del 3 %" },
  ];
  return (
    <div>
      <PageTitle title="Dashboard" sub="Así van tus campañas" right={
        <span className="flex gap-1 rounded-md border border-border bg-card p-0.5 text-[11px] font-semibold">
          <span data-tour="range-7" className={cn("rounded px-2 py-1", !is30 ? "bg-primary text-white" : "text-muted-foreground")}>7 días</span>
          <span data-tour="range-30" className={cn("rounded px-2 py-1 transition-colors", is30 ? "bg-primary text-white" : "text-muted-foreground", hl(hover, "range-30"))}>30 días</span>
        </span>
      } />
      <div className="grid grid-cols-4 gap-3">
        {kpis.map((c) => (
          <Card key={c.id} id={c.id} hover={hover} className="p-3.5">
            <p className="text-[11px] font-semibold text-muted-foreground">{c.label}</p>
            <p className={cn("mt-1 font-display text-[24px] font-semibold tracking-[-0.03em]", c.accent && "text-emerald-600 dark:text-emerald-400")}>{c.value}</p>
            <p className="text-[10.5px] text-muted-foreground">{c.sub}</p>
          </Card>
        ))}
      </div>
      <Card id="chart" hover={hover} className="mt-3 p-4">
        <p className="mb-2 text-[12px] font-semibold">Respuestas por día</p>
        <svg viewBox="0 0 700 130" className="h-[170px] w-full" preserveAspectRatio="none">
          <defs><linearGradient id="tourArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#6E58F1" stopOpacity=".25" /><stop offset="1" stopColor="#6E58F1" stopOpacity="0" /></linearGradient></defs>
          {[30, 60, 90, 120].map((y) => <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth="1" />)}
          <polygon points={`0,130 ${path} 700,130`} fill="url(#tourArea)" opacity={draw} />
          <polyline points={path} fill="none" stroke="#6E58F1" strokeWidth="3" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} />
        </svg>
      </Card>
    </div>
  );
}

/* ─────────────────────────────── 2 · Cuentas de correo ─────────────────────────────── */

const accCursor: CursorStep[] = [
  { at: 300, target: "nav-accounts", click: true },
  { at: 1900, target: "btn-add-account", click: true },
  { at: 3500, target: "opt-gmail", click: true },
  { at: 6400, target: "warmup-1" },
  { at: 8300, target: "ramp-1", click: true },
  { at: 11000, target: "limit-1" },
];
const A_NAV = clickAt(accCursor[0]);
const A_ADD = clickAt(accCursor[1]);
const A_GMAIL = clickAt(accCursor[2]);
const A_CONNECTED = A_GMAIL + 1300;
const A_RAMP = clickAt(accCursor[4]);

const MAILBOXES = [
  { email: "lucia@ventas-ejemplo.com", warm: 98 },
  { email: "marcos@ventas-ejemplo.com", warm: 96 },
  { email: "equipo@ventas-ejemplo.com", warm: 99 },
];

function AccountsView({ t, hover }: SceneCtx) {
  const dialog = on(t, A_ADD) && !on(t, A_CONNECTED);
  const connecting = on(t, A_GMAIL);
  const newRow = on(t, A_CONNECTED);
  const ramp = on(t, A_RAMP);
  const rows = newRow ? [{ email: "hola@tuempresa-ejemplo.com", warm: 12, fresh: true }, ...MAILBOXES] : MAILBOXES;
  return (
    <div className="relative">
      <PageTitle title="Cuentas Email" sub="Tus buzones de envío" right={<Btn id="btn-add-account" hover={hover} pressed={dialog && !connecting}><Plus className="h-3.5 w-3.5" /> Añadir cuenta</Btn>} />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1.6fr_.9fr_1fr_.9fr_1.1fr] gap-2 border-b border-border bg-secondary/50 px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          <span>Cuenta</span><span>Estado</span><span>Warm-up</span><span>Límite diario</span><span>Slow ramp</span>
        </div>
        {rows.map((r, i) => {
          const first = i === 0;
          const rampOn = first && ramp;
          return (
            <div key={r.email} className={cn("grid grid-cols-[1.6fr_.9fr_1fr_.9fr_1.1fr] items-center gap-2 border-b border-border/70 px-3.5 py-2.5 text-[12px] last:border-0", "fresh" in r && "animate-in fade-in slide-in-from-top-1 duration-500 bg-primary/[0.03]")}>
              <span className="flex items-center gap-2 truncate font-medium"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{r.email}{"fresh" in r && <Chip>Nueva</Chip>}</span>
              <span><Chip tone="green"><Check className="h-3 w-3" /> Conectada</Chip></span>
              <span data-tour={first ? "warmup-1" : undefined} className={cn("flex items-center gap-2 rounded px-1", first && hl(hover, "warmup-1"))}>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${r.warm}%` }} /></span>
                <span className="text-[11px] text-muted-foreground">{r.warm} %</span>
              </span>
              <span data-tour={first ? "limit-1" : undefined} className={cn("rounded px-1 font-semibold", first && hl(hover, "limit-1"))}>
                {rampOn ? <span className="text-primary">2 → 15 / día</span> : "15 / día"}
              </span>
              <span className="flex items-center gap-2">
                <Toggle id={first ? "ramp-1" : undefined} hover={hover} on={rampOn} />
                {rampOn && <span className="text-[10.5px] font-medium text-primary">+3 cada día</span>}
              </span>
            </div>
          );
        })}
      </Card>
      <Fade show={on(t, 6500) && t < 8300} className="absolute left-[34%] top-[150px] z-10">
        <span className="rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background shadow-lg">Warm-up: el buzón gana reputación solo</span>
      </Fade>
      {/* Diálogo de añadir cuenta */}
      <Fade show={dialog} className="absolute inset-0 z-20 flex items-start justify-center bg-[#15113C]/25 pt-14">
        <Card className="w-[380px] p-4 shadow-[0_18px_44px_rgba(21,17,60,.18)]">
          <p className="font-display text-[15px] font-semibold">Conecta un buzón</p>
          <p className="mb-3 text-[11.5px] text-muted-foreground">Elige tu proveedor: tardas menos de un minuto.</p>
          {[
            { id: "opt-gmail", label: "Google / Gmail", c: "bg-red-500" },
            { id: "opt-outlook", label: "Microsoft / Outlook", c: "bg-sky-500" },
            { id: "opt-smtp", label: "Cualquier proveedor (SMTP / IMAP)", c: "bg-slate-500" },
          ].map((o) => (
            <div key={o.id} data-tour={o.id} className={cn("mb-2 flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5 text-[12.5px] font-medium", hl(hover, o.id), connecting && o.id === "opt-gmail" && "border-primary bg-primary/5")}>
              <span className={cn("h-2.5 w-2.5 rounded-full", o.c)} /> {o.label}
              {connecting && o.id === "opt-gmail" && <span className="ml-auto flex items-center gap-1.5 text-[11px] text-primary"><span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> Conectando…</span>}
            </div>
          ))}
        </Card>
      </Fade>
    </div>
  );
}

/* ─────────────────────────────── 3 · Leads ─────────────────────────────── */

const leadsCursor: CursorStep[] = [
  { at: 300, target: "nav-leads", click: true },
  { at: 1800, target: "btn-import", click: true },
  { at: 4900, target: "map-first" },
  { at: 6200, target: "btn-import-confirm", click: true },
  { at: 8400, target: "lead-row-1" },
  { at: 10000, target: "var-chip" },
];
const L_NAV = clickAt(leadsCursor[0]);
const L_IMPORT = clickAt(leadsCursor[1]);
const L_MAP = L_IMPORT + 1900;
const L_DONE = clickAt(leadsCursor[3]);

const LEADS = [
  { n: "Laura", c: "Clínica Norte", city: "Valencia" },
  { n: "Sergio", c: "Talleres Ribera", city: "Sevilla" },
  { n: "Marta", c: "Estudio Lúa", city: "Bilbao" },
  { n: "Andrés", c: "Logística Sur", city: "Málaga" },
  { n: "Nuria", c: "Grupo Brisa", city: "Madrid" },
];

function LeadsView({ t, hover }: SceneCtx) {
  const importing = on(t, L_IMPORT) && !on(t, L_DONE);
  const mapping = on(t, L_MAP);
  const done = on(t, L_DONE);
  const maps = [
    { col: "Nombre", v: "{{first_name}}", at: L_MAP, id: "map-first" },
    { col: "Empresa", v: "{{company_name}}", at: L_MAP + 500 },
    { col: "Ciudad", v: "{{city}}", at: L_MAP + 1000 },
  ];
  return (
    <div className="relative">
      <PageTitle title="Leads" sub={done ? "248 leads · lista «Clínicas y talleres»" : "Tus listas de contactos"} right={<Btn id="btn-import" hover={hover} pressed={importing}><Upload className="h-3.5 w-3.5" /> Importar</Btn>} />
      {!importing && (
        <Fade show={done || t < L_IMPORT}>
          {done ? (
            <Card className="overflow-hidden">
              <div className="grid grid-cols-[1fr_1.2fr_1fr] gap-2 border-b border-border bg-secondary/50 px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                <span data-tour="var-chip" className={cn("w-fit rounded", hl(hover, "var-chip"))}>Nombre · <span className="normal-case text-primary">{"{{first_name}}"}</span></span>
                <span>Empresa · <span className="normal-case text-primary">{"{{company_name}}"}</span></span>
                <span>Ciudad · <span className="normal-case text-primary">{"{{city}}"}</span></span>
              </div>
              {LEADS.map((l, i) => (
                <div key={l.n} data-tour={i === 0 ? "lead-row-1" : undefined} className={cn("grid grid-cols-[1fr_1.2fr_1fr] gap-2 border-b border-border/70 px-3.5 py-2.5 text-[12px] last:border-0", i === 0 && hl(hover, "lead-row-1"))}>
                  <span className="font-medium">{l.n}</span><span>{l.c}</span><span className="text-muted-foreground">{l.city}</span>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
              <Users className="h-8 w-8 text-primary/60" />
              <p className="text-[13px] font-semibold">Todavía no tienes leads</p>
              <p className="text-[11.5px] text-muted-foreground">Importa un CSV o búscalos con IA</p>
            </Card>
          )}
        </Fade>
      )}
      {importing && (
        <div className="grid grid-cols-2 gap-3">
          <Card className="flex h-[300px] flex-col items-center justify-center gap-3 border-dashed p-5">
            <FileSpreadsheet className={cn("h-10 w-10 text-emerald-600 transition-all duration-700", on(t, L_IMPORT + 300) ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0")} />
            <p className="text-[12.5px] font-semibold">leads-ejemplo.csv</p>
            <span className="h-1.5 w-48 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${prog(t, L_IMPORT + 300, L_MAP) * 100}%` }} /></span>
            <p className="text-[11px] text-muted-foreground">{mapping ? "248 filas leídas" : "Leyendo…"}</p>
          </Card>
          <Card className="p-4">
            <p className="mb-3 text-[12.5px] font-semibold">Cada columna, una variable</p>
            {maps.map((m) => (
              <Fade key={m.col} show={on(t, m.at)}>
                <div data-tour={m.id} className={cn("mb-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px]", m.id && hl(hover, m.id))}>
                  <span className="w-20 font-medium">{m.col}</span><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="rounded bg-primary/10 px-1.5 font-medium text-primary">{m.v}</span>
                </div>
              </Fade>
            ))}
            <Fade show={on(t, L_MAP + 1300)} className="mt-4 flex justify-end"><Btn id="btn-import-confirm" hover={hover}><Check className="h-3.5 w-3.5" /> Importar 248 leads</Btn></Fade>
          </Card>
        </div>
      )}
      <Fade show={done && t < L_DONE + 2600} className="absolute right-0 top-[-6px]">
        <span className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-lg"><Check className="h-3.5 w-3.5" /> 248 leads importados</span>
      </Fade>
    </div>
  );
}

/* ─────────────────────────── 4–6 · Campaña: secuencia, variantes y ajustes ─────────────────────────── */

const seqCursor: CursorStep[] = [
  { at: 300, target: "nav-campaigns", click: true },
  { at: 1800, target: "btn-new-campaign", click: true },
  { at: 3000, target: "tab-editor", click: true },
  { at: 6600, target: "wait-1" },
  { at: 8400, target: "btn-add-step", click: true },
  { at: 10800, target: "step-3" },
];
const S_NAV = clickAt(seqCursor[0]);
const S_NEW = clickAt(seqCursor[1]);
const S_EDITOR = clickAt(seqCursor[2]);
const S_ADD = clickAt(seqCursor[4]);
const SUBJECT = "{{first_name}}, una idea para {{company_name}}";
const BODY_A = "Hola {{first_name}},\n\nHe visto que en {{company_name}} estáis creciendo en {{city}}. Ayudamos a equipos como el tuyo a conseguir más reuniones sin contratar a nadie.\n\n¿Te cuento cómo en 15 minutos?";

const varCursor: CursorStep[] = [
  { at: 500, target: "btn-add-variant", click: true },
  { at: 5300, target: "var-personalized" },
  { at: 7400, target: "variant-tab-a", click: true },
  { at: 9300, target: "variant-toggle-a", click: true },
  { at: 11800, target: "variant-tab-b" },
];
const V_ADD = clickAt(varCursor[0]);
const V_TYPE = V_ADD + 500;
const V_TAB_A = clickAt(varCursor[2]);
const V_OFF = clickAt(varCursor[3]);
const BODY_B = "Hola {{first_name}},\n\n{{personalized_message}}\n\n¿Te encaja una llamada de 15 minutos esta semana?";

const setCursor: CursorStep[] = [
  { at: 400, target: "tab-ajustes", click: true },
  { at: 2000, target: "acc-check-3", click: true },
  { at: 3800, target: "subtab-horario", click: true },
  { at: 5500, target: "hours" },
  { at: 7000, target: "subtab-opciones", click: true },
  { at: 8600, target: "opt-ooo", click: true },
  { at: 10600, target: "btn-launch", click: true },
];
const G_AJUSTES = clickAt(setCursor[0]);
const G_CHECK = clickAt(setCursor[1]);
const G_HORARIO = clickAt(setCursor[2]);
const G_OPCIONES = clickAt(setCursor[4]);
const G_OOO = clickAt(setCursor[5]);
const G_LAUNCH = clickAt(setCursor[6]);

interface CampaignState {
  tab: "analitica" | "editor" | "ajustes";
  subject: string;
  steps: number;
  step3New: boolean;
  variants: boolean;
  activeVariant: "A" | "B";
  bodyB: string;
  aOff: boolean;
  sub: "cuentas" | "horario" | "opciones";
  checked3: boolean;
  ooo: boolean;
  launched: boolean;
}

function CampaignDetailView({ s, hover, t }: { s: CampaignState; hover: string | null; t: number }) {
  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h3 className="font-display text-[19px] font-semibold tracking-[-0.02em]">Clínicas y talleres</h3>
          {s.launched
            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Activa</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-[#9aa0c2]" />Borrador</span>}
        </div>
        <Btn id="btn-launch" hover={hover} pressed={s.launched && t < G_LAUNCH + 250}><Play className="h-3.5 w-3.5" /> {s.launched ? "Pausar" : "Lanzar"}</Btn>
      </div>
      <div className="mb-3 flex gap-5 border-b border-border text-[12.5px] font-semibold">
        {[
          { id: "tab-analitica", label: "Analítica", act: s.tab === "analitica" },
          { id: "tab-editor", label: "Editor", act: s.tab === "editor" },
          { id: "tab-leads", label: "Leads", act: false },
          { id: "tab-ajustes", label: "Ajustes", act: s.tab === "ajustes" },
        ].map((tb) => (
          <span key={tb.id} data-tour={tb.id} className={cn("-mb-px border-b-2 px-0.5 pb-2 transition-colors", tb.act ? "border-primary text-primary" : "border-transparent text-muted-foreground", hl(hover, tb.id))}>{tb.label}</span>
        ))}
      </div>

      {s.tab === "analitica" ? (
        <Card className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
          <BarChart3 className="h-8 w-8 text-primary/60" />
          <p className="text-[13px] font-semibold">Aún no hay envíos</p>
          <p className="max-w-[300px] text-[11.5px] text-muted-foreground">Cuando lances la campaña verás aquí los envíos, las respuestas y los interesados. Empieza escribiendo la secuencia en el Editor.</p>
        </Card>
      ) : s.tab === "editor" ? (
        <div className="grid grid-cols-[230px_1fr] gap-4">
          {/* Raíl de pasos y esperas */}
          <div>
            {Array.from({ length: s.steps }, (_, i) => (
              <div key={i} className={cn(i === 2 && s.step3New && "animate-in fade-in slide-in-from-top-2 duration-500")}>
                {i > 0 && (
                  <div data-tour={`wait-${i}`} className={cn("my-1.5 ml-4 flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground", hl(hover, `wait-${i}`))}>
                    <Clock className="h-3.5 w-3.5" /> Esperar <b className="text-foreground">{i === 1 ? 3 : 4}</b> días
                  </div>
                )}
                <Card id={`step-${i + 1}`} hover={hover} className={cn("p-3", i === 0 && "border-primary/50 bg-primary/[0.03]")}>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground">Paso {i + 1}</p>
                    {i === 0 && (
                      <span className="flex items-center gap-1">
                        {s.variants && (["A", "B"] as const).map((v) => (
                          <span key={v} className={cn("flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold", v === s.activeVariant ? "bg-primary text-white" : "bg-secondary text-muted-foreground", v === "A" && s.aOff && "line-through opacity-50")}>{v}</span>
                        ))}
                        <span data-tour="btn-add-variant" title="Añadir variante" className={cn("flex h-5 w-5 items-center justify-center rounded border border-dashed border-primary/50 text-primary", hl(hover, "btn-add-variant"))}><Plus className="h-3 w-3" /></span>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[12px] font-medium">{i === 0 ? <WithVars text={s.subject || " "} /> : i === 1 ? "Re: seguimiento rápido" : "¿Lo dejamos aquí?"}</p>
                </Card>
              </div>
            ))}
            <span data-tour="btn-add-step" className={cn("mt-3 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-[12px] font-semibold text-primary", hl(hover, "btn-add-step"))}><Plus className="h-3.5 w-3.5" /> Añadir paso</span>
          </div>
          {/* Editor del paso 1 */}
          <Card className="p-4">
            {s.variants && (
              <div className="mb-3 flex items-center gap-2">
                {(["A", "B"] as const).map((v) => (
                  <span key={v} data-tour={`variant-tab-${v.toLowerCase()}`} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                    s.activeVariant === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground", hl(hover, `variant-tab-${v.toLowerCase()}`))}>
                    Variante {v}
                    {v === "A" && <Toggle id="variant-toggle-a" hover={hover} on={!s.aOff} />}
                    {v === "A" && s.aOff && <Chip tone="grey">Apagada</Chip>}
                  </span>
                ))}
                <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-primary"><Wand2 className="h-3.5 w-3.5" /> Escribir con IA</span>
              </div>
            )}
            <p className="text-[11px] font-semibold text-muted-foreground">Asunto</p>
            <p className="mb-3 mt-1 min-h-[30px] rounded-md border border-border bg-background px-2.5 py-1.5 text-[12.5px]"><WithVars text={s.subject} />{!s.variants && s.subject.length < SUBJECT.length && <span className="ml-px inline-block h-3.5 w-px animate-pulse bg-foreground align-middle" />}</p>
            <p className="text-[11px] font-semibold text-muted-foreground">Mensaje</p>
            <div className="mt-1 h-[190px] whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed">
              <WithVars text={s.variants && s.activeVariant === "B" ? s.bodyB : BODY_A} hover={hover} />
            </div>
            {s.variants && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {s.aOff ? "La variante A queda guardada pero ya no se envía." : "Los envíos se reparten entre las variantes encendidas."}
              </p>
            )}
          </Card>
          <Fade show={hover === "var-personalized"} className="absolute bottom-[54px] right-6 z-10">
            <span className="block max-w-[260px] rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background shadow-lg">{"{{personalized_message}}"}: un párrafo escrito con IA para cada lead</span>
          </Fade>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex gap-1 rounded-md bg-secondary p-0.5 text-[11.5px] font-semibold w-fit">
            {(["cuentas", "horario", "opciones", "bajas"] as const).map((k) => (
              <span key={k} data-tour={`subtab-${k}`} className={cn("rounded px-3 py-1 capitalize transition-colors", s.sub === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground", hl(hover, `subtab-${k}`))}>{k === "cuentas" ? "Cuentas" : k === "horario" ? "Horario" : k === "opciones" ? "Opciones" : "Bajas"}</span>
            ))}
          </div>
          {s.sub === "cuentas" && (
            <Card className="p-3">
              {MAILBOXES.map((m, i) => {
                const checked = i < 2 || s.checked3;
                return (
                  <div key={m.email} className="flex items-center gap-2.5 border-b border-border/70 px-1 py-2 text-[12px] last:border-0">
                    <span data-tour={`acc-check-${i + 1}`} className={cn("flex h-4 w-4 items-center justify-center rounded border transition-colors", checked ? "border-primary bg-primary text-white" : "border-border", hl(hover, `acc-check-${i + 1}`))}>{checked && <Check className="h-3 w-3" />}</span>
                    <span className="font-medium">{m.email}</span><span className="ml-auto text-muted-foreground">15 / día</span>
                  </div>
                );
              })}
              <p className="mt-2 px-1 text-[11.5px] font-semibold text-primary">{s.checked3 ? 3 : 2} buzones · capacidad de hoy {s.checked3 ? 45 : 30} correos</p>
            </Card>
          )}
          {s.sub === "horario" && (
            <Card className="p-4">
              <p className="mb-2 text-[11.5px] font-semibold text-muted-foreground">Días de envío</p>
              <div className="mb-4 flex gap-1.5">
                {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => <span key={d} className={cn("flex h-7 w-7 items-center justify-center rounded-md text-[11.5px] font-bold", i < 5 ? "bg-primary text-white" : "bg-secondary text-muted-foreground")}>{d}</span>)}
              </div>
              <p className="mb-2 text-[11.5px] font-semibold text-muted-foreground">Horas</p>
              <span data-tour="hours" className={cn("inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold", hl(hover, "hours"))}><Clock className="h-3.5 w-3.5 text-primary" /> 09:00 – 17:00</span>
              <p className="mt-3 text-[11.5px] text-muted-foreground">Zona horaria: Europe/Madrid · los envíos se reparten a lo largo de la franja</p>
            </Card>
          )}
          {s.sub === "opciones" && (
            <Card className="p-2">
              {[
                { id: "opt-stop", label: "Parar al recibir respuesta", on: true },
                { id: "opt-ooo", label: "Fuera de oficina: esperar a que vuelva", on: s.ooo, hint: "Si dice que vuelve el día 20, el siguiente correo sale ese día." },
                { id: "opt-limit", label: "Máximo de nuevos leads al día", on: true, value: "45" },
              ].map((o) => (
                <div key={o.id} className={cn("flex items-center gap-3 rounded-md px-3 py-2.5", o.id === "opt-ooo" && s.ooo && "bg-primary/5")}>
                  <div className="flex-1">
                    <p className="text-[12.5px] font-semibold">{o.label}</p>
                    {o.hint && o.on && <p className="text-[11px] text-muted-foreground">{o.hint}</p>}
                  </div>
                  {o.value ? <span className="rounded-md border border-border px-2 py-0.5 text-[12px] font-semibold">{o.value}</span> : <Toggle id={o.id} hover={hover} on={o.on} />}
                </div>
              ))}
            </Card>
          )}
          <Fade show={s.launched && t < G_LAUNCH + 2600} className="absolute right-0 top-10 z-10">
            <span className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-lg"><Check className="h-3.5 w-3.5" /> Campaña lanzada</span>
          </Fade>
        </div>
      )}
    </div>
  );
}

const SEQ_FINAL = (): CampaignState => ({
  tab: "editor", subject: SUBJECT, steps: 3, step3New: false, variants: false, activeVariant: "A", bodyB: "", aOff: false,
  sub: "cuentas", checked3: false, ooo: false, launched: false,
});
const VAR_FINAL = (): CampaignState => ({ ...SEQ_FINAL(), variants: true, activeVariant: "A", bodyB: BODY_B, aOff: true });

function SequenceView({ t, hover }: SceneCtx) {
  if (!on(t, S_NEW)) {
    return (
      <div>
        <PageTitle title="Campañas" sub="Tus secuencias de correo" right={<Btn id="btn-new-campaign" hover={hover}><Plus className="h-3.5 w-3.5" /> Crear campaña</Btn>} />
        <Card className="overflow-hidden">
          {[{ n: "Agencias · Madrid", st: "Activa", tone: "green" as const, r: "7,1 %" }, { n: "Ecommerce · Q1", st: "Pausada", tone: "amber" as const, r: "4,3 %" }].map((c) => (
            <div key={c.n} className="flex items-center gap-3 border-b border-border/70 px-4 py-3 text-[12.5px] last:border-0">
              <span className="flex-1 font-semibold">{c.n}</span><Chip tone={c.tone}>{c.st}</Chip><span className="w-28 text-right text-muted-foreground">{c.r} respuestas</span>
            </div>
          ))}
        </Card>
      </div>
    );
  }
  const s: CampaignState = {
    ...SEQ_FINAL(),
    tab: on(t, S_EDITOR) ? "editor" : "analitica",
    subject: on(t, S_EDITOR) ? typed(SUBJECT, t, S_EDITOR + 300, 22) : "",
    steps: on(t, S_ADD) ? 3 : 2,
    step3New: on(t, S_ADD),
  };
  return <div className="animate-in fade-in duration-500"><CampaignDetailView s={s} hover={hover} t={t} /></div>;
}

function VariantsView({ t, hover }: SceneCtx) {
  const added = on(t, V_ADD);
  const s: CampaignState = {
    ...SEQ_FINAL(),
    variants: added,
    activeVariant: added && !on(t, V_TAB_A) ? "B" : "A",
    bodyB: typed(BODY_B, t, V_TYPE, 30),
    aOff: on(t, V_OFF),
  };
  return <CampaignDetailView s={s} hover={hover} t={t} />;
}

function SettingsView({ t, hover }: SceneCtx) {
  const s: CampaignState = {
    ...VAR_FINAL(),
    tab: on(t, G_AJUSTES) ? "ajustes" : "editor",
    sub: on(t, G_OPCIONES) ? "opciones" : on(t, G_HORARIO) ? "horario" : "cuentas",
    checked3: on(t, G_CHECK),
    ooo: on(t, G_OOO),
    launched: on(t, G_LAUNCH),
  };
  return <CampaignDetailView s={s} hover={hover} t={t} />;
}

/* ─────────────────────────────── 7 · Unibox ─────────────────────────────── */

const uniCursor: CursorStep[] = [
  { at: 300, target: "nav-unibox", click: true },
  { at: 1900, target: "filter-interested", click: true },
  { at: 3600, target: "conv-1", click: true },
  { at: 8300, target: "btn-send-draft", click: true },
  { at: 10800, target: "conv-2" },
];
const U_NAV = clickAt(uniCursor[0]);
const U_FILTER = clickAt(uniCursor[1]);
const U_OPEN = clickAt(uniCursor[2]);
const U_SEND = clickAt(uniCursor[3]);
const DRAFT = "¡Genial, Laura! ¿Te va bien el jueves a las 11:00? Te mando la invitación con el enlace.";

const CONVS = [
  { id: "conv-1", n: "Laura · Clínica Norte", m: "Suena interesante, ¿hablamos el jueves?", tag: "Interesado", tone: "green" as const },
  { id: "conv-2", n: "Andrés · Logística Sur", m: "Sí, mándame más información.", tag: "Interesado", tone: "green" as const },
  { id: "conv-3", n: "Sergio · Talleres Ribera", m: "¿Funciona con Outlook?", tag: "Pregunta", tone: "sky" as const },
  { id: "conv-4", n: "Marta · Estudio Lúa", m: "Estoy fuera hasta el día 20.", tag: "Fuera / Auto", tone: "pink" as const },
  { id: "conv-5", n: "Nuria · Grupo Brisa", m: "Ahora no nos interesa, gracias.", tag: "No interesado", tone: "red" as const },
];

function UniboxView({ t, hover }: SceneCtx) {
  const filtered = on(t, U_FILTER);
  const open = on(t, U_OPEN);
  const sent = on(t, U_SEND);
  const list = filtered ? CONVS.filter((c) => c.tag === "Interesado") : CONVS;
  return (
    <div>
      <PageTitle title="Unibox" sub="Todas tus respuestas, de todos tus buzones" />
      <div className="mb-3 flex gap-1.5">
        {[{ id: "filter-all", l: "Todos", a: !filtered }, { id: "filter-interested", l: "Interesado", a: filtered }, { id: "filter-q", l: "Pregunta", a: false }, { id: "filter-ooo", l: "Fuera / Auto", a: false }].map((f) => (
          <span key={f.id} data-tour={f.id} className={cn("rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors", f.a ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground", hl(hover, f.id))}>{f.l}</span>
        ))}
      </div>
      <div className="grid h-[400px] grid-cols-[280px_1fr] gap-3">
        <Card className="overflow-hidden">
          {list.map((c) => (
            <div key={c.id} data-tour={c.id} className={cn("border-b border-border/70 px-3 py-2.5 transition-colors", open && c.id === "conv-1" && "bg-primary/[0.06]", hl(hover, c.id))}>
              <div className="flex items-center justify-between gap-2"><span className="truncate text-[12px] font-semibold">{c.n}</span><Chip tone={c.tone}>{c.tag}</Chip></div>
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{c.m}</p>
            </div>
          ))}
        </Card>
        <Card className="flex flex-col p-4">
          {open ? (
            <div className="flex h-full flex-col animate-in fade-in duration-500">
              <div className="mb-3 flex items-center gap-2"><span className="text-[13px] font-semibold">Laura · Clínica Norte</span><Chip tone="green">Interesado</Chip></div>
              <div className="w-[85%] rounded-lg bg-secondary px-3 py-2 text-[12px]">Hola, suena interesante. ¿Podemos hablar el jueves? Un saludo, Laura</div>
              {sent && <div className="ml-auto mt-2 w-[85%] rounded-lg bg-primary px-3 py-2 text-[12px] text-white animate-in fade-in slide-in-from-bottom-1 duration-500">{DRAFT}<span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-white/80"><Check className="h-3 w-3" /> Enviado</span></div>}
              {!sent && (
                <div className="mt-auto rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-primary"><BotMessageSquare className="h-3.5 w-3.5" /> Borrador del agente de respuestas</p>
                  <p className="min-h-[36px] text-[12px]">{typed(DRAFT, t, U_OPEN + 600, 30)}</p>
                  <div className="mt-2 flex justify-end gap-2"><Btn id="btn-edit-draft" hover={hover} ghost>Editar</Btn><Btn id="btn-send-draft" hover={hover}><Send className="h-3.5 w-3.5" /> Enviar</Btn></div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground"><Inbox className="h-8 w-8" /><p className="text-[12px]">Elige una conversación</p></div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────────────── 8 · Equipo IA y estadísticas ─────────────────────────────── */

const aiCursor: CursorStep[] = [
  { at: 300, target: "nav-personalizacion", click: true },
  { at: 3200, target: "nav-agentes", click: true },
  { at: 6100, target: "nav-entregabilidad", click: true },
  { at: 9000, target: "nav-stats", click: true },
];
const I_P = clickAt(aiCursor[0]);
const I_A = clickAt(aiCursor[1]);
const I_E = clickAt(aiCursor[2]);
const I_S = clickAt(aiCursor[3]);
const PERSONAL = [
  "Vi que abristeis la nueva clínica en Ruzafa: enhorabuena.",
  "Me llamó la atención vuestro servicio de recogida en 24 h.",
  "Vuestro proyecto para la biblioteca de Deusto es precioso.",
  "Leí que estáis ampliando la flota en la Costa del Sol.",
];

function AiView({ t }: SceneCtx) {
  if (on(t, I_S)) {
    const bars = [{ n: "Clínicas y talleres", v: 7.4 }, { n: "Agencias · Madrid", v: 7.1 }, { n: "Ecommerce · Q1", v: 4.3 }];
    const k = prog(t, I_S, I_S + 900);
    return (
      <div key="s" className="animate-in fade-in duration-500">
        <PageTitle title="Estadísticas" sub="Respuestas por campaña" />
        <Card className="space-y-3 p-5">
          {bars.map((b) => (
            <div key={b.n}>
              <div className="mb-1 flex justify-between text-[12px]"><span className="font-semibold">{b.n}</span><span className="text-muted-foreground">{b.v.toFixed(1).replace(".", ",")} %</span></div>
              <span className="block h-3 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-gradient-to-r from-[#6E58F1] to-[#8B6BFF]" style={{ width: `${(b.v / 8) * 100 * k}%` }} /></span>
            </div>
          ))}
        </Card>
      </div>
    );
  }
  if (on(t, I_E)) {
    const k = prog(t, I_E, I_E + 900);
    const rows = [{ n: "Bandeja principal", v: 92, c: "bg-emerald-500" }, { n: "Promociones", v: 6, c: "bg-amber-400" }, { n: "Spam", v: 2, c: "bg-red-500" }];
    return (
      <div key="e" className="animate-in fade-in duration-500">
        <PageTitle title="Entregabilidad" sub="Prueba dónde caen tus correos" />
        <Card className="space-y-3 p-5">
          {rows.map((r) => (
            <div key={r.n} className="flex items-center gap-3 text-[12px]">
              <span className="w-32 font-semibold">{r.n}</span>
              <span className="h-3 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", r.c)} style={{ width: `${r.v * k}%` }} /></span>
              <span className="w-10 text-right font-semibold">{Math.round(r.v * k)} %</span>
            </div>
          ))}
        </Card>
      </div>
    );
  }
  if (on(t, I_A)) {
    return (
      <div key="a" className="animate-in fade-in duration-500">
        <PageTitle title="Agentes" sub="Cómo responde la IA por ti" />
        <div className="space-y-2">
          {[{ w: "Interesado", d: "Proponer día y hora para una llamada", tone: "green" as const }, { w: "Pregunta", d: "Responder con la información de tu empresa", tone: "sky" as const }, { w: "Fuera / Auto", d: "Esperar a que vuelva y seguir la secuencia", tone: "pink" as const }].map((r) => (
            <Card key={r.w} className="flex items-center gap-3 p-3.5 text-[12.5px]">
              <span className="text-muted-foreground">Si es</span><Chip tone={r.tone}>{r.w}</Chip><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="flex-1 font-medium">{r.d}</span><Toggle hover={null} on />
            </Card>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div key="p" className="animate-in fade-in duration-500">
      <PageTitle title="Personalización" sub="La IA escribe un mensaje para cada lead" />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[120px_1fr] gap-2 border-b border-border bg-secondary/50 px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground"><span>Lead</span><span className="normal-case text-primary">{"{{personalized_message}}"}</span></div>
        {LEADS.slice(0, 4).map((l, i) => {
          const start = I_P + 300 + i * 450;
          return (
            <div key={l.n} className="grid grid-cols-[120px_1fr] gap-2 border-b border-border/70 px-3.5 py-2.5 text-[12px] last:border-0">
              <span className="font-medium">{l.n}</span>
              <span className="flex items-center gap-1.5">{on(t, start) ? typed(PERSONAL[i], t, start, 60) : <span className="flex items-center gap-1.5 text-muted-foreground"><Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" /> Escribiendo…</span>}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ─────────────────────────────── 9 · FunnyBot y Funny Team ─────────────────────────────── */

const helpCursor: CursorStep[] = [
  { at: 400, target: "chat-bubble", click: true },
  { at: 5400, target: "chat-bubble", click: true },
  { at: 6600, target: "nav-funnyteam", click: true },
  { at: 8400, target: "cal-day", click: true },
  { at: 9900, target: "cal-slot", click: true },
];
const H_OPEN = clickAt(helpCursor[0]);
const H_CLOSE = clickAt(helpCursor[1]);
const H_NAV = clickAt(helpCursor[2]);
const H_DAY = clickAt(helpCursor[3]);
const H_SLOT = clickAt(helpCursor[4]);
const Q = "¿Cómo subo el límite diario de un buzón?";

function HelpView({ t, hover }: SceneCtx) {
  const chat = on(t, H_OPEN) && !on(t, H_CLOSE);
  const team = on(t, H_NAV);
  return (
    <div className="relative h-[516px]">
      {team ? (
        <div className="animate-in fade-in duration-500">
          <div className="mb-3 rounded-xl bg-gradient-to-br from-[#3B2BD9] via-[#6E58F1] to-[#4F8BFF] px-5 py-4 text-white">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/75">Funny Team</p>
            <p className="font-display text-[18px] font-semibold tracking-[-0.02em]">Reserva una reunión con tu equipo</p>
          </div>
          <div className="grid grid-cols-[1fr_200px] gap-3">
            <Card className="p-3.5">
              <p className="mb-2 text-[12px] font-semibold">Noviembre</p>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                {["L", "M", "X", "J", "V", "S", "D"].map((d) => <span key={d} className="text-muted-foreground">{d}</span>)}
                {/* Noviembre de 2026 empieza en domingo: seis huecos antes del día 1. */}
                {Array.from({ length: 6 }, (_, i) => <span key={`b${i}`} />)}
                {Array.from({ length: 30 }, (_, i) => {
                  const day = i + 1;
                  const free = [12, 13, 16, 17, 18, 19, 20].includes(day);
                  const sel = day === 12 && on(t, H_DAY);
                  return <span key={day} data-tour={day === 12 ? "cal-day" : undefined} className={cn("rounded-md py-1", free ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground/60", sel && "bg-primary text-white", day === 12 && hl(hover, "cal-day"))}>{day}</span>;
                })}
              </div>
            </Card>
            <Card className="p-3">
              <p className="mb-2 text-[11.5px] font-semibold">{on(t, H_DAY) ? "Jueves 12" : "Elige un día"}</p>
              {on(t, H_DAY) && ["10:00", "10:30", "11:00", "12:30"].map((h) => (
                <span key={h} data-tour={h === "10:30" ? "cal-slot" : undefined} className={cn("mb-1.5 block rounded-md border border-primary/40 py-1.5 text-center text-[12px] font-semibold text-primary animate-in fade-in duration-300", h === "10:30" && on(t, H_SLOT) && "bg-primary text-white", h === "10:30" && hl(hover, "cal-slot"))}>{h}</span>
              ))}
            </Card>
          </div>
          <Fade show={on(t, H_SLOT + 400)} className="absolute inset-x-0 bottom-16 flex justify-center">
            <span className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-lg"><Check className="h-4 w-4" /> Reunión reservada · jueves 12 a las 10:30</span>
          </Fade>
        </div>
      ) : (
        <AiView t={99999} hover={null} />
      )}
      <Fade show={chat} className="absolute bottom-16 right-0 z-20 w-[300px]">
        <Card className="overflow-hidden shadow-[0_18px_44px_rgba(21,17,60,.18)]">
          <div className="bg-gradient-to-br from-[#5B40FB] to-[#8B6BFF] px-4 py-3 text-white">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Sparkles className="h-3.5 w-3.5" /> Asistente IA</p>
            <p className="font-display text-[16px] font-semibold">¿Cómo podemos ayudarte?</p>
          </div>
          <div className="space-y-2 p-3 text-[11.5px]">
            {on(t, H_OPEN + 500) && <div className="ml-auto w-fit max-w-[85%] rounded-xl bg-primary px-2.5 py-1.5 text-white">{typed(Q, t, H_OPEN + 500, 26)}</div>}
            {on(t, H_OPEN + 2600) && <div className="w-fit max-w-[90%] rounded-xl bg-secondary px-2.5 py-1.5 animate-in fade-in duration-300">En <b>Cuentas Email</b>, abre la cuenta y cambia el límite diario. Si está con slow ramp, sube solo cada día.</div>}
          </div>
        </Card>
      </Fade>
    </div>
  );
}

/* ─────────────────────────────── Las escenas, en orden ─────────────────────────────── */

const navAt = (steps: CursorStep[], nav: NavId[]) => (t: number): NavId | null => {
  let cur: NavId | null = null;
  steps.filter((s) => s.click && s.target.startsWith("nav-")).forEach((s, i) => { if (t >= clickAt(s)) cur = nav[i] ?? cur; });
  return cur;
};

export const SCENES: Scene[] = [
  { id: "dashboard", cursor: dashCursor, navClickAt: D_NAV, nav: navAt(dashCursor, ["dashboard"]), render: (c) => <DashboardView {...c} /> },
  { id: "accounts", cursor: accCursor, navClickAt: A_NAV, nav: navAt(accCursor, ["accounts"]), render: (c) => <AccountsView {...c} /> },
  { id: "leads", cursor: leadsCursor, navClickAt: L_NAV, nav: navAt(leadsCursor, ["leads"]), render: (c) => <LeadsView {...c} /> },
  { id: "sequence", cursor: seqCursor, navClickAt: S_NAV, nav: navAt(seqCursor, ["campaigns"]), render: (c) => <SequenceView {...c} /> },
  { id: "variants", cursor: varCursor, nav: () => null, render: (c) => <VariantsView {...c} /> },
  { id: "settings", cursor: setCursor, nav: () => null, render: (c) => <SettingsView {...c} /> },
  { id: "unibox", cursor: uniCursor, navClickAt: U_NAV, nav: navAt(uniCursor, ["unibox"]), render: (c) => <UniboxView {...c} /> },
  { id: "ai", cursor: aiCursor, navClickAt: I_P, nav: navAt(aiCursor, ["personalizacion", "agentes", "entregabilidad", "stats"]), render: (c) => <AiView {...c} /> },
  { id: "help", cursor: helpCursor, nav: navAt(helpCursor, ["funnyteam"]), render: (c) => <HelpView {...c} /> },
];

/** Sección del menú activa: la de la escena o, si no ha cambiado aún, la de las anteriores. */
export function activeNav(index: number, t: number): NavId | null {
  for (let i = index; i >= 0; i--) {
    const s = SCENES[i];
    const n = s.nav(i === index ? t : Number.POSITIVE_INFINITY);
    if (n) return n;
  }
  return null;
}

/** El paso del cursor vigente en el instante t (el último que ya ha salido). */
export function cursorStepAt(index: number, t: number): CursorStep | null {
  const steps = SCENES[index]?.cursor ?? [];
  let cur: CursorStep | null = null;
  for (const s of steps) if (t >= s.at) cur = s;
  return cur;
}

/** ¿Está el cursor haciendo clic ahora? (para la onda y el "apretón") */
export function clickingAt(index: number, t: number): number | null {
  for (const s of SCENES[index]?.cursor ?? []) {
    if (!s.click) continue;
    const c = clickAt(s);
    if (t >= c && t < c + 450) return c;
  }
  return null;
}

/** El contenido de la pantalla: antes del primer clic en el menú se ve aún la pantalla anterior. */
export function renderScene(index: number, t: number, hover: string | null): ReactNode {
  const s = SCENES[index];
  if (!s) return null;
  if (index > 0 && s.navClickAt !== undefined && t < s.navClickAt) {
    return SCENES[index - 1].render({ t: Number.POSITIVE_INFINITY, hover });
  }
  return s.render({ t, hover });
}

export function sceneChatOpen(index: number, t: number): boolean {
  return SCENES[index]?.id === "help" && t >= H_OPEN && t < H_CLOSE;
}
