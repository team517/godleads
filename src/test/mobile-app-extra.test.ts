import { describe, expect, it } from "vitest";
import { templatePreview } from "@/pages/mobile/Templates";
import { iosBottomShim } from "@/lib/mobile-app";

describe("vista previa de una plantilla", () => {
  it("sin etiquetas, con el texto del enlace y en una línea", () => {
    expect(templatePreview('Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso">Reservar llamada</a>'))
      .toBe("Buenas, te paso mi calendario Reservar llamada");
    expect(templatePreview("")).toBe("");
  });
});

describe("hueco de abajo en iPhone (app instalada)", () => {
  const base = { safeTop: 59, portrait: true, screenW: 393, screenH: 852 };
  it("barra de estado transparente y página 59 pt más corta → se alarga esa cantidad", () => {
    expect(iosBottomShim({ ...base, pageH: 793 })).toBe(59);
  });
  it("página ya completa → nada", () => {
    expect(iosBottomShim({ ...base, pageH: 852 })).toBe(0);
  });
  it("barra de estado normal (sin zona segura arriba) → nada aunque la página sea más corta", () => {
    expect(iosBottomShim({ ...base, safeTop: 0, pageH: 793 })).toBe(0);
  });
  it("diferencias raras (teclado, pantalla partida) → nada", () => {
    expect(iosBottomShim({ ...base, pageH: 500 })).toBe(0);
  });
  it("en horizontal usa el lado corto", () => {
    expect(iosBottomShim({ ...base, portrait: false, pageH: 360 })).toBe(33);
  });
});
