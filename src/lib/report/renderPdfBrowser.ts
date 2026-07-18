// Browser-only glue: decode the logo to PNG (jsPDF needs PNG/JPEG), lazy-load jsPDF,
// and run the shared DOM-free builder. Kept separate from buildReportPdf.ts so that
// file stays importable from Deno (the scheduled path decodes the logo differently).

import { buildReportDoc } from "./buildReportPdf";
import type { ReportData, ReportBranding } from "./types";

async function imgToPngDataUrl(src: string): Promise<{ data: string; w: number; h: number } | null> {
  if (!src) return null;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("load")); });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { data: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
  } catch {
    return null;
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
