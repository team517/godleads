// Adjuntos de un correo, sacados de su MIME en crudo.
//
// Se usa al pedir los adjuntos de un mensaje concreto (función `inbox-attachments`), cuando la
// sincronización no pudo guardarlos: el sync sólo se trae los primeros 256 KB de cada correo por
// velocidad, y un PDF suele ir DESPUÉS de esos bytes, así que se queda fuera.
//
// Es un módulo aparte, puro y probado (src/test/mail-attachments.test.ts), para no tocar el
// camino de la sincronización, que es delicado.

export interface RawAttachment {
  name: string;
  mime: string;
  /** Vacío si el archivo es demasiado grande para guardarlo: sólo se anota su nombre y tamaño. */
  base64: string;
  size: number;
  oversized?: boolean;
  /** Va DENTRO del mensaje (logo de la firma, imagen del cuerpo), no es un archivo aparte. */
  inline?: boolean;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_COUNT = 10;

/** Un nombre de archivo MIME (RFC 2047 =?UTF-8?B?…?= y RFC 2231 utf-8''…) en texto normal. */
export function decodeFilename(raw: string): string {
  let v = (raw || "").trim().replace(/^"+|"+$/g, "").trim();
  const r2231 = v.match(/^[\w-]+''(.+)$/);
  if (r2231) {
    try { return decodeURIComponent(r2231[1]).replace(/^"+|"+$/g, "").trim(); } catch { /* sigue abajo */ }
  }
  v = v.replace(/\?=\s*=\?/g, "?==?");            // trozos partidos por el plegado
  return v.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, charset: string, enc: string, text: string) => {
    try {
      if (enc.toUpperCase() === "Q") {
        const bytes: number[] = [];
        const t = text.replace(/_/g, " ");
        for (let i = 0; i < t.length; i++) {
          if (t[i] === "=" && /[0-9A-Fa-f]{2}/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
          else bytes.push(t.charCodeAt(i));
        }
        return new TextDecoder(safeCharset(charset), { fatal: false }).decode(new Uint8Array(bytes));
      }
      const bin = atob(text.replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder(safeCharset(charset), { fatal: false }).decode(bytes);
    } catch {
      return text;
    }
  }).replace(/^"+|"+$/g, "").trim();
}

function safeCharset(c: string): string {
  const n = (c || "utf-8").toLowerCase().trim();
  if (n === "iso-8859-1" || n === "latin1") return "iso-8859-1";
  if (n === "windows-1252" || n === "cp1252") return "windows-1252";
  return "utf-8";
}

/** Los archivos adjuntos que lleva un correo MIME en crudo. */
export function extractAttachments(raw: string, opts?: { maxBytes?: number; max?: number }): RawAttachment[] {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxCount = opts?.max ?? DEFAULT_MAX_COUNT;
  if (!raw || raw.length < 64) return [];

  // Un correo con adjuntos es multiparte: se corta por CUALQUIER línea de frontera (puede haber
  // varias anidadas: mixed → alternative → el archivo).
  const parts = raw.split(/\r?\n--[A-Za-z0-9'()+_,\-./:=?]{6,}(?:--)?[ \t]*\r?\n/);
  const out: RawAttachment[] = [];
  for (const part of parts) {
    if (out.length >= maxCount) break;
    if (!/Content-Transfer-Encoding:\s*base64/i.test(part)) continue;
    const sp = part.split(/\r?\n\r?\n/);
    if (sp.length < 2) continue;
    const header = (sp[0] || "").replace(/=\r?\n[ \t]*/g, "").replace(/\r?\n[ \t]+/g, "");
    const nameM = header.match(/(?:file)?name\*?=\s*(?:"([^"\r\n]+)"|([^\s";\r\n]+))/i);
    if (!nameM) continue;                                   // sin nombre no es un archivo: es el cuerpo
    const name = decodeFilename(nameM[1] || nameM[2] || "adjunto").slice(0, 200);
    const typeM = header.match(/Content-Type:\s*([^;\r\n]+)/i);
    const mime = (typeM ? typeM[1].trim() : "application/octet-stream").toLowerCase().slice(0, 120);
    // Content-Disposition: inline (o un Content-ID) = la imagen la usa el propio cuerpo.
    const inline = /Content-Disposition:\s*inline/i.test(header) || /Content-ID:\s*</i.test(header);
    const b64 = sp.slice(1).join("\n").replace(/[^A-Za-z0-9+/=]/g, "");
    if (b64.length < 40) continue;
    const size = Math.floor(b64.length * 0.75);
    if (size > maxBytes) { out.push({ name, mime, base64: "", size, oversized: true, inline }); continue; }
    out.push({ name, mime, base64: b64, size, inline });
  }
  return out;
}

/** ¿Es una imagen de la firma o del cuerpo (logo, icono) y no un archivo que hayan adjuntado?
 *  Se mira lo que dice el propio correo (inline / Content-ID) y, además, se descartan los iconos
 *  diminutos: muchas firmas los mandan sin marcar. Una imagen grande SIEMPRE se enseña, porque
 *  bien puede ser la foto que te han querido mandar. */
export function looksInline(att: RawAttachment): boolean {
  if (!att.mime.startsWith("image/")) return false;
  if (att.inline) return true;
  return att.size < 12 * 1024;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
