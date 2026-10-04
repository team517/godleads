import { describe, expect, it } from "vitest";
import { buildStepRows, totalsFromRpcRow } from "@/lib/campaign-analytics-rows";

describe("totales de la pestaña Analítica (fila cruda de campaign_metrics_v2)", () => {
  it("usa el contacted del RPC (respeta «Reiniciar») y nunca por debajo de replied", () => {
    expect(totalsFromRpcRow({ sent: "15998", contacted: "7209", replied: "328" })).toEqual({ sent: 15998, contacted: 7209, replied: 328 });
    expect(totalsFromRpcRow({ sent: 10, contacted: 2, replied: 5 })).toEqual({ sent: 10, contacted: 5, replied: 5 });
  });
  it("sin fila → null (se enseña «—» y Reintentar, nunca ceros)", () => {
    expect(totalsFromRpcRow(null)).toBeNull();
    expect(totalsFromRpcRow(undefined)).toBeNull();
  });
});

describe("filas por paso desde campaign_step_stats", () => {
  const steps = [
    { id: "s1", step_order: 1, subject: "Hola" },
    { id: "s2", step_order: 2, subject: "Seguimiento" },
  ];

  it("una fila por paso, a cero si el RPC no lo trae", () => {
    const rows = buildStepRows(steps, [{ campaign_step_id: "s1", sent: "120", replied: "4" }]);
    expect(rows).toEqual([
      { id: "s1", step_order: 1, subject: "Hola", sent: 120, replied: 4 },
      { id: "s2", step_order: 2, subject: "Seguimiento", sent: 0, replied: 0 },
    ]);
  });

  it("«Other» = envíos sin paso + pasos borrados, sumados; no depende de los totales", () => {
    const rows = buildStepRows(steps, [
      { campaign_step_id: "s1", sent: 100, replied: 3 },
      { campaign_step_id: null, sent: 7, replied: 1 },
      { campaign_step_id: "borrado", sent: 5, replied: 0 },
    ]);
    const other = rows.find((r) => r._other)!;
    expect(other.sent).toBe(12);
    expect(other.replied).toBe(1);
    expect(rows).toHaveLength(3);
  });

  it("sin envíos fuera de los pasos no hay fila fantasma", () => {
    expect(buildStepRows(steps, [{ campaign_step_id: "s2", sent: 1, replied: 0 }]).some((r) => r._other)).toBe(false);
    expect(buildStepRows(steps, [{ campaign_step_id: null, sent: 0, replied: 0 }]).some((r) => r._other)).toBe(false);
  });
});
