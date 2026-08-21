// Pure RFC 5322 / 5321 helpers for building a REPLY that threads correctly.
//
// Lives here (no Deno APIs, no imports) so both the edge functions and the vitest
// suite can use the exact same code — the header building is what decides whether a
// client sees our answer inside the conversation or as a loose new email.
//
// Storage convention in this project (set by fetch-inbox):
//   inbox_messages.message_id → WITHOUT angle brackets   ("abc@mail.com")
//   inbox_messages.ref_chain  → WITH angle brackets, space separated  ("<a@x> <b@y>")
// Everything here normalises both shapes, so callers never have to care.

/** How many ids a References chain keeps before it gets trimmed in the middle. */
const MAX_REFERENCES = 20;
/** Max length of a header line before folding (RFC 5322 recommends 78). */
const MAX_HEADER_LINE = 78;

/** `<id@host>` / ` id@host ` → `id@host`. Null for anything unusable. */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").replace(/[\r\n]/g, " ").trim();
  if (!v) return null;
  const inner = v.match(/<([^<>\s]+)>/);
  const id = (inner ? inner[1] : v).trim();
  // A Message-ID without "@" is malformed enough that echoing it back only breaks
  // threading in some clients — better to send no In-Reply-To at all.
  if (!id || /\s/.test(id) || id.indexOf("@") < 0) return null;
  return id;
}

/** Wrap a bare id in angle brackets (idempotent). */
export function angle(id: string): string {
  const bare = normalizeMessageId(id);
  return bare ? `<${bare}>` : "";
}

/** Pull every `<id>` out of a References/In-Reply-To value, in order. */
export function extractMessageIds(raw: string | null | undefined): string[] {
  const v = String(raw ?? "").replace(/[\r\n]/g, " ");
  if (!v.trim()) return [];
  const angled = v.match(/<[^<>\s]+>/g);
  const tokens = angled ?? v.split(/\s+/);
  const out: string[] = [];
  for (const t of tokens) {
    const id = normalizeMessageId(t);
    if (id) out.push(id);
  }
  return out;
}

/**
 * Build the In-Reply-To / References pair for a reply to `parent`.
 *
 * References = the parent's own chain + the parent's Message-ID (deduped, order kept).
 * When the chain grows past MAX_REFERENCES, RFC 5322 §3.6.4 allows dropping ids: we
 * keep the FIRST (the thread root, which is what groups the conversation) and the most
 * recent ones, which is what every mail client actually needs.
 */
export function buildThreadHeaders(parent: {
  messageId?: string | null;
  refChain?: string | null;
}): { inReplyTo: string | null; references: string | null } {
  const parentId = normalizeMessageId(parent.messageId);
  const chain = extractMessageIds(parent.refChain);

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [...chain, ...(parentId ? [parentId] : [])]) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }

  const trimmed = ids.length > MAX_REFERENCES
    ? [ids[0], ...ids.slice(ids.length - (MAX_REFERENCES - 1))]
    : ids;

  // No Message-ID on the parent (some senders omit it): reply against the last known
  // id of the chain so the answer still lands inside the thread.
  const replyTarget = parentId ?? (chain.length ? chain[chain.length - 1] : null);

  return {
    inReplyTo: replyTarget ? angle(replyTarget) : null,
    references: trimmed.length ? trimmed.map(angle).join(" ") : null,
  };
}

/**
 * Collapse a header value to a single line. A CR/LF that survives into a header is
 * header injection (an attacker-controlled subject adding its own Bcc:), so this is
 * applied to every value that reaches the wire.
 */
