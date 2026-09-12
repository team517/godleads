// Área del cliente — lo único que ve la cuenta de acceso de un cliente.
//
// Es de SOLO LECTURA por diseño: aquí no hay un solo botón que cree, cambie o
// borre nada. Lo que puede mirar tampoco se decide aquí: `my_client_context()`
// devuelve la lista de secciones que el dueño le ha dado (y no devuelve NADA si
// quien llama no es la cuenta de acceso de un cliente), y cada función de datos
// (`client_campaign_stats`, `client_inbox`, `client_daily_stats`,
// `client_ai_stats`) sólo responde al dueño o a esa misma cuenta. Esta pantalla
// se limita a pintar lo que el servidor entrega, y el único `client_id` que
// viaja es el que devolvió `my_client_context()`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { brandStyleFor } from "@/lib/brandColor";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Brain,
  Building2,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  MailWarning,
  MessageSquareReply,
  Percent,
  Send,
  Users,
} from "lucide-react";

/** Las únicas secciones que existen, en el mismo orden y con los mismos iconos
 *  que en la barra lateral de la agencia. Lo que venga fuera de esta lista se
 *  ignora: la lista blanca del servidor es la misma, esta es la segunda red. */
const AREA_SECTIONS = ["dashboard", "campanas", "unibox", "estadisticas", "ia"] as const;
type AreaSection = (typeof AREA_SECTIONS)[number];

const SECTION_META: Record<AreaSection, { label: string; icon: LucideIcon }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  campanas: { label: "Campañas", icon: Send },
  unibox: { label: "Unibox", icon: Inbox },
  estadisticas: { label: "Estadísticas", icon: BarChart3 },
  ia: { label: "IA", icon: Brain },
};

export type ClientContext = {
  client_id: string;
  owner_user_id: string;
  name: string;
  company_name: string | null;
  logo_url: string | null;
  brand_color: string | null;
  sections: string[] | null;
};

export type CampaignStat = {
  campaign_id: string;
  name: string;
  status: string;
  created_at: string;
  leads: number;
  sent: number;
  replied: number;
  bounced: number;
};

export type InboxItem = {
  id: string;
  received_at: string;
  from_email: string;
  from_name: string;
  subject: string;
  preview: string;
  labels: string[];
  campaign_name: string;
};

export type DailyPoint = { dia: string; enviados: number; respuestas: number };

export type AiStat = { categoria: string; total: number };

/** Pastilla de estado CUADRADA, igual que en la tabla de campañas de la agencia:
 *  tokens (`success`/`warning`/`info`/`muted`) que ya se aclaran en `.dark`. */
const STATUS_PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-[3px] text-[13px] font-semibold leading-none";

