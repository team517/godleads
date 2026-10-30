import { describe, expect, it } from "vitest";
import { canUseZapmail } from "@/lib/zapmail";

describe("Zapmail", () => {
  it("sólo hello@ y support@", () => {
    expect(canUseZapmail("hello@onepulso.blog")).toBe(true);
    expect(canUseZapmail(" Support@OnePulso.online ")).toBe(true);
    for (const e of ["equipo@onepulso.online", "team@onepulso.online", "cliente@empresa.com", "", null]) expect(canUseZapmail(e)).toBe(false);
  });
});
