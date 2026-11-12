import { describe, expect, it } from "vitest";
import { fitScale, widthScale, DESIGN_W } from "@/components/EmptyShowcase";

// Pantallas vacías (11-11-2026): el dibujo se encoge para que título, texto y botón quepan siempre.
describe("ajuste de la pantalla vacía", () => {
  it("con sitio de sobra, tamaño normal", () => {
    expect(fitScale({ viewportH: 1080, top: 200, textH: 220, naturalH: 340, padding: 56 })).toBe(1);
  });
  it("Unibox en un portátil (832 px, filtros arriba): se encoge lo justo", () => {
    const s = fitScale({ viewportH: 832, top: 330, textH: 228, naturalH: 330, padding: 56 });
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
    expect(330 * s + 228 + 56 + 330).toBeLessThanOrEqual(832);
  });
  it("nunca baja del mínimo (el dibujo no desaparece)", () => {
    expect(fitScale({ viewportH: 500, top: 400, textH: 228, naturalH: 330, padding: 56 })).toBe(0.42);
  });
});

// 12-11-2026: el dibujo es un lienzo fijo de 1000 px (tarjetas y caminos siempre encajan) que se
// escala entero si el hueco es más estrecho; en pantallas pequeñas el lienzo es fluido.
describe("escala por ancho del lienzo", () => {
  it("hueco más ancho que el lienzo: tamaño normal", () => expect(widthScale(1400, 1600)).toBe(1));
  it("hueco más estrecho: se encoge lo justo", () => expect(widthScale(800, 1200)).toBeCloseTo(800 / DESIGN_W));
  it("móvil o tableta (sin tarjetas): no se escala por ancho", () => expect(widthScale(500, 800)).toBe(1));
});
