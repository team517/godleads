// Shared SMTP reply sender — extracted from process-auto-replies so the reminder
// cron can reuse the exact same battle-tested send path (465 TLS / 587 STARTTLS).
//
// RFC COMPLIANCE (2026-09-11). This file used to emit a message with no Date, no
// Message-ID, raw 8-bit UTF-8 under an implicit 7bit CTE, HTML with no plain-text
// alternative, and In-Reply-To/References re-bracketed on top of ids that are already
// bracketed (`<<id@dom>>` → threading silently dead). All of that is fixed here and the
// message builder is now ONE function (buildMimeMessage) shared by both senders.

export function linkifyText(text: string): string {
  return text.replace(
    /(https?:\/\/[^\s<>"')\]]+)/gi,
    '<a href="$1" style="color:#2563eb;text-decoration:underline;" target="_blank">$1</a>'
  );
}

export function textToHtml(text: string): string {
  if (/<(p|div|br)\b/i.test(text)) {
    return linkifyText(text);
  }
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${linkifyText(p.replace(/\n/g, "<br>"))}</p>`)
    .join("");
}

// ── MIME / RFC 5322 helpers ───────────────────────────────────────────────────
const b64utf8 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
};
const mimeWord = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);
function fromHeaderStr(name: string, addr: string): string {
  const clean = (name || "").replace(/[\r\n]/g, "").trim();
  if (!clean) return `<${addr}>`;
  // NOTE: the replacement must be "\\$1" — "\$1" is just "$1" in TS, i.e. the quote was
  // re-inserted unescaped and the display-name quoting broke on names containing `"`.
  if (/^[\x20-\x7E]*$/.test(clean)) return `"${clean.replace(/([\\"])/g, "\\$1")}" <${addr}>`;
  return `${mimeWord(clean)} <${addr}>`;
}

const randomToken = (n: number) => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
};

/** RFC 5322 §3.3 date, e.g. "Thu, 11 Sep 2026 14:30:22 +0000". Built from getUTC* only, so
 *  it is correct whatever timezone the isolate happens to run in. */
export function formatSmtpDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (v: number) => v.toString().padStart(2, "0");
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/** `<timestamp.random.random@sending-domain>` — the right-hand side must be a domain we own
 *  or the id is worthless for threading (and looks forged). */
export function generateMessageId(domain: string, now: Date = new Date()): string {
  const pad = (v: number) => v.toString().padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}.` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `<${stamp}.${randomToken(10)}.${randomToken(6)}@${domain || "localhost"}>`;
}

/** Message-IDs go on the wire inside angle brackets, EXACTLY once. Every other code path in
 *  this repo stores them already bracketed; blind `<${id}>` produced `<<id@dom>>`. */
function wrapId(id: string): string {
  const t = (id || "").trim();
  if (!t) return "";
  return t.includes("<") ? t : `<${t}>`;
}
/** References is a SPACE-SEPARATED chain: normalise each id on its own. */
function wrapRefs(refs: string): string {
  return (refs || "").trim().split(/\s+/).filter(Boolean).map(wrapId).filter(Boolean).join(" ");
}

/** RFC 5322 §2.2.3 folding — a long References chain must not produce a >998-char line. */
function foldHeader(name: string, value: string): string {
  const parts = value.split(" ").filter(Boolean);
  let line = `${name}:`;
  const out: string[] = [];
  for (const p of parts) {
    if (line.length + 1 + p.length > 76 && line !== `${name}:`) { out.push(line); line = " "; }
    line += (line === " " ? "" : " ") + p;
  }
  out.push(line);
  return out.join("\r\n");
}

/**
 * Quoted-printable (RFC 2045 §6.7). Soft-wraps so no output line exceeds 76 chars, and
 * encodes whitespace that would otherwise sit at the end of a line (a decoder is allowed to
 * throw that away). The declared CTE must match this exactly.
 */
export function quotedPrintableEncode(input: string): string {
  const bytes = new TextEncoder().encode(input.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const hex = (b: number) => "=" + b.toString(16).toUpperCase().padStart(2, "0");
  const lines: string[] = [];
  let line = "";
  // 73 (not 75) leaves room for the "=" soft-break marker plus a trailing space promoted to
  // "=20" at wrap time, so the emitted line still fits in 76.
  const push = (chunk: string) => {
    if (line.length + chunk.length > 73) {
      line = line.replace(/[ \t]$/, (m) => hex(m.charCodeAt(0)));
      lines.push(line + "=");
      line = "";
    }
    line += chunk;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a) {
      line = line.replace(/[ \t]$/, (m) => hex(m.charCodeAt(0)));
      lines.push(line);
      line = "";
      continue;
    }
    if (b === 0x20 || b === 0x09) {
      const next = i + 1 < bytes.length ? bytes[i + 1] : 0x0a;
      push(next === 0x0a ? hex(b) : String.fromCharCode(b));
      continue;
    }
    if (b >= 0x21 && b <= 0x7e && b !== 0x3d) push(String.fromCharCode(b));
    else push(hex(b));
  }
  line = line.replace(/[ \t]$/, (m) => hex(m.charCodeAt(0)));
  lines.push(line);
  return lines.join("\r\n");
}

/** Plain-text alternative derived from the HTML. Links keep their URL — "label (href)" —
 *  because a text/plain part that silently drops the link is worse than no part at all. */
export function htmlToPlainText(html: string): string {
  return (html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      return !label || label === href ? href : `${label} (${href})`;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Dot-stuffing per RFC 5321 §4.5.2 — a body line starting with "." would end DATA early.
 *  `^\./gm` also covers a "." on the very first line, which /\r\n\./ does not. */
export function dotStuff(message: string): string {
  return message.replace(/^\./gm, "..");
}

export type MimeAttachment = { filename: string; mime: string; base64: string };

/**
 * The single RFC-correct message builder used by both senders.
 *   no attachments →  multipart/alternative { text/plain, text/html }
 *   attachments    →  multipart/mixed { multipart/alternative { … }, attachment* }
 * Both text parts are charset=utf-8 + quoted-printable (declared CTE == actual encoding).
 * Returns the raw message WITHOUT dot-stuffing or the DATA terminator (the senders add both).
 */
export function buildMimeMessage(o: {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string | null;
  references?: string | null;
  replyTo?: string | null;
  attachments?: MimeAttachment[];
  date?: Date;
  messageId?: string;
}): string {
  const date = o.date || new Date();
  const fromDomain = (o.from || "").split("@")[1] || "localhost";
  const messageId = o.messageId || generateMessageId(fromDomain, date);
  // Header-injection guard: an inbound Subject decoded from an encoded-word can carry CR/LF;
  // without this a "Re: …\r\nBcc: relay@x" turned the reply into a relay. Strip them + encode.
  const safeSubject = (o.subject || "").replace(/[\r\n]+/g, " ");

  const headers: string[] = [
    `From: ${o.fromName ? fromHeaderStr(o.fromName, o.from) : `<${o.from}>`}`,
    `To: ${(o.to || "").replace(/[\r\n]+/g, " ")}`,
    `Subject: ${mimeWord(safeSubject)}`,
    `Date: ${formatSmtpDate(date)}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
  ];
  if (o.replyTo) headers.push(`Reply-To: <${o.replyTo}>`);

  const irt = wrapId(o.inReplyTo || "");
  if (irt) headers.push(`In-Reply-To: ${irt}`);
  const refs = wrapRefs(o.references || "") || irt;
  if (refs) headers.push(foldHeader("References", refs));

  const altBoundary = `=_op_alt_${randomToken(12)}_${randomToken(8)}`;
  const plain = htmlToPlainText(o.html);
  const altLines = [
    `--${altBoundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    "",
    quotedPrintableEncode(plain),
    `--${altBoundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    "",
    quotedPrintableEncode(o.html || ""),
    `--${altBoundary}--`,
  ];

  const attachments = (o.attachments || []).filter((a) => a && a.base64);
  if (attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return [headers.join("\r\n"), "", ...altLines].join("\r\n");
  }

  const b64wrap = (s: string) => (s.replace(/[^A-Za-z0-9+/=]/g, "").match(/.{1,76}/g) || []).join("\r\n");
  const mixedBoundary = `=_op_mix_${randomToken(12)}_${randomToken(8)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const lines: string[] = [
    headers.join("\r\n"),
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    ...altLines,
  ];
  for (const att of attachments) {
    const safeName = mimeWord((att.filename || "adjunto").replace(/[\r\n"]/g, ""));
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${(att.mime || "application/octet-stream").replace(/[\r\n]/g, "")}; name="${safeName}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${safeName}"`,
      "",
      b64wrap(att.base64),
    );
  }
  lines.push(`--${mixedBoundary}--`);
  return lines.join("\r\n");
}

