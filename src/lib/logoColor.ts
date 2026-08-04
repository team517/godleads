// Extract the brand color from a logo image.
// Logos are mostly transparent/white background + black text + ONE vivid brand color.
// A naive average would give muddy grey, so we throw away near-white / near-black /
// low-saturation (text & background) pixels and pick the most prominent vivid hue.

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const rgbToHex = (r: number, g: number, b: number) => `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();

/**
 * Returns the dominant vivid color of a logo as a hex string (e.g. "#1EA7B5"),
 * or null if it can't be read. Accepts a File (uploaded logo) or an image URL.
 */
export async function extractLogoColor(source: File | string): Promise<string | null> {
  try {
    const isFile = typeof source !== "string";
    const url = isFile ? URL.createObjectURL(source as File) : (source as string);
    const img = new Image();
    if (!isFile) img.crossOrigin = "anonymous"; // storage serves CORS *; blobs are same-origin

    const el = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("logo load failed"));
      img.src = url;
    });

    const S = 48; // downscale — plenty for a color estimate, cheap to scan
    const canvas = document.createElement("canvas");
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0, S, S);
    if (isFile) URL.revokeObjectURL(url);

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, S, S).data;
    } catch {
      return null; // tainted canvas (CORS) — bail safely
    }

    // Group vivid pixels into 24 hue buckets; weight by saturation & mid-lightness.
    const buckets = new Map<number, { r: number; g: number; b: number; w: number }>();
    let fr = 0, fg = 0, fb = 0, fn = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 125) continue;
      fr += r; fg += g; fb += b; fn++; // fallback average of any opaque pixel
      const { h, s, l } = rgbToHsl(r, g, b);
      if (l > 0.92 || l < 0.08) continue; // near white / black
      if (s < 0.18) continue;             // grey (text / neutral bg)
      const key = Math.round(h / 15) % 24;
      const w = s * (1 - Math.abs(l - 0.5)); // prefer saturated, mid-bright
      const cur = buckets.get(key) || { r: 0, g: 0, b: 0, w: 0 };
      cur.r += r * w; cur.g += g * w; cur.b += b * w; cur.w += w;
      buckets.set(key, cur);
    }

    let best: { r: number; g: number; b: number; w: number } | null = null;
    for (const v of buckets.values()) if (!best || v.w > best.w) best = v;
    if (best && best.w > 0) return rgbToHex(best.r / best.w, best.g / best.w, best.b / best.w);
    if (fn > 0) return rgbToHex(fr / fn, fg / fn, fb / fn); // no vivid color → average
    return null;
  } catch {
    return null;
  }
}
