// Limpieza y lectura de los mensajes de la Unibox (texto, asunto, categoría, deduplicado).
// Funciones puras que comparten la Unibox de escritorio y la app móvil: viven aquí para que la
// app móvil no tenga que descargar la página entera de escritorio.
import DOMPurify from "dompurify";
import { classifyMessage as classifyIntent } from "@/lib/classify";
import { repairMojibake } from "@/lib/reply-text";

/* ── Helpers ───────────────────────────────────────────────────── */

/**
 * Remove warm-up / tracking codes that providers (Instantly, Mailreef…) inject
 * into subjects and bodies — e.g. "GAJIE920CWH", "CHBV6J7", "2YSB82T",
 * "t27109847387709683". They are alphanumeric tokens mixing letters AND digits,
 * or long pure-digit runs. We STRIP them so the email stays readable, instead of
 * hiding the whole message (which was throwing away real lead replies).
 */
export const MIXED_CODE_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20}\b/g;
// 12+ pure digits = tracking id (real phone numbers are 9–11 digits → kept).
export const LONG_DIGIT_RE = /\b\d{12,}\b/g;
// 14+ hex chars = message/tracking hash, e.g. "0000000000004f31700653fc0cdf".
export const LONG_HEX_RE = /\b[0-9a-f]{14,}\b/gi;
// 21+ alphanumeric mix (letters+digits) = long tracking ref beyond MIXED_CODE_RE.
export const LONG_MIXED_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{21,}\b/g;
export function stripWarmupTokens(input: string | null): string {
  if (!input) return "";
  let s = input;
  // Only strip tokens that are REALLY warm-up/tracking codes (high-entropy mix via
  // looksLikeWarmupCode), never legit business refs the lead actually wrote —
  // "iPhone15", "ABC123X", a NIE "X1234567L", an invoice/booking code. Previously a
  // blanket 5–20 alnum rule silently erased those from the message the user reads.
  const isCode = (t: string) => looksLikeWarmupCode(t) && !ID_WHITELIST_RE.test(t);
  // "| CODE", "- CODE", "· CODE" trailing separators that wrap a real code → drop both.
  s = s.replace(/[ \t]*[|·•·∙‧\-–—]+[ \t]*((?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20})\b/g,
    (full: string, code: string) => (isCode(code) ? "" : full));
  // Long hex hashes / long mixed refs / long digit runs = unambiguous tracking
  // artifacts (never appear in real prose) → safe to strip outright.
  s = s.replace(LONG_HEX_RE, "");
  s = s.replace(LONG_MIXED_RE, "");
  s = s.replace(LONG_DIGIT_RE, "");
  // The 5–20 char codes themselves — but ONLY the ones that look like warm-up codes.
  s = s.replace(MIXED_CODE_RE, (m: string) => (isCode(m) ? "" : m));
  // Tidy up separators / whitespace the removals leave behind
  s = s.replace(/[ \t]*[|·•∙‧]+[ \t]*(?=$|\n)/gm, "");
  s = s.replace(/^[\s|·•\-–—]+|[\s|·•\-–—]+$/g, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/[ \t]+([.,;:!?)])/g, "$1");
  // Collapse blank lines the removals may have created
  s = s.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
  return s.trim();
}

/** Try to decode a compact base64 string to readable UTF-8 text. Returns null if
 *  it isn't valid base64 or decodes to something that looks binary (e.g. an image). */
export function tryDecodeBase64(compact: string): string | null {
  if (compact.length < 8 || compact.length > 200000) return null;
  if (compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  try {
    const bin = atob(compact);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // STRICT decode: throws if the bytes aren't valid UTF-8 -> it wasn't text base64.
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!decoded) return null;
    // Reject binary control bytes (real bodies only use tab/newline/CR).
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return null;
    // Must look like real text: contain whitespace OR at least a couple of vowels.
    const vowels = (decoded.match(/[aeiouà-ÿ]/gi) || []).length;
    if (!/\s/.test(decoded) && vowels < 2) return null;
    if (!/[a-zA-ZÀ-ɏ]/.test(decoded)) return null;
    return decoded;
  } catch { return null; }
}

/** Decode base64-encoded message bodies that arrived un-decoded:
 *  the whole body, or individual lines/blocks that are pure base64. */
export function decodeBase64Body(input: string): string {
  if (!input) return input;
  const wholeCompact = input.replace(/\s+/g, "");
  // Whole body is one base64 blob (the common broken case)
  const whole = tryDecodeBase64(wholeCompact);
  if (whole !== null) return whole;
  // Otherwise decode any individual line that is entirely base64
  let changed = false;
  const out = input.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (t.length >= 16) {
      const dec = tryDecodeBase64(t);
      if (dec !== null) { changed = true; return dec; }
    }
    return line;
  });
  return changed ? out.join("\n") : input;
}

// Marks where attachment / raw-PDF binary begins — everything after is NOT message text.
export const ATTACHMENT_CUT_RE = /(?:^|\n)\s*(?:Content-Disposition:\s*attachment|Content-ID:|Content-Type:\s*application\/(?:pdf|octet-stream|zip|msword|vnd\.|x-)|(?:file)?name\*?=\s*"?=\?|%PDF-|\/FlateDecode\b|\/XObject\b|\/Producer\s*\(|\/Creator\s*\(|\bendobj\b|\bendstream\b|^\s*\d+\s+\d+\s+obj\b)/im;

/** Cut the raw body at the first attachment/PDF marker and remove leftover MIME
 *  attachment header lines, so the binary garbage never shows in the message. */
export function stripAttachmentJunk(text: string): string {
  if (!text) return text;
  const idx = text.search(ATTACHMENT_CUT_RE);
  let t = idx >= 0 ? text.slice(0, idx) : text;
  // Only MIME parameter lines (`filename="x.pdf"`, `name=...`): a line with NO tags.
  // It used to match ANY line containing `name=`, and Outlook mobile puts a
  // `<meta name="viewport">` on the same line as the reply text → the whole reply
  // vanished and only the quoted message was left (real case, 2026-09-14).
  t = t.replace(/^[^<>\n]*\b(?:file)?name\*?=[^<>\n]*$/gim, "");
  t = t.replace(/^Content-(?:Disposition|ID|Type|Transfer-Encoding|Description):.*$/gim, "");
  return t;
}

/** Decode attachment file names found in the raw MIME body (e.g. name="...pdf"). */
export function extractAttachmentNames(raw: string | null): string[] {
  if (!raw) return [];
  // Unfold: drop QP soft breaks (=\r\n) and header folding so a filename split
  // across lines is captured whole before decoding.
  const unfolded = raw.replace(/=\r?\n[ \t]*/g, "").replace(/\r?\n[ \t]+/g, "");
  const names = new Set<string>();
  // value = quoted string, a full MIME encoded-word, or a bare token
  const re = /(?:file)?name\*?=\s*(?:"([^"\r\n]+)"|(=\?[^\r\n;]+?\?=)|([^\s";\r\n]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(unfolded)) !== null) {
    const rawVal = m[1] || m[2] || m[3] || "";
    const decoded = decodeFilename(rawVal);
    if (decoded && decoded.length < 200 && /\.[A-Za-z0-9]{2,6}$/.test(decoded)) names.add(decoded);
  }
  return Array.from(names);
}

