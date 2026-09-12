import type { CSSProperties } from "react";

// Convert a #hex brand color to the "H S% L%" triple our CSS custom properties use.
// Lives here (and not inside a layout) because two different shells tint themselves
// with a client's colour: the app layout and the client's own read-only area.
export function hexToHsl(hex: string): string | null {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
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
  return `${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** The CSS custom properties that repaint the accent with a client's colour. */
export function brandStyleFor(hex: string | null | undefined): CSSProperties | undefined {
  const hsl = hex ? hexToHsl(hex) : null;
  if (!hsl) return undefined;
  return {
    ["--primary"]: hsl,
    ["--ring"]: hsl,
    ["--primary-glow"]: hsl,
    ["--sidebar-primary"]: hsl,
    ["--sidebar-ring"]: hsl,
  } as CSSProperties;
}
