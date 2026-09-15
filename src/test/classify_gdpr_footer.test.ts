import { describe, expect, it } from "vitest";
import { authorText, classifyMessage } from "@/lib/classify";

// Real case (PASEK, 2026-09-15): a warm meeting proposal followed by the company's GDPR
// boilerplate. The footer cut missed "comprometidos con el RGPD. Conozca…" (a full stop right
// after the marker) and the bare `rgpd` rule — which is FINAL, the AI is never asked — turned
// "Propongo mañana a las 11" into "No contactar".
const PASEK =
  "Buenos días, Propongo mañana a las 11. Saludos, Juan Naves García Director Industrial " +
  "Director de Recursos Humanos [Pasek] (+34) 626518501 juan.naves@pasek.group Calle Doctor Carreño, 1 " +
  "33405, Salinas, Asturias, España pasekgroup.com En Pasek, estamos comprometidos con el RGPD. Conozca el " +
  "tratamiento de los datos que llevamos a cabo en Pasek a través de “Política de privacidad” y ejercite los " +
  "derechos reconocidos en la misma a través del correo gdpr.pasek@pasek.es . At PASEK, we are committed to " +
  "GDPR. Learn about the data processing we carry out at PASEK through our “Privacy Policy” and exercise the " +
  "rights recognized therein through the email at gdpr.pasek@pasek.es . De: Alfons Pons Enviado el: lunes, 14 " +
  "de septiembre de 2026 16:37 Para: Juan Naves García Asunto: RE: idea para PASEK Buenas tardes Juan, Gracias " +
  "por tu tiempo. Te paso mi disponibilidad de esta semana.";

describe("clasificador — pie RGPD corporativo no es una baja", () => {
  it("recorta el pie legal antes del clasificador", () => {
    const t = authorText(PASEK);
    expect(t).toContain("Propongo mañana a las 11");
    expect(t).not.toMatch(/rgpd|gdpr|privacidad/i);
  });

  it("PASEK: «Propongo mañana a las 11» + pie RGPD → Interesado", () => {
    expect(classifyMessage("RE: idea para PASEK", PASEK)).toBe("interested");
  });

  it("un RGPD suelto en la firma no decide nada; con intención del autor sí", () => {
    expect(classifyMessage(null, "Vale, hablamos el jueves. Un saludo. --- Cumplimos el RGPD.")).not.toBe("no_contactar");
    expect(classifyMessage(null, "Exijo saber cómo tratáis mis datos según el RGPD.")).toBe("no_contactar");
    expect(classifyMessage(null, "¿De dónde habéis sacado mis datos? Esto viola el RGPD.")).toBe("no_contactar");
    expect(classifyMessage(null, "RGPD: no he dado consentimiento, borradme.")).toBe("no_contactar");
  });
});
