// Lectura de un correo entrante tal como lo devuelve IMAP: trocear la respuesta de FETCH, leer
// las cabeceras y decodificar el cuerpo. Es un módulo PURO (sin red ni base de datos) para poder
// probarlo con correos reales (src/test/imap-parse.test.ts). Lo usa fetch-inbox.
//
// Las funciones de decodificación (cleanBody, extractHtml...) vivían dentro de fetch-inbox/index.ts
// y se han movido aquí sin cambios.

import { bounceInfo, extractPermanentBounceRecipients, isAutomatedSender, type BounceInfo } from "./bounce.ts";
import { repairMojibakeBytes } from "./reply-text.ts";
import { extractAttachments, looksInline, type RawAttachment } from "./mail-attachments.ts";

/** Remove null bytes and invalid Unicode escape sequences that PostgreSQL rejects */
export function sanitizeForPostgres(text: string): string {
  if (!text) return "";
  // Remove null bytes (\u0000)
  let clean = text.replace(/\u0000/g, "");
  // Remove invalid Unicode escape sequences (backslash + u + hex)
  clean = clean.replace(/\\u[0-9a-fA-F]{4}/g, "");
  // Remove other problematic control characters (except newline, tab, carriage return)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return clean;
}

/** Normalize a charset label to one accepted by TextDecoder. */
export function normalizeCharset(cs?: string | null): string {
  if (!cs) return "utf-8";
  const c = cs.toLowerCase().trim().replace(/['"]/g, "").replace(/\s+/g, "");
  // Common aliases
  if (c === "utf8" || c === "utf-8" || c === "unicode-1-1-utf-8") return "utf-8";
  if (c === "us-ascii" || c === "ascii") return "utf-8"; // ASCII is UTF-8 compatible
  if (c === "latin1" || c === "latin-1") return "iso-8859-1";
  if (c === "cp1252" || c === "cp-1252") return "windows-1252";
  if (c.startsWith("iso8859")) return "iso-8859" + c.slice(7);
  if (c.startsWith("windows1") && !c.includes("-")) return "windows-" + c.slice(7);
  return c;
}

/** Safely decode bytes with a charset, falling back if the charset is unknown. */
export function safeDecode(bytes: Uint8Array, charset?: string | null): string {
  const cs = normalizeCharset(charset);
  try {
    return new TextDecoder(cs, { fatal: false }).decode(bytes);
  } catch {
    // Fallback chain: windows-1252 (superset of latin1, handles most western mail)
    try { return new TextDecoder("windows-1252", { fatal: false }).decode(bytes); }
    catch {
      try { return new TextDecoder("iso-8859-1", { fatal: false }).decode(bytes); }
      catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
    }
  }
}

/** Decode a sequence of quoted-printable hex bytes using the declared charset. */
export function decodeQPBytes(text: string, charset?: string): string {
  const withSpaces = text.replace(/_/g, " ");
  const byteChunks: number[] = [];
  let i = 0;
  while (i < withSpaces.length) {
    if (withSpaces[i] === "=" && i + 2 < withSpaces.length && /[0-9A-Fa-f]{2}/.test(withSpaces.substring(i + 1, i + 3))) {
      byteChunks.push(parseInt(withSpaces.substring(i + 1, i + 3), 16));
      i += 3;
    } else {
      byteChunks.push(withSpaces.charCodeAt(i) & 0xff);
      i++;
    }
  }
  return safeDecode(new Uint8Array(byteChunks), charset);
}

/** Decode MIME encoded-words like =?UTF-8?Q?...?= or =?ISO-8859-1?B?...?= */
export function decodeMimeWords(raw: string): string {
  if (!raw) return "";
  // Collapse whitespace between adjacent encoded-words first (RFC 2047)
  const collapsed = raw.replace(/\?=\s+=\?/g, "?==?");
  return collapsed.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, text) => {
    if (encoding.toUpperCase() === "Q") {
      return decodeQPBytes(text, charset);
    }
    try {
      const binary = atob(text.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return safeDecode(bytes, charset);
    } catch { return text; }
  }).trim();
}

/** Detect the charset declared in a MIME header block (Content-Type: ...; charset=...) */
export function detectCharset(raw: string): string {
  if (!raw) return "utf-8";
  const m = raw.match(/charset\s*=\s*"?([A-Za-z0-9_\-:.+]+)"?/i);
  return normalizeCharset(m ? m[1] : "utf-8");
}

/** base64 → bytes, tolerante: ignora saltos y basura, rehace el relleno "=" y descarta un último
 *  grupo incompleto (cuerpo cortado por el FETCH parcial). atob() a secas fallaba con "…NCg=" (un
 *  "=" de relleno perdido) y el cuerpo se guardaba en base64: ~1.100 correos al día desde el
 *  02-10-2026, y el detector de warm-up, que lee el cuerpo, dejaba pasar algunos a Campañas. */
export function base64ToBytesLenient(b64: string): Uint8Array {
  let s = b64.replace(/[^A-Za-z0-9+/]/g, "");
  if (s.length % 4 === 1) s = s.slice(0, -1);
  while (s.length % 4 !== 0) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Detect the Content-Transfer-Encoding (quoted-printable, base64, 7bit, 8bit, binary) */
export function detectTransferEncoding(raw: string): string {
  const m = raw.match(/Content-Transfer-Encoding\s*:\s*([^\r\n;]+)/i);
  return (m ? m[1].trim().toLowerCase() : "7bit");
}

/** Re-decode a string that was wrongly read as UTF-8 from raw bytes,
 *  by mapping each char back to its original byte and decoding with the right charset. */
export function reinterpretBytes(text: string, charset: string): string {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return safeDecode(bytes, charset);
}

export function stripCssText(t: string): string {
  // (1) whole rule blocks — selector/@media + { declarations } — only when the inside LOOKS like
  // CSS (has ":" plus ";" or "!important"), so real prose with braces survives. Runs 3x so the
  // outer of a nested "@media { .x { … } }" falls once its inner block is gone.
  for (let i = 0; i < 3; i++) {
    // selector must stay on ONE line (no \n in the class) or it swallows the words before the
    // block ("Invitation\n\nbody{…}" used to lose "Invitation").
    t = t.replace(/(^|[\s>])(@(?:media|font-face|keyframes|import|charset)[^{}\n]{0,120}|[.#]?[A-Za-z*][\w.,:#>*[\]"'=-]*(?:[ \t]+[\w.,:#>*[\]"'=(-]+){0,6}\)?)\{[^{}]{0,600}(?:!important|;|:)[^{}]{0,600}\}/g, " ");
    t = t.replace(/(^|[\s>])[^\s{}]{0,80}\{\s*\}/g, " "); // now-empty shells
  }
  // (2) leftover pure-CSS lines: "padding-left: 10px !important;" / stray "}" / "selector {"
  t = t.replace(/^\s*[a-zA-Z-]{2,40}\s*:\s*[^;{}\n]{1,160};\s*(?:!important;?\s*)?$/gm, "");
  t = t.replace(/^[^\n{}]{0,100}\{\s*$/gm, "");
  t = t.replace(/^\s*\}\s*$/gm, "");
  t = t.replace(/^[ \t]*@(media|font-face|keyframes|import|charset)[^\n]*$/gim, ""); // headerless leftovers
  return t;
}

/** Multipart-aware: pick the text/plain part (else the first non-multipart part) of a multipart body and
 *  decode it by ITS OWN Content-Transfer-Encoding / charset. The old whole-body path ran atob() over
 *  "part1 + boundary + part2" (which fails) and stored Outlook replies as raw base64 (~6k unreadable
 *  bodies). Returns null when the body is not multipart so the single-part path handles it. */
export function decodeMultipartPlain(raw: string, defaultCharset: string): string | null {
  const bm = raw.match(/(?:^|\r?\n)--([A-Za-z0-9'()+_,./:=?-]{10,})\r?\n/);
  if (!bm) return null;
  const esc = bm[1].replace(/[^A-Za-z0-9_]/g, (c) => "\\" + c);
  const parts = raw.split(new RegExp("(?:^|\r?\n)--" + esc + "(?:--)?(?:\r?\n|$)"));
  const cands = parts.map((p) => { const i = p.search(/\r?\n\r?\n/); return i < 0 ? null : { hdr: p.slice(0, i), body: p.slice(i).replace(/^\r?\n\r?\n/, "") }; })
    .filter((x): x is { hdr: string; body: string } => !!x && /content-type\s*:/i.test(x.hdr) && x.body.trim().length > 0);
  if (!cands.length) return null;
  const isMulti = (c: { hdr: string }) => /content-type\s*:\s*multipart\//i.test(c.hdr);
  const isBinaryPart = (c: { hdr: string }) => /content-type\s*:\s*(image|application|audio|video)\//i.test(c.hdr) || /content-disposition\s*:\s*attachment/i.test(c.hdr);
  // Outlook nests the text inside multipart/alternative, INSIDE a multipart/related that also
  // carries the inline signature images. At this level there is no text/plain candidate, so the
  // old fallback ("first non-multipart part") picked the JPEG: the reply's body_text became image
  // bytes and "no estamos interesados" was classified from them. Descend into nested parts first.
  const hasPlain = cands.some((c) => /content-type\s*:\s*text\/plain/i.test(c.hdr));
  if (!hasPlain) {
    for (const c of cands) {
      if (!isMulti(c)) continue;
      const inner = decodeMultipartPlain(c.body, defaultCharset);
      if (inner && inner.trim().length > 0) return inner;
    }
  }
  const pick = cands.find((c) => /content-type\s*:\s*text\/plain/i.test(c.hdr))
    || cands.find((c) => !isMulti(c) && !isBinaryPart(c))
    || cands.find((c) => !isMulti(c))
    || cands[0];
  const cte = (pick.hdr.match(/Content-Transfer-Encoding\s*:\s*([^\r\n;]+)/i)?.[1] || "7bit").trim().toLowerCase();
  const cs = (pick.hdr.match(/charset="?([^"\s;]+)"?/i)?.[1] || defaultCharset).toLowerCase();
  let body = pick.body;
  if (cte === "base64") {
    try { body = safeDecode(base64ToBytesLenient(body), cs); } catch { return null; }
  } else if (cte === "quoted-printable") {
    body = body.replace(/=\r?\n/g, "").replace(/(?:=[0-9A-Fa-f]{2})+/g, (m) => { const by: number[] = []; for (let i = 0; i < m.length; i += 3) by.push(parseInt(m.substring(i + 1, i + 3), 16)); return safeDecode(new Uint8Array(by), cs); });
  } else if (cs !== "utf-8" && /[\x80-\xFF]/.test(body)) {
    body = reinterpretBytes(body, cs);
  }
  if (/content-type\s*:\s*text\/html/i.test(pick.hdr)) body = body.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return body;
}

/** Clean raw IMAP body_text into readable plain text (charset-aware) */
export function cleanBody(raw: string, defaultCharset = "utf-8"): string {
  if (!raw) return "";
  // Multipart → decode the right part by its own headers, then continue with the generic cleanup
  // (transfer-encoding already applied, so the whole-body decode below must not run again).
  const mp = decodeMultipartPlain(raw.replace(/^\s*BODY(?:\.PEEK)?\[TEXT\](?:<\d+>)?\s*\{\d+\}\s*/i, ""), defaultCharset);
  if (mp !== null) raw = "Content-Transfer-Encoding: 8bit\n\n" + mp;
  // The charset declared in the part header (if present) overrides the default
  const charset = detectCharset(raw) || defaultCharset;
  const transferEnc = detectTransferEncoding(raw);

  let text = raw;
  // Strip the IMAP item marker. With a PARTIAL fetch the server answers "BODY[TEXT]<0> {N}" — the old
  // regex lacked the "<0>" part, so the marker survived and the HTML-tag stripper below turned it into
  // "BODY[TEXT] {N}" at the top of ~38k stored bodies. Also tolerate BODY.PEEK and a stray leading space.
  text = text.replace(/^\s*BODY(?:\.PEEK)?\[TEXT\](?:<\d+>)?\s*\{\d+\}\s*/i, "");
  // Outlook/Exchange multipart preamble + the boundary token right after it (with or
  // without its leading "--") — otherwise "This is a multi-part message in MIME format."
  // and a bare boundary line leak into the stored body.
  text = text.replace(
    /^[ \t]*This is a multi-?part message in MIME format\.?[ \t]*\r?\n+(?:[ \t]*(?:--)?[A-Za-z0-9'()+_,./:=?-]{10,}[ \t]*\r?\n)?/gim,
    "",
  );
  text = text.replace(/----_[^\r\n]+/g, "");
  text = text.replace(/--[a-zA-Z0-9_=-]+--?\s*/g, "");
  text = text.replace(/Content-Type:[^\n]+/gi, "");
  text = text.replace(/Content-Transfer-Encoding:[^\n]+/gi, "");
  text = text.replace(/Content-Disposition:[^\n]+/gi, "");
  text = text.replace(/charset="?[^"\s;]+"?/gi, "");
  text = text.replace(/<meta[^>]*>/gi, "");
  // "=" + salto es el salto blando de quoted-printable. En base64 ese "=" es RELLENO: quitarlo
  // rompía la decodificación (el cuerpo se guardaba en base64).
  if (transferEnc !== "base64") text = text.replace(/=\r?\n/g, "");

  if (transferEnc === "base64") {
    // The whole body is base64 — decode bytes with the declared charset
    try {
      text = safeDecode(base64ToBytesLenient(text), charset);
    } catch { /* fall through */ }
  } else {
    // Quoted-printable: decode each =XX run with the declared charset
    text = text.replace(/(?:=[0-9A-Fa-f]{2})+/g, (match) => {
      const bytes: number[] = [];
      for (let i = 0; i < match.length; i += 3) bytes.push(parseInt(match.substring(i + 1, i + 3), 16));
      return safeDecode(new Uint8Array(bytes), charset);
    });
    // If the part is NOT quoted-printable but still has high-bit chars that arrived
    // as latin1 bytes (because we read the whole IMAP stream as latin1), reinterpret.
    if (charset !== "utf-8" && /[\x80-\xFF]/.test(text)) {
      text = reinterpretBytes(text, charset);
    }
  }

  // Last resort: if what we have is still one pure base64 blob (headers missing/misread), decode it.
  if (/^[A-Za-z0-9+\/=\s]{40,}$/.test(text) && !/\s[a-z]{2,}\s[a-z]{2,}\s/i.test(text)) {
    try {
      const dec = safeDecode(base64ToBytesLenient(text), charset);
      if (dec && !/\uFFFD{3,}/.test(dec) && /[A-Za-z]{3,}/.test(dec)) text = dec;
    } catch { /* keep as is */ }
  }
  // HTML-only emails: drop <style>/<script>/<head>/comments BEFORE stripping tags, or their
  // CSS/JS text survives as body content (real case: mailinblack invitation showing raw CSS).
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<head[\s\S]*?<\/head>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = stripCssText(text); // already-tagless CSS (partial fetch cut the tags off)
  text = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"');
  // Strip any U+FFFD that might still leak (last resort cleanup)
  text = text.replace(/\uFFFD/g, "");
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n /g, "\n").replace(/ \n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const lines = text.split("\n");
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    if (normalized.length > 10 && seen.has(normalized)) continue;
    if (normalized.length > 10) seen.add(normalized);
    deduped.push(line);
  }
  return deduped.join("\n").trim();
}

/** Extract HTML body from raw IMAP text (charset-aware) */
export function extractHtml(raw: string): string {
  if (!raw) return "";
  // Look for the text/html part. Its body runs until the next MIME BOUNDARY LINE (a line that is
  // "--" + boundary token, optionally "--"-closed) — NOT until any "--" that appears inside the HTML.
  // The old lookahead (?=--[a-zA-Z0-9_=-]+) stopped at Mailchimp's "<!---->" / "<!--[if !mso]><!-->"
  // comments and at CSS variables ("--x"), so the stored HTML ended inside <head> and the Unibox
  // painted an empty message (SICE Telecomunicazioni newsletters, 2026-09-11).
  const htmlMatch = raw.match(/(Content-Type:\s*text\/html[\s\S]*?)(?:\r?\n\r?\n)([\s\S]*?)(?=\r?\n--[A-Za-z0-9'()+_,\-./:=?]{6,}(?:--)?[ \t]*(?:\r?\n|$)|$)/i);
  if (htmlMatch && htmlMatch[2]) {
    const headerBlock = htmlMatch[1] || "";
    const charset = detectCharset(headerBlock) || "utf-8";
    const transferEnc = detectTransferEncoding(headerBlock);
    let html = htmlMatch[2].trim();

    if (transferEnc === "base64") {
      try {
        html = safeDecode(base64ToBytesLenient(html), charset);
      } catch { /* fall through */ }
    } else {
      html = html.replace(/=\r?\n/g, "");
      html = html.replace(/(?:=[0-9A-Fa-f]{2})+/g, (match) => {
        const bytes: number[] = [];
        for (let i = 0; i < match.length; i += 3) bytes.push(parseInt(match.substring(i + 1, i + 3), 16));
        return safeDecode(new Uint8Array(bytes), charset);
      });
      if (charset !== "utf-8" && /[\x80-\xFF]/.test(html)) {
        html = reinterpretBytes(html, charset);
      }
    }
    // Strip stray U+FFFD
    html = html.replace(/\uFFFD/g, "");
    return html;
  }
  return "";
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Respuesta de FETCH → mensajes
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Cabeceras que se piden de cada correo. Además de las de siempre (remitente, asunto, hilo) van
 *  las que dicen SIN LEER EL TEXTO si el correo lo escribió una máquina: Auto-Submitted (RFC 3834),
 *  X-Autoreply / X-Autorespond (Gmail y otros), Precedence, las de Exchange y X-Failed-Recipients. */
export const INBOUND_HEADER_FIELDS =
  "FROM TO CC REPLY-TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO CONTENT-TYPE CONTENT-TRANSFER-ENCODING " +
  "AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND X-AUTOREPLY-FROM PRECEDENCE X-AUTO-RESPONSE-SUPPRESS " +
  "X-MS-EXCHANGE-GENERATED-MESSAGE-SOURCE X-MS-EXCHANGE-INBOX-RULES-LOOP X-FAILED-RECIPIENTS RETURN-PATH DELIVERED-TO X-ORIGINAL-TO";

/** Lo que se pide por mensaje. BODY.PEEK no marca el correo como leído. */
export const INBOUND_FETCH_ITEMS = `(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (${INBOUND_HEADER_FIELDS})] BODY.PEEK[TEXT]<0.262144>)`;

/** ¿Llegó la respuesta entera? Un comando IMAP acaba con su línea etiquetada ("A012 OK ...").
 *  Si no está, el servidor cortó o se agotó el tiempo: lo leído NO es todo lo que había. */
export function imapCompleted(resp: string, tag: string): "OK" | "NO" | "BAD" | null {
  const m = resp.match(new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)\\b[^\\r\\n]*\\r?\\n?$`));
  return m ? (m[1] as "OK" | "NO" | "BAD") : null;
}

export interface FetchItem {
  uid: number;
  internalDate: string;
  header: string;
  text: string;
  /** false = el elemento quedó a medias (respuesta cortada): no se puede dar por leído. */
  complete: boolean;
}

/**
 * Trocea la respuesta de un FETCH en mensajes siguiendo los LITERALES de IMAP ("{1234}" seguido de
 * exactamente 1234 bytes). Antes se cortaba por el texto "* N FETCH" y por líneas en blanco: un
 * correo cuyo cuerpo citaba una línea así, o un servidor que devolvía los datos en otro orden,
 * descuadraba el mensaje. El socket se lee como windows-1252, que es 1 byte = 1 carácter, así que
 * el tamaño del literal se puede contar en caracteres.
 */
export function splitFetchItems(resp: string): { items: FetchItem[]; truncated: boolean } {
  const items: FetchItem[] = [];
  let truncated = false;
  const startRe = /(?:^|\r\n)\* \d+ FETCH \(/g;
  let pos = 0;
  for (;;) {
    startRe.lastIndex = pos;
    const m = startRe.exec(resp);
    if (!m) break;
    let cur = m.index + m[0].length;
    const item: FetchItem = { uid: 0, internalDate: "", header: "", text: "", complete: false };
    const attrs = (gap: string) => {
      const u = gap.match(/\bUID (\d+)/i);
      if (u) item.uid = parseInt(u[1]);
      const d = gap.match(/INTERNALDATE "([^"]+)"/i);
      if (d) item.internalDate = d[1];
      // Un cuerpo de una sola línea puede venir como cadena entre comillas en vez de literal.
      const q = gap.match(/BODY\[TEXT\](?:<\d+>)?\s+"((?:[^"\\]|\\.)*)"/i);
      if (q && !item.text) item.text = q[1].replace(/\\(.)/g, "$1");
    };
    for (;;) {
      const litRe = /\{(\d+)\}\r\n/g; litRe.lastIndex = cur;
      const lit = litRe.exec(resp);
      const endAt = resp.indexOf(")\r\n", cur);
      const end = endAt >= 0 ? { index: endAt } : null;
      if (lit && (!end || lit.index < end.index)) {
        const gap = resp.slice(cur, lit.index);
        attrs(gap);
        const size = parseInt(lit[1]);
        const from = lit.index + lit[0].length;
        if (from + size > resp.length) { truncated = true; cur = resp.length; break; }
        const data = resp.substr(from, size);
        const section = gap.match(/BODY\[([^\]]*)\](?:<\d+>)?\s*$/i)?.[1] || "";
        if (/^HEADER/i.test(section)) item.header = data;
        else if (/^TEXT/i.test(section) || section === "") item.text = data;
        cur = from + size;
        continue;
      }
      if (end) {
        attrs(resp.slice(cur, end.index));
        item.complete = true;
        cur = end.index + 1; // deja el \r\n para que el siguiente "* N FETCH" encaje
        break;
      }
      truncated = true; cur = resp.length; break;
    }
    items.push(item);
    pos = cur;
    if (truncated) break;
  }
  return { items, truncated };
}

/** Valor de una cabecera (ya sin plegar), buscada SÓLO en el bloque de cabeceras. */
export function headerValue(headerBlock: string, name: string): string {
  const unfolded = (headerBlock || "").replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "im"));
  return m ? m[1].trim() : "";
}

/** Primera dirección de una cabecera de direcciones. Nunca devuelve el nombre como dirección. */
export function addressOf(value: string): string {
  if (!value) return "";
  const m = value.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/) || value.match(/([^\s<>"@,;:()]+@[^\s<>"@,;:()]+\.[^\s<>"@,;:()]+)/);
  return m ? m[1].toLowerCase().trim() : "";
}

/** Fecha interna de IMAP ("02-Oct-2026 11:43:12 +0200") → Date. */
export function parseInternalDate(s: string): Date | null {
  const m = (s || "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * La fecha del mensaje. Manda la cabecera Date (así no cambia nada de lo ya guardado), pero el
 * reloj del remitente puede estar mal: si no hay Date, no se entiende, viene del futuro o es más
 * de 7 días anterior a cuando el servidor lo recibió, vale la fecha interna de IMAP, que la pone
 * NUESTRO servidor. Sin ninguna de las dos, una fecha FIJA (nunca "ahora": cambiaría en cada pasada).
 */
export function messageDate(dateHeader: string, internalDate: string): string {
  const internal = parseInternalDate(internalDate);
  const header = dateHeader ? new Date(dateHeader) : null;
  const headerOk = !!header && !Number.isNaN(header.getTime());
  if (headerOk && internal) {
    const diff = header!.getTime() - internal.getTime();
    if (diff > 24 * 3600_000 || diff < -7 * 24 * 3600_000) return internal.toISOString();
    return header!.toISOString();
  }
  if (headerOk) return header!.toISOString();
  if (internal) return internal.toISOString();
  return "1970-01-01T00:00:00.000Z";
}

/**
 * Señal de respuesta automática LEÍDA DE LAS CABECERAS (no del texto). Devuelve "" si no hay.
 * - Auto-Submitted: auto-replied / auto-generated / auto-notified (RFC 3834). "no" = lo escribió alguien.
 * - X-Autoreply / X-Autorespond / X-Autoreply-From: contestadores de Gmail, cPanel, Zimbra...
 * - Precedence: auto_reply.
 * - X-MS-Exchange-Generated-Message-Source / X-MS-Exchange-Inbox-Rules-Loop: fuera de oficina y
 *   reglas de Exchange / Microsoft 365.
 */
export function autoSignal(headerBlock: string): string {
  const as = headerValue(headerBlock, "Auto-Submitted").toLowerCase();
  if (as && !/^no\b/.test(as)) return "auto-submitted:" + as.split(/[;\s]/)[0];
  if (headerValue(headerBlock, "X-Autoreply")) return "x-autoreply";
  if (headerValue(headerBlock, "X-Autorespond")) return "x-autorespond";
  if (headerValue(headerBlock, "X-Autoreply-From")) return "x-autoreply-from";
  if (/auto.?reply/i.test(headerValue(headerBlock, "Precedence"))) return "precedence:auto_reply";
  if (headerValue(headerBlock, "X-MS-Exchange-Generated-Message-Source")) return "exchange-generated";
  if (headerValue(headerBlock, "X-MS-Exchange-Inbox-Rules-Loop")) return "exchange-rule";
  return "";
}

/** Prefijos de asunto que ponen los contestadores automáticos, en los idiomas que nos llegan. */
// 06-10-2026: también "Abwesenheit…", "Ausente:"/"Ausencia:" y "Out-of-office". Sólo al PRINCIPIO del
// asunto (tras un "Re:" como mucho): un "Re: …" normal de una persona nunca entra aquí.
const AUTO_SUBJECT = /^\s*(?:re:\s*)?(?:respuesta autom[aá]tica|resposta autom[aàá]tica|automatic reply|auto(?:matic)?[- ]?reply|autoreply|auto[- ]?response|autorespuesta|out[- ]of[- ](?:the[- ])?office|fuera de (?:la )?oficina|fora de l'oficina|automatische antwort|abwesenheit\w*|abwesend|r[ée]ponse automatique|absence du bureau|risposta automatica|fuori sede|automatisch antwoord|afwezig|autosvar|automatisk svar|automatick[áa] odpov[eě][dď]|odpowied[zź] automatyczna|automaattinen vastaus|ausente(?=\s*(?:[:\-–(]|$))|ausencia(?=\s*[:\-–(]))(?=$|[^a-z0-9áéíóúñàèìòùüç])/i;

export function looksAutoSubject(subject: string): boolean {
  return AUTO_SUBJECT.test(subject || "");
}

export type InboundKind = "human" | "auto_reply" | "bounce";

export interface InboundMessage {
  uid: number;
  from_email: string;
  from_name: string;
  subject: string;
  body_text: string;
  body_html: string;
  message_id: string;
  /** ISO. Ver messageDate. */
  date: string;
  ref_chain: string;
  to_emails: string;
  cc_emails: string;
  reply_to: string;
  attachments: RawAttachment[];
  kind: InboundKind;
  /** Señal que lo delata como automático: la cabecera, o "subject:auto" si sólo lo dice el asunto ("" si lo escribió una persona). */
  auto_signal: string;
  /** noreply@ / no-reply@ / mailer-daemon@ / postmaster@ / bounce@ */
  automated_sender: boolean;
  bounce: BounceInfo | null;
}

export type ParsedInbound =
  | { status: "message"; uid: number; msg: InboundMessage; suppress: string[] }
  | { status: "skipped"; uid: number; reason: "own_copy" | "no_from" | "incomplete"; from: string; subject: string; message_id: string; date: string; suppress: string[] };

/**
 * Un elemento de FETCH → el mensaje listo para guardar. No decide si se guarda: sólo lee. Lo único
 * que descarta es lo que NO es correo entrante (la copia de un envío nuestro) o lo ilegible (sin
 * remitente en From, Reply-To ni Return-Path), y aun así devuelve el motivo para dejarlo anotado.
 */
export function parseInboundItem(item: FetchItem, ctx: { accountEmail: string; imapUsername: string }): ParsedInbound {
  const H = item.header || "";
  const hv = (name: string) => headerValue(H, name);
  const fromStr = hv("From");
  let subjectStr = hv("Subject");
  if (/^\s*(BODY\[|BODY\.PEEK\[|\{\d+\}\s*$)/i.test(subjectStr)) subjectStr = "";
  const decodedSubject = decodeMimeWords(subjectStr);
  const msgIdRaw = hv("Message-ID");
  const msgIdInner = msgIdRaw.match(/<([^<>\s]+)>/) || msgIdRaw.match(/([^\s<>]+@[^\s<>]+)/);
  const msgId = msgIdInner ? msgIdInner[1].trim() : "";
  const date = messageDate(hv("Date"), item.internalDate);

  // La dirección puede venir DENTRO de una palabra codificada (=?UTF-8?B?…?=): se mira también decodificada.
  let fromEmail = addressOf(fromStr) || addressOf(decodeMimeWords(fromStr));
  let fromName = "";
  if (fromEmail) {
    const nameMatch = fromStr.match(/^"?([^"<]+?)"?\s*</);
    fromName = nameMatch ? nameMatch[1].trim() : "";
  } else {
    // Sin From legible: quien pide la respuesta (Reply-To) o quien lo mandó (Return-Path).
    fromEmail = addressOf(hv("Reply-To")) || addressOf(hv("Return-Path"));
  }

  const base = { uid: item.uid, from: fromEmail, subject: decodedSubject, message_id: msgId, date };
  if (!item.complete) return { status: "skipped", reason: "incomplete", ...base, suppress: [] };
  if (!fromEmail) return { status: "skipped", reason: "no_from", ...base, suppress: [] };
  const own = [ctx.accountEmail, ctx.imapUsername].map((x) => (x || "").toLowerCase().trim()).filter(Boolean);
  if (own.includes(fromEmail)) return { status: "skipped", reason: "own_copy", ...base, suppress: [] };

  // Un mensaje de una sola parte lleva su Content-Type / Content-Transfer-Encoding en las cabeceras
  // de ARRIBA, no dentro del cuerpo: se le ponen delante para que la decodificación de siempre
  // (charset, base64, quoted-printable) funcione igual.
  let rawBody = item.text || "";
  if (!/^[\s\S]{0,400}?Content-Transfer-Encoding\s*:/i.test(rawBody)) {
    const topCte = hv("Content-Transfer-Encoding");
    const topCt = hv("Content-Type");
    if (topCte || topCt) {
      rawBody = (topCt ? "Content-Type: " + topCt + "\r\n" : "") + (topCte ? "Content-Transfer-Encoding: " + topCte + "\r\n" : "") + "\r\n" + rawBody;
    }
  }

  const refChain = Array.from(new Set(`${hv("References")} ${hv("In-Reply-To")}`.match(/<[^<>\s]+>/g) || [])).join(" ").slice(0, 3000);
  const signal = autoSignal(H);
  const bounce = bounceInfo(fromEmail, decodedSubject, hv("Content-Type"), rawBody, hv("X-Failed-Recipients"));
  if (bounce?.original.subject) bounce.original.subject = decodeMimeWords(bounce.original.subject);
  const kind: InboundKind = bounce ? "bounce" : (signal || looksAutoSubject(decodedSubject)) ? "auto_reply" : "human";
  // Fuera de oficina sin cabecera (sólo lo delata el asunto): señal propia para que TODO lo que lee
  // auto_signal (motor, avisos, estadísticas) lo trate como automático y no pare la secuencia (06-10-2026).
  const autoSig = signal || (kind === "auto_reply" ? "subject:auto" : "");

  return {
    status: "message",
    uid: item.uid,
    // Rebote permanente por "ese buzón no existe": el destinatario se deja de usar (regla de siempre).
    suppress: extractPermanentBounceRecipients(fromEmail, decodedSubject, rawBody),
    msg: {
      uid: item.uid,
      from_email: fromEmail,
      from_name: sanitizeForPostgres(decodeMimeWords(fromName)),
      subject: sanitizeForPostgres(decodedSubject || "(sin asunto)"),
      body_text: sanitizeForPostgres(repairMojibakeBytes(cleanBody(rawBody)).slice(0, 5000)),
      body_html: sanitizeForPostgres(repairMojibakeBytes(extractHtml(rawBody)).slice(0, 50000)),
      message_id: msgId,
      date,
      ref_chain: sanitizeForPostgres(refChain),
      to_emails: sanitizeForPostgres(decodeMimeWords(hv("To")).slice(0, 2000)),
      cc_emails: sanitizeForPostgres(decodeMimeWords(hv("Cc")).slice(0, 2000)),
      reply_to: addressOf(hv("Reply-To")),
      // Los archivos adjuntos y, marcadas como inline, las imágenes de la firma/cuerpo (src="cid:…"):
      // antes se tiraban y las firmas salían sin logo (06-10-2026). Sólo si el HTML las referencia.
      attachments: extractAttachments(rawBody).flatMap((a) => looksInline(a)
        ? (/src=["']?cid:/i.test(rawBody) ? [{ ...a, inline: true }] : [])
        : [a]),
      kind,
      auto_signal: autoSig,
      automated_sender: isAutomatedSender(fromEmail),
      bounce,
    },
  };
}

/** Los identificadores <...> de una cadena de referencias, en minúsculas. */
export function refIds(refChain: string | null | undefined): string[] {
  return Array.from(new Set(((refChain || "").match(/<[^<>\s]+>/g) || []).map((x) => x.toLowerCase())));
}

/** Carpetas que NO son correo entrante: enviados, borradores, papelera, plantillas, bandeja de salida. */
const NOT_INBOUND_FOLDER = /(^|[./])(sent|enviad|gesendet|elementos enviados|drafts?|borrador|entw|trash|papelera|deleted|eliminad|gel[oö]scht|outbox|bandeja de salida|templates?|plantillas?|notes|notas)/i;

/**
 * De la respuesta de LIST, qué carpetas se leen además de INBOX:
 *  - `spam`: la que el servidor MARCA como correo no deseado (\Junk) o, si no marca ninguna, la
 *    que se llama así (Spam, Junk, Correo no deseado, Bulk).
 *  - `extra`: carpetas propias del buzón (una regla "mover a X", un archivo). También llega correo
 *    ahí y antes no se miraban nunca. Fuera quedan las que no son correo entrante (enviados,
 *    borradores, papelera) y las vistas de Gmail que lo repiten todo ([Gmail]/Todos, Destacados).
 */
export function pickFolders(listResp: string): { spam: string | null; extra: string[]; all: string[] } {
  const listed: { flags: string; name: string }[] = [];
  for (const m of (listResp || "").matchAll(/\* LIST \(([^)]*)\)\s+(?:"[^"]*"|\S+)\s+(?:"([^"]+)"|(\S+))\r?\n/gi)) {
    listed.push({ flags: m[1] || "", name: (m[2] || m[3] || "").trim() });
  }
  const selectable = listed.filter((f) => f.name && !/\\Noselect/i.test(f.flags));
  const all = selectable.map((f) => f.name);
  const spam = selectable.find((f) => /\\Junk/i.test(f.flags))?.name
    || all.find((f) => /(^|[./])spam$|junk|deseado|unwanted|bulk/i.test(f)) || null;
  const extra = selectable
    .filter((f) => f.name.toUpperCase() !== "INBOX" && f.name !== spam)
    .filter((f) => !/\\(Sent|Drafts|Trash|All|Flagged|Important|Junk)/i.test(f.flags))
    .filter((f) => !NOT_INBOUND_FOLDER.test(f.name) && !/enviad|\bsent\b|gesendet|envoy|inviat/i.test(f.name) && !/^\[(gmail|google mail)\]/i.test(f.name))
    .map((f) => f.name).slice(0, 4);
  return { spam, extra, all };
}
