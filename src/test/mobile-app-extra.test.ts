import { describe, expect, it } from "vitest";
import { fullScreenHeightFix } from "@/lib/mobile-app";
import { templatePreview } from "@/pages/mobile/Templates";

describe("altura de la app en iPhone", () => {
  const base = { ios: true, installed: true, portrait: true, screenW: 393, screenH: 852, visualH: null };
  it("si iOS deja la página corta (pantalla menos la barra de estado), se usa la pantalla entera", () => {
    expect(fullScreenHeightFix({ ...base, innerH: 793 })).toBe(852);
  });
  it("si ya ocupa toda la pantalla, no se toca", () => {
    expect(fullScreenHeightFix({ ...base, innerH: 852 })).toBeNull();
  });
  it("con el teclado fuera, no se toca", () => {
    expect(fullScreenHeightFix({ ...base, innerH: 793, visualH: 450 })).toBeNull();
  });
  it("Android, navegador o diferencias raras: nunca", () => {
    expect(fullScreenHeightFix({ ...base, ios: false, innerH: 780 })).toBeNull();
    expect(fullScreenHeightFix({ ...base, installed: false, innerH: 700 })).toBeNull();
    expect(fullScreenHeightFix({ ...base, innerH: 500 })).toBeNull();
  });
  it("en horizontal usa el lado corto", () => {
    expect(fullScreenHeightFix({ ...base, portrait: false, innerH: 360 })).toBe(393);
  });
});

describe("vista previa de una plantilla", () => {
  it("sin etiquetas, con el texto del enlace y en una línea", () => {
    expect(templatePreview('Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso">Reservar llamada</a>'))
      .toBe("Buenas, te paso mi calendario Reservar llamada");
    expect(templatePreview("")).toBe("");
  });
});
