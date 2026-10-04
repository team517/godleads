import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp } from "@/components/ui/count-up";
import { Send, MessageCircle, Users, Mail, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TodayMessages from "@/components/dashboard/TodayMessages";
import RetryNotice from "@/components/RetryNotice";
import { useWidget } from "@/hooks/useWidget";
import { num } from "@/lib/widget-state";

type Summary = { sent?: unknown; contacted?: unknown; replied?: unknown };
type CampaignRow = { id: string; name: string; status: string; created_at?: string };

/* Dashboard: cuatro widgets independientes (resumen de envíos, leads, cuentas, campañas recientes).
   Cada uno se pinta al instante desde la caché de la última visita y se refresca detrás; si uno falla
   (statement_timeout, token caducado, red) sólo él lo dice y ofrece reintentar — los demás se ven. */
export default function Dashboard() {
  const { user } = useAuth();
  const uid = user?.id;

  // Enviados/contactados/respuestas salen de la MISMA RPC exacta que Estadísticas (cuenta
  // server-side, sin el tope de 1000 filas). Así el Dashboard y Estadísticas siempre cuadran.
  const summary = useWidget<Summary>({
    cacheKey: "dash:summary", enabled: !!uid,
    load: () => (supabase as any).rpc("user_email_stats"),
    deps: [uid],
  });
  // "Cuentas ACTIVAS" = buzones conectados, no todas las filas de la tabla.
  const accounts = useWidget<number>({
    cacheKey: "dash:accounts", enabled: !!uid,
    load: () => supabase.from("email_accounts").select("id", { count: "exact", head: true }).eq("user_id", uid!).eq("status", "connected")
      .then((r) => ({ data: r.error ? null : (r.count || 0), error: r.error })),
    deps: [uid],
  });
  const leads = useWidget<number>({
    cacheKey: "dash:leads", enabled: !!uid,
    load: () => supabase.from("leads").select("id", { count: "exact", head: true }).eq("user_id", uid!)
      .then((r) => ({ data: r.error ? null : (r.count || 0), error: r.error })),
    deps: [uid],
  });
  // Sólo lo que se pinta (nombre y estado). Antes pedía también campaign_leads(count) y
  // sent_emails(count) embebidos, que no se enseñaban y costaban 1,2 s de media (picos de 7,5 s).
  const campaigns = useWidget<CampaignRow[]>({
    cacheKey: "dash:campaigns", enabled: !!uid,
    load: () => supabase.from("campaigns").select("id, name, status, created_at").eq("user_id", uid!).order("created_at", { ascending: false }).limit(5)
      .then((r) => ({ data: (r.data || []) as CampaignRow[], error: r.error })),
    deps: [uid],
  });

  const s = summary.data || {};
  const stats = { sent: num(s.sent), contacted: num(s.contacted), replied: num(s.replied) };
  // Tasa REAL = respuestas ÷ LEADS contactados (personas), no ÷ correos enviados.
  const responseRate = stats.contacted > 0 ? ((stats.replied / stats.contacted) * 100).toFixed(1) : "0";

  const pending = (w: { data: unknown; loading: boolean }) => w.data === undefined && w.loading;
  const failedNoData = (w: { data: unknown; error: string | null }) => w.data === undefined && !!w.error;

  // Como las métricas del diseño: etiqueta con icono del color de la cifra y cifra grande.
  const statCards = [
    { label: "Correos enviados", value: stats.sent, icon: Send, color: "text-primary", w: summary },
    { label: "Leads contactados", value: stats.contacted, icon: UserCheck, color: "text-info", w: summary },
    { label: "Tasa de respuesta", value: Number(responseRate), decimals: 1, suffix: "%", icon: MessageCircle, color: "text-success", w: summary },
    { label: "Leads totales", value: leads.data ?? 0, icon: Users, color: "text-[hsl(var(--brand-indigo))]", w: leads },
    { label: "Cuentas activas", value: accounts.data ?? 0, icon: Mail, color: "text-warning", w: accounts },
  ];

  const failures = [
    { what: "el resumen de envíos", w: summary },
    { what: "el total de leads", w: leads },
    { what: "las cuentas activas", w: accounts },
  ].filter((f) => f.w.error);

  return (
    <div className="stagger space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">Dashboard</h1>
          <p className="text-[15px] text-muted-foreground">Resumen de tu actividad de email marketing</p>
        </div>
      </div>

      {failures.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border bg-muted/30 px-4 py-3">
          {failures.map((f) => (
            <RetryNotice key={f.what} what={f.what} error={f.w.error} onRetry={f.w.reload} stale={f.w.data !== undefined} />
          ))}
        </div>
      )}

      <div className="stagger grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((stat, i) => (
          <Card key={i} className="lift" aria-busy={pending(stat.w)}>
            <CardContent className="p-4 sm:p-5">
              <p className="flex items-center gap-1.5 text-[11.5px] sm:text-[12.5px] font-medium text-muted-foreground">
                <stat.icon className={`h-3.5 w-3.5 shrink-0 ${stat.color}`} strokeWidth={2} /> <span className="truncate">{stat.label}</span>
              </p>
              <p className={`mt-1.5 font-display text-[26px] sm:text-[32px] font-semibold leading-none tracking-[-0.03em] tabular ${stat.color} ${pending(stat.w) ? "animate-pulse opacity-40" : ""}`}>
                {failedNoData(stat.w) ? "—" : <CountUp value={stat.value} decimals={stat.decimals} suffix={stat.suffix} />}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today Messages */}
        <TodayMessages />

        {/* Campaigns */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-[17px] font-semibold tracking-[-0.02em]">Campañas recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.error && (
              <RetryNotice what="las campañas" error={campaigns.error} onRetry={campaigns.reload} stale={campaigns.data !== undefined} className="mb-3" />
            )}
            {pending(campaigns) ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/50" />)}</div>
            ) : failedNoData(campaigns) ? null : (campaigns.data || []).length === 0 ? (
              <p className="text-[15px] text-muted-foreground text-center py-8">No tienes campañas aún. ¡Crea tu primera campaña!</p>
            ) : (
              <div className="space-y-3">
                {(campaigns.data || []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-rest transition-colors hover:border-[#C9BFFA] hover:bg-accent/30">
                    <p className="min-w-0 truncate text-[15px] font-semibold text-foreground">{c.name}</p>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold ${
                      c.status === "active" ? "border-success/25 bg-success/10 text-success" : c.status === "paused" ? "border-warning/30 bg-warning/10 text-warning" : "border-border bg-muted text-muted-foreground"
                    }`}>
                      {c.status === "active" && <span className="live-dot h-1.5 w-1.5 rounded-full bg-[#05D17F]" />}
                      {c.status === "active" ? "Activa" : c.status === "paused" ? "Pausada" : c.status === "draft" ? "Borrador" : c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
