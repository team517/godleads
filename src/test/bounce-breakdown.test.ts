import { describe, expect, it } from "vitest";
import { bounceBreakdownText } from "@/lib/campaign-metrics";

/* 06-10-2026: "Rebotados" sólo suma los rebotes por la dirección del lead; los bloqueos del servidor
   emisor (IONOS/Spamhaus) se dicen aparte y no cuentan. */
describe("desglose de rebotes (texto de la celda Rebotados)", () => {
  it("el bloqueo del servidor emisor va aparte y no cuenta", () => {
    expect(bounceBreakdownText(161, { policy: 212, recipient_gone: 19, temporary: 0, other: 142 })).toBe(
      "161 rebotes · 19 buzón inexistente · Aparte, 212 bloqueos del servidor emisor (IONOS/Spamhaus) que no cuentan como rebote",
    );
  });
  it("omite las causas a cero", () => {
    expect(bounceBreakdownText(5, { policy: 0, recipient_gone: 3, temporary: 2, other: 0 })).toBe("5 rebotes · 3 buzón inexistente");
  });
  it("sólo bloqueos: 0 rebotes, pero se dice el bloqueo", () => {
    expect(bounceBreakdownText(0, { policy: 4, recipient_gone: 0, temporary: 0, other: 0 })).toBe(
      "Aparte, 4 bloqueos del servidor emisor (IONOS/Spamhaus) que no cuentan como rebote",
    );
  });
  it("sin desglose (aún no cargado o sin avisos): sólo el total", () => {
    expect(bounceBreakdownText(12, null)).toBe("12 rebotes");
    expect(bounceBreakdownText(0, null)).toBe("Sin rebotes");
  });
});