export async function sendSmtpReply(
  host: string, port: number, username: string, password: string,
  from: string, to: string, subject: string, body: string,
  inReplyTo: string | null, references: string | null,
  fromName: string | null
): Promise<{ ok: boolean; error?: string }> {
  // Deadlines so a hung/desynced peer fails fast instead of stalling the isolate to its wall
  // limit (which left the job lock stuck). Mirrors sendSmtpWithAttachments below.
  const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("SMTP timeout (" + what + ")")), ms))]);
  try {
    let conn: Deno.Conn = await withTimeout(
      port === 465 ? Deno.connectTls({ hostname: host, port }) : Deno.connect({ hostname: host, port }),
      15000, "connect");
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    // Read a COMPLETE SMTP reply: accumulate until the last line is "NNN " (space, not "NNN-").
    // The old one-read-per-command version desynced on a multi-line EHLO split across TCP
    // segments → AUTH read the wrong line ("Auth failed" on good creds) or the final "250"
    // check matched the RCPT reply while the real DATA verdict (e.g. 554) went unread ("sent"
    // when it bounced).
    const readResponse = async (): Promise<string> => {
      let result = "";
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const b = new Uint8Array(4096);
        const n = await withTimeout(conn.read(b), 20000, "read");
        if (!n) break;
        result += dec.decode(b.subarray(0, n));
        const lines = result.split("\r\n").filter((l) => l.length > 0);
        if (/^\d{3} /.test(lines[lines.length - 1] || "")) break;
      }
      return result;
    };
    const writeAll = async (data: Uint8Array) => { let off = 0; while (off < data.length) off += await conn.write(data.subarray(off)); };
    const cmd = async (c: string) => { await writeAll(enc.encode(c + "\r\n")); return (await readResponse()).trim(); };
    const code2 = (r: string) => /^2\d\d/.test(r);

    const buildMessage = () => {
      const raw = buildMimeMessage({
        from, fromName, to, subject, html: body,
        inReplyTo, references, replyTo: from,
      });
      return `${dotStuff(raw)}\r\n.\r\n`;
    };

    await readResponse(); // greeting
    if (port !== 465) {
      const ehlo = await cmd("EHLO onepulso");
      if (/STARTTLS/i.test(ehlo)) { await writeAll(enc.encode("STARTTLS\r\n")); await readResponse(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); }
      else { try { conn.close(); } catch { /* */ } return { ok: false, error: "SMTP sin STARTTLS" }; }
    }
    await cmd("EHLO onepulso");
    const auth = await cmd(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `Auth failed: ${auth.slice(0, 80)}` }; }
    const mf = await cmd(`MAIL FROM:<${from}>`);
    if (!code2(mf)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `MAIL FROM: ${mf.slice(0, 80)}` }; }
    const rc = await cmd(`RCPT TO:<${to}>`);
    if (!code2(rc)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `RCPT: ${rc.slice(0, 80)}` }; }
    const dt = await cmd("DATA");
    if (!/^3\d\d/.test(dt)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `DATA: ${dt.slice(0, 80)}` }; }
    await writeAll(enc.encode(buildMessage()));
    const fin = (await readResponse()).trim();
    try { await cmd("QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }
    return code2(fin) ? { ok: true } : { ok: false, error: `Send failed: ${fin.slice(0, 80)}` };
  } catch (e) {
    return { ok: false, error: `SMTP error: ${(e as Error)?.message || e}` };
  }
}