export type ParsedAttachment = { name: string; mime: string; base64: string };

/** Decode an attachment filename: RFC2231 (name*=utf-8''%xx), RFC2047 encoded-words
 *  (=?UTF-8?Q?..?=), joining adjacent words and stripping stray quotes. */
export function decodeFilename(raw: string): string {
  let v = (raw || "").trim().replace(/^"+|"+$/g, "").trim();
  const r2231 = v.match(/^[\w-]+''(.+)$/);
  if (r2231) { try { return decodeURIComponent(r2231[1]).replace(/^"+|"+$/g, "").trim(); } catch { /* keep */ } }
  // Join adjacent encoded-words that were separated by folding whitespace
  v = v.replace(/\?=\s*=\?/g, "?==?");
  return decodeSubjectKeepCodes(v).replace(/^"+|"+$/g, "").trim();
}

/** Extract downloadable attachments (name + mime + base64 payload) from the raw
 *  MIME body. Fully client-side: the base64 is already stored in body_text/html.
 *  Returns [] when no base64 part with a filename is present. */
export function extractAttachments(raw: string | null): ParsedAttachment[] {
  if (!raw || raw.length < 64) return [];
  const out: ParsedAttachment[] = [];
  const seen = new Set<string>();
  // Split into MIME parts. Prefer the declared boundary; fall back to any --token line.
  const bMatch = raw.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  let parts: string[];
  if (bMatch) {
    const esc = bMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    parts = raw.split(new RegExp("--" + esc + "(?:--)?[ \\t]*\\r?\\n", "g"));
  } else {
    parts = raw.split(/\r?\n--[A-Za-z0-9'()+_,\-./:=?]{6,}(?:--)?[ \t]*\r?\n/);
  }
  for (const part of parts) {
    if (!/Content-Transfer-Encoding:\s*base64/i.test(part)) continue;
    // header / body split (first blank line); unfold the header so a folded
    // filename is matched whole. Body keeps its original base64.
    const sp = part.split(/\r?\n\r?\n/);
    if (sp.length < 2) continue;
    const header = (sp[0] || "").replace(/=\r?\n[ \t]*/g, "").replace(/\r?\n[ \t]+/g, "");
    const nameM = header.match(/(?:file)?name\*?=\s*(?:"([^"\r\n]+)"|([^\s";\r\n]+))/i);
    if (!nameM) continue;
    const name = decodeFilename(nameM[1] || nameM[2] || "adjunto");
    const typeM = header.match(/Content-Type:\s*([^;\r\n]+)/i);
    const mime = (typeM ? typeM[1].trim() : "application/octet-stream").toLowerCase();
    const b64 = sp.slice(1).join("\n").replace(/[^A-Za-z0-9+/=]/g, "");
    if (b64.length < 40) continue;
    const key = name + "|" + b64.length;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, mime, base64: b64 });
  }
  return out;
}

/** Turn a parsed attachment into an object URL (or null if the base64 is bad). */
export function attachmentObjectUrl(att: ParsedAttachment): string | null {
  try {
    const bin = atob(att.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: att.mime || "application/octet-stream" }));
  } catch {
    return null;
  }
}

