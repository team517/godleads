// What text a reply gets CLASSIFIED on.
// =====================================================================
// KEEP IN SYNC (byte-identical) WITH:
//   - supabase/functions/_shared/reply-text.ts  (edge, Deno)
//   - src/lib/reply-text.ts                     (frontend, Vite/TS)
// Pure & dependency-free so both runtimes can import it and a test can diff them.
// =====================================================================
//
// body_text is not always the words the person wrote. When an Outlook reply carries an inline
// signature image, the sync sometimes stores the IMAGE bytes as body_text while body_html holds
// the real sentence — so "Gracias por su email pero no estamos interesados" was classified from
// "ExifII*Adobe Photoshop…" and came out as Pregunta (the stray "?" bytes). Every classifier
// (browser, cron, AI) must read through this function, never body_text directly.

/** Bytes of an undecoded attachment dumped where text should be. */
export function looksBinaryText(raw: string | null | undefined): boolean {
  const t = (raw || "").slice(0, 1500);
  if (t.length < 20) return false;
  if (/\b(JFIF|Exif|IHDR|IDAT|GIF8[79]a|%PDF-|Adobed|Photoshop|sRGB)/.test(t)) return true;
  const rare = (t.match(/[^\p{L}\p{N}\p{P}\p{Zs}\n\r\t]/gu) || []).length;
  return rare / t.length > 0.12;
}

/** Plain text out of an HTML mail body: no styles/scripts/tags, entities decoded, block tags
 *  turned into line breaks so the quote/footer cutters still see paragraph boundaries. */
export function textFromHtml(html: string | null | undefined): string {
  const h = html || "";
  if (!h) return "";
  return h
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return " "; } })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** The text to classify: body_text when it is real prose, else the HTML rendered to text. */
export function replyTextForClassification(bodyText: string | null | undefined, bodyHtml: string | null | undefined): string {
  const t = (bodyText || "").trim();
  if (t && !looksBinaryText(t)) return t;
  const fromHtml = textFromHtml(bodyHtml);
  return fromHtml || (looksBinaryText(t) ? "" : t);
}
