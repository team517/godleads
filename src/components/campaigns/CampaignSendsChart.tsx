import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from "recharts";
import { BarChart3 } from "lucide-react";
import RetryNotice from "@/components/RetryNotice";
import { lastDays, sumPoints, toDayPoints, type DailyRpcRow, type DayPoint } from "@/lib/daily-rows";

interface Props {
  campaignId?: string;
  /** Filas de campaign_daily_sends (las pide la ficha UNA vez, 14 días) — aquí se pintan los últimos 7. */
  daily?: DailyRpcRow[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const DAYS_SHOWN = 7;

/** Daily sends chart for one campaign — hover a bar to see the exact day + counts. */
export default function CampaignSendsChart({ daily, loading, error, onRetry }: Props) {
  // Counted server-side (SQL RPC) so the bars are EXACT — the old `.select().limit()` was capped
  // by PostgREST and undercounted busy days (showed ~367 instead of ~1900).
  const data: DayPoint[] = toDayPoints(lastDays(daily, DAYS_SHOWN));
  const pending = daily === undefined && !!loading;
  const failed = daily === undefined && !!error;
  const total = sumPoints(data, "envios");
  const totalReplies = sumPoints(data, "respuestas");

  return (
    <div className="rounded-md border border-border/60 bg-card px-4 py-3 shadow-rest">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5" /> Envíos y respuestas por día · últimos {DAYS_SHOWN} días
        </p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> {pending || failed ? "…" : `${total} envíos`}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(var(--brand-teal))" }} /> {pending || failed ? "…" : `${totalReplies} respuestas`}</span>
        </div>
      </div>
      {error && onRetry && <RetryNotice what="la gráfica" error={error} onRetry={onRetry} stale={daily !== undefined} className="mb-2 text-[12px]" />}
      <div className="h-40 w-full">
        {pending ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Cargando…</div>
        ) : failed ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Gráfica no disponible ahora mismo.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={46} />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as DayPoint;
                  return (
                    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-raised">
                      <p className="mb-1 font-medium capitalize">{p.full}</p>
                      <p className="text-primary font-semibold">{p.envios} {p.envios === 1 ? "envío" : "envíos"}</p>
                      {p.respuestas > 0 && <p className="text-teal-600 dark:text-teal-400">{p.respuestas} {p.respuestas === 1 ? "respuesta" : "respuestas"}</p>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="envios" name="Envíos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={30} minPointSize={(v: number) => (v > 0 ? 8 : 0)}>
                {/* The exact number ON TOP of the bar — so a real count reads clearly
                    even when the bar looks short next to a much bigger day. */}
                <LabelList dataKey="envios" position="top" style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }} formatter={(v: any) => (Number(v) > 0 ? v : "")} />
              </Bar>
              <Bar dataKey="respuestas" name="Respuestas" fill="hsl(var(--brand-teal))" radius={[4, 4, 0, 0]} maxBarSize={30} minPointSize={(v: number) => (v > 0 ? 8 : 0)} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
