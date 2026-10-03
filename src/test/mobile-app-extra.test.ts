import { describe, expect, it } from "vitest";
import { templatePreview } from "@/pages/mobile/Templates";

describe("vista previa de una plantilla", () => {
  it("sin etiquetas, con el texto del enlace y en una línea", () => {
    expect(templatePreview('Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso">Reservar llamada</a>'))
      .toBe("Buenas, te paso mi calendario Reservar llamada");
    expect(templatePreview("")).toBe("");
  });
});