// Markers where the QUOTED previous message begins. We cut here so only the new
// reply shows (like Gmail/Outlook collapse the quote). Catalan/Spanish/English/etc.
export const QUOTE_MARKERS: RegExp[] = [
  /(^|\n)\s*Missatge de\b[\s\S]{0,180}?a les\s+\d{1,2}[:.]\d{2}\s*:/i,        // CA "Missatge de … a les 22:18:"
  /(^|\n)\s*(El|On|Le|Em|Il|Am)\b[\s\S]{0,160}?(escri(b|v)i[óo]|wrote|a écrit|escreveu|ha scritto|va escriure|schrieb)[^\n]{0,40}:/i, // "El … escribió:" / "On … wrote:"
  /(^|\n)\s*-{2,}\s*(Original Message|Mensaje original|Missatge original|Forwarded message|Message d['’]origine|Message original|Ursprüngliche Nachricht|Messaggio originale|Mensagem original|Oorspronkelijk bericht)\s*-{2,}/i,
  /(^|\n)\s*(De|From|Von|Da|Van)\s*:\s*.+\n\s*(Enviado|Sent|Date|Fecha|Data|Datum|Envoy[ée]|Gesendet|Inviato|Verzonden|Verzonden op)\s*:/i,
  /<blockquote/i,
  /class=["']?gmail_quote/i,
  /(^|\n)\s*>{1,}\s?\S/,                                                       // "> quoted line"
];
/** Trim quoted reply chains so only the new message shows. */
export function stripQuotedReply(text: string): string {
  if (!text) return text;
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m) {
      // m.index points at the (^|\n) — advance past a leading newline so we keep it tidy
      const idx = m.index + (m[0].startsWith("\n") ? 1 : 0);
      if (idx < cut) cut = idx;
    }
  }
  const trimmed = text.slice(0, cut).trim();
  return trimmed.length >= 2 ? trimmed : text;
}

/** Label used to flag a message as "Importante" (stored in inbox_messages.labels). */
export const IMPORTANT_LABEL = "Importante";

/** Append the account's HTML signature to a reply BODY, client-side, so it works with
 *  just a frontend redeploy (no edge deploy needed). We build proper HTML: the plain
 *  reply → paragraphs/<br> (mirrors send-email's textToHtml so line breaks survive),
 *  then the signature as a COMPACT block (its <p> tags → single <br>, so the email
 *  client's default ~16px paragraph margins don't blow it apart). Because the result
 *  contains <br>/<p>, send-email's textToHtml passes it through untouched. */

/** Columns the list/search/thread need (NOT body_html — fetched only when a message
 *  is opened). Typed loosely because the generated types.ts is stale. */
export const INBOX_LIST_COLS = "id, user_id, account_id, lead_id, campaign_id, message_id, from_email, from_name, subject, body_text, received_at, is_read, is_archived, folder_id, labels, dedupe_hash, ref_chain, is_warmup, to_emails, cc_emails";

/** Rejoin words that a sender's client hard-wrapped MID-WORD (e.g. "respo\nnsable de…"
 *  "explic\nar", "ofre\ncéis"). We only act when the message is CLEARLY wrapped that
 *  way — a majority of its line breaks split a word (previous line ends in a letter/
 *  digit, next line continues in lowercase). Then we glue those broken words back with
 *  no space. Blank lines, new sentences and signature lines (which start uppercase)
 *  keep their break, so normal emails are never altered. Fixes "el mensaje no se ve
 *  completo": the body was showing chopped every ~40–55 chars in the middle of words. */
export function unwrapHardBreaks(text: string): string {
  if (!text || text.indexOf("\n") === -1) return text;
  const lines = text.split("\n");
  let internal = 0, midWord = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i], b = lines[i + 1];
    if (!a.trim() || !b.trim()) continue;
    internal++;
    if (/[\p{L}\p{N}]$/u.test(a) && /^[\p{Ll}]/u.test(b)) midWord++;
  }
  if (internal < 3 || midWord / internal < 0.5) return text; // not word-wrapped → leave as-is
  // Short link-words: if the previous line ENDS with one of these, the wrap fell right
  // after a whole word (a space was eaten) → rejoin WITH a space ("por la"+"mañana" →
  // "por la mañana"). Otherwise the previous line ends in a word FRAGMENT → glue with
  // no space ("respo"+"nsable" → "responsable").
  const LINK = new Set(["de","la","el","los","las","un","una","unos","unas","por","con","que","para","del","al","en","y","e","o","u","su","sus","mi","mis","tu","tus","se","lo","le","les","no","mas","más","como","es","ha","he","nos","si","ni","ya","muy","sin","sobre","entre","hasta","desde","a"]);
  const out: string[] = [];
  for (const line of lines) {
    if (out.length === 0) { out.push(line); continue; }
    const prev = out[out.length - 1];
    if (!prev.trim() || !line.trim()) { out.push(line); continue; }
    if (/[\p{L}\p{N}]$/u.test(prev) && /^[\p{Ll}]/u.test(line)) {
      const lastTok = (prev.match(/([\p{L}\p{N}]+)$/u)?.[1] || "").toLowerCase();
      out[out.length - 1] = LINK.has(lastTok) ? prev + " " + line : prev + line;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

// MEMOISED wrapper. cleanBodyText is pure (~60 regexes) and was re-run for every
// message on every render/keystroke (category counts, unread count, hiddenFromClean,
// previews) → the Unibox felt sluggish with many messages. Same input → same output,
// so cache it. Bounded to keep memory in check.
export const _cleanTextCache = new Map<string, string>();
export function cleanBodyText(raw: string | null, keepCodes = false): string {
  if (!raw) return "";
  const key = (keepCodes ? "1|" : "0|") + raw;
  const hit = _cleanTextCache.get(key);
  if (hit !== undefined) return hit;
  const out = cleanBodyTextRaw(raw, keepCodes);
  if (_cleanTextCache.size > 5000) _cleanTextCache.clear();
  _cleanTextCache.set(key, out);
  return out;
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

export function cleanBodyTextRaw(raw: string | null, keepCodes = false): string {
  if (!raw) return "";
  // Decode base64-encoded bodies that arrived un-decoded (whole body or per-line)
  let text = decodeBase64Body(raw);
  text = repairMojibake(text);
  // Remove attachment/PDF binary so only the real message text remains
  text = stripAttachmentJunk(text);
  // Trim the quoted previous message so only the new reply remains
  text = stripQuotedReply(text);

  // Remove IMAP artifacts
  text = text.replace(/^BODY(?:\.PEEK)?\[TEXT\](?:<\d+>)?\s*\{\d+\}\s*/i, "");
  // CSS leaked from HTML-only mails (style-tag content survived the tag strip) → junk like
  // "body{width:100% !important;…}" at the top of the preview. Scrub it here too so already-
  // stored rows render clean without waiting for a DB backfill.
  text = stripCssText(text);

  // Outlook/Exchange multipart preamble + the boundary token that follows it. That token
  // sometimes reaches us with its leading "--" already stripped, so it dodged the "^--…"
  // rule below and showed as a bare gibberish line under "This is a multi-part message…".
  text = text.replace(
    /^[ \t]*This is a multi-?part message in MIME format\.?[ \t]*\r?\n+(?:[ \t]*(?:--)?[A-Za-z0-9'()+_,./:=?-]{10,}[ \t]*\r?\n)?/gim,
    "",
  );

  // Remove MIME boundaries (all common formats)
  text = text.replace(/^--[a-zA-Z0-9_=.-]{10,}--?\s*$/gm, "");
  text = text.replace(/----_[^\r\n]+/g, "");
  text = text.replace(/^--=_[^\r\n]+/gm, "");
  // MIME part markers that leak mid-line into previews, e.g. "--_000_URP_", "--_009_om_"
  text = text.replace(/--_+[A-Za-z0-9]+_+[A-Za-z0-9._-]*/g, " ");
  // Inline-image content-id refs, e.g. "[cid:Logo-135]"
  text = text.replace(/\[cid:[^\]]*\]/gi, " ");
  // Remove =_Part_... boundary identifiers and boundary="..." declarations
  text = text.replace(/=_Part_[0-9_.]+/g, "");
  text = text.replace(/boundary="[^"]*"/gi, "");
  text = text.replace(/boundary=[^\s;]+/gi, "");

  // Remove MIME headers (multiline)
  text = text.replace(/^Content-Type:[^\n]+(\n\s+[^\n]+)*/gim, "");
  text = text.replace(/^Content-Transfer-Encoding:[^\n]+/gim, "");
  text = text.replace(/^Content-Disposition:[^\n]+/gim, "");
  text = text.replace(/^Content-ID:[^\n]+/gim, "");
  text = text.replace(/^MIME-Version:[^\n]+/gim, "");
  text = text.replace(/^X-[A-Za-z-]+:[^\n]+/gim, "");
  text = text.replace(/charset="?[^"\s;]+"?/gi, "");
  text = text.replace(/<meta[^>]*>/gi, "");

  // Remove base64 encoded blocks
  text = text.replace(/^[A-Za-z0-9+/=]{76,}\s*$/gm, "");
  text = text.replace(/(?:[A-Za-z0-9+/]{4}){10,}={0,2}/g, "");

  // Decode quoted-printable as proper UTF-8 byte sequences
  text = text.replace(/=\r?\n/g, "");
  text = text.replace(/(?:=[0-9A-Fa-f]{2})+/g, (match) => {
    const bytes: number[] = [];
    for (let i = 0; i < match.length; i += 3) {
      bytes.push(parseInt(match.substring(i + 1, i + 3), 16));
    }
    try { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); } catch { return match; }
  });

  // Remove style/script/head blocks before stripping tags
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  // Remove tracking pixels and hidden elements
  text = text.replace(/<img[^>]*(?:width\s*=\s*["']?1["']?|height\s*=\s*["']?1["']?)[^>]*>/gi, "");
  text = text.replace(/<img[^>]*(?:mailtrack|hubspot|sendgrid|mailchimp|track|pixel|beacon|open\.)[^>]*>/gi, "");
  text = text.replace(/<[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>[\s\S]*?<\/[^>]+>/gi, "");

  // Remove Outlook conditional comments and all HTML comments
  text = text.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert block elements to newlines before stripping
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities (numeric, hex, named) — preserves accents, ñ, €, emojis…
  text = decodeHtmlEntities(text);

  // Strip remaining zero-width / invisible Unicode that render as boxes
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");

  // Remove warmup/tracking codes (e.g., GAJIE920CWH, CHBV6J7, 2YSB82T) and long
  // digit ids. Skipped when keepCodes=true — used when DISPLAYING a real reply, so
  // legit letter+digit refs the lead wrote (a chip part number "STM32F407", an
  // order/invoice ref) stay visible in the body instead of being erased.
  if (!keepCodes) text = stripWarmupTokens(text);

  // Remove long tracking URLs
  text = text.replace(/https?:\/\/[^\s]{100,}/g, "");
  text = text.replace(/https?:\/\/[^\s]*(?:unsubscribe|tracking|click|redirect|mailtrack|hubspot|sendgrid)[^\s]*/gi, "");

  // Remove separator lines
  text = text.replace(/^[_\-*=~]{3,}\s*$/gm, "");
  text = text.replace(/^[\s_\-*=~]+$/gm, "");

  // Remove common device signatures
  text = text.replace(/^(?:Enviado desde mi (?:iPhone|iPad|Android|dispositivo Samsung|Huawei|Xiaomi).*$)/gim, "");
  text = text.replace(/^(?:Sent from my (?:iPhone|iPad|Android|Samsung|Huawei|Xiaomi).*$)/gim, "");
  text = text.replace(/^(?:Get Outlook for (?:iOS|Android).*$)/gim, "");
  text = text.replace(/^(?:Obtener Outlook para (?:iOS|Android).*$)/gim, "");

  // Normalize whitespace
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n /g, "\n")
    .replace(/ \n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // Deduplicate repeated lines
  const lines = text.split("\n");
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const line of lines) {
    const norm = line.trim().toLowerCase();
    if (!norm) { deduped.push(line); continue; }
    if (/^--[a-f0-9]{20,}$/i.test(norm)) continue;
    if (norm.length > 5 && seen.has(norm)) continue;
    if (norm.length > 5) seen.add(norm);
    deduped.push(line);
  }

  // Second pass: detect if first half ≈ second half (plain text + HTML duplicate)
  const result = deduped.join("\n").trim();
  const resultLines = result.split("\n").filter(l => l.trim().length > 0);
  if (resultLines.length >= 4) {
    const mid = Math.floor(resultLines.length / 2);
    const firstHalf = resultLines.slice(0, mid).map(l => l.trim().toLowerCase()).join(" ");
    const secondHalf = resultLines.slice(mid).map(l => l.trim().toLowerCase()).join(" ");
    const shorter = firstHalf.length <= secondHalf.length ? firstHalf : secondHalf;
    const longer = firstHalf.length <= secondHalf.length ? secondHalf : firstHalf;
    if (shorter.length > 20 && longer.startsWith(shorter.slice(0, Math.min(shorter.length, 80)))) {
      return unwrapHardBreaks(resultLines.slice(0, mid).join("\n").trim());
    }
  }
  return unwrapHardBreaks(result);
}

/** Where the QUOTED previous message starts inside an HTML body: gmail/yahoo/thunderbird
 *  quote blocks, Outlook's `appendonsend` block and its "De:/Enviado:" header, any
 *  <blockquote>, or a textual "El … escribió:" / "On … wrote:" line. */
export const HTML_QUOTE_START_RE =
  // NOTE: `moz-cite-prefix` is NOT a quote marker on its own — Thunderbird puts the NEW
  // reply paragraphs in div.moz-cite-prefix too (real case 2026-09-16: a 3-paragraph
  // meeting proposal rendered as one line / an empty card). Only the attribution line
  // ("El 16/09/2026 a las 9:59, X escribió:") inside such a div starts the quote; the
  // <blockquote type="cite"> right after it is caught by the generic <blockquote rule.
  /<(?:blockquote|div)[^>]*class=["']?[^"'>]*(?:gmail_quote|yahoo_quoted)|<div[^>]*class=["']?moz-cite-prefix["']?[^>]*>\s*(?:el|on|le|am|il|den|op)\b[^<]{0,200}?(?:escri(?:b|v)i\S{0,4}|wrote|a\s+écrit|schrieb|ha\s+scritto|escreveu)\s*:|<blockquote\b|<div[^>]*id=["']?appendonsend|<(?:b|strong)[^>]*>\s*(?:De|From|Von|Da|Van)\s*:[\s\S]{0,400}?(?:Enviado|Sent|Date|Fecha|Data|Datum|Gesendet|Inviato)\s*:|(?:^|\n)\s*Missatge de\b[\s\S]{0,160}?a les\s+\d{1,2}[:.]\d{2}\s*:|(?:^|\n)\s*(?:El|On)\b[\s\S]{0,140}?(?:escri(?:b|v)i[óo]|wrote|va escriure)[^\n]{0,30}:/gi;

/** Visible characters of an HTML fragment (no head/style, tags or nbsp). */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;| /gi, " ")
    .trim().length;
}

/** Index where the quoted chain begins, or -1. A marker only counts as a quote when there is
 *  visible text BEFORE it: Outlook wraps the NEW reply itself in
 *  `<blockquote class="elementToProof">`, and cutting there left an empty card. When the
 *  blockquote is the first thing in the body it IS the message, so we move on to the next
 *  marker (Outlook's appendonsend / "De:" header) for the real quote. */
export function findQuoteStart(html: string): number {
  HTML_QUOTE_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTML_QUOTE_START_RE.exec(html)) !== null) {
    if (visibleTextLength(html.slice(0, m.index)) >= 2) return m.index;
    if (m[0].length === 0) HTML_QUOTE_START_RE.lastIndex++;
  }
  return -1;
}

/** Clean HTML email body for safe rendering — aggressively strips artifacts for a clean Gmail-style view */
export function cleanBodyHtml(raw: string | null, keepQuote = false): string {
  if (!raw) return "";
  // Decode a base64-encoded HTML body if it arrived un-decoded
  let html = repairMojibake(decodeBase64Body(raw));
  // Drop attachment/PDF binary that leaked into the HTML body
  html = stripAttachmentJunk(html);

  // Cut the quoted reply chain (everything from the gmail/outlook quote block on)
  // so only the new message is shown — like Gmail collapses the quote. When the
  // user asks for the full email ("Ver completo"), keep the quote.
  if (!keepQuote) {
    const qIdx = findQuoteStart(html);
    if (qIdx > 0) html = html.slice(0, qIdx);
  }

  // Remove MIME headers that leaked into the HTML
  html = html.replace(/^Content-Type:[^\n]+(\n\s+[^\n]+)*/gim, "");
  html = html.replace(/^Content-Transfer-Encoding:[^\n]+/gim, "");
  html = html.replace(/^Content-Disposition:[^\n]+/gim, "");
  html = html.replace(/^MIME-Version:[^\n]+/gim, "");
  html = html.replace(/^X-[A-Za-z-]+:[^\n]+/gim, "");
  html = html.replace(/^Return-Path:[^\n]+/gim, "");
  html = html.replace(/^Received:[^\n]+(\n\s+[^\n]+)*/gim, "");
  html = html.replace(/^Message-ID:[^\n]+/gim, "");
  html = html.replace(/^DKIM-Signature:[^\n]+(\n\s+[^\n]+)*/gim, "");

  // Remove MIME boundaries visible as text
  html = html.replace(/^--[a-zA-Z0-9_=.-]{10,}--?\s*$/gm, "");
  html = html.replace(/----_[^\r\n]+/g, "");
  html = html.replace(/^--=_[^\r\n]+/gm, "");
  html = html.replace(/--_+[A-Za-z0-9]+_+[A-Za-z0-9._-]*/g, " ");
  html = html.replace(/\[cid:[^\]]*\]/gi, " ");
  html = html.replace(/=_Part_[0-9_.]+/g, "");
  html = html.replace(/boundary="[^"]*"/gi, "");
  html = html.replace(/boundary=[^\s;]+/gi, "");

  // Decode quoted-printable
  html = html.replace(/=\r?\n/g, "");
  html = html.replace(/(?:=[0-9A-Fa-f]{2})+/g, (match) => {
    const bytes: number[] = [];
    for (let i = 0; i < match.length; i += 3) {
      bytes.push(parseInt(match.substring(i + 1, i + 3), 16));
    }
    try { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); } catch { return match; }
  });

  // Remove zero-width characters and invisible Unicode that show as "weird codes"
  html = html.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");

  // Remove <head>, <style>, <script>, <xml>, <o:p> blocks entirely (Outlook artifacts)
  html = html.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, "");
  html = html.replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, "");
  html = html.replace(/<\/?o:[^>]+>/gi, "");
  html = html.replace(/<\/?w:[^>]+>/gi, "");
  html = html.replace(/<\/?v:[^>]+>/gi, "");

  // Remove <meta>, <link>, <title>, <base> tags
  html = html.replace(/<meta[^>]*\/?>/gi, "");
  html = html.replace(/<link[^>]*\/?>/gi, "");
  html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "");
  html = html.replace(/<base[^>]*\/?>/gi, "");

  // Remove <html>, <body> wrappers (we don't want full doc structure)
  html = html.replace(/<\/?html[^>]*>/gi, "");
  html = html.replace(/<\/?body[^>]*>/gi, "");
  html = html.replace(/<!DOCTYPE[^>]*>/gi, "");

  // Remove Outlook conditional comments and all HTML comments
  html = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  // Remove tracking pixels: 1x1 images, known tracking domains
  html = html.replace(/<img[^>]*(?:width\s*=\s*["']?\s*1\s*["']?|height\s*=\s*["']?\s*1\s*["']?)[^>]*\/?>/gi, "");
  html = html.replace(/<img[^>]*(?:mailtrack|hubspot|sendgrid|mailchimp|track\.|pixel|beacon|open\.|click\.)[^>]*\/?>/gi, "");

  // Remove elements with display:none or visibility:hidden
  html = html.replace(/<([a-z]+)[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, "");
  html = html.replace(/<[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'][^>]*\/?>/gi, "");

  // Remove warmup/tracking codes (GAJIE920CWH, CHBV6J7…) ONLY from visible text
  // between tags — never touch tag names, attributes or href URLs, and preserve
  // the surrounding whitespace so inline words don't glue together.
  html = html.replace(/>([^<]+)</g, (_m, textNode: string) => {
    const cleaned = textNode
      .replace(/[|·•∙‧]\s*(?=(?:[A-Za-z0-9]*[A-Za-z])(?:[A-Za-z0-9]*\d))[A-Za-z0-9]{5,20}\b/g, " ")
      .replace(LONG_HEX_RE, "")
      .replace(LONG_MIXED_RE, "")
      .replace(MIXED_CODE_RE, "")
      .replace(LONG_DIGIT_RE, "")
      .replace(/[ \t]{2,}/g, " ");
    return `>${cleaned}<`;
  });

  // Clean pipe separators from warmup codes
  html = html.replace(/\s*\|\s*(<|$)/g, "$1");

  // Remove tracking/unsubscribe links entirely
  html = html.replace(/<a[^>]*href\s*=\s*["'][^"']*(?:unsubscribe|tracking|click\.|redirect|mailtrack|hubspot|sendgrid)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");

  // Remove leftover encoded entities for invisible chars
  html = html.replace(/&zwnj;|&zwj;|&#8203;|&#65279;|&#8204;|&#8205;/gi, "");

  // Sanitize with DOMPurify
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6", "span", "div", "blockquote",
      "table", "tr", "td", "th", "thead", "tbody", "img", "hr"],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "style", "class", "width", "height"],
    ADD_ATTR: ["target"],
  });

  // Post-sanitize: remove empty wrappers and excessive breaks
  let final = clean;
  // Repeat the empty-wrapper removal a few times to fully collapse nested empties
  for (let i = 0; i < 3; i++) {
    // Un envoltorio que sólo contenía un ESPACIO deja un espacio en su sitio. Antes se borraba
    // entero, y en los pies que separan las palabras con <span>&nbsp;</span> (Gmail con
    // letter-spacing) el texto salía pegado: "Estemensajeysusarchivosadjuntos…" (18-09-2026).
    final = final.replace(
      /<(p|div|span|td|tr|table|tbody|thead|th|blockquote)(\s[^>]*)?>((?:\s|&nbsp;|<br\s*\/?>)*)<\/\1>/gi,
      (_m: string, _tag: string, _attrs: string, inner: string) =>
        (/(?:\s|&nbsp;)/i.test(String(inner || "").replace(/<br\s*\/?>/gi, "")) ? " " : ""),
    );
  }
  final = final.replace(/(<br\s*\/?>[\s]*){3,}/gi, "<br><br>");
  // Remove leading/trailing whitespace nodes
  final = final.replace(/^(\s|<br\s*\/?>|&nbsp;)+/i, "").replace(/(\s|<br\s*\/?>|&nbsp;)+$/i, "");

  return final;
}

/** HTML ready to paint, or "" when the cleaned HTML has NO visible content (e.g. a body that was
 *  cut off inside <head> at sync time) so the caller falls back to body_text instead of an empty card. */
/** HTML of the message being answered, to be quoted under a Unibox reply. The FULL original
 *  (its own quoted chain included, as mail clients do), from the sanitized HTML when there is
 *  one, else from the plain text as paragraphs. Capped: a 200 KB newsletter must not ride along. */
export function buildReplyQuoteHtml(m: { body_html?: string | null; body_text?: string | null } | null | undefined): string {
  if (!m) return "";
  const html = renderableHtml(m.body_html, true);
  if (html) return html.slice(0, 40_000);
  const text = cleanBodyText(m.body_text || "", true).trim();
  if (!text) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.slice(0, 20_000).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export const _renderableCache = new Map<string, string>();
export function renderableHtml(raw: string | null | undefined, keepQuote = false): string {
  if (!raw || raw.trim().length <= 20) return "";
  // Cached: the thread card calls this twice per message (test + paint) on every render.
  const key = (keepQuote ? "1|" : "0|") + raw;
  const hit = _renderableCache.get(key);
  if (hit !== undefined) return hit;
  const html = cleanBodyHtml(raw, keepQuote);
  const visible = html
    .replace(/<img[^>]*>/gi, "IMG")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;| /gi, " ")
    .trim();
  const out = visible.length > 0 ? html : "";
  if (_renderableCache.size > 2000) _renderableCache.clear();
  _renderableCache.set(key, out);
  return out;
}

/**
 * Repair mojibake — text where UTF-8 bytes were misinterpreted as Latin-1/Windows-1252.
 * Common patterns: "Ã±" → "ñ", "Ã©" → "é", "Â¿" → "¿", "â‚¬" → "€".
 * Also handles already-corrupted "" (U+FFFD) by best-effort substitution
 * for common Spanish patterns where context makes the original character obvious.
 */
// repairMojibake now lives in @/lib/reply-text (imported above) — the sync, the
// classifier and this view all repair the same way.

/** Decode a byte array using the given charset (defaults to utf-8). */
export function decodeBytes(bytes: number[], charset?: string): string {
  const cs = (charset || "utf-8").toLowerCase().replace(/^iso-?/, "iso-").replace(/^windows-?/, "windows-");
  try {
    return new TextDecoder(cs as string, { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    try { return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes)); }
    catch { return String.fromCharCode(...bytes); }
  }
}

export function decodeHtmlEntities(input: string): string {
  if (!input) return input;
  let s = input;
  // Numeric entities (decimal) → real character (handles ñ, á, €, emojis with surrogate pairs)
  s = s.replace(/&#(\d+);/g, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ""; }
  });
  // Numeric entities (hex)
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
    try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
  });
  // Named entities — common ones for Spanish/European text
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
    ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
    iexcl: "¡", iquest: "¿", ordf: "ª", ordm: "º",
    euro: "€", pound: "£", yen: "¥", cent: "¢", copy: "©", reg: "®", trade: "™",
    hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
    bull: "•", middot: "·", deg: "°", plusmn: "±", times: "×", divide: "÷",
    aring: "å", Aring: "Å", oslash: "ø", Oslash: "Ø", aelig: "æ", AElig: "Æ",
    szlig: "ß", ccedil: "ç", Ccedil: "Ç",
    agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
    Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
    acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
    Acirc: "Â", Ecirc: "Ê", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û",
    auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", Auml: "Ä", Euml: "Ë", Iuml: "Ï", Ouml: "Ö",
  };
  s = s.replace(/&([a-zA-Z]+);/g, (m, name) => named[name] ?? m);
  return s;
}

