import { describe, expect, it } from "vitest";
import { bounceRatePct } from "@/lib/campaign-metrics";

/* % de rebote sobre INTENTOS (enviados + rebotados), 19-10-2026. */
describe("bounceRatePct", () => {
  it("Coco: 317 rebotes y 826 enviados = 27,7 % (antes salía 38,4 %)", () => {
    expect(bounceRatePct(317, 826)).toBeCloseTo(27.73, 1);
  });
  it("Ray (dialogfy - b2b): 30 y 2.122 = 1,4 %", () => {
    expect(bounceRatePct(30, 2122)).toBeCloseTo(1.39, 1);
  });
  it("sin envíos ni rebotes = 0; todo rebotado = 100", () => {
    expect(bounceRatePct(0, 0)).toBe(0);
    expect(bounceRatePct(5, 0)).toBe(100);
  });
});
