import { describe, expect, it } from "vitest";
import { paceWindow, zonedMidnightIso } from "../../supabase/functions/_shared/engine-scale";

describe("zonedMidnightIso", () => {
  it("Madrid en verano = 22:00 UTC del día anterior", () => {
    expect(zonedMidnightIso(new Date("2026-09-23T10:00:00Z"), "Europe/Madrid")).toBe("2026-09-22T22:00:00.000Z");
  });
  it("Madrid en invierno = 23:00 UTC", () => {
    expect(zonedMidnightIso(new Date("2026-12-10T10:00:00Z"), "Europe/Madrid")).toBe("2026-12-09T23:00:00.000Z");
  });
  it("Nueva York: a las 21:00 de allí sigue siendo su mismo día", () => {
    // 2026-09-24T01:00Z = 23-sep 21:00 en Nueva York (EDT, UTC-4)
    expect(zonedMidnightIso(new Date("2026-09-24T01:00:00Z"), "America/New_York")).toBe("2026-09-23T04:00:00.000Z");
  });
  it("UTC", () => {
    expect(zonedMidnightIso(new Date("2026-09-23T15:30:00Z"), "UTC")).toBe("2026-09-23T00:00:00.000Z");
  });
  it("día de cambio de hora (Madrid, 25-oct-2026)", () => {
    expect(zonedMidnightIso(new Date("2026-10-25T12:00:00Z"), "Europe/Madrid")).toBe("2026-10-24T22:00:00.000Z");
  });
  it("Asia (UTC+8) y zona con media hora (India)", () => {
    expect(zonedMidnightIso(new Date("2026-09-23T03:00:00Z"), "Asia/Shanghai")).toBe("2026-09-22T16:00:00.000Z");
    expect(zonedMidnightIso(new Date("2026-09-23T03:00:00Z"), "Asia/Kolkata")).toBe("2026-09-22T18:30:00.000Z");
  });
});

describe("paceWindow", () => {
  const W = 540; // 9-18
  it("campaña que empezó a su hora: igual que siempre", () => {
    const p = paceWindow(W, 240, 238); // primer envío a las 9:02, ahora 13:00
    expect(p.startMin).toBe(0);
    expect(p.fraction).toBeCloseTo(241 / 540);
  });
  it("activada a las 13:00 sin envíos todavía: reparte de 13 a 18", () => {
    const p = paceWindow(W, 240, null);
    expect(p.startMin).toBe(240);
    expect(p.spanMinutes).toBe(300);
    expect(p.fraction).toBeCloseTo(1 / 300);
  });
  it("activada a las 13:00, ahora 15:30: va por la mitad de SU tramo", () => {
    const p = paceWindow(W, 390, 150);
    expect(p.startMin).toBe(240);
    expect(p.fraction).toBeCloseTo(151 / 300);
  });
  it("margen de 15 min al abrir la franja", () => {
    expect(paceWindow(W, 10, null).startMin).toBe(0);
    expect(paceWindow(W, 30, 20).startMin).toBe(0); // primer envío a las 9:10
  });
  it("nunca pasa de 1 ni se sale de la franja", () => {
    expect(paceWindow(W, 600, null).fraction).toBeLessThanOrEqual(1);
    expect(paceWindow(W, 539, 0).fraction).toBe(1);
  });
});