const statusPill: Record<string, { label: string; className: string; dot: string }> = {
  active: { label: "Activa", className: "bg-success/12 text-success border-success/25", dot: "bg-success" },
  running: { label: "Activa", className: "bg-success/12 text-success border-success/25", dot: "bg-success" },
  paused: { label: "En pausa", className: "bg-warning/15 text-warning border-warning/30", dot: "bg-warning" },
  draft: { label: "Borrador", className: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/60" },
  completed: { label: "Terminada", className: "bg-info/12 text-info border-info/25", dot: "bg-info" },
  stopped: { label: "Parada", className: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/60" },
};

/** El MISMO tono por categoría que usa el Unibox de la agencia, para que una
 *  respuesta "Interesado" se vea verde en los dos sitios. Literales completos
 *  (no plantillas) porque Tailwind purga lo que no ve escrito. */
const LABEL_HUES: Record<string, { chip: string; dot: string }> = {
  Interesado: { chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", dot: "bg-emerald-500" },
  Pregunta: { chip: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300", dot: "bg-sky-500" },
  "No interesado": { chip: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300", dot: "bg-red-500" },
  "No contactar": { chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300", dot: "bg-rose-600" },
  Derivado: { chip: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", dot: "bg-amber-500" },
  "Fuera / Auto": { chip: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300", dot: "bg-pink-500" },
  "Fuera/Auto": { chip: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300", dot: "bg-pink-500" },
};

const NEUTRAL_HUE = { chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" };
const hueFor = (label: string) => LABEL_HUES[label] || NEUTRAL_HUE;

/** Ficha mini CUADRADA — misma forma que las etiquetas del Unibox. */
const CHIP = "inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[10.5px] font-semibold leading-none";

const INBOX_PAGE = 25;
const DASHBOARD_GLANCE = 5;
const STATS_DAYS = 30;

const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => String(v ?? "");

/** Fecha en relativo corto; el cliente quiere saber "cuándo", no el sello exacto. */
function relativeDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(t).toLocaleDateString("es", { day: "numeric", month: "short" });
}

// ── Piezas de interfaz ───────────────────────────────────────────────────────

function Metric({
  icon,
  value,
  label,
  suffix,
  className,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-rest">
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
        {icon} {label}
      </span>
      <p
        className={`mt-1 font-display text-[24px] font-semibold tabular-nums tracking-[-0.03em] ${
          className || "text-foreground"
        }`}
      >
        {value}
        {suffix && <span className="ml-0.5 text-[15px] font-semibold">{suffix}</span>}
      </p>
    </div>
  );
}

/** Un panel honesto: si no hay datos se dice, nunca se inventa un número. */
function NadaTodavia({ title, help }: { title: string; help: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
      <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{help}</p>
    </div>
  );
}

function Cargando({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card p-6 text-[13px] text-muted-foreground shadow-rest">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando {what}…
    </div>
  );
}

function FalloDeSeccion({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
      <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-destructive">
        No pudimos cargar esta sección
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-[-0.03em] text-foreground">
      {icon} {children}
    </h2>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = statusPill[status] || { label: status || "—", className: statusPill.draft.className, dot: statusPill.draft.dot };
  return (
    <span className={`${STATUS_PILL_BASE} ${s.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" /> {s.label}
    </span>
  );
}

/** Las funciones nuevas todavía no están en los tipos generados de Supabase, así
 *  que se llaman por esta vista mínima en vez de con `any`. */
type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};
const rpcClient = supabase as unknown as RpcCaller;

type Status = "idle" | "loading" | "ready" | "error";
type Res<T> = { status: Status; data: T; error: string | null };
const start = <T,>(d: T): Res<T> => ({ status: "idle", data: d, error: null });

async function rpcRows(fn: string, args: Record<string, unknown>) {
  const { data, error } = await rpcClient.rpc(fn, args);
  if (error) throw new Error(error.message || "El servidor no respondió.");
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export default function AreaCliente() {
  const { signOut } = useAuth();
  const [ctx, setCtx] = useState<ClientContext | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_client" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<AreaSection | null>(null);

  const [campaigns, setCampaigns] = useState<Res<CampaignStat[]>>(() => start<CampaignStat[]>([]));
  const [inbox, setInbox] = useState<Res<InboxItem[]>>(() => start<InboxItem[]>([]));
  const [inboxDone, setInboxDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [daily, setDaily] = useState<Res<DailyPoint[]>>(() => start<DailyPoint[]>([]));
  const [ai, setAi] = useState<Res<AiStat[]>>(() => start<AiStat[]>([]));

  const loadCtx = useCallback(async () => {
    setState("loading");
    setError(null);
    const { data, error: rpcErr } = await rpcClient.rpc("my_client_context");
    if (rpcErr) {
      setError(rpcErr.message || "No pudimos cargar tu área.");
      setState("error");
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as ClientContext | undefined;
    if (!row?.client_id) {
      // Esta cuenta no es el acceso de ningún cliente: no es su sitio.
      setState("not_client");
      return;
    }
    setCtx(row);
    setState("ready");
  }, []);

  useEffect(() => {
    loadCtx();
  }, [loadCtx]);

  // Lo que el servidor concede, cruzado con la lista blanca de esta pantalla.
  const sections = useMemo<AreaSection[]>(() => {
    const raw = ctx?.sections || [];
    return AREA_SECTIONS.filter((s) => raw.includes(s));
  }, [ctx]);

  // La primera sección concedida es la que se abre.
  useEffect(() => {
    setActive((cur) => (cur && sections.includes(cur) ? cur : sections[0] || null));
  }, [sections]);

  const clientId = ctx?.client_id || null;

  const fetchCampaigns = useCallback(async (id: string) => {
    setCampaigns((r) => ({ ...r, status: "loading", error: null }));
    try {
      const rows = await rpcRows("client_campaign_stats", { p_client_id: id });
      setCampaigns({
        status: "ready",
        error: null,
        data: rows.map((r) => ({
          campaign_id: str(r.campaign_id),
          name: str(r.name),
          status: str(r.status),
          created_at: str(r.created_at),
          leads: num(r.leads),
          sent: num(r.sent),
          replied: num(r.replied),
          bounced: num(r.bounced),
        })),
      });
    } catch (e) {
      setCampaigns({ status: "error", data: [], error: (e as Error).message });
    }
  }, []);

  const mapInbox = (rows: Record<string, unknown>[]): InboxItem[] =>
    rows.map((r) => ({
      id: str(r.id),
      received_at: str(r.received_at),
      from_email: str(r.from_email),
      from_name: str(r.from_name),
      subject: str(r.subject),
      preview: str(r.preview),
      labels: Array.isArray(r.labels) ? (r.labels as unknown[]).map((l) => String(l)).filter(Boolean) : [],
      campaign_name: str(r.campaign_name),
    }));

  const fetchInbox = useCallback(async (id: string) => {
    setInbox((r) => ({ ...r, status: "loading", error: null }));
    setInboxDone(false);
    try {
      const rows = await rpcRows("client_inbox", { p_client_id: id, p_limit: INBOX_PAGE, p_offset: 0 });
      const list = mapInbox(rows);
      setInbox({ status: "ready", data: list, error: null });
      setInboxDone(list.length < INBOX_PAGE);
    } catch (e) {
      setInbox({ status: "error", data: [], error: (e as Error).message });
    }
  }, []);

  /** "Ver más": la siguiente página con el `p_offset` que toca. */
  const moreInbox = useCallback(async () => {
    if (!clientId || loadingMore) return;
    setLoadingMore(true);
    try {
      const rows = await rpcRows("client_inbox", {
        p_client_id: clientId,
        p_limit: INBOX_PAGE,
        p_offset: inbox.data.length,
      });
      const list = mapInbox(rows);
      // Por si una respuesta nueva ha corrido la ventana: nunca se repite una fila.
      setInbox((r) => {
        const seen = new Set(r.data.map((m) => m.id));
        return { status: "ready", error: null, data: [...r.data, ...list.filter((m) => !seen.has(m.id))] };
      });
      if (list.length < INBOX_PAGE) setInboxDone(true);
    } catch (e) {
      setInbox((r) => ({ ...r, error: (e as Error).message }));
    }
    setLoadingMore(false);
  }, [clientId, inbox.data.length, loadingMore]);

  const fetchDaily = useCallback(async (id: string) => {
    setDaily((r) => ({ ...r, status: "loading", error: null }));
    try {
      const rows = await rpcRows("client_daily_stats", { p_client_id: id, p_days: STATS_DAYS });
      setDaily({
        status: "ready",
        error: null,
        data: rows.map((r) => ({ dia: str(r.dia), enviados: num(r.enviados), respuestas: num(r.respuestas) })),
      });
    } catch (e) {
      setDaily({ status: "error", data: [], error: (e as Error).message });
    }
  }, []);

  const fetchAi = useCallback(async (id: string) => {
    setAi((r) => ({ ...r, status: "loading", error: null }));
    try {
      const rows = await rpcRows("client_ai_stats", { p_client_id: id });
      setAi({
        status: "ready",
        error: null,
        data: rows.map((r) => ({ categoria: str(r.categoria), total: num(r.total) })),
      });
    } catch (e) {
      setAi({ status: "error", data: [], error: (e as Error).message });
    }
  }, []);

  // Cada sección pide sus datos la primera vez que se abre, y no los vuelve a
  // pedir al cambiar de pestaña. `asked` recuerda lo ya pedido.
  const asked = useRef<Set<string>>(new Set());
  const once = useCallback((key: string, run: () => void) => {
    if (asked.current.has(key)) return;
    asked.current.add(key);
    run();
  }, []);
  const retry = useCallback((key: string, run: () => void) => {
    asked.current.add(key);
    run();
  }, []);

  useEffect(() => {
    if (!clientId || !active) return;
    if (active === "dashboard") {
      once("campaigns", () => fetchCampaigns(clientId));
      once("inbox", () => fetchInbox(clientId));
    }
    if (active === "campanas") once("campaigns", () => fetchCampaigns(clientId));
    if (active === "unibox") once("inbox", () => fetchInbox(clientId));
    if (active === "estadisticas") once("daily", () => fetchDaily(clientId));
    if (active === "ia") once("ai", () => fetchAi(clientId));
  }, [clientId, active, once, fetchCampaigns, fetchInbox, fetchDaily, fetchAi]);

  const totals = useMemo(
    () =>
      campaigns.data.reduce(
        (a, c) => ({
          leads: a.leads + c.leads,
          sent: a.sent + c.sent,
          replied: a.replied + c.replied,
          bounced: a.bounced + c.bounced,
        }),
        { leads: 0, sent: 0, replied: 0, bounced: 0 },
      ),
    [campaigns.data],
  );

  const replyRate = totals.sent > 0 ? (totals.replied / totals.sent) * 100 : null;

  const chartData = useMemo(
    () =>
      daily.data.map((p) => {
        const d = new Date(`${p.dia}T00:00:00`);
        return {
          ...p,
          label: d.toLocaleDateString("es", { day: "numeric", month: "short" }),
          full: d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }),
        };
      }),
    [daily.data],
  );

  const chartHasData = chartData.some((p) => p.enviados > 0 || p.respuestas > 0);
  const aiTotal = useMemo(() => ai.data.reduce((s, r) => s + r.total, 0), [ai.data]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state === "not_client") return <Navigate to="/dashboard" replace />;

  if (state === "error") {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
          <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-destructive">
            No pudimos cargar tu área
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={loadCtx}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const ActiveIcon = active ? SECTION_META[active].icon : Building2;

  return (
    <div className="min-h-screen bg-background" style={brandStyleFor(ctx?.brand_color)}>
      {/* Cabecera con la marca del cliente */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {ctx?.logo_url ? (
              <img src={ctx.logo_url} alt={ctx?.name || "logo"} className="h-9 max-w-[140px] rounded-md object-contain" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                {ctx?.company_name || ctx?.name}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">Tus campañas, en directo</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-[13px]">
              <Link to="/settings">
                <KeyRound className="h-3.5 w-3.5" /> Mi contraseña
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-[13px]" onClick={() => signOut()}>
              <LogOut className="h-3.5 w-3.5" /> Salir
            </Button>
          </div>
        </div>

        {/* Raíl de secciones: SÓLO las que el servidor ha concedido */}
        {sections.length > 0 && (
          <nav aria-label="Secciones" className="mx-auto max-w-5xl overflow-x-auto px-4">
            <div className="flex items-center gap-1 pb-1">
              {sections.map((key) => {
                const meta = SECTION_META[key];
                const on = active === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActive(key)}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                      on
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    <meta.icon className="h-4 w-4" strokeWidth={1.9} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {sections.length === 0 && (
          <NadaTodavia
            title="Tu área está casi lista"
            help="Todavía no se ha abierto ninguna sección para ti. En cuanto tu agencia la active, aparecerá aquí."
          />
        )}

        {active && (
          <section className="space-y-3">
            <SectionTitle icon={<ActiveIcon className="h-4 w-4 text-primary" />}>{SECTION_META[active].label}</SectionTitle>

            {/* ── Dashboard ───────────────────────────────────────────────── */}
            {active === "dashboard" && (
              <>
                {campaigns.status === "error" ? (
                  <FalloDeSeccion
                    message={campaigns.error || ""}
                    onRetry={() => clientId && retry("campaigns", () => fetchCampaigns(clientId))}
                  />
                ) : campaigns.status !== "ready" ? (
                  <Cargando what="tus totales" />
                ) : campaigns.data.length === 0 ? (
                  <NadaTodavia
                    title="Todavía no hay cifras que sumar"
                    help="Cuando tu agencia ponga en marcha una campaña para ti, aquí verás sus totales."
                  />
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <Metric
                        icon={<Users className="h-3.5 w-3.5" />}
                        value={totals.leads.toLocaleString("es")}
                        label="Leads"
                        className="text-violet-600 dark:text-violet-400"
                      />
                      <Metric
                        icon={<Send className="h-3.5 w-3.5" />}
                        value={totals.sent.toLocaleString("es")}
                        label="Enviados"
                        className="text-indigo-600 dark:text-indigo-400"
                      />
                      <Metric
                        icon={<MessageSquareReply className="h-3.5 w-3.5" />}
                        value={totals.replied.toLocaleString("es")}
                        label="Respuestas"
                        className="text-teal-600 dark:text-teal-400"
                      />
                      <Metric
                        icon={<Percent className="h-3.5 w-3.5" />}
                        value={replyRate === null ? "—" : replyRate.toFixed(1).replace(".", ",")}
                        suffix={replyRate === null ? undefined : "%"}
                        label="Tasa de respuesta"
                      />
                      <Metric
                        icon={<MailWarning className="h-3.5 w-3.5" />}
                        value={totals.bounced.toLocaleString("es")}
                        label="Rebotes"
                      />
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      Suma de tus {campaigns.data.length} campaña{campaigns.data.length === 1 ? "" : "s"}.
                    </p>

                    {/* Un vistazo a lo último que ha entrado */}
                    <div className="space-y-2 pt-2">
                      <p className="text-[13px] font-semibold text-foreground">Últimas respuestas</p>
                      {inbox.status === "error" ? (
                        <FalloDeSeccion
                          message={inbox.error || ""}
                          onRetry={() => clientId && retry("inbox", () => fetchInbox(clientId))}
                        />
                      ) : inbox.status !== "ready" ? (
                        <Cargando what="tus respuestas" />
                      ) : inbox.data.length === 0 ? (
                        <NadaTodavia
                          title="Todavía no ha contestado nadie"
                          help="En cuanto un lead responda a una de tus campañas, su respuesta aparecerá aquí."
                        />
                      ) : (
                        <ul className="divide-y divide-border/60 rounded-md border border-border bg-card shadow-rest">
                          {inbox.data.slice(0, DASHBOARD_GLANCE).map((m) => (
                            <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-[15px] font-semibold text-foreground">
                                  {m.from_name || m.from_email}
                                </p>
                                <p className="truncate text-[13px] text-muted-foreground">{m.subject || "(sin asunto)"}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {m.labels.slice(0, 1).map((l) => (
                                  <span key={l} className={`${CHIP} ${hueFor(l).chip}`}>
                                    {l}
                                  </span>
                                ))}
                                <span className="whitespace-nowrap text-[12px] text-muted-foreground">
                                  {relativeDate(m.received_at)}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Campañas ────────────────────────────────────────────────── */}
            {active === "campanas" && (
              <>
                {campaigns.status === "error" ? (
                  <FalloDeSeccion
                    message={campaigns.error || ""}
                    onRetry={() => clientId && retry("campaigns", () => fetchCampaigns(clientId))}
                  />
                ) : campaigns.status !== "ready" ? (
                  <Cargando what="tus campañas" />
                ) : campaigns.data.length === 0 ? (
                  <NadaTodavia
                    title="Todavía no hay nada que mostrar aquí"
                    help="Cuando tu agencia ponga en marcha una campaña para ti, la verás en esta lista con sus cifras."
                  />
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border bg-card shadow-rest">
                    <table className="w-full min-w-[640px] border-collapse text-[15px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/50 text-[13px] font-semibold text-muted-foreground">
                          <th scope="col" className="px-4 py-2.5 text-left">Nombre</th>
                          <th scope="col" className="px-4 py-2.5 text-left">Estado</th>
                          <th scope="col" className="px-4 py-2.5 text-right">Leads</th>
                          <th scope="col" className="px-4 py-2.5 text-right">Enviados</th>
                          <th scope="col" className="px-4 py-2.5 text-right">Respuestas</th>
                          <th scope="col" className="px-4 py-2.5 text-right">Rebotes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.data.map((c) => (
                          <tr key={c.campaign_id} className="border-b border-border/60 last:border-b-0">
                            <td className="px-4 py-3 font-semibold text-foreground">{c.name}</td>
                            <td className="px-4 py-3">
                              <StatusPill status={c.status} />
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                              {c.leads.toLocaleString("es")}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
                              {c.sent.toLocaleString("es")}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-teal-600 dark:text-teal-400">
                              {c.replied.toLocaleString("es")}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                              {c.bounced.toLocaleString("es")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ── Unibox (solo lectura) ───────────────────────────────────── */}
            {active === "unibox" && (
              <>
                {inbox.status === "error" ? (
                  <FalloDeSeccion
                    message={inbox.error || ""}
                    onRetry={() => clientId && retry("inbox", () => fetchInbox(clientId))}
                  />
                ) : inbox.status !== "ready" ? (
                  <Cargando what="tus respuestas" />
                ) : inbox.data.length === 0 ? (
                  <NadaTodavia
                    title="Todavía no ha contestado nadie"
                    help="Aquí aparecen las respuestas de los leads de tus campañas, en cuanto llegue la primera."
                  />
                ) : (
                  <>
                    <p className="text-[13px] text-muted-foreground">
                      Solo para leer: son las respuestas a tus campañas. Contestarlas es cosa de tu agencia.
                    </p>
                    <ul className="space-y-2">
                      {inbox.data.map((m) => (
                        <li key={m.id} className="rounded-md border border-border bg-card p-3 shadow-rest">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-semibold text-foreground">
                                {m.from_name || m.from_email}
                              </p>
                              {m.from_name && m.from_email && (
                                <p className="truncate text-[12px] text-muted-foreground">{m.from_email}</p>
                              )}
                            </div>
                            <span className="shrink-0 whitespace-nowrap text-[12px] text-muted-foreground">
                              {relativeDate(m.received_at)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-[13px] font-semibold text-foreground">
                            {m.subject || "(sin asunto)"}
                          </p>
                          {m.preview && <p className="mt-0.5 text-[13px] text-muted-foreground">{m.preview}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {m.campaign_name && (
                              <span className={`${CHIP} border border-border bg-muted/50 text-muted-foreground`}>
                                {m.campaign_name}
                              </span>
                            )}
                            {m.labels.map((l) => (
                              <span key={l} className={`${CHIP} ${hueFor(l).chip}`}>
                                {l}
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {inbox.error && <p className="text-[13px] font-semibold text-destructive">{inbox.error}</p>}
                    {!inboxDone && (
                      <Button variant="outline" size="sm" className="gap-2" disabled={loadingMore} onClick={moreInbox}>
                        {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />} Ver más
                      </Button>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Estadísticas ───────────────────────────────────────────── */}
            {active === "estadisticas" && (
              <>
                {daily.status === "error" ? (
                  <FalloDeSeccion
                    message={daily.error || ""}
                    onRetry={() => clientId && retry("daily", () => fetchDaily(clientId))}
                  />
                ) : daily.status !== "ready" ? (
                  <Cargando what="tus estadísticas" />
                ) : !chartHasData ? (
                  <NadaTodavia
                    title="Todavía no hay movimiento que dibujar"
                    help={`En estos ${STATS_DAYS} días no se ha enviado ni recibido nada tuyo. Cuando empiecen los envíos, aquí verás la evolución día a día.`}
                  />
                ) : (
                  <div className="rounded-md border border-border bg-card px-4 py-3 shadow-rest">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-muted-foreground">
                        Envíos y respuestas por día · últimos {STATS_DAYS} días
                      </p>
                      <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="h-2 w-2 rounded-sm bg-primary" />
                          {daily.data.reduce((s, p) => s + p.enviados, 0).toLocaleString("es")} envíos
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(var(--brand-teal))" }} />
                          {daily.data.reduce((s, p) => s + p.respuestas, 0).toLocaleString("es")} respuestas
                        </span>
                      </div>
                    </div>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: -22 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                            minTickGap={12}
                          />
                          <YAxis
                            allowDecimals={false}
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                            tickLine={false}
                            axisLine={false}
                            width={46}
                          />
                          <Tooltip
                            cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                            content={({ active: on, payload }) => {
                              if (!on || !payload?.length) return null;
                              const p = payload[0].payload as DailyPoint & { full: string };
                              return (
                                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-raised">
                                  <p className="mb-1 font-semibold capitalize">{p.full}</p>
                                  <p className="font-semibold text-primary">
                                    {p.enviados} {p.enviados === 1 ? "envío" : "envíos"}
                                  </p>
                                  {p.respuestas > 0 && (
                                    <p className="text-teal-600 dark:text-teal-400">
                                      {p.respuestas} {p.respuestas === 1 ? "respuesta" : "respuestas"}
                                    </p>
                                  )}
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="enviados" name="Envíos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={22} />
                          <Bar
                            dataKey="respuestas"
                            name="Respuestas"
                            fill="hsl(var(--brand-teal))"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={22}
                            minPointSize={(v: number) => (v > 0 ? 3 : 0)}
                          >
                            <LabelList
                              dataKey="respuestas"
                              position="top"
                              style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                              formatter={(v: unknown) => (Number(v) > 0 ? String(v) : "")}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── IA ─────────────────────────────────────────────────────── */}
            {active === "ia" && (
              <>
                <p className="text-[13px] text-muted-foreground">
                  La IA lee cada respuesta que llega a tus campañas y le pone una categoría. Esto es el reparto.
                </p>
                {ai.status === "error" ? (
                  <FalloDeSeccion message={ai.error || ""} onRetry={() => clientId && retry("ai", () => fetchAi(clientId))} />
                ) : ai.status !== "ready" ? (
                  <Cargando what="la clasificación de la IA" />
                ) : aiTotal === 0 ? (
                  <NadaTodavia
                    title="Todavía no hay respuestas que clasificar"
                    help="En cuanto lleguen las primeras respuestas, la IA las lee y verás aquí cuántas son de cada tipo."
                  />
                ) : (
                  <div className="space-y-2 rounded-md border border-border bg-card p-4 shadow-rest">
                    {ai.data.map((r) => {
                      const share = aiTotal > 0 ? (r.total / aiTotal) * 100 : 0;
                      const hue = hueFor(r.categoria);
                      return (
                        <div key={r.categoria} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-[13px]">
                            <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
                              <span className={`h-2 w-2 shrink-0 rounded-sm ${hue.dot}`} aria-hidden="true" />
                              <span className="truncate">{r.categoria}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              <span className="font-semibold text-foreground">{r.total.toLocaleString("es")}</span>{" "}
                              · {share.toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-muted">
                            <div className={`h-full rounded-sm ${hue.dot}`} style={{ width: `${Math.max(share, 2)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    <p className="pt-1 text-[13px] text-muted-foreground">
                      {aiTotal.toLocaleString("es")} respuesta{aiTotal === 1 ? "" : "s"} clasificada
                      {aiTotal === 1 ? "" : "s"} en total.
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <Card className="border-dashed">
          <CardContent className="p-4">
            <p className="text-[13px] text-muted-foreground">
              Esta área es solo de consulta: puedes mirar tus resultados, pero nada de lo que ves se puede cambiar desde
              aquí. Si algo no cuadra, dilo a tu agencia.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