/** Decode a subject but KEEP any warm-up codes intact (used by the warmup filter). */
export function decodeSubjectKeepCodes(raw: string | null): string {
  if (!raw) return "";
  // Decode RFC 2047 encoded-words (=?charset?B/Q?text?=) — supports adjacent words
  const decoded = raw.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, text) => {
    const enc = encoding.toUpperCase();
    if (enc === "Q") {
      // Q-encoding: _ = space, =XX = byte
      const cleaned = text.replace(/_/g, " ");
      const bytes: number[] = [];
      let i = 0;
      while (i < cleaned.length) {
        if (cleaned[i] === "=" && i + 2 < cleaned.length) {
          bytes.push(parseInt(cleaned.substring(i + 1, i + 3), 16));
          i += 3;
        } else {
          bytes.push(cleaned.charCodeAt(i));
          i += 1;
        }
      }
      return decodeBytes(bytes, charset);
    }
    // B-encoding (Base64) — must decode bytes as the declared charset, NOT atob
    try {
      const bin = atob(text.replace(/\s+/g, ""));
      const bytes = new Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return decodeBytes(bytes, charset);
    } catch { return text; }
  });
  // Strip whitespace between adjacent encoded-words artifacts and decode entities
  return repairMojibake(decodeHtmlEntities(decoded.replace(/\?=\s+=\?/g, "?==?")));
}

