import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import EmptyShowcase from "@/components/EmptyShowcase";
import RetryNotice from "@/components/RetryNotice";
import { useWidget } from "@/hooks/useWidget";
import { num } from "@/lib/widget-state";
import { sumPoints, toDayPoints, type DailyRpcRow, type DayPoint } from "@/lib/daily-rows";
import { fetchCampaignTotals, globalReplyRate, type CampaignTotals } from "@/lib/campaign-totals";

type Summary = { sent?: unknown; contacted?: unknown; bounced?: unknown; opened?: unknown; replied?: unknown; failed?: unknown };

const DAYS = 14;

/* Estadísticas: dos widgets independientes (resumen y gráfica diaria). Cada uno es UNA RPC que cuenta
   en el servidor (exacto, sin el tope de 1000 filas de PostgREST), se pinta al instante desde la caché
   de la última visita y se refresca detrás. Si una RPC falla o tarda (statement_timeout de 8 s, token
   caducado) sólo ESA tarjeta lo dice y ofrece reintentar: la página nunca se queda en blanco ni en el
   spinner por culpa de un widget. */
export default function Stats() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const summary = useWidget<Summary>({
    cacheKey: "stats:summary",
    enabled: !!user,
    load: () => (supabase as any).rpc("user_email_stats"),
    deps: [user?.id],
  });
  // Totales globales = suma de las cifras de cada campaña (las mismas de la tabla de Campañas).
  const totalsW = useWidget<CampaignTotals | null>({
    cacheKey: "stats:campaign-totals",
    enabled: !!user,
    load: () => fetchCampaignTotals(supabase as any, user!.id),
    deps: [user?.id],
  });
  const dailyW = useWidget<DailyRpcRow[]>({
    cacheKey: "stats:daily",
    enabled: !!user,
    load: () => (supabase as any).rpc("user_daily_sends", { p_days: DAYS }),
    deps: [user?.id],
  });

  const s = summary.data || {};
  // Enviados, contactados, respondidos y rebotados: suma de las campañas. Mientras no llega (o si
  // falla), el resumen de siempre. Fallidos sale siempre del resumen.
  const t = totalsW.data ?? null;
  const sent = t ? t.sent : num(s.sent);
  const bounced = t ? t.bounced : num(s.bounced);
  const stats = {
    sent,
    contacted: t ? t.contacted : num(s.contacted),
    bounced,
    delivered: Math.max(0, sent - bounced),
    opened: num(s.opened),
    replied: t ? t.replied : num(s.replied),
    failed: num(s.failed),
  };
  const daily: DayPoint[] = toDayPoints(dailyW.data);

  const pieData = [
    { name: "Entregados", value: stats.delivered || 1, color: "hsl(var(--brand-cyan))" },
    { name: "Respondidos", value: stats.replied, color: "hsl(var(--success))" },
    { name: "Rebotados", value: stats.bounced, color: "hsl(var(--destructive))" },
    { name: "Fallidos", value: stats.failed, color: "hsl(var(--warning))" },
  ];

  // Tasa global = media de los % de la columna «Respondidos» de Campañas (decisión del dueño).
  const replyRate = globalReplyRate(t);

  // Primary — the numbers that matter, each with a clarifying sub-label so "leads" (personas)
  // is never confused with "correos" (con follow-ups) again.
  const primaryStats = [
    { label: "Leads contactados", value: stats.contacted.toLocaleString("es"), sub: "personas únicas", highlight: false },
    { label: "Correos enviados", value: stats.sent.toLocaleString("es"), sub: "con follow-ups", highlight: false },
    { label: "Respuestas", value: stats.replied.toLocaleString("es"), sub: "recibidas", highlight: false },
    { label: "Tasa de respuesta", value: `${replyRate.toFixed(1)}%`, sub: t && t.ratedCampaigns ? `media de ${t.ratedCampaigns} ${t.ratedCampaigns === 1 ? "campaña" : "campañas"}` : "por lead contactado", highlight: true },
  ];
  const secondaryStats = [
    { label: "Entregados", value: stats.delivered.toLocaleString("es") },
    { label: "Rebotes", value: stats.bounced.toLocaleString("es") },
    { label: "Fallidos", value: stats.failed.toLocaleString("es") },
  ];

  const totalWindow = sumPoints(daily, "envios");
  const totalReplies = sumPoints(daily, "respuestas");
  const totalNuevos = sumPoints(daily, "nuevos");
  const totalFollowups = sumPoints(daily, "followups");

  // Sin nada que enseñar todavía (ni caché ni carga): esqueleto, no spinner de página entera.
  const summaryPending = summary.data === undefined && summary.loading;
  const dailyPending = dailyW.data === undefined && dailyW.loading;
  const summaryFailed = summary.data === undefined && !!summary.error;
  const dailyFailed = dailyW.data === undefined && !!dailyW.error;
  const skeleton = "animate-pulse text-transparent bg-muted rounded";

  // Sin ningún envío todavía (las DOS cargas fueron bien): la pantalla vacía del diseño.
  const allZero = summary.data !== undefined && !summary.error && dailyW.data !== undefined && !dailyW.error
    && stats.sent === 0 && daily.every((p) => !p.envios && !p.respuestas && !p.nuevos && !p.followups);
  if (allZero) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">Estadísticas</h1>
          <p className="text-[15px] text-muted-foreground">Mide el rendimiento de tus campañas, agentes y oportunidades.</p>
        </div>
        <EmptyShowcase
          variant="analytics"
          title="Aún no hay datos en Estadísticas"
          text="Lanza tu primera campaña y empieza a ver aquí el rendimiento de tus emails, leads y oportunidades."
          cta={{ label: "Crear campaña", onClick: () => navigate("/campaigns") }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">Estadísticas</h1>
        <p className="text-[15px] text-muted-foreground">Análisis detallado de rendimiento</p>
      </div>

      {/* Resumen: su propio aviso si falló (con dato viejo = discreto; sin dato = en su sitio) */}
      {summary.error && (
        <RetryNotice what="el resumen" error={summary.error} onRetry={summary.reload} stale={summary.data !== undefined} />
      )}
      {summaryFailed ? (
        <Card><CardContent className="p-8 text-center text-[15px] text-muted-foreground">Resumen no disponible ahora mismo.</CardContent></Card>
      ) : (
        <>
          {/* Primary — leads vs correos claramente separados + la tasa que importa */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4" aria-busy={summaryPending}>
            {primaryStats.map((stat, i) => (
              <Card key={i} className={stat.highlight ? "border-primary/40 bg-primary/5" : undefined}>
                <CardContent className="p-4">
                  <p className="text-[13px] font-semibold text-muted-foreground">{stat.label}</p>
                  <p className={`font-display text-2xl font-semibold tracking-[-0.03em] mt-1 ${summaryPending ? skeleton : stat.highlight ? "text-primary" : "text-foreground"}`}>{stat.value}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{stat.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Secondary — números de apoyo, más discretos */}
          <div className="grid gap-3 grid-cols-3">
            {secondaryStats.map((stat, i) => (
              <Card key={i} className="bg-muted/30">
                <CardContent className="p-3 text-center">
                  <p className={`font-display text-lg font-semibold tracking-[-0.02em] ${summaryPending ? skeleton : "text-foreground"}`}>{stat.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Time series — envíos + respuestas por día (últimos 14 días), estilo panel */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="font-display text-[17px] font-semibold tracking-[-0.02em]">Envíos por día · últimos {DAYS} días</CardTitle>
          {!dailyFailed && (
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground ${dailyPending ? skeleton : ""}`}>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(var(--brand-cyan))" }} /> {totalWindow.toLocaleString("es")} envíos</span>
              <span>· {totalNuevos.toLocaleString("es")} leads nuevos</span>
              <span>· {totalFollowups.toLocaleString("es")} follow-ups</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(var(--success))" }} /> {totalReplies.toLocaleString("es")} respuestas</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {dailyW.error && (
            <RetryNotice what="la gráfica diaria" error={dailyW.error} onRetry={dailyW.reload} stale={dailyW.data !== undefined} className="mb-3" />
          )}
          {dailyFailed ? (
            <div className="flex h-[200px] items-center justify-center text-[15px] text-muted-foreground">Gráfica no disponible ahora mismo.</div>
          ) : dailyPending ? (
            <div className="h-[280px] animate-pulse rounded bg-muted/50" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gReply" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as DayPoint;
                    // Reply rate = respuestas ÷ envíos de ESE día (guardado contra división por
                    // cero). Si ese día no hubo envíos no se puede calcular un % → se muestra "—".
                    const dayRate = p.envios > 0 ? (Math.min(p.respuestas, p.envios) / p.envios) * 100 : null;
                    return (
                      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-raised">
                        <p className="mb-1 font-medium capitalize">{p.full}</p>
                        <p className="font-semibold" style={{ color: "hsl(var(--brand-cyan))" }}>{p.envios.toLocaleString("es")} {p.envios === 1 ? "envío" : "envíos"}</p>
                        <p className="text-muted-foreground">· {p.nuevos.toLocaleString("es")} leads nuevos</p>
                        <p className="text-muted-foreground">· {p.followups.toLocaleString("es")} follow-ups</p>
                        {p.respuestas > 0 && <p style={{ color: "hsl(var(--success))" }}>{p.respuestas} {p.respuestas === 1 ? "respuesta" : "respuestas"}</p>}
                        <p className="mt-1 border-t border-border pt-1 font-semibold" style={{ color: "hsl(var(--success))" }}>
                          Tasa de respuesta: {dayRate === null ? "—" : `${dayRate.toFixed(1).replace(".", ",")}%`}
                        </p>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="envios" stroke="hsl(var(--brand-cyan))" strokeWidth={2} fill="url(#gSent)" />
                <Area type="monotone" dataKey="respuestas" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#gReply)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Distribución: sale del resumen; si el resumen no está, tampoco ella */}
      {!summaryFailed && (
        <Card>
          <CardHeader><CardTitle className="font-display text-[17px] font-semibold tracking-[-0.02em]">Distribución</CardTitle></CardHeader>
          <CardContent>
            {summaryPending ? (
              <div className="h-[250px] animate-pulse rounded bg-muted/50" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={4} stroke="hsl(var(--card))">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "hsl(var(--popover-foreground))",
                    }}
                    itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                    labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="mt-2 space-y-2">
              {pieData.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className={`font-medium ${summaryPending ? skeleton : ""}`}>{item.value.toLocaleString("es")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
