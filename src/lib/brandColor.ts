import type { CSSProperties } from "react";

// Convert a #hex brand color to the "H S% L%" triple our CSS custom properties use.
// Lives here (and not inside a layout) because two different shells tint themselves
// with a client's colour: the app layout and the client's own read-only area.
function parseHex(hex: string): [number, number, number] | null {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  return [Math.round(hue * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function hexToHsl(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(...rgb);
  return `${h} ${s}% ${l}%`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Contraste WCAG del blanco sobre un color (r, g, b en 0–1). */
function contrastWithWhite([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (lum + 0.05);
}

/** Color de la BARRA SUPERIOR para una marca: el propio color del cliente si el blanco se lee
 *  bien encima, y si no (naranjas, amarillos, verdes claros…) el mismo tono oscurecido justo
 *  hasta que se lea (contraste ≥ 4.5). Así la barra es siempre "su color" y nunca ilegible. */
export function brandBarHsl(hex: string | null | undefined): { h: number; s: number; l: number } | null {
  const rgb = hex ? parseHex(hex) : null;
  if (!rgb) return null;
  const [h, s0, l0] = rgbToHsl(...rgb);
  const s = Math.min(s0, 85);            // un 100% de saturación a lo ancho de la pantalla cansa
  let l = Math.min(l0, 46);
  while (l > 8 && contrastWithWhite(hslToRgb(h, s, l)) < 4.5) l -= 1;
  return { h, s, l: Math.max(l, 9) };   // una marca negra da una barra casi negra, no un agujero
}

/** The CSS custom properties that repaint the accent with a client's colour. The shell reads
 *  `--brand-*` from `[data-brand]` rules in index.css (light and dark each get their own tints),
 *  so put `data-brand` on the same element that receives this style. */
export function brandStyleFor(hex: string | null | undefined): CSSProperties | undefined {
  const hsl = hex ? hexToHsl(hex) : null;
  const bar = brandBarHsl(hex);
  if (!hsl || !bar) return undefined;
  return {
    ["--primary"]: hsl,
    ["--ring"]: hsl,
    ["--primary-glow"]: hsl,
    ["--sidebar-primary"]: hsl,
    ["--sidebar-ring"]: hsl,
    ["--brand-h"]: String(bar.h),
    ["--brand-s"]: `${bar.s}%`,
    ["--brand-bar"]: `${bar.h} ${bar.s}% ${bar.l}%`,
  } as CSSProperties;
}