/** Display subject — decoded AND with warm-up/tracking codes stripped out. */
export function decodeSubject(raw: string | null): string {
  return stripWarmupTokens(decodeSubjectKeepCodes(raw)) || "(sin asunto)";
}

/** Strict warmup detector — drops messages with any mixed letter+digit code in the subject.
 *  Examples blocked: "Eric - quick question | GH2RZD5 CHBV6J7", "ot 2 | CHBV6J7 WK2FX1R",
 *  "VC3Q3N2", "isition challenge | any.trail.manufactur CHBV6J7", "t27109847387709683 ...". */
export const WARMUP_MIXED_CODE_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20}\b/;
export const WARMUP_LONG_DIGIT_RE = /\b\d{8,}\b/;
export const WARMUP_UUID_LIKE_RE = /\b[a-f0-9]{4,}-[a-f0-9-]{8,}\b/i;
export const WARMUP_DOTTED_LOWER_RE = /\b[a-z]+\.[a-z]+(?:\.[a-z]+)+\b/;
export const WARMUP_MARKER_RE = /#warmup|instantly-warmup|warmup-|x-warmup/i;
/** Spam detection – hide ONLY clear warmup-network / automated messages.
 *  IMPORTANT: a message is no longer hidden just because it contains a code
 *  (those are stripped from the display instead). We only drop emails that are
 *  unmistakably warm-up traffic (explicit markers) or automated system senders,
 *  so real lead replies are never thrown away. */
