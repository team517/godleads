import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Daily = { day: string; label: string; full: string; envios: number; respuestas: number };

export default function Stats() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ sent: 0, contacted: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, failed: 0 });
  const [daily, setDaily] = useState<Daily[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      setLoading(true);
      // Server-side aggregation (SQL RPCs). This is EXACT: counting 15k+ rows in the DB,
      // never the old `select()` that PostgREST capped at 1000 rows → the "990" undercount.
      const [statsRes, dailyRes] = await Promise.all([
        (supabase as any).rpc("user_email_stats"),
        (supabase as any).rpc("user_daily_sends", { p_days: 14 }),
      ]);
      if (!alive) return;
      const s = (statsRes?.data || {}) as { sent?: number; contacted?: number; bounced?: number; opened?: number; replied?: number; failed?: number };
      const sent = Number(s.sent || 0);
      const bounced = Number(s.bounced || 0);
      setStats({
        sent,
        contacted: Number(s.contacted || 0),
        bounced,
        delivered: Math.max(0, sent - bounced),
        opened: Number(s.opened || 0),
        replied: Number(s.replied || 0),
        failed: Number(s.failed || 0),
      });
      const rows = (dailyRes?.data || []) as Array<{ day: string; sends: number; replies: number }>;
      setDaily(rows.map((r) => {
        const d = new Date(`${r.day}T00:00:00`);
        return {
          day: r.day,
          label: d.toLocaleDateString("es", { day: "numeric", month: "short" }),
          full: d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }),
          envios: Number(r.sends || 0),
          respuestas: Number(r.replies || 0),
        };
      }));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user]);

  const pieData = [
    { name: "Entregados", value: stats.delivered || 1, color: "hsl(217, 91%, 60%)" },
    { name: "Respondidos", value: stats.replied, color: "hsl(142, 76%, 36%)" },
    { name: "Rebotados", value: stats.bounced, color: "hsl(0, 84%, 60%)" },
    { name: "Fallidos", value: stats.failed, color: "hsl(38, 92%, 50%)" },
  ];

  const replyRate = stats.contacted > 0 ? (stats.replied / stats.contacted) * 100 : 0;

  // Primary — the numbers that matter, each with a clarifying sub-label so "leads" (personas)
  // is never confused with "correos" (con follow-ups) again.
  const primaryStats = [
    { label: "Leads contactados", value: stats.contacted.toLocaleString("es"), sub: "personas únicas", highlight: false },
    { label: "Correos enviados", value: stats.sent.toLocaleString("es"), sub: "con follow-ups", highlight: false },
    { label: "Respuestas", value: stats.replied.toLocaleString("es"), sub: "recibidas", highlight: false },
    { label: "Tasa de respuesta", value: `${replyRate.toFixed(1)}%`, sub: "por lead contactado", highlight: true },
  ];
  const secondaryStats = [
    { label: "Entregados", value: stats.delivered.toLocaleString("es") },
    { label: "Rebotes", value: stats.bounced.toLocaleString("es") },
    { label: "Fallidos", value: stats.failed.toLocaleString("es") },
  ];

  const totalWindow = daily.reduce((s, p) => s + p.envios, 0);
  const totalReplies = daily.reduce((s, p) => s + p.respuestas, 0);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Estadísticas</h1>
        <p className="text-sm text-muted-foreground">Análisis detallado de rendimiento</p>
      </div>

      {/* Primary — leads vs correos claramente separados + la tasa que importa */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {primaryStats.map((stat, i) => (
          <Card key={i} className={stat.highlight ? "border-primary/40 bg-primary/5" : undefined}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <p className={`font-display text-2xl font-bold mt-1 ${stat.highlight ? "text-primary" : ""}`}>{stat.value}</p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary — números de apoyo, más discretos */}
      <div className="grid gap-3 grid-cols-3">
        {secondaryStats.map((stat, i) => (
          <Card key={i} className="bg-muted/30">
            <CardContent className="p-3 text-center">
              <p className="font-display text-lg font-semibold">{stat.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.sent === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-sm text-muted-foreground">Aún no hay datos de envío. Las estadísticas aparecerán cuando empieces a enviar campañas.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Time series — envíos + respuestas por día (últimos 14 días), estilo panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="font-display text-base">Envíos por día · últimos 14 días</CardTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(217, 91%, 60%)" }} /> {totalWindow.toLocaleString("es")} envíos</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(142, 76%, 36%)" }} /> {totalReplies.toLocaleString("es")} respuestas</span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gReply" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    cursor={{ stroke: "hsl(var(--border))" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as Daily;
                      return (
                        <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                          <p className="mb-1 font-medium capitalize">{p.full}</p>
                          <p className="font-semibold" style={{ color: "hsl(217, 91%, 60%)" }}>{p.envios.toLocaleString("es")} {p.envios === 1 ? "envío" : "envíos"}</p>
                          {p.respuestas > 0 && <p style={{ color: "hsl(142, 76%, 36%)" }}>{p.respuestas} {p.respuestas === 1 ? "respuesta" : "respuestas"}</p>}
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="envios" stroke="hsl(217, 91%, 60%)" strokeWidth={2} fill="url(#gSent)" />
                  <Area type="monotone" dataKey="respuestas" stroke="hsl(142, 76%, 36%)" strokeWidth={2} fill="url(#gReply)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="font-display text-base">Distribución</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={4}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-2">
                {pieData.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-muted-foreground">{item.name}</span>
                    </div>
                    <span className="font-medium">{item.value.toLocaleString("es")}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
