// Web Worker for streaming CSV parsing — receives ArrayBuffer, decodes in chunks, processes incrementally
import { parseCSV, cleanCsvField } from "./csv-parser";

const STRICT_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

// Decode ArrayBuffer in 8MB slices to avoid a single massive string allocation
function decodeInChunks(buffer: ArrayBuffer): string {
  const SLICE = 8 * 1024 * 1024; // 8 MB
  if (buffer.byteLength <= SLICE) {
    return new TextDecoder("utf-8").decode(buffer);
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const parts: string[] = [];
  let offset = 0;
  while (offset < buffer.byteLength) {
    const end = Math.min(offset + SLICE, buffer.byteLength);
    const isLast = end === buffer.byteLength;
    parts.push(decoder.decode(new Uint8Array(buffer, offset, end - offset), { stream: !isLast }));
    offset = end;
  }
  return parts.join("");
}

self.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
  // Support both ArrayBuffer (optimized) and string (legacy) inputs
  const text = typeof e.data === "string" ? e.data : decodeInChunks(e.data);

  const parsed = parseCSV(text);
  if (parsed.length < 2) {
    self.postMessage({ type: "error", error: "CSV vacío o sin datos" });
    return;
  }

  // Build headers
  const rawHeaders = parsed[0].map(h => h.toLowerCase().replace(/\s+/g, "_"));
  const headerCount: Record<string, number> = {};
  const headers = rawHeaders.map(h => {
    if (!headerCount[h]) { headerCount[h] = 1; return h; }
    headerCount[h]++;
    return `${h}_${headerCount[h]}`;
  });
  const expectedCols = headers.length;
  const emailIdx = headers.indexOf("email");
  if (emailIdx === -1) {
    self.postMessage({ type: "error", error: "No se encontró columna 'email'" });
    return;
  }

  // Send headers first
  self.postMessage({ type: "headers", headers, totalRawRows: parsed.length - 1 });

  // Process data rows in chunks of 2000
  const CHUNK = 2000;
  const dataRows = parsed.slice(1);
  let processed = 0;

  for (let i = 0; i < dataRows.length; i += CHUNK) {
    const chunk = dataRows.slice(i, i + CHUNK);
    const rows: Record<string, string>[] = [];

    for (const values of chunk) {
      if (values.length !== expectedCols) continue;
      const email = (values[emailIdx] || "").trim().replace(/,/g, "");
      if (!STRICT_EMAIL_REGEX.test(email)) continue;

      const obj: Record<string, string> = {};
      // cleanCsvField preserves rich/HTML columns (personalized_message etc.)
      // verbatim and applies the generic cleaner to everything else.
      headers.forEach((h, j) => {
        obj[h] = cleanCsvField(h, values[j] || "");
      });
      rows.push(obj);
    }

    processed += chunk.length;
    self.postMessage({ type: "chunk", rows, processed, total: dataRows.length });
  }

  self.postMessage({ type: "done" });
};
