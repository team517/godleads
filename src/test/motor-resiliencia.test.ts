import { describe, expect, it } from "vitest";
import { backoffMinutes, inBackoff, BACKOFF_MAX_LEVEL } from "../../supabase/functions/_shared/engine-scale";

/* Pausa automática de buzones tras fallos seguidos del servidor (02-11-2026). */
describe("pausa automática de buzones", () => {
  it("15, 30, 60, 120 min y no pasa de 120", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMinutes)).toEqual([15, 30, 60, 120, 120, 120]);
    expect(backoffMinutes(0)).toBe(15);
    expect(BACKOFF_MAX_LEVEL).toBe(4);
  });
  it("en pausa sólo mientras no se cumple la hora", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    expect(inBackoff({ backoff_until: "2026-11-02T10:14:00Z" }, now)).toBe(true);
    expect(inBackoff({ backoff_until: "2026-11-02T09:59:00Z" }, now)).toBe(false);
    expect(inBackoff({ backoff_until: null }, now)).toBe(false);
    expect(inBackoff({}, now)).toBe(false);
  });
});
