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
// Subject / nombre del remitente: UN encoded-word por línea de ≤75 caracteres (RFC 2047 §2) y plegado
// con CRLF+SP, con el MISMO código que send-email (_shared/mime-headers.ts). Antes un asunto largo con
// tildes iba entero en una sola palabra codificada de >75 caracteres.
import { encodeMimeHeaderFolded, foldHeader, threadHeaders, htmlToPlainText } from "./mime-headers.ts";
import { assertPublicMailHost } from "./host-guard.ts";
import { makeBudget, readSmtpReply, sanitizeServerText, withTimeout } from "./smtp-wire.ts";
import { fixBlockedLinks } from "./link-guard.ts";

function fromHeaderStr(name: string, addr: string): string {
  const clean = (name || "").replace(/[\r\n]/g, "").trim();
  if (!clean) return `<${addr}>`;
  // NOTE: the replacement must be "\\$1" — "\$1" is just "$1" in TS, i.e. the quote was
  // re-inserted unescaped and the display-name quoting broke on names containing `"`.
  if (/^[\x20-\x7E]*$/.test(clean)) return `"${clean.replace(/([\\"])/g, "\\$1")}" <${addr}>`;
  return `${encodeMimeHeaderFolded(clean)} <${addr}>`;
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
    `Subject: ${encodeMimeHeaderFolded(safeSubject)}`,
    `Date: ${formatSmtpDate(date)}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
  ];
  if (o.replyTo) headers.push(`Reply-To: <${o.replyTo}>`);

  // Same threading rules as send-email (shared, tested): bracketed once, deduplicated, the
  // answered id last, long chains trimmed from the middle.
  const thread = threadHeaders(o.inReplyTo, o.references);
  if (thread) {
    headers.push(`In-Reply-To: ${thread.inReplyTo}`);
    headers.push(foldHeader("References", thread.references));
  }

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
    // El nombre va dentro de un parámetro entre comillas: las palabras codificadas se unen con un espacio (sin CRLF).
    const safeName = encodeMimeHeaderFolded((att.filename || "adjunto").replace(/[\r\n"]/g, "")).replace(/\r\n[ \t]/g, " ");
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

// ── Sesión SMTP común a los dos emisores ─────────────────────────────────────────
// Auditoría 06-10-2026: host público (SSRF), plazos de conexión/lectura/escritura + presupuesto total
// de ~45 s, STARTTLS exigido (nunca AUTH en claro), respuesta completa sólo con CRLF + línea "NNN ",
// y 354 obligatorio tras DATA antes de mandar el mensaje.
const SMTP_BUDGET_MS = 45_000;

// Tipos mínimos del runtime: este módulo también lo compila el tsconfig del frontend (lo importan las
// pruebas) y allí no existe el espacio de nombres Deno.
interface RtConn { read(p: Uint8Array): Promise<number | null>; write(p: Uint8Array): Promise<number>; close(): void }
interface RtOpts { hostname: string; port: number }
const rt = () => (globalThis as unknown as {
  Deno: { connect(o: RtOpts): Promise<RtConn>; connectTls(o: RtOpts): Promise<RtConn>; startTls(c: RtConn, o: { hostname: string }): Promise<RtConn> };
}).Deno;

interface SmtpSession {
  cmd(c: string): Promise<string>;
  read(): Promise<string>;
  writeAll(data: string): Promise<void>;
  close(): void;
}

/** Abre la conexión y deja la sesión lista para AUTH (TLS ya negociado). */
async function openSmtpSession(
  host: string, port: number, budget: (cap: number) => number, onLog?: (c: string, r: string) => void,
): Promise<{ s: SmtpSession | null; error?: string }> {
  const bad = await assertPublicMailHost(host, port);
  if (bad) return { s: null, error: bad };
  const enc = new TextEncoder();
  const connecting: Promise<RtConn> = port === 465
    ? rt().connectTls({ hostname: host, port })
    : rt().connect({ hostname: host, port });
  // Si el plazo vence y la conexión llega después, se cierra en cuanto llegue.
  let gaveUp = false;
  connecting.then((c) => { if (gaveUp) { try { c.close(); } catch { /* */ } } }, () => {});
  let conn: RtConn;
  try { conn = await withTimeout(connecting, budget(15_000), "connect"); } catch (e) { gaveUp = true; throw e; }
  const read = () => readSmtpReply(() => conn, { readMs: 20_000, budget });
  const s: SmtpSession = {
    read,
    cmd: async (c: string) => {
      await withTimeout(conn.write(enc.encode(c + "\r\n")), budget(20_000), "write");
      const r = (await read()).trim();
      onLog?.(c.split(" ")[0], r);
      return r;
    },
    // write() puede ser PARCIAL en buffers grandes (un PDF de 240 KB se truncó en silencio una vez).
    writeAll: (data: string) => withTimeout((async () => {
      const bytes = enc.encode(data);
      let off = 0;
      while (off < bytes.length) off += await conn.write(bytes.subarray(off));
    })(), budget(30_000), "write body"),
    close: () => { try { conn.close(); } catch { /* ya cerrada */ } },
  };
  try {
    const greet = (await read()).trim();
    onLog?.("GREET", greet);
    if (port !== 465) {
      const ehlo = await s.cmd("EHLO onepulso");
      if (!/STARTTLS/i.test(ehlo)) { s.close(); return { s: null, error: "El servidor no ofrece conexión cifrada (TLS); usa el puerto 465 o 587 con STARTTLS" }; }
      const st = await s.cmd("STARTTLS");
      if (!st.startsWith("220")) { s.close(); return { s: null, error: `STARTTLS failed: ${sanitizeServerText(st, 80)}` }; }
      conn = await withTimeout(rt().startTls(conn, { hostname: host }), budget(15_000), "STARTTLS");
    }
    await s.cmd("EHLO onepulso");
    return { s };
  } catch (e) {
    s.close();
    throw e;
  }
}

export async function sendSmtpReply(
  host: string, port: number, username: string, password: string,
  from: string, to: string, subject: string, body: string,
  inReplyTo: string | null, references: string | null,
  fromName: string | null
): Promise<{ ok: boolean; error?: string }> {
  // Guardián de enlaces (06-10-2026): nada sale con un enlace que IONOS enruta por su servidor en Spamhaus.
  body = fixBlockedLinks(body).text;
  let sess: SmtpSession | null = null;
  try {
    const budget = makeBudget(SMTP_BUDGET_MS);
    const opened = await openSmtpSession(host, port, budget);
    if (!opened.s) return { ok: false, error: opened.error };
    const s = (sess = opened.s);
    const code2 = (r: string) => /^2\d\d/.test(r);

    const auth = await s.cmd(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) return { ok: false, error: `Auth failed: ${sanitizeServerText(auth, 80)}` };
    const mf = await s.cmd(`MAIL FROM:<${from}>`);
    if (!code2(mf)) return { ok: false, error: `MAIL FROM: ${sanitizeServerText(mf, 80)}` };
    const rc = await s.cmd(`RCPT TO:<${to}>`);
    if (!code2(rc)) return { ok: false, error: `RCPT: ${sanitizeServerText(rc, 80)}` };
    const dt = await s.cmd("DATA");
    if (!dt.startsWith("354")) return { ok: false, error: `DATA: ${sanitizeServerText(dt, 80)}` };

    const raw = buildMimeMessage({
      from, fromName, to, subject, html: body,
      inReplyTo, references, replyTo: from,
    });
    await s.writeAll(`${dotStuff(raw)}\r\n.\r\n`);
    const fin = (await s.read()).trim();
    try { await s.cmd("QUIT"); } catch { /* */ }
    return code2(fin) ? { ok: true } : { ok: false, error: `Send failed: ${sanitizeServerText(fin, 80)}` };
  } catch (e) {
    return { ok: false, error: `SMTP error: ${sanitizeServerText((e as Error)?.message || e, 160)}` };
  } finally {
    sess?.close();
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
  const { host, port, username, password, from, fromName, to, subject, attachments } = opts;
  // Guardián de enlaces (06-10-2026): nada sale con un enlace que IONOS enruta por su servidor en Spamhaus.
  const body = fixBlockedLinks(opts.body).text;
  const visibleFrom = opts.headerFrom || from;
  const log: string[] = [];
  let sess: SmtpSession | null = null;
  try {
    const budget = makeBudget(SMTP_BUDGET_MS);
    const opened = await openSmtpSession(host, port, budget, (c, r) => log.push(c + " => " + r.slice(0, 60)));
    if (!opened.s) return { ok: false, error: opened.error, transcript: log };
    const s = (sess = opened.s);
    const code2 = (r: string) => /^2\d\d/.test(r);

    const auth = await s.cmd(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) return { ok: false, error: `Auth: ${sanitizeServerText(auth, 80)}`, transcript: log };
    const mf = await s.cmd(`MAIL FROM:<${from}>`);
    if (!code2(mf)) return { ok: false, error: `MAIL FROM: ${sanitizeServerText(mf, 80)}`, transcript: log };
    const rc = await s.cmd(`RCPT TO:<${to}>`);
    if (!code2(rc)) return { ok: false, error: `RCPT: ${sanitizeServerText(rc, 80)}`, transcript: log };
    const dt = await s.cmd("DATA");
    if (!dt.startsWith("354")) return { ok: false, error: `DATA: ${sanitizeServerText(dt, 80)}`, transcript: log };

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
    await s.writeAll(`${dotStuff(raw)}\r\n.\r\n`);
    const fin = (await s.read()).trim();
    try { await s.cmd("QUIT"); } catch { /* */ }
    return code2(fin) ? { ok: true } : { ok: false, error: `Envío: ${sanitizeServerText(fin, 80)}`, transcript: log };
  } catch (e) { return { ok: false, error: sanitizeServerText((e as Error)?.message || e, 160), transcript: log }; }
  finally { sess?.close(); }
}
