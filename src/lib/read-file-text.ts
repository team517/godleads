// Read a briefing / knowledge file to plain text.
// - Text-like files (.txt/.md/.csv/.json/.html…) are read directly.
// - PDFs are parsed client-side with pdf.js (lazy-loaded, so it never bloats the
//   main bundle). Word .docx is not supported → ask the user to export to PDF/txt.

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|html?|xml|rtf|log|text)$/i;

export async function readFileText(file: File): Promise<string> {
  const name = (file.name || "").toLowerCase();
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
  if (isPdf) return (await readPdfText(file)).trim();

  const looksText = TEXT_EXT.test(name) || (file.type || "").startsWith("text/") || file.type === "application/json";
  if (looksText || !file.type) {
    return (await file.text()).trim();
  }
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    throw new Error("Los .doc/.docx no se pueden leer aquí. Expórtalo a PDF o pega el texto.");
  }
  // Best effort: try as text anyway.
  return (await file.text()).trim();
}

async function readPdfText(file: File): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist");
  // @ts-ignore  Vite resolves ?url to the worker asset URL.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  const maxPages = Math.min(doc.numPages, 40); // sane cap
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it: any) => (typeof it?.str === "string" ? it.str : "")).join(" "));
  }
  return parts.join("\n");
}
