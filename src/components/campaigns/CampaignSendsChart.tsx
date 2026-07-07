import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from "recharts";
import { BarChart3 } from "lucide-react";

interface Props { campaignId: string; }

type DayPoint = { day: string; label: string; full: string; envios: number; respuestas: number };

const DAYS_SHOWN = 14;

/** Daily sends chart for one campaign — hover a bar to see the exact day + counts. */
export default function CampaignSendsChart({ campaignId }: Props) {
  const [data, setData] = useState<DayPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - (DAYS_SHOWN - 1));
      since.setHours(0, 0, 0, 0);

      const [sentRes, replyRes] = await Promise.all([
        supabase.from("sent_emails")
          .select("sent_at")
          .eq("campaign_id", campaignId)
          .not("sent_at", "is", null)
          .gte("sent_at", since.toISOString())
          .limit(10000),
        supabase.from("inbox_messages")
          .select("received_at")
          .eq("campaign_id", campaignId)
          .gte("received_at", since.toISOString())
          .limit(10000),
      ]);
      if (!alive) return;

      // Bucket per LOCAL day so the chart matches what the user's clock says.
      const sentByDay: Record<string, number> = {};
      for (const r of sentRes.data || []) {
        const k = new Date(r.sent_at).toLocaleDateString("sv"); // YYYY-MM-DD local
        sentByDay[k] = (sentByDay[k] || 0) + 1;
      }
      const replyByDay: Record<string, number> = {};
      for (const r of replyRes.data || []) {
        const k = new Date(r.received_at).toLocaleDateString("sv");
        replyByDay[k] = (replyByDay[k] || 0) + 1;
      }

      const points: DayPoint[] = [];
      for (let i = 0; i < DAYS_SHOWN; i++) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        const k = d.toLocaleDateString("sv");
        points.push({
          day: k,
          label: d.toLocaleDateString("es", { day: "numeric", month: "short" }),
          full: d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }),
          envios: sentByDay[k] || 0,
          respuestas: replyByDay[k] || 0,
        });
      }
      setData(points);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [campaignId]);

  const total = data.reduce((s, p) => s + p.envios, 0);
  const totalReplies = data.reduce((s, p) => s + p.respuestas, 0);

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5" /> Envíos y respuestas por día · últimos {DAYS_SHOWN} días
        </p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> {loading ? "…" : `${total} envíos`}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(173 58% 39%)" }} /> {loading ? "…" : `${totalReplies} respuestas`}</span>
        </div>
      </div>
      <div className="h-40 w-full">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Cargando…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={46} />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as DayPoint;
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium capitalize">{p.full}</p>
                      <p className="text-primary font-semibold">{p.envios} {p.envios === 1 ? "envío" : "envíos"}</p>
                      {p.respuestas > 0 && <p className="text-teal-600">{p.respuestas} {p.respuestas === 1 ? "respuesta" : "respuestas"}</p>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="envios" name="Envíos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={22} minPointSize={2}>
                {/* The exact number ON TOP of the bar — so a real count reads clearly
                    even when the bar looks short next to a much bigger day. */}
                <LabelList dataKey="envios" position="top" style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }} formatter={(v: any) => (Number(v) > 0 ? v : "")} />
              </Bar>
              <Bar dataKey="respuestas" name="Respuestas" fill="hsl(173 58% 39%)" radius={[4, 4, 0, 0]} maxBarSize={22} minPointSize={2} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
