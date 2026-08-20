// DOM-free PDF of a client's campaign COPY — every email (subject + body) of every
// step and every variant, rendered as CLEAN readable text (never raw HTML), plus the
// variables used and one real-lead example. Meant to be handed to the client to review
// the copy. Same jsPDF-only approach as buildReportPdf (works in browser + Deno).

type Rgb = [number, number, number];

export type CopyStep = { step_order: number; subject?: string | null; body?: string | null; variants?: any[] | null; delay_days?: number | null };
export type CopyCampaign = { name: string; status?: string | null; steps: CopyStep[] };
export type CopyData = {
  clientName: string;
  generatedAtLabel: string;
  campaigns: CopyCampaign[];
  sampleLead?: { email?: string | null; custom_fields?: Record<string, any> | null } | null;
  agencyLogoDataUrl?: string | null;  // OnePulso logo (white PNG) for the header
  agencyLogoRatio?: number | null;    // logo width/height, to place it without distortion
};

// HTML → clean text (mirrors src/pages/ClientCampaigns.tsx htmlToText, minus the **bold**
// markers which we strip so the PDF reads as plain prose).
function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<\/?(strong|b)\s*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The real personalized message for the sample lead (custom_fields.personalized_message,
// or any long free-text field). Used to show the ACTUAL text where a campaign body is just
// {{personalized_message}} — so the client reads real copy, not a placeholder token.
function personalizedMsgOf(sampleLead: CopyData["sampleLead"]): string {
  const cf = (sampleLead && sampleLead.custom_fields) || {};
  const direct = (cf as any).personalized_message || (cf as any).personalized || (cf as any).mensaje_personalizado;
  // The stored personalized message is often HTML → clean it to plain text so it never
  // shows raw tags in the PDF.
  if (typeof direct === "string" && direct.trim()) return htmlToText(direct);
  const long = Object.values(cf).find((v: any) => typeof v === "string" && v.length > 120);
  return typeof long === "string" ? htmlToText(long) : "";
}

// HTML → clean text, swapping ONLY {{personalized_message}} for a real example message.
// Other merge variables ({{firstName}}, {{companyName}}…) stay as-is ON PURPOSE — the
// client should see the merge fields, not fake filled-in data.
function renderCopy(html: string, personalizedMsg: string): string {
  let t = htmlToText(html);
  if (personalizedMsg) t = t.replace(/\{\{\s*(personalized_message|personalized|mensaje_personalizado)\s*\}\}/gi, personalizedMsg);
  return t;
}

function variablesIn(text: string): string[] {
  const set = new Set<string>();
  for (const m of String(text || "").matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) set.add(m[1]);
  return [...set];
}

const PAGE_W = 210, PAGE_H = 297, MARGIN = 16, CONTENT_W = PAGE_W - MARGIN * 2, FOOTER_H = 12;

export function buildCopyDoc(jsPDFCtor: any, data: CopyData): any {
  const doc = new jsPDFCtor({ unit: "mm", format: "a4", orientation: "portrait" });
  const brand: Rgb = [110, 88, 241];
  const ink: Rgb = [28, 28, 36], muted: Rgb = [120, 120, 134], line: Rgb = [228, 228, 236];
  const soft: Rgb = [244, 242, 255];
  const personalizedMsg = personalizedMsgOf(data.sampleLead);
  let y = 0;
  const setT = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const setF = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2]);
  const setD = (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]);
  const newPage = () => { doc.addPage(); y = MARGIN; };
  const ensure = (h: number) => { if (y + h > PAGE_H - FOOTER_H) newPage(); };

  // Header (violet band with the OnePulso logo, top-right)
  setF(brand); doc.rect(0, 0, PAGE_W, 34, "F");
  if (data.agencyLogoDataUrl) {
    try {
      const lh = 8;
      const lw = lh * (data.agencyLogoRatio && data.agencyLogoRatio > 0 ? data.agencyLogoRatio : 4);
      // alias + SLOW compression so a large source logo is embedded ONCE and zlib-compressed
      // (a full-res white logo is mostly transparent → compresses tiny; avoids a multi-MB PDF).
      doc.addImage(data.agencyLogoDataUrl, "PNG", PAGE_W - MARGIN - lw, (34 - lh) / 2, lw, lh, "opLogo", "SLOW");
    } catch { /* logo is optional */ }
  }
  setT([255, 255, 255]); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("Copys de campaña", MARGIN, 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
  doc.text(`${data.clientName}  ·  ${data.generatedAtLabel}`, MARGIN, 23);
  y = 34 + 10;

  const para = (text: string, size = 10, color: Rgb = ink, lineH = 5) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(size); setT(color);
    for (const block of String(text || "").split("\n")) {
      const lines: string[] = doc.splitTextToSize(block || " ", CONTENT_W);
      for (const ln of lines) { ensure(lineH); doc.text(ln, MARGIN, y); y += lineH; }
    }
  };
  const chip = (label: string, bg: Rgb, fg: Rgb) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    const w = doc.getTextWidth(label) + 6;
    setF(bg); doc.roundedRect(MARGIN, y - 4, w, 6.5, 1.5, 1.5, "F");
    setT(fg); doc.text(label, MARGIN + 3, y + 0.6); y += 8;
  };

  // Intro — presentación para el cliente
  {
    const intro = "Hola, aquí tienes los mensajes de todas tus campañas: cada email y cada variante, tal cual se envían. Échales un vistazo con calma. Si todo te parece bien, hacemos la revisión final y empezamos a enviar.";
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
    const lines: string[] = doc.splitTextToSize(intro, CONTENT_W - 12);
    const boxH = lines.length * 5.4 + 9;
    ensure(boxH + 2);
    setF(soft); doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2.5, 2.5, "F");
    setF(brand); doc.roundedRect(MARGIN, y, 2.5, boxH, 1, 1, "F");
    setT([64, 54, 110]);
    lines.forEach((ln, i) => doc.text(ln, MARGIN + 7, y + 7 + i * 5.4));
    y += boxH + 9;
  }

  if (!data.campaigns.length) { para("Este cliente todavía no tiene campañas creadas.", 11, muted); }

  data.campaigns.forEach((camp, ci) => {
    ensure(20);
    if (ci > 0) y += 4;
    // Campaign title bar
    setF(soft); doc.roundedRect(MARGIN, y - 5, CONTENT_W, 10, 2, 2, "F");
    setT(brand); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(camp.name || "Campaña", MARGIN + 4, y + 1.5);
    setT(muted); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text((camp.status || "").toUpperCase(), PAGE_W - MARGIN - 4, y + 1, { align: "right" } as any);
    y += 11;

    const allVars = new Set<string>();
    (camp.steps || []).forEach((step, si) => {
      const delay = si === 0 ? "envío inicial" : `día +${step.delay_days ?? 0}`;
      ensure(14);
      setT(ink); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text(`Email ${si + 1} · ${delay}`, MARGIN, y); y += 6;

      const versions = [
        { tag: "Principal", subject: step.subject || "", body: step.body || "" },
        ...((step.variants || []).map((v: any, vi: number) => ({
          tag: `Variante ${String.fromCharCode(66 + vi)}`,
          subject: v?.subject || step.subject || "",
          body: v?.body || step.body || "",
        }))),
      ];
      versions.forEach((v) => {
        const subj = renderCopy(v.subject, personalizedMsg), bodyTxt = renderCopy(v.body, personalizedMsg);
        variablesIn(subj).forEach((x) => allVars.add(x));
        variablesIn(bodyTxt).forEach((x) => allVars.add(x));
        ensure(16);
        chip(v.tag, [238, 234, 255], brand);
        setT(muted); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); ensure(5);
        doc.text("ASUNTO", MARGIN, y); y += 4.5;
        para(subj || "(sin asunto)", 10, ink);
        y += 1.5;
        setT(muted); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); ensure(5);
        doc.text("MENSAJE", MARGIN, y); y += 4.5;
        para(bodyTxt || "(sin cuerpo)", 10, ink);
        y += 3;
      });
      y += 2;
    });

    // Variables used
    if (allVars.size) {
      ensure(12);
      setT(ink); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text("Variables usadas (se rellenan con los datos de cada lead):", MARGIN, y); y += 5.5;
      para([...allVars].map((v) => `{{${v}}}`).join("   "), 9.5, brand);
      y += 3;
    }

  });

  // Footer
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    setD(line); doc.setLineWidth(0.3); doc.line(MARGIN, PAGE_H - 9, PAGE_W - MARGIN, PAGE_H - 9);
    setT(muted); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`${data.clientName} · Copys generados por OnePulso`, MARGIN, PAGE_H - 4.5);
    doc.text(`Página ${p} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 4.5, { align: "right" } as any);
  }
  return doc;
}