export function isSpam(subject: string | null, body: string | null, fromEmail: string | null): boolean {
  const sub = (decodeSubject(subject || "") || "");
  const email = fromEmail || "";
  const rawSub = subject || "";
  const bodyStart = (body || "").slice(0, 600);

  // Explicit warm-up markers only
  if (WARMUP_MARKER_RE.test(rawSub + " " + bodyStart)) return true;
  if (/#warmup|instantly-warmup/i.test(sub)) return true;

  // Known automated / system senders
  if (/noreply@|no-reply@|mailer-daemon@|postmaster@|bounce@/i.test(email)) return true;

  return false;
}

/* ── Unibox filters (spec) ─────────────────────────────────────────
 * A) Warm-up code in subject   B) Language (ES/CA except tcx)
 * C) Bounce / noise senders    D) toggles handled in the component
 * ──────────────────────────────────────────────────────────────── */

// A) Brands / acronyms that must NEVER be treated as a warm-up code.
export const WARMUP_WHITELIST = new Set([
  "TCX", "AWS", "GCP", "API", "S3", "AI", "ML", "CRM", "ERP", "UX", "UI",
  "SEO", "SEM", "B2B", "B2C", "SAAS", "VAT", "IVA", "IBAN", "CIF", "NIF", "DNI",
  "VIP", "CEO", "CTO", "CFO", "COO", "RRHH", "HR", "IT", "PM", "QA", "SLA",
  "KPI", "ROI", "MVP", "GDPR", "RGPD", "MICRO", "MACRO", "PRO", "PREMIUM",
  "STANDARD", "BASIC", "PLUS", "ULTRA", "ALPHA", "BETA",
]);

/** A) True when the subject contains an UPPERCASE code that mixes letters+digits
 *  (5–16 chars), e.g. "New HR Policy | 9XAT619 CHBV6J7". Whitelisted brands,
 *  plain uppercase words and years (2024) are NOT treated as codes. */
export function subjectHasWarmupCode(subject: string | null): boolean {
  return textHasWarmupCode(decodeSubjectKeepCodes(subject || ""));
}

/** INTELLIGENT warm-up code detector for a SINGLE token. A warm-up/tracking code
 *  (e.g. "FJRI829FJSC", "GH2RZD5", "9XAT619", "CHBV6J7") mixes letters AND digits
 *  and is high-entropy. Real references ("Order ABC12345", "iPhone13", "COVID19",
 *  "Q4-2024") are NOT flagged, so genuine replies survive. Signals used:
 *   - must mix letters+digits, 6–20 chars, not a whitelisted brand nor a year;
 *   - ≥2 letter↔digit transitions (interleaved) → random code; OR
 *   - the letters are ALL-UPPERCASE with no vowels (e.g. "CHBVJ7") → random code. */
export function looksLikeWarmupCode(t: string): boolean {
  if (t.length < 6 || t.length > 20) return false;
  if (!/[A-Za-z]/.test(t) || !/[0-9]/.test(t)) return false;   // needs BOTH
  if (WARMUP_WHITELIST.has(t.toUpperCase())) return false;
  if (/^(19|20)\d{2}$/.test(t)) return false;                  // a year
  let transitions = 0;
  for (let i = 1; i < t.length; i++) {
    if (/[0-9]/.test(t[i - 1]) !== /[0-9]/.test(t[i])) transitions++;
  }
  if (transitions >= 2) return true;                           // interleaved = code
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase() && !/[AEIOU]/.test(letters)) return true;
  return false;
}

