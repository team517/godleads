/**
 * RFC 5322 / RFC 2047 header helpers — ONE implementation shared by the frontend
 * (src/lib) and the Supabase Edge Functions (supabase/functions/_shared), kept
 * byte-identical by src/test/shared-copies.test.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * send-email used to emit headers as single unbounded lines:
 *
 *   Subject: =?UTF-8?B?<the whole subject, could be 400 chars>?=
 *   References: <id1> <id2> ... <id20>
 *   To: a@b.com, c@d.com, e@f.com, ...
 *
 * Two hard rules get broken that way:
 *   • RFC 2047 §2: an encoded-word MUST NOT be longer than 75 characters.
 *   • RFC 5322 §2.1.1: a line MUST NOT exceed 998 characters (excluding CRLF).
 *     Over that, servers fold, truncate or reject — the classic "subject arrives
 *     cut in half / message refused with 500 line too long".
 *
 * WHAT IT DOES
 * ------------
 *   encodeMimeHeaderFolded(value)  unstructured header value (Subject):
 *       ASCII        → returned as-is (only hard-folded if absurdly long),
 *       non-ASCII    → several `=?UTF-8?B?..?=` words, each ≤75 chars, joined
 *                      by CRLF + SP. Splitting happens on CHARACTER boundaries
 *                      (code points, via Array.from) so a multi-byte letter or
 *                      an emoji surrogate pair is never cut in half — a cut
 *                      would produce a broken word and mojibake in the client.
 *
 *   foldHeader(name, value)        structured header (To, Cc, References):
 *       folds on whitespace at ≤78 chars with CRLF + TAB continuation, which is
 *       what real mailboxes emit. Returns the COMPLETE header line(s), name
 *       included, ready to push into the header array.
 *
 * Both collapse every CR and LF in the input to a single space first: that is
 * the header-injection guard (a bare \r is enough to inject a header, and
 * /\r?\n/ does NOT match it).
 */

/** Max length of one RFC 2047 encoded-word, including the =?UTF-8?B? and ?= wrapper. */
const ENCODED_WORD_MAX = 75;
/** Recommended max line length (RFC 5322 §2.1.1 "SHOULD" limit). */
const FOLD_AT = 78;
/** Ceiling for a plain ASCII value: stays comfortably under the 998 hard limit. */
const SAFE_LINE = 900;

/**
 * Collapse CR/LF (in any combination, including a BARE \r) to a single space.
 * This is the header-injection guard: anything the user controls goes through it.
 */
export function collapseHeaderWhitespace(value: string): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Last-resort split for a single token longer than a whole line (a pathological
 * URL or Message-ID). RFC 5322 only allows folding at whitespace, so such a
 * token cannot be folded legally — but leaving it whole would blow the 998-char
 * hard limit and get the message rejected outright. Cutting is the lesser evil.
 */
function splitLongToken(token: string, limit: number): string[] {
  if (token.length <= limit) return [token];
  const out: string[] = [];
  for (let i = 0; i < token.length; i += limit) out.push(token.slice(i, i + limit));
  return out;
}

function foldOnWhitespace(value: string, limit: number, firstPrefixLen: number, cont: string): string {
  const indent = Math.max(0, cont.length - 2); // cont starts with CRLF
  const maxToken = Math.max(1, limit - indent);
  const tokens: string[] = [];
  for (const raw of value.split(/\s+/)) {
    if (raw) tokens.push(...splitLongToken(raw, maxToken));
  }
  if (tokens.length === 0) return "";
  const lines: string[] = [];
  let line = tokens[0];
  let budget = Math.max(1, limit - firstPrefixLen);
  for (let i = 1; i < tokens.length; i++) {
    if (line.length + 1 + tokens[i].length <= budget) {
      line += " " + tokens[i];
    } else {
      lines.push(line);
      line = tokens[i];
      budget = maxToken;
    }
  }
  lines.push(line);
  return lines.join(cont);
}

/**
 * Encode an unstructured header value (Subject) — RFC 2047 base64 encoded-words,
 * each ≤75 chars, folded with CRLF + SP. Pure-ASCII values are returned verbatim
 * (that is what every mail client does) unless they are long enough to threaten
 * the 998-char line limit, in which case they are folded on whitespace.
 */
export function encodeMimeHeaderFolded(value: string): string {
  const normalized = collapseHeaderWhitespace(value);
  if (!normalized) return "";

  if (!/[^\x20-\x7E]/.test(normalized)) {
    return normalized.length <= SAFE_LINE
      ? normalized
      : foldOnWhitespace(normalized, SAFE_LINE, 0, "\r\n ");
  }

  const prefix = "=?UTF-8?B?";
  const suffix = "?=";
  // base64 grows 3 bytes → 4 chars, so cap the payload in BYTES and round down
  // to a whole 3-byte group: 45 bytes → 60 base64 chars → 72-char word ≤ 75.
  const maxBase64 = ENCODED_WORD_MAX - prefix.length - suffix.length;
  const maxBytes = Math.max(3, Math.floor(maxBase64 / 4) * 3);

  const encoder = new TextEncoder();
  const words: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Array.from iterates CODE POINTS, so an emoji (surrogate pair) or an accented
  // letter is always kept whole — never split across two encoded-words.
  for (const ch of Array.from(normalized)) {
    const size = encoder.encode(ch).length;
    if (current && currentBytes + size > maxBytes) {
      words.push(prefix + base64Utf8(current) + suffix);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current) words.push(prefix + base64Utf8(current) + suffix);
  return words.join("\r\n ");
}

/**
 * Build a COMPLETE structured header line ("Name: value"), folded on whitespace
 * at ≤78 chars with CRLF + TAB continuation. Use for To, Cc, References and any
 * other header whose value is a list that can grow without bound.
 */
export function foldHeader(name: string, value: string): string {
  const normalized = collapseHeaderWhitespace(value);
  const single = `${name}: ${normalized}`;
  if (single.length <= FOLD_AT) return single;
  return `${name}: ${foldOnWhitespace(normalized, FOLD_AT, name.length + 2, "\r\n\t")}`;
}

/**
 * Does this body already carry real HTML markup?
 *
 * It decides whether textToHtml wraps the text in paragraphs (escaping &, < and >
 * so a literal "<2 semanas" cannot be swallowed as a bogus tag) or passes it
 * through untouched. The list MUST include the inline formatting tags: four live
 * campaign steps are written as "Buenas <b>{{first_name}}</b>, …" with no <p> at
 * all, and leaving <b> out of the list sent them with the tags visible as text.
 *
 * One definition for both senders so the engine and send-email can never drift.
 */
const HTML_MARKUP_RE = /<(?:p|div|br|table|thead|tbody|tr|td|th|span|a|img|ul|ol|li|b|strong|em|i|u|h[1-6]|blockquote|pre|code|hr|font)(?:\s|>|\/)/i;

export function hasHtmlMarkup(text: string | null | undefined): boolean {
  return HTML_MARKUP_RE.test(text || "");
}
