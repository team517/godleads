import { describe, expect, it } from "vitest";
import { lastDays, sumPoints, toDayPoints } from "@/lib/daily-rows";

describe("filas por día (una sola llamada de 14 días alimenta las dos gráficas)", () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, sends: String(i), replies: i % 3 }));

  it("lastDays corta los últimos N por fecha, aunque lleguen desordenados", () => {
    const shuffled = [...rows].reverse();
    const seven = lastDays(shuffled, 7);
    expect(seven.map((r) => r.day)).toEqual(rows.slice(7).map((r) => r.day));
    expect(lastDays(rows, 30)).toHaveLength(14);
    expect(lastDays(undefined, 7)).toEqual([]);
  });

  it("toDayPoints convierte los bigint en números y suma bien", () => {
    const pts = toDayPoints(rows);
    expect(pts[13].envios).toBe(13);
    expect(pts[0].nuevos).toBe(0);
    expect(sumPoints(pts, "envios")).toBe(91);
    expect(sumPoints(pts, "respuestas")).toBe(rows.reduce((s, r) => s + r.replies, 0));
    expect(pts[0].label).toMatch(/1/);
  });

  it("una fecha rota no pinta «Invalid Date»", () => {
    const [p] = toDayPoints([{ day: "no-fecha", sends: 1 }]);
    expect(p.label).toBe("no-fecha");
    expect(p.envios).toBe(1);
  });
});
