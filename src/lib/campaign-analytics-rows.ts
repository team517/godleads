// Lógica pura de la pestaña Analítica de una campaña (totales y filas por paso), sin React.
import { num } from "@/lib/widget-state";

export type Totals = { sent: number; contacted: number; replied: number };
export type StepRow = { id: string; step_order: number | string; subject: string; sent: number; replied: number; _other?: boolean };
export type StepStatRow = { campaign_step_id: string | null; sent: unknown; replied: unknown };

/**
 * Totales desde la fila CRUDA de campaign_metrics_v2 (la que respeta "Reiniciar analíticas").
 * Quien respondió fue contactado: contacted nunca < replied (la tasa no pasa del 100 %).
 */
export function totalsFromRpcRow(row: { sent?: unknown; contacted?: unknown; replied?: unknown } | null | undefined): Totals | null {
  if (!row) return null;
  const replied = num(row.replied);
  return { sent: num(row.sent), replied, contacted: Math.max(num(row.contacted), replied) };
}

/**
 * Filas de "Analítica por paso" a partir de campaign_step_stats: una por paso de la secuencia y,
 * si hay envíos sin paso o de pasos ya borrados, una fila "Other (no step)" con su suma. Sale del
 * propio RPC (no de total − suma), así nunca aparece una fila fantasma ni mezcla unidades.
 */
export function buildStepRows(
  steps: { id: string; step_order: number | string; subject: string }[],
  stats: StepStatRow[],
): StepRow[] {
  const known = new Set(steps.map((s) => s.id));
  const byStep: Record<string, { sent: number; replied: number }> = {};
  let otherSent = 0;
  let otherReplied = 0;
  for (const r of stats) {
    const sent = num(r.sent);
    const replied = num(r.replied);
    if (r.campaign_step_id && known.has(r.campaign_step_id)) {
      byStep[r.campaign_step_id] = { sent, replied };
    } else {
      otherSent += sent;
      otherReplied += replied;
    }
  }
  const rows: StepRow[] = steps.map((s) => ({ ...s, sent: byStep[s.id]?.sent ?? 0, replied: byStep[s.id]?.replied ?? 0 }));
  if (otherSent > 0 || otherReplied > 0) {
    rows.push({ id: "__other__", step_order: "·", subject: "Other (no step)", sent: otherSent, replied: otherReplied, _other: true });
  }
  return rows;
}