// Spanish/business identifiers that are letter+digit but 100% legitimate and must
// NEVER be treated as a warm-up code: NIE (X1234567L), CIF (Q2826000H), old-format
// car plates (B1234CS), DNI-with-letter. A lead writing "mi NIE es X1234567L" stays.
export const ID_WHITELIST_RE = /^(?:[XYZ]\d{7}[A-Z]|[A-HJ-NP-SUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[A-Z]{1,2}\d{4}[A-Z]{0,2})$/;

/** True if the text (subject OR body) contains warm-up codes. URLs, emails and HTML
 *  are stripped first so link slugs / tracking params never trip it. To avoid hiding
 *  real replies, we require **≥2** code-like tokens — warm-up traffic reliably injects
 *  several ("FJRI829FJSC CHBV6J7"), whereas a genuine message almost never contains
 *  two random alphanumeric tokens (a lone order ref / NIE / CIF is kept). */
export function countWarmupCodes(text: string | null): number {
  if (!text) return 0;
  const cleaned = String(text)
    .replace(/<[^>]+>/g, " ")                 // HTML tags
    .replace(/https?:\/\/\S+/gi, " ")         // URLs
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gi, " ") // emails
    .slice(0, 4000);
  const tokens = cleaned.match(/[A-Za-z0-9]{6,20}/g) || [];
  let n = 0;
  const seen = new Set<string>();
  for (const t of tokens) {
    if (ID_WHITELIST_RE.test(t)) continue;
    if (looksLikeWarmupCode(t) && !seen.has(t)) { seen.add(t); n++; }
  }
  return n;
}
export function textHasWarmupCode(text: string | null): boolean {
  return countWarmupCodes(text) >= 2;
}

/** C) Bounce / delivery-failure / known system senders — always hidden. */
export function isBounceOrNoise(fromEmail: string | null): boolean {
  const e = (fromEmail || "").toLowerCase().trim();
  if (!e) return false;
  // Delivery failures & generic noise mailboxes
  if (/^(mailer-daemon|postmaster|bounce|bounces|delivery|deliverability|abuse|failure-notice|mailer)@/.test(e)) return true;
  // Calendly
  if (/@calendly\.com$/.test(e)) return true;
  // IONOS system mailboxes
  if (/^(no-?reply|noreply|notification|info|servicio|service|sistema|system|billing|admin|soporte|support|atencion|contacto)@ionos\.(com|es|de|fr|co\.uk)$/.test(e)) return true;
  // 1stcontact.ai — entire domain (warmup / outreach)
  if (/@1stcontact\.ai$/.test(e)) return true;
  // instantly.ai system mailboxes
  if (/^(support|noreply|no-reply|notification|billing|info)@instantly\.ai$/.test(e)) return true;
  return false;
}

// Relevance: in the clean bandeja we only want REAL replies to our outreach, not
// random cold inbound. A message is relevant if it's linked to a lead/campaign,
// already labelled, or its subject is a reply/forward/auto-reply.
export const REPLY_SUBJECT_RE = /^\s*(re|res|rv|aw|tr|fw|fwd)\s*[:\]]|^\s*(respuesta autom|automatic reply|out of office|fuera de (la )?oficina|ausente|absent)/i;
export function isRelevantInboxItem(m: any): boolean {
  if (m?.lead_id || m?.campaign_id) return true;
  const labels: string[] = Array.isArray(m?.labels) ? m.labels : [];
  if (labels.some((l) => ["Interesado", "No interesado", "No contactar", "Derivado", "Pregunta", "Fuera / Auto"].includes(l))) return true;
  return REPLY_SUBJECT_RE.test(decodeSubjectKeepCodes(m?.subject || ""));
}