export function sanitizeHeaderValue(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** "algo" → "Re: algo"; "Re: algo" / "RE : algo" / "Rv: algo" stay as they are. */
export function replySubject(subject: string | null | undefined, fallback = "tu mensaje"): string {
  const s = sanitizeHeaderValue(subject);
  if (!s) return `Re: ${fallback}`;
  // Matches Re:, RE:, Re :, Re[2]:, Res:, and the Spanish forward prefixes RV:/Rv:.
  if (/^(re|res|rv|fwd?|rve)\s*(\[\d+\])?\s*:/i.test(s)) return s;
  return `Re: ${s}`;
}

const b64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

const isAscii = (s: string): boolean => /^[\x20-\x7E]*$/.test(s);

/**
 * RFC 2047 encoded-word for a header value with non-ASCII (accents!). An unencoded
 * "Re: tu campaña" is what garbles subjects on strict servers.
 *
 * Each encoded word must stay ≤75 chars, so long values are split on codepoint
 * boundaries (never mid-UTF-8-sequence) and joined with a fold.
 */
export function mimeWord(value: string): string {
  const s = sanitizeHeaderValue(value);
  if (isAscii(s)) return s;
  const enc = new TextEncoder();
  // "=?UTF-8?B?" + payload + "?=" ≤ 75 → base64 payload ≤ 63 → ≤ 45 raw bytes.
  const MAX_BYTES = 45;
  const words: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (chunkBytes + n > MAX_BYTES) {
      words.push(`=?UTF-8?B?${b64(enc.encode(chunk))}?=`);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += n;
  }
  if (chunk) words.push(`=?UTF-8?B?${b64(enc.encode(chunk))}?=`);
  return words.join("\r\n ");
}

/**
 * A valid From header. An ASCII display name must be QUOTED (a bare name with "@" or
 * "." is an invalid atom and IONOS then reads it as the sender address, rejecting the
 * send with "554 Unauthorized sender address"); a non-ASCII one is an encoded-word.
 */
export function fromHeader(name: string | null | undefined, addr: string): string {
  const a = sanitizeAddress(addr);
  const clean = sanitizeHeaderValue(name);
  if (!clean) return `<${a}>`;
  if (isAscii(clean)) return `"${clean.replace(/([\\"])/g, "\\$1")}" <${a}>`;
  return `${mimeWord(clean)} <${a}>`;
}

/** An address can never contain whitespace or angle brackets of its own. */
export function sanitizeAddress(addr: string | null | undefined): string {
  return String(addr ?? "").replace(/[\s<>,;]/g, "").trim();
}

/**
 * Fold a long header onto continuation lines (CRLF + one space). A References chain of
 * a dozen ids is well past the 998-char hard limit, and servers that enforce it drop
 * the header — which silently breaks threading.
 */
export function foldHeader(name: string, value: string): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const tokens = v.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = `${name}:`;
  for (const t of tokens) {
    if (line.length + 1 + t.length > MAX_HEADER_LINE && line !== `${name}:`) {
      lines.push(line);
      line = ` ${t}`;
    } else {
      line += ` ${t}`;
    }
  }
  lines.push(line);
  return lines.join("\r\n");
}

/** RFC 5322 Date header ("Fri, 21 Aug 2026 10:00:00 +0000"). */
export function formatDateHeader(d: Date): string {
  return d.toUTCString().replace(/GMT$/, "+0000");
}

/** A fresh Message-ID for an outgoing mail, WITHOUT angle brackets. */
export function newMessageId(fromAddress: string, seed?: string): string {
  const domain = String(fromAddress || "").split("@")[1]?.trim() || "localhost";
  const rand = seed || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${rand}@${domain}`;
}

/** Normalise every line ending to CRLF (SMTP requires it; a lone \n desyncs DATA). */
export function toCrlf(text: string): string {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

/** RFC 5321 §4.5.2: a line starting with "." must be sent as "..". */
export function dotStuff(text: string): string {
  return String(text ?? "").replace(/^\./gm, "..");
}

export interface MimeMessage {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  /** HTML body — sent base64-encoded, so long lines and dots can't break DATA. */
  html: string;
  date: Date;
  /** Bare id (no angle brackets) — see newMessageId. */
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
  replyTo?: string | null;
}

/**
 * Assemble the full RFC 5322 message for the SMTP DATA phase (terminator NOT included).
 * Base64 body: no dot-stuffing hazard, no 998-char line limit, no charset surprises.
 */
export function buildMimeMessage(m: MimeMessage): string {
  const headers: string[] = [
    `From: ${fromHeader(m.fromName, m.from)}`,
    `To: <${sanitizeAddress(m.to)}>`,
    `Subject: ${mimeWord(m.subject)}`,
    `Date: ${formatDateHeader(m.date)}`,
    `Message-ID: ${angle(m.messageId)}`,
    `Reply-To: <${sanitizeAddress(m.replyTo || m.from)}>`,
  ];
  if (m.inReplyTo) headers.push(foldHeader("In-Reply-To", m.inReplyTo));
  if (m.references) headers.push(foldHeader("References", m.references));
  headers.push("MIME-Version: 1.0", "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64");

  const body = b64(new TextEncoder().encode(m.html)).match(/.{1,76}/g)?.join("\r\n") || "";
  return dotStuff(toCrlf(`${headers.join("\r\n")}\r\n\r\n${body}`));
}
