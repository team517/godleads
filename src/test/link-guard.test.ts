import { describe, expect, it } from "vitest";
import { fixBlockedLinks } from "../../supabase/functions/_shared/link-guard";

/* 06-10-2026: el enlace calendly.com/onepulso/30min vuelve a no entregar (IONOS lo enruta por un
   servidor en Spamhaus; 6 de 8 respuestas con él rebotaron; las pruebas del dueño a Gmail con la
   plantilla no llegaron). Se cambia por la URL de perfil, que entrega, y se avisa del cambio. */
describe("guardián de enlaces", () => {
  it("cambia /30min por la URL de perfil, en el texto y en el href", () => {
    const tpl = 'Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a>\nsaludos';
    const r = fixBlockedLinks(tpl);
    expect(r.text).not.toContain("/30min");
    expect(r.text).toContain('<a href="https://calendly.com/onepulso">https://calendly.com/onepulso</a>');
    expect(r.fixes).toEqual([{ from: "calendly.com/onepulso/30min", to: "calendly.com/onepulso" }]);
    expect(r.blocked).toEqual([]);
  });
  it("también con www, barra final o parámetros", () => {
    const r = fixBlockedLinks("ver https://www.calendly.com/onepulso/30min/?month=2026-10 ya");
    expect(r.text).toBe("ver https://calendly.com/onepulso ya");
  });
  it("no toca lo que entrega", () => {
    for (const s of ["Hola, https://calendly.com/onepulso", "https://calendly.com/kingofleadsdigital/30min", "sin enlaces", ""]) {
      const r = fixBlockedLinks(s);
      expect(r.text).toBe(s);
      expect(r.fixes).toEqual([]);
      expect(r.blocked).toEqual([]);
    }
  });
});