// B) Language detection. Goal: ONLY Spanish/Catalan stays in the bandeja; English
// (and other languages) are hidden. Returns "es" | "en" | "other" | "unknown".
//
// LANG_ES_CA: words that are distinctly Spanish/Catalan (deliberately avoids
// 2-letter words that also exist in English, e.g. "me", "son", "no", "a", "i").
export const LANG_ES_CA = /\b(el|la|los|las|un[oa]?s?|del|al|que|qué|por|para|con|como|pero|porque|cuando|cuándo|donde|dónde|gracias|hola|saludos|buenos|buenas|cordial(?:es|mente)?|atentamente|estimad[oa]s?|señor(?:a|es)?|empresa|reunión|información|interesa|interesad[oa]s?|necesito|necesitamos|necesita|quiero|queremos|quería|querría|puede[ns]?|podemos|podríamos?|tengo|tenemos|tiene[ns]?|somos|estamos|está[ns]?|esto|esta|este|estos|estas|eso|esa|nuestr[oa]s?|vuestr[oa]s?|usted(?:es)?|también|según|sólo|solo|muy|más|sin|sobre|desde|hasta|mientras|aunque|entonces|vale|claro|perfecto|genial|encantad[oa]|quedamos|llamada|correo|adjunto|propuesta|presupuesto|consulta|pregunta|duda|cita|amb|per|què|gràcies|salutacions|atentament|nosaltres|aquest[a]?|aquests|aquestes|també|molt|més|sense|fins|vostè|voldria|d'acord|tinc|tenim|podem|bon\s?dia)\b/gi;
// LANG_EN: very common English words — almost every English email hits several.
export const LANG_EN = /\b(the|and|you|your|yours|for|with|this|that|these|those|have|has|had|are|was|were|will|would|could|should|been|being|is|of|to|in|on|at|as|be|by|or|if|from|but|not|can|just|get|got|know|let|let's|see|time|week|day|here|there|our|we|us|i'm|i'll|we're|we'll|don't|doesn't|thanks|thank|regards|best|hi|hello|hey|dear|please|company|meeting|information|interested|need|want|team|cheers|sincerely|looking|forward|kind|sounds|great|schedule|call|available|reach|reaching|out)\b/gi;
// French markers — real business replies from FR leads should be SHOWN, not hidden.
export const LANG_FR = /\b(merci|bonjour|cordialement|salutations|madame|monsieur|votre|notre|nous|vous|êtes|suis|absent[e]?|bureau|jusqu'au|jusqu|veuillez|prie|s'il\s?vous\s?plaît|disponible|répondre|réponse|entreprise|réunion|rendez-vous|actuellement|serai|retour|contacter|contactez|message|société|joindre|dès|meilleures)\b/gi;
// Italian markers — real business replies from IT leads should be SHOWN, not hidden.
export const LANG_IT = /\b(grazie|salve|buongiorno|cordiali|saluti|distinti|sono|assente|ufficio|fino|contattare|contatti|prego|gentile|egregio|signor[ae]?|vostr[oa]|nostr[oa]|siamo|essere|disponibile|rispondere|risposta|azienda|riunione|messaggio|ritorno|tornerò|cortesia|attualmente|potete|grazie\s?mille)\b/gi;
// Remaining clearly-foreign languages (German / Portuguese / Polish / Russian) — hidden as noise.
export const LANG_OTHER = /\b(danke|sehr|freundlichen|grüße|guten|ich|und|mit|obrigad[oa]|olá|você|atenciosamente|dziękuję|pozdrawiam|spasibo|zdravstvuyte)\b/gi;

export function detectLanguageBucket(text: string): "es" | "en" | "fr" | "it" | "other" | "unknown" {
  const t = (text || "").toLowerCase();
  const es = (t.match(LANG_ES_CA) || []).length;
  const en = (t.match(LANG_EN) || []).length;
  const fr = (t.match(LANG_FR) || []).length;
  const it = (t.match(LANG_IT) || []).length;
  const other = (t.match(LANG_OTHER) || []).length;
  // Spanish/Catalan-specific characters are a signal (English has none).
  const esChars = /[ñ¿¡]|·l|ç/.test(t) ? 1 : 0;
  const esScore = es + esChars * 2;

  // Pick the language with the STRONGEST signal. English is classified whenever its
  // word count wins — a stray accent (esChars) no longer rescues an English mail as
  // "es" (that was the main leak: "Hola John, best regards" counted as Spanish).
  if (en >= 2 && en >= esScore && en >= fr && en >= it) return "en";
  if (esScore >= 2 && esScore >= en && esScore >= fr && esScore >= it) return "es";
  if (fr >= 2 && fr >= en && fr >= esScore && fr >= it) return "fr";
  if (it >= 2 && it >= en && it >= esScore && it >= fr) return "it";
  if (other >= 2 && other >= en && other >= esScore) return "other";
  // Weak signal: a single strong ES word/accent → es; a single English word → en.
  if (esScore > 0) return "es";
  if (en > 0) return "en";
  if (fr > 0) return "fr";
  if (it > 0) return "it";
  return "unknown"; // no hay señal — poco texto
}

export type MessageCategory = "interested" | "not_interested" | "no_contactar" | "derivado" | "question" | "out_of_office" | "neutral";

export function classifyMessage(subject: string | null, body: string | null): MessageCategory {
  // Single source of truth for the intent rules lives in src/lib/classify.ts. Unibox just
  // cleans the text (decode base64/MIME/quoted-printable, strip HTML) and then delegates.
  return classifyIntent(decodeSubject(subject), cleanBodyText(body));
}

// Clasificar un mensaje cuesta (descodificar base64/MIME, quitar HTML, decenas de regex) y la
// lista lo hacía para CADA fila en CADA pintado: con 1.000 mensajes, cada tecla del buscador o
// cada clic repetía ~1.000 clasificaciones. La categoría de un objeto de mensaje no cambia
// mientras sea el mismo objeto (al recargar llegan objetos nuevos), así que se recuerda por objeto.
export const categoryCache = new WeakMap<object, MessageCategory>();
// Lo mismo para el texto en el que busca el cuadro de búsqueda: descodificar y limpiar el cuerpo
// de 1.000 mensajes en cada tecla costaba ~800 ms por pulsación (medido). Una vez por mensaje.
export const searchTextCache = new WeakMap<object, string>();
export function searchTextOf(m: any): string {
  const hit = searchTextCache.get(m);
  if (hit !== undefined) return hit;
  const text = [m.from_email, m.from_name, decodeSubject(m.subject), cleanBodyText(m.body_text, true)]
    .filter(Boolean).join(" ").toLowerCase();
  searchTextCache.set(m, text);
  return text;
}
export function categoryOf(m: { subject?: string | null; body_text?: string | null; labels?: string[] | null }): MessageCategory {
  // Si el servidor (cron push-interested, con IA) ya puso su etiqueta, ésa manda: antes cada
  // fila se reclasificaba aquí con las reglas y el body_text (sin el HTML que lee el servidor), y
  // un "Interesado" que hacía sonar el móvil podía no aparecer en la pestaña Interesados.
  for (const l of (m.labels || [])) {
    const fromLabel = LABEL_TO_CATEGORY[l];
    if (fromLabel) return fromLabel;
  }
  const hit = categoryCache.get(m);
  if (hit) return hit;
  const cat = classifyMessage(m.subject ?? null, m.body_text ?? null);
  categoryCache.set(m, cat);
  return cat;
}

export function getInitials(name: string | null, email: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function getMessageDeduplicationKey(message: any): string {
  if (typeof message?.dedupe_hash === "string" && message.dedupe_hash.trim()) {
    return `hash:${message.dedupe_hash.trim()}`;
  }

  if (typeof message?.message_id === "string" && message.message_id.trim()) {
    return `mid:${message.message_id.trim().toLowerCase()}`;
  }

  const normalizedFrom = typeof message?.from_email === "string" ? message.from_email.trim().toLowerCase() : "";
  const normalizedSubject = decodeSubject(message?.subject ?? "").trim().toLowerCase();
  const normalizedBody = cleanBodyText(message?.body_text ?? "").slice(0, 160).trim().toLowerCase();
  const normalizedReceivedAt = typeof message?.received_at === "string" ? message.received_at.slice(0, 16) : "";

  return `fallback:${message?.account_id ?? ""}|${normalizedFrom}|${normalizedSubject}|${normalizedBody}|${normalizedReceivedAt}`;
}

/** Etiqueta guardada en inbox_messages.labels para cada categoría (lo que escribe el servidor). */
export const CATEGORY_LABEL: Record<MessageCategory, string> = {
  interested: "Interesado",
  not_interested: "No interesado",
  no_contactar: "No contactar",
  derivado: "Derivado",
  question: "Pregunta",
  out_of_office: "Fuera / Auto",
  neutral: "",
};
/** Etiqueta guardada ("Interesado", "Pregunta"…) → categoría. Es lo que lee categoryOf primero. */
export const LABEL_TO_CATEGORY: Record<string, MessageCategory> = Object.fromEntries(
  (Object.entries(CATEGORY_LABEL) as [MessageCategory, string][])
    .filter(([, label]) => label)
    .map(([k, label]) => [label, k]),
);

/** Respuesta manual que rebotó por la IP de salida y el servidor reenvió sola (06-10-2026):
 *  fetch-inbox añade esta nota (supabase/functions/_shared/reply-retry.ts → resentNote). */
export function isAutoResent(errorMessage: string | null | undefined): boolean {
  return /Reenviado automáticamente/.test(String(errorMessage || ""));
}
