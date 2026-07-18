// Corporate PDF builder for the automated client reports.
//
// DOM-FREE ON PURPOSE: it only uses jsPDF's programmatic drawing API (text, rects,
// images, lines) — no html2canvas, no `document`. That way the SAME builder runs in
// the browser (test preview + download) and in the Deno edge function (scheduled
// sends), producing identical output with no external PDF service.
//
// The jsPDF *constructor* is injected so each environment imports it its own way:
//   browser:  const { default: jsPDF } = await import("jspdf")
//   Deno:     import { jsPDF } from "https://esm.sh/jspdf@2.5.1"
//
// Returns the finished jsPDF doc; callers pick the output format:
//   browser:  doc.output("blob")
//   Deno:     new Uint8Array(doc.output("arraybuffer"))

import type { ReportData, ReportBranding } from "./types";

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return [110, 88, 241]; // OnePulso violet fallback
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Relative luminance → pick readable text (white on dark brand, near-black on light).
function readableOn([r, g, b]: Rgb): Rgb {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? [23, 23, 30] : [255, 255, 255];
}

function mix([r, g, b]: Rgb, [r2, g2, b2]: Rgb, t: number): Rgb {
  return [Math.round(r + (r2 - r) * t), Math.round(g + (g2 - g) * t), Math.round(b + (b2 - b) * t)];
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 14;

export function buildReportDoc(jsPDFCtor: any, data: ReportData, branding: ReportBranding): any {
  const doc = new jsPDFCtor({ unit: "mm", format: "a4", orientation: "portrait" });
  const brand = hexToRgb(branding.brandColor);
  const onBrand = readableOn(brand);
  const ink: Rgb = [30, 30, 38];
  const muted: Rgb = [122, 122, 135];
  const line: Rgb = [228, 228, 236];
  const softBrand = mix(brand, [255, 255, 255], 0.9); // very light brand tint

  let y = 0;

  const setText = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw = (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]);

  // Add a new page and reset the cursor below the top margin.
  const newPage = () => { doc.addPage(); y = MARGIN + 4; };
  const ensure = (h: number) => { if (y + h > PAGE_H - FOOTER_H) newPage(); };

  // ── Header band ──────────────────────────────────────────────────────────
  const headerH = 44;
  setFill(brand);
  doc.rect(0, 0, PAGE_W, headerH, "F");
  // subtle darker strip at the very top for depth
  setFill(mix(brand, [0, 0, 0], 0.18));
  doc.rect(0, 0, PAGE_W, 2.2, "F");

  // Logo on a white chip (so any logo reads on the colored band)
  let textX = MARGIN;
  if (branding.logoPngDataUrl) {
    try {
      const ratio = branding.logoW && branding.logoH ? branding.logoW / branding.logoH : 3;
      const chipH = 20;
      const logoH = 13;
      const logoW = Math.min(logoH * ratio, 46);
      const chipW = logoW + 8;
      setFill([255, 255, 255]);
      doc.roundedRect(MARGIN, (headerH - chipH) / 2, chipW, chipH, 2.5, 2.5, "F");
      doc.addImage(branding.logoPngDataUrl, "PNG", MARGIN + 4, (headerH - logoH) / 2, logoW, logoH);
      textX = MARGIN + chipW + 7;
    } catch { /* logo failed → just skip it */ }
  }

  setText(onBrand);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  const title = data.kind === "weekly" ? "Informe semanal de campaña" : "Informe de rendimiento";
  doc.text(title, textX, 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const sub = readableOn(brand)[0] === 255 ? mix(onBrand, brand, 0.15) : mix(onBrand, brand, 0.25);
  setText(sub);
  doc.text(branding.company || data.clientName, textX, 26.5);
  doc.setFontSize(9);
  doc.text(`${data.periodLabel}  ·  Generado el ${data.generatedAtLabel}`, textX, 33);

  y = headerH + 9;

  // ── Reply-rate highlight strip ───────────────────────────────────────────
  const stripH = 26;
  setFill(softBrand);
  doc.roundedRect(MARGIN, y, CONTENT_W, stripH, 3, 3, "F");
  setText(brand);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text(`${data.replyRate.toFixed(1)}%`, MARGIN + 8, y + 17);
  setText(ink);
  doc.setFontSize(11);
  doc.text("Tasa de respuesta", MARGIN + 42, y + 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(muted);
  doc.text(
    `${data.totals.replied.toLocaleString("es")} respuestas de ${data.totals.contacted.toLocaleString("es")} personas contactadas`,
    MARGIN + 42, y + 18,
  );
  y += stripH + 8;

  // ── KPI cards ────────────────────────────────────────────────────────────
  const cards: { label: string; value: string; sub?: string }[] = [
    { label: "Personas contactadas", value: data.totals.contacted.toLocaleString("es"), sub: data.totals.periodNewContacts ? `+${data.totals.periodNewContacts} nuevas` : undefined },
    { label: "Correos enviados", value: data.totals.sent.toLocaleString("es"), sub: data.totals.periodSent ? `${data.totals.periodSent} en el periodo` : undefined },
    { label: "Respuestas", value: data.totals.replied.toLocaleString("es"), sub: data.totals.periodReplies ? `+${data.totals.periodReplies} en el periodo` : undefined },
    { label: "Interesados", value: data.totals.positive.toLocaleString("es"), sub: "marcados por la IA" },
    { label: "Rebotes", value: data.totals.bounced.toLocaleString("es") },
    { label: "Contactos restantes", value: data.totals.remaining.toLocaleString("es") },
  ];
  const gap = 5;
  const cardW = (CONTENT_W - gap * 2) / 3;
  const cardH = 26;
  cards.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    if (col === 0) ensure(cardH + (row === 0 ? 0 : gap));
    const cx = MARGIN + col * (cardW + gap);
    const cy = y + row * (cardH + gap);
    setFill([250, 250, 252]);
    setDraw(line);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, cy, cardW, cardH, 2.5, 2.5, "FD");
    setText(ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(c.value, cx + 5, cy + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(muted);
    doc.text(c.label.toUpperCase(), cx + 5, cy + 18, { maxWidth: cardW - 8 } as any);
    if (c.sub) {
      setText(brand);
      doc.setFontSize(7.5);
      doc.text(c.sub, cx + 5, cy + 22.5, { maxWidth: cardW - 8 } as any);
    }
  });
  y += cardH * 2 + gap + 8;

  // ── Section helper ───────────────────────────────────────────────────────
  const section = (label: string) => {
    ensure(14);
    setFill(brand);
    doc.roundedRect(MARGIN, y, 3, 6.5, 1, 1, "F");
    setText(ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(label, MARGIN + 6, y + 5.5);
    y += 11;
  };

  // Wrapped paragraph, advances y.
  const paragraph = (text: string, opts?: { color?: Rgb; size?: number; lineH?: number }) => {
    const size = opts?.size ?? 10;
    const lineH = opts?.lineH ?? 5.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    setText(opts?.color ?? ink);
    const lines: string[] = doc.splitTextToSize(text || "", CONTENT_W);
    for (const ln of lines) {
      ensure(lineH);
      doc.text(ln, MARGIN, y);
      y += lineH;
    }
  };

  // Bullet list with a brand dot, wrapped.
  const bullets = (items: string[], opts?: { tint?: boolean }) => {
    const size = 10;
    const lineH = 5.2;
    const indent = 6;
    for (const raw of items) {
      const item = (raw || "").trim();
      if (!item) continue;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      const lines: string[] = doc.splitTextToSize(item, CONTENT_W - indent - (opts?.tint ? 8 : 0));
      const blockH = lines.length * lineH;
      ensure(blockH + 1.5);
      // dot
      setFill(brand);
      doc.circle(MARGIN + (opts?.tint ? 6 : 1.6), y - 1.6, 0.9, "F");
      setText(ink);
      lines.forEach((ln, idx) => {
        doc.text(ln, MARGIN + indent + (opts?.tint ? 5 : 0), y + idx * lineH);
      });
      y += blockH + 2;
    }
  };

  // ── Resumen (AI summary) ─────────────────────────────────────────────────
  if (data.narrative.summary) {
    section("Resumen ejecutivo");
    paragraph(data.narrative.summary);
    y += 4;
  }

  // ── Alert (low contacts, etc.) ───────────────────────────────────────────
  if (data.narrative.alert) {
    const alertLines: string[] = doc.splitTextToSize(data.narrative.alert, CONTENT_W - 14);
    const boxH = alertLines.length * 5 + 9;
    ensure(boxH + 2);
    setFill([255, 249, 237]);
    setDraw([245, 190, 90]);
    doc.setLineWidth(0.4);
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2.5, 2.5, "FD");
    setText([146, 96, 8]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text("Aviso", MARGIN + 6, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    alertLines.forEach((ln: string, i: number) => doc.text(ln, MARGIN + 6, y + 11.5 + i * 5));
    y += boxH + 8;
  }

  // ── Highlights ───────────────────────────────────────────────────────────
  if (data.narrative.highlights?.length) {
    section("Lo más destacado");
    bullets(data.narrative.highlights);
    y += 3;
  }

  // ── Daily activity chart ─────────────────────────────────────────────────
  const daily = data.campaigns.length
    ? mergeDaily(data.campaigns)
    : [];
  if (daily.length) {
    ensure(14 + 44 + 15); // keep section header + chart + legend together on one page
    section("Actividad diaria");
    drawBarChart(doc, MARGIN, y, CONTENT_W, 44, daily, brand, muted, line);
    y += 44 + 6;
    // legend
    setFill(brand); doc.rect(MARGIN, y - 2.6, 3, 3, "F");
    setText(muted); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text("Enviados", MARGIN + 5, y);
    const teal: Rgb = [20, 160, 133];
    setFill(teal); doc.rect(MARGIN + 32, y - 2.6, 3, 3, "F");
    doc.text("Respuestas", MARGIN + 37, y);
    y += 9;
  }

  // ── Per-campaign table ───────────────────────────────────────────────────
  if (data.campaigns.length) {
    ensure(14 + 8 * 3); // header + a few rows before allowing a page break
    section("Detalle por campaña");
    y = drawTable(doc, y, data, brand, ink, muted, line);
    y += 4;
  }

  // ── Próximos pasos ───────────────────────────────────────────────────────
  if (data.narrative.nextSteps?.length) {
    section("Próximos pasos recomendados");
    // tinted box
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const measure = data.narrative.nextSteps
      .map((s) => doc.splitTextToSize(s, CONTENT_W - 22).length)
      .reduce((a, b) => a + b, 0);
    const boxH = measure * 5.2 + data.narrative.nextSteps.length * 2 + 8;
    ensure(boxH + 2); // reserve the full box so the bullets never spill past it
    const boxTop = y;
    setFill(softBrand);
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 3, 3, "F");
    y += 6;
    bullets(data.narrative.nextSteps, { tint: true });
    y = Math.max(y, boxTop + boxH) + 8;
  }

  // ── Sugerencias (weekly only) ────────────────────────────────────────────
  if (data.kind === "weekly" && data.narrative.suggestions?.length) {
    section("Sugerencias para la próxima semana");
    bullets(data.narrative.suggestions);
    y += 3;
  }

  // ── Footers on every page ────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    setDraw(line);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_H - 10, PAGE_W - MARGIN, PAGE_H - 10);
    setText(muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`${branding.company || data.clientName} · Informe generado por OnePulso`, MARGIN, PAGE_H - 5.5);
    doc.text(`Página ${p} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 5.5, { align: "right" } as any);
  }

  return doc;
}

// Sum daily series across all campaigns aligned by day label.
function mergeDaily(campaigns: ReportData["campaigns"]): { day: string; sends: number; replies: number }[] {
  const map = new Map<string, { day: string; sends: number; replies: number }>();
  const order: string[] = [];
  for (const c of campaigns) {
    for (const d of c.daily || []) {
      if (!map.has(d.day)) { map.set(d.day, { day: d.day, sends: 0, replies: 0 }); order.push(d.day); }
      const m = map.get(d.day)!;
      m.sends += d.sends; m.replies += d.replies;
    }
  }
  return order.map((k) => map.get(k)!);
}

function drawBarChart(
  doc: any, x: number, top: number, w: number, h: number,
  daily: { day: string; sends: number; replies: number }[],
  brand: Rgb, muted: Rgb, line: Rgb,
) {
  const teal: Rgb = [20, 160, 133];
  const axisY = top + h - 8; // baseline
  const chartTop = top + 2;
  const chartH = axisY - chartTop;
  const maxVal = Math.max(1, ...daily.map((d) => Math.max(d.sends, d.replies)));
  // baseline
  doc.setDrawColor(line[0], line[1], line[2]);
  doc.setLineWidth(0.3);
  doc.line(x, axisY, x + w, axisY);
  const n = daily.length;
  const groupW = w / n;
  const barW = Math.min(4.5, groupW / 3);
  daily.forEach((d, i) => {
    const gx = x + i * groupW + groupW / 2;
    const sH = (d.sends / maxVal) * chartH;
    const rH = (d.replies / maxVal) * chartH;
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(gx - barW - 0.6, axisY - sH, barW, sH, "F");
    doc.setFillColor(teal[0], teal[1], teal[2]);
    doc.rect(gx + 0.6, axisY - rH, barW, rH, "F");
    // x label (short day)
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(shortDay(d.day), gx, axisY + 5, { align: "center" } as any);
  });
}

function shortDay(iso: string): string {
  // iso like "2026-07-18" → "18/07"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}` : iso;
}

function drawTable(
  doc: any, top: number, data: ReportData,
  brand: Rgb, ink: Rgb, muted: Rgb, line: Rgb,
): number {
  let y = top;
  const cols = [
    { key: "name", label: "Campaña", w: 62, align: "left" as const },
    { key: "contacted", label: "Contact.", w: 24, align: "right" as const },
    { key: "sent", label: "Enviados", w: 26, align: "right" as const },
    { key: "replied", label: "Resp.", w: 22, align: "right" as const },
    { key: "positive", label: "Interes.", w: 24, align: "right" as const },
    { key: "rate", label: "Tasa", w: 24, align: "right" as const },
  ];
  const rowH = 8;
  const drawHeader = () => {
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
    const onBrand = readableOn(brand);
    doc.setTextColor(onBrand[0], onBrand[1], onBrand[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    let cx = MARGIN;
    for (const c of cols) {
      const tx = c.align === "right" ? cx + c.w - 2 : cx + 2.5;
      doc.text(c.label, tx, y + 5.4, { align: c.align } as any);
      cx += c.w;
    }
    y += rowH;
  };
  drawHeader();
  data.campaigns.forEach((c, i) => {
    if (y + rowH > PAGE_H - FOOTER_H) { doc.addPage(); y = MARGIN + 4; drawHeader(); }
    if (i % 2 === 1) { doc.setFillColor(247, 247, 250); doc.rect(MARGIN, y, CONTENT_W, rowH, "F"); }
    const rate = c.contacted > 0 ? `${((c.replied / c.contacted) * 100).toFixed(1)}%` : "0%";
    const vals: Record<string, string> = {
      name: c.name,
      contacted: c.contacted.toLocaleString("es"),
      sent: c.sent.toLocaleString("es"),
      replied: c.replied.toLocaleString("es"),
      positive: c.positive.toLocaleString("es"),
      rate,
    };
    let cx = MARGIN;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    for (const col of cols) {
      doc.setTextColor(col.key === "rate" ? brand[0] : ink[0], col.key === "rate" ? brand[1] : ink[1], col.key === "rate" ? brand[2] : ink[2]);
      const raw = vals[col.key];
      const tx = col.align === "right" ? cx + col.w - 2 : cx + 2.5;
      let text = raw;
      if (col.key === "name") {
        const first = doc.splitTextToSize(raw, col.w - 4)[0] || raw;
        text = first.length < raw.length ? first.slice(0, Math.max(0, first.length - 1)) + "…" : first;
      }
      doc.text(text, tx, y + 5.4, { align: col.align } as any);
      cx += col.w;
    }
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
    y += rowH;
  });
  return y + 2;
}
