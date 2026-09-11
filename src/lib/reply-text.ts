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

/** ── Mojibake repair ────────────────────────────────────────────────────────────
 *  Some senders (and some IMAP servers) hand us UTF-8 bytes already misread as
 *  Latin-1/Windows-1252: "informaciÃ³n", "Â¿QuÃ©?". Measured live on 2026-09-11:
 *  74 of 1.255 real replies in a week. It matters beyond looks — the rule
 *  classifier matches accented Spanish words ("información", "más", "reunión"),
 *  so a mangled body was being judged on broken text.
 *
 *  repairMojibakeBytes = the SAFE, deterministic half: re-encode each char as its
 *  Latin-1 byte and re-decode as UTF-8, accepted ONLY when it removes suspicious
 *  sequences. Use it before STORING a body.
 *  repairMojibake = that plus contextual guesses for unrecoverable U+FFFD. Use it
 *  for display and classification, never to overwrite stored data.
 */
export function repairMojibakeBytes(input: string): string {
  if (!input) return input;
  let s = input;

  // Pass 1: classic UTF-8-as-Latin1 mojibake. We re-encode each char as its
  // Latin-1 byte then re-decode the byte stream as UTF-8.
  if (/[ÃÂâ][\x80-\xBF\u0080-\u00BF\u20AC-\u2122]/.test(s)) {
    try {
      const bytes: number[] = [];
      let valid = true;
      for (const ch of s) {
        const code = ch.codePointAt(0)!;
        if (code <= 0xFF) {
          bytes.push(code);
        } else if (code === 0x20AC) { bytes.push(0x80); }
        else if (code === 0x201A) { bytes.push(0x82); }
        else if (code === 0x0192) { bytes.push(0x83); }
        else if (code === 0x201E) { bytes.push(0x84); }
        else if (code === 0x2026) { bytes.push(0x85); }
        else if (code === 0x2020) { bytes.push(0x86); }
        else if (code === 0x2021) { bytes.push(0x87); }
        else if (code === 0x02C6) { bytes.push(0x88); }
        else if (code === 0x2030) { bytes.push(0x89); }
        else if (code === 0x0160) { bytes.push(0x8A); }
        else if (code === 0x2039) { bytes.push(0x8B); }
        else if (code === 0x0152) { bytes.push(0x8C); }
        else if (code === 0x017D) { bytes.push(0x8E); }
        else if (code === 0x2018) { bytes.push(0x91); }
        else if (code === 0x2019) { bytes.push(0x92); }
        else if (code === 0x201C) { bytes.push(0x93); }
        else if (code === 0x201D) { bytes.push(0x94); }
        else if (code === 0x2022) { bytes.push(0x95); }
        else if (code === 0x2013) { bytes.push(0x96); }
        else if (code === 0x2014) { bytes.push(0x97); }
        else if (code === 0x02DC) { bytes.push(0x98); }
        else if (code === 0x2122) { bytes.push(0x99); }
        else if (code === 0x0161) { bytes.push(0x9A); }
        else if (code === 0x203A) { bytes.push(0x9B); }
        else if (code === 0x0153) { bytes.push(0x9C); }
        else if (code === 0x017E) { bytes.push(0x9E); }
        else if (code === 0x0178) { bytes.push(0x9F); }
        else { valid = false; break; }
      }
      if (valid) {
        const repaired = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
        // Only accept the repair if it actually reduces the number of suspicious sequences
        if (!/Ã[\x80-\xBF]|Â[\xA0-\xBF]/.test(repaired)) {
          s = repaired;
        }
      }
    } catch { /* keep original */ }
  }

  return s;
}

/** repairMojibakeBytes + contextual guesses for U+FFFD (display/classification only). */
export function repairMojibake(input: string): string {
  if (!input) return input;
  let s = repairMojibakeBytes(input);

  // Pass 2: replace U+FFFD () using common Spanish contextual heuristics.
  // The original character is unrecoverable, but we can guess based on adjacent letters.
  if (s.includes("\uFFFD")) {
    const replacements: Array<[RegExp, string]> = [
      // Spanish words with ñ
      [/se\uFFFDor/gi, "señor"], [/se\uFFFDora/gi, "señora"],
      [/a\uFFFDo/gi, "año"], [/a\uFFFDos/gi, "años"],
      [/ma\uFFFDana/gi, "mañana"], [/peque\uFFFDo/gi, "pequeño"],
      [/espa\uFFFDol/gi, "español"], [/compa\uFFFD\uFFFDa/gi, "compañía"],
      [/compa\uFFFDero/gi, "compañero"], [/dise\uFFFDo/gi, "diseño"],
      [/ense\uFFFDar/gi, "enseñar"], [/ni\uFFFDo/gi, "niño"], [/ni\uFFFDa/gi, "niña"],
      [/ma\uFFFDana/gi, "mañana"],
      // Common Spanish words with accents
      [/qu\uFFFD/gi, "qué"], [/c\uFFFDmo/gi, "cómo"], [/d\uFFFDnde/gi, "dónde"],
      [/cu\uFFFDndo/gi, "cuándo"], [/cu\uFFFDl/gi, "cuál"], [/qui\uFFFDn/gi, "quién"],
      [/m\uFFFDs/gi, "más"], [/s\uFFFD/gi, "sí"], [/est\uFFFD/gi, "está"],
      [/aqu\uFFFD/gi, "aquí"], [/ah\uFFFD/gi, "ahí"], [/all\uFFFD/gi, "allí"],
      [/tambi\uFFFDn/gi, "también"], [/seg\uFFFDn/gi, "según"],
      [/d\uFFFDa/gi, "día"], [/d\uFFFDas/gi, "días"],
      [/B\uFFFDsicamente/gi, "Básicamente"], [/b\uFFFDsicamente/gi, "básicamente"],
      [/an\uFFFDlisis/gi, "análisis"], [/anal\uFFFDtic/gi, "analític"],
      [/tecnol\uFFFDgic/gi, "tecnològic"], [/empresarial/gi, "empresarial"],
      [/a\uFFFDn/gi, "aún"], [/all\uFFFD/gi, "allá"],
      // Punctuation hints — opening exclamation/question
      [/(^|\s)\uFFFD([A-ZÁÉÍÓÚÑ])/g, "$1¿$2"],
      // €/£ symbol (often becomes  alone in money contexts)
      [/(\d+)\s*\uFFFD/g, "$1€"], [/\uFFFD\s*(\d+)/g, "€$1"],
    ];
    for (const [re, to] of replacements) s = s.replace(re, to);
    // As a last resort: lone  between two letters → assume vowel-with-accent stripped
    // (we keep it visible if we can't guess to avoid making things worse)
  }

  return s;
}

/** The text to classify: body_text when it is real prose, else the HTML rendered to text. */
export function replyTextForClassification(bodyText: string | null | undefined, bodyHtml: string | null | undefined): string {
  const t = repairMojibake((bodyText || "").trim());
  if (t && !looksBinaryText(t)) return t;
  const fromHtml = repairMojibake(textFromHtml(bodyHtml));
  return fromHtml || (looksBinaryText(t) ? "" : t);
}
