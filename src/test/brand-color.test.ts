import { describe, expect, it } from "vitest";
import { brandBarHsl, brandStyleFor, hexToHsl } from "@/lib/brandColor";

// Contraste del blanco sobre un hsl, recalculado aquí para no fiarnos de la propia función.
function whiteContrast(h: number, s: number, l: number): number {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
  return 1.05 / (lum + 0.05);
}

describe("barra superior con el color del cliente", () => {
  it("un color oscuro se usa casi tal cual (mismo tono)", () => {
    const bar = brandBarHsl("#1E3A8A")!; // azul marino
    expect(bar.h).toBe(224);
    expect(bar.l).toBeLessThanOrEqual(46);
    expect(whiteContrast(bar.h, bar.s, bar.l)).toBeGreaterThanOrEqual(4.5);
  });
  it("naranja, amarillo y verde claro se oscurecen lo justo: mismo tono, blanco legible", () => {
    for (const hex of ["#F28C00", "#FFD400", "#7ED957", "#00C2FF", "#FF5A8A"]) {
      const bar = brandBarHsl(hex)!;
      const tone = Number(hexToHsl(hex)!.split(" ")[0]);
      expect(bar.h).toBe(tone);
      expect(whiteContrast(bar.h, bar.s, bar.l)).toBeGreaterThanOrEqual(4.5);
      expect(bar.l).toBeGreaterThan(8); // oscurecido, no negro
      expect(bar.s).toBeLessThanOrEqual(85);
    }
  });
  it("negro y grises: barra neutra legible; blanco: gris oscuro, nunca una barra blanca", () => {
    expect(brandBarHsl("#000000")).toEqual({ h: 0, s: 0, l: 9 });
    const white = brandBarHsl("#FFFFFF")!;
    expect(white.s).toBe(0);
    expect(whiteContrast(white.h, white.s, white.l)).toBeGreaterThanOrEqual(4.5);
  });
  it("sin color o con un valor inválido no hay marca (queda el índigo del diseño)", () => {
    expect(brandBarHsl(null)).toBeNull();
    expect(brandBarHsl("naranja")).toBeNull();
    expect(brandStyleFor("")).toBeUndefined();
    expect(brandStyleFor("#12")).toBeUndefined();
  });
  it("brandStyleFor entrega el acento y las variables de la barra", () => {
    const st = brandStyleFor("#F28C00") as Record<string, string>;
    expect(st["--primary"]).toBe(hexToHsl("#F28C00"));
    expect(st["--brand-h"]).toBe("35");
    expect(st["--brand-bar"]).toMatch(/^35 \d+% \d+%$/);
  });
});
