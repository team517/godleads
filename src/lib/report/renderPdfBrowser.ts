// Browser-only glue: decode the logo to PNG (jsPDF needs PNG/JPEG), lazy-load jsPDF,
// and run the shared DOM-free builder. Kept separate from buildReportPdf.ts so that
// file stays importable from Deno (the scheduled path decodes the logo differently).

import { buildReportDoc } from "./buildReportPdf";
import type { ReportData, ReportBranding } from "./types";

async function imgToPngDataUrl(src: string): Promise<{ data: string; w: number; h: number } | null> {
  if (!src) return null;
  let objectUrl: string | null = null;
  try {
    // Client logos live in a PUBLIC Supabase bucket (cross-origin). Loading them
    // straight into an <img> and drawing to a canvas can "taint" the canvas so
    // toDataURL() throws and the logo silently disappears. Fetching the bytes first
    // and loading them from a same-origin blob: URL avoids the taint entirely — the
    // logo then reliably renders in the PDF regardless of the storage host's CORS.
    let loadSrc = src;
    if (/^https?:/i.test(src)) {
      try {
        const resp = await fetch(src, { mode: "cors" });
        if (resp.ok) { objectUrl = URL.createObjectURL(await resp.blob()); loadSrc = objectUrl; }
      } catch { /* fall back to direct <img> load below */ }
    }
    const img = new Image();
    if (!objectUrl) img.crossOrigin = "anonymous";
    img.src = loadSrc;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("load")); });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    let data: string | null = null;
    try { data = canvas.toDataURL("image/png"); } catch { data = null; }
    if (!data) return null;
    return { data, w, h };
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export interface BrowserBranding {
  company: string;
  brandColor: string;
  logoUrl?: string | null;
}

/** Build the report PDF in the browser. Returns a Blob + a suggested filename. */
export async function renderReportPdfBlob(data: ReportData, b: BrowserBranding): Promise<{ blob: Blob; filename: string }> {
  const branding: ReportBranding = { company: b.company, brandColor: b.brandColor, logoPngDataUrl: null };
  if (b.logoUrl) {
    const logo = await imgToPngDataUrl(b.logoUrl);
    if (logo) { branding.logoPngDataUrl = logo.data; branding.logoW = logo.w; branding.logoH = logo.h; }
  }
  const { default: jsPDF } = await import("jspdf");
  const doc = buildReportDoc(jsPDF, data, branding);
  const blob: Blob = doc.output("blob");
  const safe = (b.company || data.clientName || "informe").replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9\-]/g, "");
  const kindLabel = data.kind === "weekly" ? "semanal" : "48h";
  const filename = `informe-${kindLabel}-${safe}.pdf`;
  return { blob, filename };
}
