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

// Fill {{variables}} with a real lead's fields (case-insensitive + common aliases).
function fillVars(text: string, fields: Record<string, any>): string {
  const lower: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) lower[k.toLowerCase().replace(/[\s_-]/g, "")] = v;
  const alias: Record<string, string[]> = {
    firstname: ["firstname", "first", "nombre", "name"],
    companyname: ["companyname", "company", "empresa", "compania"],
    city: ["city", "ciudad"],
    industry: ["industry", "sector", "industria"],
  };
  return String(text || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const k = String(key).toLowerCase().replace(/[\s_-]/g, "");
    const candidates = alias[k] || [k];
    for (const c of candidates) if (lower[c] != null && String(lower[c]).trim()) return String(lower[c]);
    return `{{${key}}}`;
  });
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
  let y = 0;
  const setT = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const setF = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2]);
  const setD = (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]);
  const newPage = () => { doc.addPage(); y = MARGIN; };
  const ensure = (h: number) => { if (y + h > PAGE_H - FOOTER_H) newPage(); };

  // Header
  setF(brand); doc.rect(0, 0, PAGE_W, 34, "F");
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
        const subj = htmlToText(v.subject), bodyTxt = htmlToText(v.body);
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

    // Real-lead example (first email, first version) filled with the sample lead's data
    const first = (camp.steps || [])[0];
    if (first && data.sampleLead?.custom_fields) {
      const fields = data.sampleLead.custom_fields || {};
      const exSubj = fillVars(htmlToText(first.subject || ""), fields);
      const exBody = fillVars(htmlToText(first.body || ""), fields);
      ensure(16);
      // Single-line filled header (never spans a page → no box-height bug when the
      // example text below flows onto the next page). The text then wraps/paginates
      // normally via para().
      setF([233, 246, 236]); doc.roundedRect(MARGIN, y - 4, CONTENT_W, 7, 1.5, 1.5, "F");
      setT([22, 120, 60]); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
      doc.text(`Ejemplo con datos reales — ${data.sampleLead.email || "lead"}`, MARGIN + 3, y + 0.8);
      y += 9;
      para(`Asunto: ${exSubj || "(sin asunto)"}`, 9.5, ink);
      y += 1;
      para(exBody || "(sin cuerpo)", 9.5, ink);
      y += 6;
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
