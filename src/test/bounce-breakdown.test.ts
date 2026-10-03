import { describe, expect, it } from "vitest";
import { bounceBreakdownText } from "@/lib/campaign-metrics";

describe("desglose de rebotes (texto de la celda Rebotados)", () => {
  it("separa el bloqueo del servidor (infraestructura) del buzón inexistente (lista)", () => {
    expect(bounceBreakdownText(373, { policy: 212, recipient_gone: 19, temporary: 0, other: 142 })).toBe(
      "373 rebotes · 212 por bloqueo del servidor emisor (lista negra/reputación: IONOS, Spamhaus) · 19 buzón inexistente · 142 otros",
    );
  });
  it("omite las causas a cero y el temporal se nombra", () => {
    expect(bounceBreakdownText(5, { policy: 0, recipient_gone: 3, temporary: 2, other: 0 })).toBe("5 rebotes · 3 buzón inexistente · 2 temporales");
  });
  it("sin desglose (aún no cargado o sin avisos): sólo el total", () => {
    expect(bounceBreakdownText(12, null)).toBe("12 rebotes");
    expect(bounceBreakdownText(0, null)).toBe("Sin rebotes");
  });
});
