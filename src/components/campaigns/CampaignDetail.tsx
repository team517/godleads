import { useState, useEffect, lazy, Suspense, type ReactNode } from "react";
import { ArrowLeft, Eye, MoreVertical, Pause, Play, Rocket, Undo2, Redo2, SendHorizonal, Sparkles, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SparkMark } from "@/components/SparkMark";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWidget } from "@/hooks/useWidget";
import type { DailyRpcRow } from "@/lib/daily-rows";
import { campaignHealthReason, type CampaignHealthRow } from "@/lib/campaign-health";
import { CampaignHealthChip } from "@/components/campaigns/CampaignsTable";

/* Ficha de una campaña con el diseño del propietario (30-09-2026): barra de arriba con la chispa,
   volver, nombre, pestañas en el centro (Analítica · Editor · Leads · Ajustes) y, a la derecha,
   el estado, "Vista previa", "Lanzar" y el menú ⋮. Las secciones de antes siguen todas: Enviados
   va dentro de Analítica; CRM dentro de Leads; Cuentas, Horario, Opciones y Bajas en Ajustes. */

// Cada sección se carga sólo al abrirla (Analítica trae recharts, las demás también pesan).
const CampaignAnalytics = lazy(() => import("./CampaignAnalytics"));
const CampaignLeads = lazy(() => import("./CampaignLeads"));
const CampaignSequences = lazy(() => import("./CampaignSequences"));
const CampaignSchedule = lazy(() => import("./CampaignSchedule"));
const CampaignOptions = lazy(() => import("./CampaignOptions"));
const CampaignSentLog = lazy(() => import("./CampaignSentLog"));
const CampaignEmailAccounts = lazy(() => import("./CampaignEmailAccounts"));
const CampaignCRM = lazy(() => import("./CampaignCRM"));
const CampaignUnsubscribes = lazy(() => import("./CampaignUnsubscribes"));
const CampaignReportBar = lazy(() => import("./CampaignReportBar"));
const CampaignSendsChart = lazy(() => import("./CampaignSendsChart"));

type Tab = "analytics" | "editor" | "leads" | "settings";
type Command = { type: "undo" | "redo" | "fix" | "generate" | "test"; n: number };

const TABS: { id: Tab; label: string }[] = [
  { id: "analytics", label: "Analítica" },
  { id: "editor", label: "Editor" },
  { id: "leads", label: "Leads" },
  { id: "settings", label: "Ajustes" },
];

const STATUS: Record<string, { label: string; dot: string }> = {
  active: { label: "Activa", dot: "bg-emerald-500" },
  paused: { label: "Pausada", dot: "bg-amber-500" },
  draft: { label: "Borrador", dot: "bg-[#9aa0c2]" },
  completed: { label: "Completada", dot: "bg-sky-500" },
};

interface Props {
  campaign: any;
  /** El nombre editable (lo pinta la página, que sabe guardarlo). */
  nameSlot: ReactNode;
  /** Métricas para la barra de informe (la lista mezcla `contacted` con el progreso de leads). */
  metrics?: any;
  /** Salud de la campaña activa (campaign_health_mine): por qué no envía; null/ausente = sin chip. */
  health?: CampaignHealthRow | null;
  /** Fila CRUDA de campaign_metrics_v2 para la pestaña Analítica (respeta "Reiniciar analíticas"). */
  rawMetrics?: any;
  metricsError?: string | null;
  onRetryMetrics?: () => void;
  onBack: () => void;
  onToggleStatus: () => void;
  /** Tras "Reiniciar analíticas": la página vuelve a pedir las métricas de las campañas. */
  onMetricsStale?: () => void;
}

function SubTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          className={cn(
            "rounded-full px-4 py-1.5 text-[13.5px] font-semibold transition-colors",
            value === it.id ? "bg-[#111633] text-white dark:bg-foreground dark:text-background" : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

const Loading = () => <div className="py-12 text-center text-sm text-muted-foreground">Cargando…</div>;

export default function CampaignDetail({ campaign, nameSlot, metrics, health, rawMetrics, metricsError, onRetryMetrics, onBack, onToggleStatus, onMetricsStale }: Props) {
  const campaignId: string = campaign.id;
  const [tab, setTab] = useState<Tab>("editor");
  // Envíos/respuestas por día: UNA llamada de 14 días al abrir Analítica, que alimenta la gráfica
  // de barras (últimos 7) y la de área (14). Antes cada gráfica llamaba al RPC por su cuenta.
  const daily = useWidget<DailyRpcRow[]>({
    enabled: tab === "analytics",
    load: () => (supabase as any).rpc("campaign_daily_sends", { p_campaign_id: campaignId, p_days: 14 }),
    deps: [campaignId],
  });
  const [analyticsView, setAnalyticsView] = useState<"summary" | "sent">("summary");
  const [leadsView, setLeadsView] = useState<"leads" | "crm">("leads");
  const [settingsView, setSettingsView] = useState<"accounts" | "schedule" | "options" | "unsubscribes">("accounts");
  const [crmEnabled, setCrmEnabled] = useState(false);
  const [preview, setPreview] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);

  useEffect(() => {
    setTab("editor"); setPreview(false); setCommand(null);
    supabase.from("campaigns").select("crm_enabled").eq("id", campaignId).single().then(({ data }) => {
      if (data) setCrmEnabled((data as any).crm_enabled ?? false);
    });
  }, [campaignId]);

  const toggleCrm = async (val: boolean) => {
    setCrmEnabled(val);
    if (!val && leadsView === "crm") setLeadsView("leads");
    await supabase.from("campaigns").update({ crm_enabled: val } as any).eq("id", campaignId);
    toast.success(val ? "CRM activado" : "CRM desactivado");
  };

  /** Las órdenes del ⋮ actúan sobre el editor: se abre el editor y se le pasa la orden. */
  const run = (type: Command["type"]) => { setTab("editor"); setCommand((c) => ({ type, n: (c?.n || 0) + 1 })); };

  const st = STATUS[campaign.status] || STATUS.draft;
  const active = campaign.status === "active";
  const launchLabel = active ? "Pausar" : campaign.status === "draft" ? "Lanzar" : "Reanudar";

  return (
    <div className="space-y-5">
      {/* Barra de la campaña */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] border border-[#e8eaf5] bg-card/90 px-3 py-2.5 shadow-[0_8px_24px_rgba(82,94,170,.05)] backdrop-blur dark:border-border sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 lg:flex-none">
          <span className="hidden rounded-[14px] shadow-[0_6px_16px_rgba(98,86,255,.16)] sm:block"><SparkMark size={44} className="rounded-[14px]" /></span>
          <button type="button" onClick={onBack} aria-label="Volver a campañas" title="Volver a campañas"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#2a3052] transition-colors hover:bg-muted dark:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">{nameSlot}</div>
        </div>

        {/* Pestañas */}
        <nav className="order-last flex w-full justify-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] lg:order-none lg:w-auto lg:flex-1 lg:overflow-visible [&::-webkit-scrollbar]:hidden" aria-label="Secciones de la campaña">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "relative px-4 py-2.5 text-[15.5px] transition-colors sm:px-5",
                tab === t.id ? "font-semibold text-primary" : "text-[#5f689f] hover:text-foreground dark:text-muted-foreground",
              )}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-primary lg:-bottom-[11px]" />}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 px-1 text-[14.5px] text-[#5f689f] dark:text-muted-foreground sm:inline-flex">
            <span className={cn("h-2 w-2 rounded-full", st.dot)} /> {st.label}
          </span>
          <CampaignHealthChip reason={campaignHealthReason(campaign.status, health)} />
          <button
            type="button"
            onClick={() => { setTab("editor"); setPreview((p) => !p); }}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-[14px] border px-3 text-[14.5px] font-medium transition-colors sm:px-4",
              preview && tab === "editor" ? "border-primary bg-primary/5 text-primary" : "border-[#e3e6f2] bg-card text-[#1f2547] hover:border-primary/50 dark:border-border dark:text-foreground",
            )}
          >
            <Eye className="h-[18px] w-[18px]" /> <span className="hidden sm:inline">Vista previa</span>
          </button>
          <button
            type="button"
            onClick={onToggleStatus}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-[14px] px-4 text-[15px] font-semibold transition-all sm:px-5",
              active
                ? "border border-[#e3e6f2] bg-card text-[#1f2547] hover:border-amber-400 dark:border-border dark:text-foreground"
                : "bg-gradient-to-r from-[#6a4cff] to-[#7b5cff] text-white shadow-[0_8px_20px_rgba(106,76,255,.35)] hover:brightness-110",
            )}
          >
            {active ? <Pause className="h-[18px] w-[18px]" /> : campaign.status === "draft" ? <Rocket className="h-[18px] w-[18px]" /> : <Play className="h-[18px] w-[18px]" />}
            {launchLabel}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Más opciones" className="grid h-11 w-11 place-items-center rounded-[14px] border border-[#e3e6f2] bg-card text-[#1f2547] transition-colors hover:border-primary/50 dark:border-border dark:text-foreground">
                <MoreVertical className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => run("test")}><SendHorizonal className="mr-2 h-4 w-4" /> Enviar prueba</DropdownMenuItem>
              <DropdownMenuItem onClick={() => run("generate")}><Sparkles className="mr-2 h-4 w-4" /> Generar secuencia con IA</DropdownMenuItem>
              <DropdownMenuItem onClick={() => run("fix")}><ShieldCheck className="mr-2 h-4 w-4" /> Corregir variables</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => run("undo")}><Undo2 className="mr-2 h-4 w-4" /> Deshacer último cambio</DropdownMenuItem>
              <DropdownMenuItem onClick={() => run("redo")}><Redo2 className="mr-2 h-4 w-4" /> Rehacer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {tab === "analytics" && (
        <div className="space-y-4">
          <Suspense fallback={<Loading />}>
            <CampaignReportBar campaign={campaign} metrics={metrics} health={health} />
            <CampaignSendsChart campaignId={campaignId} daily={daily.data} loading={daily.loading} error={daily.error} onRetry={daily.reload} />
          </Suspense>
          <SubTabs<"summary" | "sent"> value={analyticsView} onChange={setAnalyticsView} items={[{ id: "summary", label: "Resumen" }, { id: "sent", label: "Enviados" }]} />
          <Suspense fallback={<Loading />}>
            {analyticsView === "summary"
              ? <CampaignAnalytics campaignId={campaignId} metrics={rawMetrics ?? undefined} metricsError={metricsError} onRetryMetrics={onRetryMetrics} daily={daily.data} dailyLoading={daily.loading} dailyError={daily.error} onDailyReload={daily.reload} onMetricsStale={onMetricsStale} />
              : <CampaignSentLog campaignId={campaignId} />}
          </Suspense>
        </div>
      )}

      {tab === "editor" && (
        <Suspense fallback={<Loading />}>
          <CampaignSequences campaignId={campaignId} preview={preview} onPreviewChange={setPreview} command={command} />
        </Suspense>
      )}

      {tab === "leads" && (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {crmEnabled
              ? <SubTabs<"leads" | "crm"> value={leadsView} onChange={setLeadsView} items={[{ id: "leads", label: "Leads" }, { id: "crm", label: "CRM" }]} />
              : <span />}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={crmEnabled} onCheckedChange={toggleCrm} /> Activar CRM (leads interesados)
            </label>
          </div>
          <Suspense fallback={<Loading />}>
            {leadsView === "crm" && crmEnabled ? <CampaignCRM campaignId={campaignId} /> : <CampaignLeads campaignId={campaignId} />}
          </Suspense>
        </div>
      )}

      {tab === "settings" && (
        <div>
          <SubTabs<"accounts" | "schedule" | "options" | "unsubscribes"> value={settingsView} onChange={setSettingsView} items={[
            { id: "accounts", label: "Cuentas" },
            { id: "schedule", label: "Horario" },
            { id: "options", label: "Opciones" },
            { id: "unsubscribes", label: "Bajas" },
          ]} />
          <Suspense fallback={<Loading />}>
            {settingsView === "accounts" && <CampaignEmailAccounts campaignId={campaignId} />}
            {settingsView === "schedule" && <CampaignSchedule campaignId={campaignId} />}
            {settingsView === "options" && <CampaignOptions campaignId={campaignId} />}
            {settingsView === "unsubscribes" && <CampaignUnsubscribes campaignId={campaignId} />}
          </Suspense>
        </div>
      )}
    </div>
  );
}