// ── SMTP sender with attachments (multipart/mixed) ─────────────────────────────
// Ported from send-report's battle-tested sender. `headerFrom` lets the visible
// From: differ from the authenticated/envelope sender (e.g. show
// equipo@onepulso.online while authenticating as support@ on the same domain —
// Gmail honours it when the address is a registered alias of the mailbox).

export async function sendSmtpWithAttachments(opts: {
  host: string; port: number; username: string; password: string;
  from: string; fromName: string; to: string; subject: string; body: string;
  attachments: { filename: string; mime: string; base64: string }[];
  headerFrom?: string;
}): Promise<{ ok: boolean; error?: string; transcript?: string[] }> {
  const { host, port, username, password, from, fromName, to, subject, body, attachments } = opts;
  const visibleFrom = opts.headerFrom || from;
  const log: string[] = [];
  // Deadlines: a hung SMTP peer must fail fast, never stall the edge function to its wall limit.
  const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("SMTP timeout (" + what + ")")), ms))]);
  try {
    let conn: Deno.Conn = await withTimeout(
      port === 465 ? Deno.connectTls({ hostname: host, port }) : Deno.connect({ hostname: host, port }),
      15000, "connect");
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const readResponse = async (): Promise<string> => {
      let result = "";
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const b = new Uint8Array(4096);
        const n = await withTimeout(conn.read(b), 20000, "read");
        if (!n) break;
        result += dec.decode(b.subarray(0, n));
        const lines = result.split("\r\n").filter((l) => l.length > 0);
        const last = lines[lines.length - 1] || "";
        if (/^\d{3} /.test(last)) break;
      }
      return result;
    };
    const writeAll = async (data: Uint8Array) => { let off = 0; while (off < data.length) off += await conn.write(data.subarray(off)); }; // TLS write() can be PARTIAL on big buffers (240KB PDF truncated silently)
    const cmd = async (c: string) => { await writeAll(enc.encode(c + "\r\n")); const r = (await readResponse()).trim(); log.push(c.split(" ")[0] + " => " + r.slice(0, 60)); return r; };
    const code2 = (r: string) => /^2\d\d/.test(r);
    log.push("GREET => " + (await readResponse()).trim().slice(0, 60));
    if (port !== 465) {
      const ehlo = await cmd("EHLO onepulso");
      if (/STARTTLS/i.test(ehlo)) { await conn.write(enc.encode("STARTTLS\r\n")); await readResponse(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); }
      else { try { conn.close(); } catch { /* */ } return { ok: false, error: "SMTP sin STARTTLS" }; }
    }
    await cmd("EHLO onepulso");
    const auth = await cmd(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `Auth: ${auth.slice(0, 80)}`, transcript: log }; }
    const mf = await cmd(`MAIL FROM:<${from}>`);
    if (!code2(mf)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `MAIL FROM: ${mf.slice(0, 80)}`, transcript: log }; }
    const rc = await cmd(`RCPT TO:<${to}>`);
    if (!code2(rc)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `RCPT: ${rc.slice(0, 80)}`, transcript: log }; }
    const dt = await cmd("DATA");
    if (!/^3\d\d/.test(dt)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `DATA: ${dt.slice(0, 80)}`, transcript: log }; }

    // The body arrives as HTML. It used to be tag-stripped into a lone text/plain part with
    // "Content-Transfer-Encoding: 8bit" (declared 7bit-safe while carrying UTF-8, and no
    // 8BITMIME check) — so the client's report mail arrived unformatted. Now: proper
    // multipart/mixed { multipart/alternative { text/plain, text/html }, attachment* }, QP.
    // This sender's only caller (admin-users → client copy report) hands us PLAIN TEXT, so the
    // html part has to be built from it. Already-HTML input is passed through untouched —
    // re-running textToHtml over it would linkify the URLs *inside* existing href attributes.
    const html = /<(p|div|br|a|table|h[1-6])\b/i.test(body) ? body : textToHtml(body);
    const raw = buildMimeMessage({
      from: visibleFrom, fromName, to, subject, html,
      replyTo: visibleFrom, attachments,
    });
    await writeAll(enc.encode(`${dotStuff(raw)}\r\n.\r\n`));
    const fin = (await readResponse()).trim();
    try { await cmd("QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }
    return code2(fin) ? { ok: true } : { ok: false, error: `Envío: ${fin.slice(0, 80)}`, transcript: log };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e), transcript: log }; }
}
