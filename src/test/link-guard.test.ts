import { describe, expect, it } from "vitest";
import { fixBlockedLinks } from "../../supabase/functions/_shared/link-guard";

describe("guardián de enlaces (send-email)", () => {
  it("sustituye el enlace de Calendly que IONOS no entrega por la URL de perfil, en href y en texto", () => {
    const tpl = 'Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a>\nsaludos';
    const r = fixBlockedLinks(tpl);
    expect(r.text).toBe('Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso">https://calendly.com/onepulso</a>\nsaludos');
    expect(r.fixes).toEqual([{ from: "calendly.com/onepulso/30min", to: "calendly.com/onepulso" }]);
    expect(r.blocked).toEqual([]);
  });
  it("también con barra final, www o parámetros", () => {
    expect(fixBlockedLinks("ver https://www.calendly.com/onepulso/30min/?month=2026-10 ok").text).toBe("ver https://calendly.com/onepulso ok");
  });
  it("no toca un texto sin enlaces problemáticos (ni la URL de perfil ni otros Calendly)", () => {
    for (const s of ["Hola, https://calendly.com/onepulso", "https://calendly.com/kingofleadsdigital/30min", "sin enlaces", ""]) {
      const r = fixBlockedLinks(s);
      expect(r.text).toBe(s);
      expect(r.fixes).toEqual([]);
    }
  });
});
