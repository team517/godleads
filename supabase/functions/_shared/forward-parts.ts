// Reenviar un correo del Unibox CON TODO (13-10-2026).
//
// El Unibox enseña el correo con sus imágenes incrustadas (logos de firma, capturas pegadas: src="cid:…",
// que MailHtml cambia por un enlace firmado) y con sus adjuntos. Al reenviarlo, el cuerpo salía con
// "cid:…" que apuntaban a partes que NO iban en el correo (imagen rota) y sin los adjuntos. Ahora el
// servidor añade al reenvío las mismas partes que tenía el original: cada imagen incrustada con su
// MISMO Content-ID (el HTML ya la referencia así) y cada archivo como adjunto.
//
// Este módulo es la parte pura (qué va como imagen, qué como adjunto, qué no cabe); la descarga del
// almacenamiento la hace send-email.

export type StoredAttachment = {
  name?: string | null;
  mime?: string | null;
  size?: number | null;
  path?: string | null;
  inline?: boolean | null;
  cid?: string | null;
  oversized?: boolean | null;
};

/** Content-IDs que referencia el HTML (src="cid:…"), sin repetir, tal cual (sin los <>). */
export function cidsInHtml(html: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of String(html || "").matchAll(/\bsrc\s*=\s*["']?\s*cid:([^"'\s>]+)/gi)) {
    let c = m[1].trim();
    try { c = decodeURIComponent(c); } catch { /* tal cual */ }
    if (c) out.add(c);
  }
  return [...out];
}

const norm = (c: string | null | undefined) => String(c || "").trim().replace(/^<|>$/g, "").toLowerCase();

export type ForwardPlan = {
  /** Imágenes incrustadas que el cuerpo referencia: van con su Content-ID. */
  inline: (StoredAttachment & { cid: string; path: string })[];
  /** Archivos del original: van como adjuntos. */
  files: (StoredAttachment & { path: string })[];
  /** Lo que no se puede reenviar (demasiado grande, sin guardar) — para avisar. */
  skipped: { name: string; reason: "grande" | "sin_guardar" | "limite" }[];
};

/**
 * Qué partes del original acompañan al reenvío.
 *  · Imagen con cid que el HTML usa → incrustada (aunque venga marcada como adjunto).
 *  · Imagen incrustada que el HTML NO usa (p. ej. la de una cita que se recortó) → no se añade:
 *    saldría como un adjunto suelto que el original no enseñaba.
 *  · Cualquier otro archivo → adjunto.
 *  · Tope de bytes (suma) y de número de adjuntos; lo que no cabe se anota.
 */
export function planForwardParts(atts: StoredAttachment[] | null | undefined, html: string, opts?: { maxBytes?: number; maxFiles?: number }): ForwardPlan {
  const maxBytes = opts?.maxBytes ?? 14_000_000;
  const maxFiles = opts?.maxFiles ?? 10;
  const used = new Set(cidsInHtml(html).map(norm));
  const plan: ForwardPlan = { inline: [], files: [], skipped: [] };
  let bytes = 0;
  const seen = new Set<string>();
  for (const a of atts || []) {
    if (!a) continue;
    const name = String(a.name || "adjunto");
    const cid = norm(a.cid);
    const isImg = String(a.mime || "").toLowerCase().startsWith("image/");
    const referenced = !!cid && used.has(cid);
    const asInline = referenced && isImg;
    if (!asInline && (a.inline || (cid && isImg))) continue; // incrustada pero no usada en el cuerpo
    if (a.oversized) { plan.skipped.push({ name, reason: "grande" }); continue; }
    if (!a.path) { plan.skipped.push({ name, reason: "sin_guardar" }); continue; }
    const key = `${a.path}|${cid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const size = Math.max(0, Number(a.size) || 0);
    if (bytes + size > maxBytes || (!asInline && plan.files.length >= maxFiles)) { plan.skipped.push({ name, reason: "limite" }); continue; }
    bytes += size;
    if (asInline) plan.inline.push({ ...a, cid: String(a.cid).trim().replace(/^<|>$/g, ""), path: a.path });
    else plan.files.push({ ...a, path: a.path });
  }
  return plan;
}

/** Quita las <img src="cid:…"> cuya imagen no va en el correo: nunca un icono roto. */
export function dropMissingCidImages(html: string, available: string[]): string {
  const have = new Set(available.map(norm));
  return String(html || "").replace(/<img\b[^>]*\bsrc\s*=\s*["']?\s*cid:([^"'\s>]+)[^>]*>/gi, (tag, c: string) => {
    let k = c;
    try { k = decodeURIComponent(c); } catch { /* tal cual */ }
    return have.has(norm(k)) ? tag : "";
  });
}

/** Bytes → base64 por trozos (un archivo de varios MB no cabe en un solo String.fromCharCode). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}
