import { describe, expect, it } from "vitest";
import { esperasPorLead, textoVuelta, tooltipVuelta } from "@/lib/ooo-chip";

describe("chip de fuera de oficina en los leads de la campaña", () => {
  it("texto con el día de vuelta", () => {
    expect(textoVuelta("2026-11-15")).toBe("Fuera · vuelve el 15 nov");
    expect(textoVuelta(null)).toBe("Fuera · vuelve pronto");
  });
  it("sólo las esperas vigentes y, por lead, la más lejana", () => {
    const now = Date.parse("2026-11-10T10:00:00Z");
    const r = esperasPorLead([
      { lead_id: "a", return_date: "2026-11-15", scheduled_for: "2026-11-16T08:00:00Z", snippet: "fuera" },
      { lead_id: "a", return_date: "2026-11-20", scheduled_for: "2026-11-20T08:00:00Z", snippet: "fuera más" },
      { lead_id: "b", return_date: "2026-11-01", scheduled_for: "2026-11-02T08:00:00Z", snippet: "ya pasó" },
    ], now);
    expect(Object.keys(r)).toEqual(["a"]);
    expect(r.a.return_date).toBe("2026-11-20");
  });
  it("el tooltip dice cuándo sale el siguiente correo y qué respondió", () => {
    const t = tooltipVuelta({ lead_id: "a", return_date: "2026-11-16", scheduled_for: "2026-11-16T08:00:00Z", snippet: "Estoy fuera hasta el 15" });
    expect(t).toContain("Siguiente correo:");
    expect(t).toContain("Estoy fuera hasta el 15");
  });
});
