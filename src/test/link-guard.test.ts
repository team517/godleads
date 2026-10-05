import { describe, expect, it } from "vitest";
import { fixBlockedLinks } from "../../supabase/functions/_shared/link-guard";

describe("guardián de enlaces (send-email)", () => {
  it("el enlace de Calendly /30min se envía ENTERO (petición del dueño, 05-10-2026)", () => {
    const tpl = 'Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a>\nsaludos';
    const r = fixBlockedLinks(tpl);
    expect(r.text).toBe(tpl);
    expect(r.fixes).toEqual([]);
    expect(r.blocked).toEqual([]);
  });
  it("no toca ningún otro enlace ni texto", () => {
    for (const s of ["Hola, https://calendly.com/onepulso", "https://calendly.com/kingofleadsdigital/30min", "sin enlaces", ""]) {
      const r = fixBlockedLinks(s);
      expect(r.text).toBe(s);
      expect(r.fixes).toEqual([]);
    }
  });
});
