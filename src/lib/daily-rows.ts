// Filas "por día" que devuelven user_daily_sends / campaign_daily_sends, y su forma para las gráficas.
// Compartido por Estadísticas y por la ficha de la campaña (que ahora pide los 14 días UNA vez y
// pinta con ellos tanto la gráfica de 7 días como la de 14).
import { num } from "@/lib/widget-state";

export type DailyRpcRow = {
  day: string;
  sends?: number | string | null;
  replies?: number | string | null;
  new_leads?: number | string | null;
  followups?: number | string | null;
};

export type DayPoint = {
  day: string;
  label: string;
  full: string;
  envios: number;
  respuestas: number;
  nuevos: number;
  followups: number;
};

/** Las últimas `n` filas por fecha (ordena por `day` ascendente antes de cortar). */
export function lastDays<T extends { day: string }>(rows: T[] | null | undefined, n: number): T[] {
  const sorted = [...(rows || [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return n >= sorted.length ? sorted : sorted.slice(sorted.length - n);
}

export function toDayPoints(rows: DailyRpcRow[] | null | undefined): DayPoint[] {
  return (rows || []).map((r) => {
    const d = new Date(`${r.day}T00:00:00`);
    const ok = !Number.isNaN(d.getTime());
    return {
      day: r.day,
      label: ok ? d.toLocaleDateString("es", { day: "numeric", month: "short" }) : r.day,
      full: ok ? d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }) : r.day,
      envios: num(r.sends),
      respuestas: num(r.replies),
      nuevos: num(r.new_leads),
      followups: num(r.followups),
    };
  });
}

export function sumPoints(points: DayPoint[], key: "envios" | "respuestas" | "nuevos" | "followups"): number {
  return points.reduce((s, p) => s + p[key], 0);
}
