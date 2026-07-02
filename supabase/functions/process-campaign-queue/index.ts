import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helpers ───

function replaceVariables(text: string, fields: Record<string, string>): string {
  // Normalize key: lowercase + strip underscores so first_name == firstName == FirstName
  const norm = (s: string) => s.toLowerCase().replace(/[_\-\s]+/g, "");
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    normalized[norm(k)] = v;
  }
  return text.replace(/\{\{\s*([\w\-\s]+?)\s*\}\}/g, (match, key) => {
    return fields[key] ?? normalized[norm(key)] ?? match;
  });
}

function textToHtml(text: string): string {
  if (/<(p|div|br|table|tr|td|span|a|img|ul|ol|li)\b/i.test(text)) return text;
  return text
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function hasExplicitHtml(text: string): boolean {
  return /<(p|div|br|table|tr|td|span|a|img|ul|ol|li)\b/i.test(text);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── Unsubscribe token (HMAC-signed, no DB lookup needed) ───
// Identifies (user, email) so the public /unsubscribe function can suppress them.
// Signed with the service-role key (never exposed; only the HMAC output travels).
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function makeUnsubToken(userId: string, email: string, secret: string): Promise<string> {
  const payload = b64url(`${userId}:${email.toLowerCase()}`);
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

function getDayAbbr(date: Date, tz: string): string {
  try {
    return date.toLocaleString("en-US", { timeZone: tz, weekday: "short" }).toLowerCase().slice(0, 3);
  } catch {
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return days[date.getUTCDay()];
  }
}

function randomString(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";
  for (let i = 0; i < length; i++) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

// Encode body as Quoted-Printable (RFC 2045) — universal compatibility, less spam-flagging
// than 8bit, supports any UTF-8 content. Used by Gmail, Outlook, Apple Mail.
function quotedPrintableEncode(input: string): string {
  const bytes = new TextEncoder().encode(input.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  let out = "";
  let lineLen = 0;
  const flush = (chunk: string) => {
    // Soft-wrap at 76 chars per RFC 2045
    if (lineLen + chunk.length > 75) {
      out += "=\r\n";
      lineLen = 0;
    }
    out += chunk;
    lineLen += chunk.length;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a) {
      out += "\r\n";
      lineLen = 0;
      continue;
    }
    // Printable ASCII except '=' and trailing whitespace handling
    if (b === 0x09 || (b >= 0x20 && b <= 0x7e && b !== 0x3d)) {
      flush(String.fromCharCode(b));
    } else {
      flush("=" + b.toString(16).toUpperCase().padStart(2, "0"));
    }
  }
  // Trailing whitespace on a line must be encoded
  return out.replace(/[ \t]+(\r\n|$)/g, (m) => {
    const ws = m.replace(/\r\n$/, "");
    const enc = Array.from(ws)
      .map((c) => "=" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))
      .join("");
    return enc + (m.endsWith("\r\n") ? "\r\n" : "");
  });
}

// Generate a Feedback-ID header for Gmail Postmaster Tools campaign tracking.
// Format: <campaign-id>:<customer-id>:<mail-type>:<sender-id>
function buildFeedbackId(campaignId: string | null, userId: string, fromDomain: string): string {
  const c = (campaignId || "tx").replace(/[^a-z0-9-]/gi, "").slice(0, 16) || "tx";
  const u = userId.replace(/[^a-z0-9-]/gi, "").slice(0, 12);
  const d = fromDomain.replace(/[^a-z0-9.-]/gi, "").slice(0, 32);
  return `${c}:${u}:onepulso:${d}`;
}


function formatSmtpDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function normalizeSmtpEndpoint(host: string, port: number): { host: string; port: number } {
  const normalizedHost = host.trim().toLowerCase();

  if (/(^|\.)smtp\.gmail\.com$|(^|\.)gmail\.com$|googlemail/.test(normalizedHost)) {
    return { host: "smtp.gmail.com", port: port === 465 ? 465 : 587 };
  }

  if (/office365|outlook|hotmail|live\.com|microsoft/.test(normalizedHost)) {
    return { host: "smtp.office365.com", port: 587 };
  }

  return { host: host.trim(), port };
}

function generateMessageId(domain: string): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${(now.getUTCMonth() + 1).toString().padStart(2, "0")}${now.getUTCDate().toString().padStart(2, "0")}.${now.getUTCHours().toString().padStart(2, "0")}${now.getUTCMinutes().toString().padStart(2, "0")}${now.getUTCSeconds().toString().padStart(2, "0")}`;
  return `<${stamp}.${randomString(10)}.${randomString(6)}@${domain}>`;
}

// Deterministic Message-ID for campaign emails — allows follow-ups to reference
// the first email's ID without needing to store/retrieve it from DB
function campaignMessageId(campaignId: string, leadId: string, stepIndex: number, domain: string): string {
  // Create a short hash from campaign+lead+step to keep it deterministic
  const raw = `${campaignId}:${leadId}:${stepIndex}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `<camp.${hex}.s${stepIndex}@${domain}>`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_m, href, text) => {
      const label = stripHtml(text || "").trim();
      return label ? `${label} (${href})` : href;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeUrlsAndTracking(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/\b(?:utm_[a-z_]+|fbclid|gclid)=[^\s)]+/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapPlainTextNaturally(text: string, targetWidth = 68 + Math.floor(Math.random() * 11)): string {
  // Preserve EVERY line break the copy already has (greeting, each sentence/
  // paragraph, sign-off, signature). We only soft-wrap lines that are genuinely
  // too long for a mail client. The old version split on \n\n only and flattened
  // single \n into spaces — which turned a nicely structured email into one giant
  // run-on blob. Single \n is an intentional line break and must be kept.
  const wrapLong = (line: string): string => {
    const t = line.replace(/[ \t]+/g, " ").trim();
    if (t.length <= targetWidth) return t;
    const words = t.split(" ").filter(Boolean);
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (cand.length > targetWidth && cur) { out.push(cur); cur = w; }
      else cur = cand;
    }
    if (cur) out.push(cur);
    return out.join("\n");
  };
  return text
    .split("\n")
    .map(wrapLong)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // collapse runs of blank lines to at most one
    .trim();
}

function sanitizeHtmlForDelivery(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|video|audio|canvas)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(img|picture|source)[^>]*>/gi, "")
    // Keep inline `style` (margin/line-height/etc.) so personalized HTML renders with
    // its intended paragraph spacing. Only strip fingerprint-y attributes.
    .replace(/\s(?:class|id|data-[\w-]+|width|height|role|dir)=("[^"]*"|'[^']*')/gi, "")
    .replace(/<a[^>]*href=("[^"]*"|'[^']*')[^>]*>([\s\S]*?)<\/a>/gi, "<a href=$1>$2</a>")
    .replace(/<(\/?)div\b/gi, "<$1p")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Calculates the spacing between sends for a campaign so that each account
// reaches its daily target within the configured sending window.
//
//   target_sends_per_day = numAccounts * dailyCapPerAccount
//   window_seconds = (send_end_hour - send_start_hour) * 3600
//   ideal_delay = window_seconds / target_sends_per_day
//
// Then we clamp to [30s, 600s] for safety and add ±25% jitter for naturalness.
function calculateHumanizedDelayMs(
  numAccounts: number = 1,
  dailyCapPerAccount: number = 30,
  windowHours: number = 9,
): number {
  const targetSendsPerDay = Math.max(1, numAccounts * dailyCapPerAccount);
  const windowSeconds = Math.max(1, windowHours * 3600);
  let idealDelaySec = windowSeconds / targetSendsPerDay;

  // Clamp: never faster than 30s (deliverability), never slower than 600s.
  idealDelaySec = Math.max(30, Math.min(600, idealDelaySec));

  // ±25% jitter so the cadence doesn't look mechanical.
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(idealDelaySec * jitter * 1000);
}

// Dot-stuff message content per RFC 5321 §4.5.2
function dotStuff(content: string): string {
  return content.replace(/\r\n\./g, "\r\n..");
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function wrapMimeBase64(value: string): string {
  const encoded = toBase64Utf8(value);
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function normalizeMimeText(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function encodeMimeHeader(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  return /[^\x20-\x7E]/.test(normalized)
    ? `=?UTF-8?B?${toBase64Utf8(normalized)}?=`
    : normalized;
}

function formatMailbox(name: string | undefined, email: string): string {
  if (!name?.trim()) return email;

  const normalized = name.replace(/\r?\n/g, " ").trim();
  const encodedName = /[^\x20-\x7E]/.test(normalized)
    ? encodeMimeHeader(normalized)
    : `"${normalized.replace(/(["\\])/g, "\\$1")}"`;

  return `${encodedName} <${email}>`;
}

// ─── Error classification (Instantly-style) ───
// Returns: 'hard' = permanent failure (do not retry, mark as bounced)
//          'soft' = temporary (retry later, keep as failed)
//          'auth' = credential problem (mark account disconnected)
//          'rate' = rate-limited (backoff this account)
function classifySmtpError(err: string): 'hard' | 'soft' | 'auth' | 'rate' | 'unknown' {
  const e = (err || '').toLowerCase();
  // TRANSIENT first — many of these mention "auth" but are NOT credential failures
  // and must NOT disconnect the account (that froze all its leads forever). E.g.
  // "Authentication temporarily unavailable", "too many auth attempts", greylisting.
  if (/421|450|451|452|throttle|rate limit|too many|temporar|try again|greylist|exceeded|4\.7\./i.test(e)) return 'rate';
  // "530 must issue STARTTLS" is a config/handshake issue, not bad credentials.
  if (/must issue a? ?starttls|starttls (command )?first|530 5\.7\.0/i.test(e)) return 'soft';
  // PERMANENT credential failures ONLY → disconnect the account.
  if (/535|534|authentication failed|invalid login|bad credentials|invalid credentials|password (in)?correct|auth\w* (failed|invalid|denied|rejected)/i.test(e)) return 'auth';
  // Hard bounces — recipient permanently invalid
  if (/550|551|553|554|5\.1\.[0-9]|5\.7\.1|mailbox unavailable|user unknown|does not exist|no such user|invalid recipient|address rejected|recipient rejected/i.test(e)) return 'hard';
  // Connection / TLS / DNS — soft errors
  if (/connection|timeout|timed out|econnrefused|enotfound|tls|certificate|network|reset/i.test(e)) return 'soft';
  return 'unknown';
}

// Promise with timeout — prevents hung connections from killing the cron
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// ─── Instantly sender (preferred when account exists in Instantly workspace) ───
//
// Instantly API v2 reference:
//   - GET  /api/v2/accounts?search=<email>  → list accounts (use to verify the
//     sending mailbox is connected in the user's Instantly workspace)
//   - POST /api/v2/inbox/emails/reply       → send a reply via a connected account
//   - POST /api/v2/inbox/emails             → send a fresh outbound email via a
//     connected account (uses Instantly's own SMTP under the hood)
//
// We cache the "account exists in Instantly" check per worker run so that a
// single tick doesn't make hundreds of redundant API calls (this caused
// WORKER_RESOURCE_LIMIT crashes previously).

const INSTANTLY_API_KEY = Deno.env.get("INSTANTLY_API_KEY") || "";
const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

// Cache of email -> exists for the duration of this run
const _instantlyAccountCache = new Map<string, boolean>();
// Soft circuit-breaker: if Instantly returns 5xx / network error N times in a
// row, stop trying for the rest of this tick and fall back to SMTP. Prevents
// CPU exhaustion when Instantly is down.
let _instantlyConsecutiveFailures = 0;
const INSTANTLY_FAIL_THRESHOLD = 3;

function instantlyDisabledForRun(): boolean {
  return _instantlyConsecutiveFailures >= INSTANTLY_FAIL_THRESHOLD;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function instantlyAccountExists(email: string): Promise<boolean> {
  if (!INSTANTLY_API_KEY) return false;
  if (instantlyDisabledForRun()) return false;
  const key = email.toLowerCase();
  const cached = _instantlyAccountCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const r = await fetchWithTimeout(
      `${INSTANTLY_BASE}/accounts?search=${encodeURIComponent(email)}&limit=1`,
      { headers: { Authorization: `Bearer ${INSTANTLY_API_KEY}` } },
      6000,
    );
    if (!r.ok) {
      await r.text().catch(() => {});
      if (r.status >= 500) _instantlyConsecutiveFailures++;
      _instantlyAccountCache.set(key, false);
      return false;
    }
    _instantlyConsecutiveFailures = 0;
    const json: any = await r.json().catch(() => null);
    const items: any[] = Array.isArray(json?.items) ? json.items : Array.isArray(json?.data) ? json.data : [];
    const exists = items.some((it) => String(it?.email || "").toLowerCase() === key);
    _instantlyAccountCache.set(key, exists);
    return exists;
  } catch {
    _instantlyConsecutiveFailures++;
    _instantlyAccountCache.set(key, false);
    return false;
  }
}

async function sendInstantlyEmail(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  opts: { inReplyTo?: string; references?: string } = {}
): Promise<{ ok: boolean; error?: string; messageId?: string; errorClass?: string }> {
  if (!INSTANTLY_API_KEY) return { ok: false, error: "INSTANTLY_API_KEY missing", errorClass: "auth" };
  if (instantlyDisabledForRun()) {
    return { ok: false, error: "Instantly disabled for this run (too many failures)", errorClass: "soft" };
  }

  const isReply = !!opts.inReplyTo;
  const endpoint = isReply
    ? `${INSTANTLY_BASE}/inbox/emails/reply`
    : `${INSTANTLY_BASE}/inbox/emails`;

  const payload: Record<string, unknown> = {
    eaccount: from,
    subject,
    body: { html: htmlBody },
    to: [{ email: to }],
  };
  if (opts.inReplyTo) payload.reply_to_uuid = opts.inReplyTo; // tolerated; primary headers preserved
  if (opts.inReplyTo) payload.in_reply_to = opts.inReplyTo;
  if (opts.references) payload.references = opts.references;

  try {
    const r = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INSTANTLY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, 10000);

    const txt = await r.text().catch(() => "");
    if (!r.ok) {
      const cls = r.status === 401 || r.status === 403
        ? "auth"
        : r.status >= 500
          ? "soft"
          : "hard";
      if (cls === "soft") _instantlyConsecutiveFailures++;
      return { ok: false, error: `Instantly ${r.status}: ${txt.slice(0, 300)}`, errorClass: cls };
    }
    _instantlyConsecutiveFailures = 0;
    let mid: string | undefined;
    try {
      const j = JSON.parse(txt);
      mid = j?.message_id || j?.id || j?.uuid;
    } catch { /* ignore */ }
    return { ok: true, messageId: mid };
  } catch (e: any) {
    _instantlyConsecutiveFailures++;
    return { ok: false, error: `Instantly error: ${e?.message || e}`, errorClass: "soft" };
  }
}


// ─── SMTP sender with full deliverability headers ───

async function sendSmtpEmail(
  host: string, port: number, username: string, password: string,
  from: string, to: string, subject: string, htmlBody: string,
  opts: {
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    firstName?: string;
    lastName?: string;
    signatureHtml?: string;
    textOnly?: boolean;
    userId?: string;
    campaignId?: string | null;
    unsubscribeUrl?: string;
  } = {}
): Promise<{ ok: boolean; error?: string; messageId?: string; errorClass?: string }> {
  try {
    const endpoint = normalizeSmtpEndpoint(host, port);
    const fromDomain = from.split("@")[1] || "mail.local";
    const msgId = opts.messageId || generateMessageId(fromDomain);
    const isReply = !!opts.inReplyTo;

    const normalizedBody = opts.textOnly ? htmlBody : sanitizeHtmlForDelivery(htmlBody);
    const signatureHtml = !opts.textOnly ? sanitizeHtmlForDelivery(opts.signatureHtml?.trim() || "") : "";
    const fullHtml = !opts.textOnly && signatureHtml
      ? `${normalizedBody}\n${signatureHtml}`
      : normalizedBody;

    const plainSignature = signatureHtml
      ? wrapPlainTextNaturally(htmlToPlainText(signatureHtml))
      : "";
    const plainText = [
      opts.textOnly ? wrapPlainTextNaturally(removeUrlsAndTracking(htmlToPlainText(normalizedBody))) : wrapPlainTextNaturally(stripHtml(fullHtml)),
      // No "--" signature delimiter: Gmail treats it as a sig boundary and collapses
      // everything after it into the "•••" (show trimmed content) pill.
      plainSignature || "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const displayParts = [opts.firstName, opts.lastName].filter(Boolean);
    const displayName = displayParts.length > 0 ? displayParts.join(" ") : undefined;
    const fromHeader = formatMailbox(displayName, from);
    const encodedSubject = encodeMimeHeader(subject);
    // Opt-out link (only when the campaign enabled it). Added AFTER URL stripping so
    // it survives the text-only sanitizer.
    const unsubText = opts.unsubscribeUrl
      ? `\n\nSi no deseas recibir más correos, date de baja aquí: ${opts.unsubscribeUrl}`
      : "";
    const unsubHtml = opts.unsubscribeUrl
      ? `<p style="font-size:12px;color:#888;margin-top:16px">Si no deseas recibir más correos, <a href="${opts.unsubscribeUrl}">date de baja aquí</a>.</p>`
      : "";
    const plainTextPart = normalizeMimeText(plainText + unsubText);
    const htmlPart = normalizeMimeText(fullHtml + unsubHtml);

    // Human-looking boundary (Outlook/Apple Mail style) — avoids bot fingerprints
    const boundary = `--==_mimepart_${randomString(16)}_${randomString(12)}`;
    const dateHeader = formatSmtpDate(new Date());

    // ─── Minimal mailbox-style headers (Outlook/Apple Mail/Thunderbird look) ───
    // Only the headers a real desktop/web mailbox would send. NO List-Unsubscribe,
    // NO Feedback-ID, NO X-* — those headers are the #1 cold-email fingerprint
    // when the domain is not pre-warmed and signed by an ESP. The IONOS server
    // already adds DKIM/Authentication-Results on the way out.
    const headers: string[] = [
      `MIME-Version: 1.0`,
      `Date: ${dateHeader}`,
      `Message-ID: ${msgId}`,
      `Subject: ${encodedSubject}`,
      `From: ${fromHeader}`,
      `To: ${to}`,
    ];

    if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    if (opts.references) headers.push(`References: ${opts.references}`);
    // One-click unsubscribe (RFC 8058) — only when the campaign enabled opt-out.
    if (opts.unsubscribeUrl) {
      headers.push(`List-Unsubscribe: <${opts.unsubscribeUrl}>`);
      headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
    }


    let body: string;
    if (opts.textOnly) {
      headers.push("Content-Type: text/plain; charset=UTF-8");
      headers.push("Content-Transfer-Encoding: quoted-printable");
      body = `\r\n${quotedPrintableEncode(plainTextPart)}`;
    } else {
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      const qpText = quotedPrintableEncode(plainTextPart);
      const qpHtml = quotedPrintableEncode(htmlPart);
      body = `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qpText}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qpHtml}\r\n--${boundary}--`;
    }


    // Dot-stuff content then append DATA terminator
    const rawContent = headers.join('\r\n') + '\r\n' + body;
    const fullMessage = dotStuff(rawContent) + '\r\n.\r\n';

    // Connect with 15s timeout (Instantly-style aggressive timeouts)
    let conn: Deno.Conn;
    if (endpoint.port === 465) {
      conn = await withTimeout(Deno.connectTls({ hostname: endpoint.host, port: endpoint.port }), 15000, `connect ${endpoint.host}:${endpoint.port}`);
    } else {
      conn = await withTimeout(Deno.connect({ hostname: endpoint.host, port: endpoint.port }), 15000, `connect ${endpoint.host}:${endpoint.port}`);
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Read a complete SMTP response, handling multi-line responses. Wrapped in a
    // hard timeout — Deno's conn.read() blocks forever if the server accepts the
    // connection but then goes silent (rate-limited, mid-negotiation stall, etc.).
    // Without this, ONE unresponsive account hangs the whole cron invocation until
    // the platform kills it — and since that's an external kill (not a JS throw),
    // the job lock is never released, stalling ALL sending for up to its 10-min TTL.
    const readResponseRaw = async (): Promise<string> => {
      let result = '';
      while (true) {
        const buf = new Uint8Array(4096);
        const n = await conn.read(buf);
        if (!n) break;
        result += decoder.decode(buf.subarray(0, n));
        const lines = result.split('\r\n').filter(l => l.length > 0);
        if (lines.length === 0) continue;
        const last = lines[lines.length - 1];
        if (/^\d{3}[ ]/.test(last) || /^\d{3}$/.test(last)) break;
      }
      return result;
    };
    const readResponse = (): Promise<string> => withTimeout(readResponseRaw(), 12000, `SMTP read ${endpoint.host}:${endpoint.port}`);

    const send = async (cmd: string): Promise<string> => {
      await conn.write(encoder.encode(cmd + "\r\n"));
      return await readResponse();
    };

    const writeRaw = async (data: string): Promise<string> => {
      const encoded = encoder.encode(data);
      let written = 0;
      while (written < encoded.length) {
        const n = await conn.write(encoded.subarray(written));
        written += n;
      }
      return await readResponse();
    };

    // Greeting
    await readResponse();

    // EHLO with the SMTP server hostname — this is what real mail clients do
    // (IONOS, Gmail, Outlook). Using the sender domain here can cause some
    // servers to reject as "EHLO doesn't match HELO PTR".
    const ehloHost = endpoint.host;

    if (endpoint.port !== 465) {
      const resp = await send(`EHLO ${ehloHost}`);
      if (!/STARTTLS/i.test(resp)) {
        try { await send("QUIT"); } catch {}
        try { conn.close(); } catch {}
        return { ok: false, error: `Server does not advertise STARTTLS: ${resp.trim()}`, errorClass: "soft" };
      }

        await conn.write(encoder.encode("STARTTLS\r\n"));
        const startTlsResp = await readResponse();
        if (!startTlsResp.startsWith("220")) {
          try { conn.close(); } catch {}
          return { ok: false, error: `STARTTLS failed: ${startTlsResp.trim()}`, errorClass: classifySmtpError(startTlsResp) };
        }

        conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: endpoint.host });

        const readTlsRaw = async (): Promise<string> => {
          let result = '';
          while (true) {
            const buf = new Uint8Array(4096);
            const n = await conn.read(buf);
            if (!n) break;
            result += decoder.decode(buf.subarray(0, n));
            const lines = result.split('\r\n').filter(l => l.length > 0);
            if (lines.length === 0) continue;
            const last = lines[lines.length - 1];
            if (/^\d{3}[ ]/.test(last) || /^\d{3}$/.test(last)) break;
          }
          return result;
        };
        const readTls = (): Promise<string> => withTimeout(readTlsRaw(), 12000, `SMTP read (TLS) ${endpoint.host}:${endpoint.port}`);

        const sendTls = async (cmd: string): Promise<string> => {
          await conn.write(encoder.encode(cmd + "\r\n"));
          return await readTls();
        };

        const writeRawTls = async (data: string): Promise<string> => {
          const encoded = encoder.encode(data);
          let written = 0;
          while (written < encoded.length) {
            const n = await conn.write(encoded.subarray(written));
            written += n;
          }
          return await readTls();
        };

        const tlsEhloResp = await sendTls(`EHLO ${ehloHost}`);
        if (!tlsEhloResp.startsWith("250")) {
          try { conn.close(); } catch {}
          return { ok: false, error: `EHLO after STARTTLS failed: ${tlsEhloResp.trim()}`, errorClass: classifySmtpError(tlsEhloResp) };
        }
        const authLoginResp = await sendTls("AUTH LOGIN");
        if (!authLoginResp.startsWith("334")) {
          try { conn.close(); } catch {}
          return { ok: false, error: `Auth LOGIN failed: ${authLoginResp.trim()}`, errorClass: classifySmtpError(authLoginResp) };
        }
        const authUserResp = await sendTls(toBase64Utf8(username));
        if (!authUserResp.startsWith("334")) {
          try { conn.close(); } catch {}
          return { ok: false, error: `Auth username failed: ${authUserResp.trim()}`, errorClass: classifySmtpError(authUserResp) };
        }
        const authResp = await sendTls(toBase64Utf8(password));
        if (!authResp.startsWith("235")) {
          try { conn.close(); } catch {}
          return { ok: false, error: `Auth failed: ${authResp.trim()}`, errorClass: classifySmtpError(authResp) };
        }

        await sendTls(`MAIL FROM:<${from}>`);
        const rcptResp = await sendTls(`RCPT TO:<${to}>`);
        if (!rcptResp.startsWith("250")) {
          try { await sendTls("QUIT"); } catch {}
          try { conn.close(); } catch {}
          return { ok: false, error: `Recipient rejected: ${rcptResp.trim()}`, errorClass: classifySmtpError(rcptResp) };
        }

        await sendTls("DATA");
        let dataResp: string;
        try {
          dataResp = await writeRawTls(fullMessage);
        } catch (e: any) {
          try { conn.close(); } catch {}
          // The full message (incl. terminating "\r\n.\r\n") was already written; only
          // the ACK read failed/timed out. The server may have queued it → treat as
          // POSSIBLY SENT (at-most-once): advance the step, never retry, so the
          // prospect is not emailed twice.
          return { ok: false, error: `Send unconfirmed post-DATA: ${e?.message || e}`, errorClass: "sent_unconfirmed" };
        }
        const dLinesTls = dataResp.trim().split(/\r?\n/);
        const sent = /^250[ -]/.test((dLinesTls[dLinesTls.length - 1] || "").trim());
        try { await sendTls("QUIT"); } catch {}
        try { conn.close(); } catch {}
        return sent
          ? { ok: true, messageId: msgId }
          : { ok: false, error: `Send failed: ${dataResp.trim()}`, errorClass: classifySmtpError(dataResp) };
    }

    await send(`EHLO ${ehloHost}`);
    const authLoginResp = await send("AUTH LOGIN");
    if (!authLoginResp.startsWith("334")) {
      try { conn.close(); } catch {}
      return { ok: false, error: `Auth LOGIN failed: ${authLoginResp.trim()}`, errorClass: classifySmtpError(authLoginResp) };
    }
    const authUserResp = await send(toBase64Utf8(username));
    if (!authUserResp.startsWith("334")) {
      try { conn.close(); } catch {}
      return { ok: false, error: `Auth username failed: ${authUserResp.trim()}`, errorClass: classifySmtpError(authUserResp) };
    }
    const authResp = await send(toBase64Utf8(password));
    if (!authResp.startsWith("235")) {
      try { conn.close(); } catch {}
      return { ok: false, error: `Auth failed: ${authResp.trim()}`, errorClass: classifySmtpError(authResp) };
    }

    await send(`MAIL FROM:<${from}>`);
    const rcptResp = await send(`RCPT TO:<${to}>`);
    if (!rcptResp.startsWith("250")) {
      try { await send("QUIT"); } catch {}
      try { conn.close(); } catch {}
      return { ok: false, error: `Recipient rejected: ${rcptResp.trim()}`, errorClass: classifySmtpError(rcptResp) };
    }

    await send("DATA");
    let dataResp: string;
    try {
      dataResp = await writeRaw(fullMessage);
    } catch (e: any) {
      try { conn.close(); } catch {}
      // Body already fully written; ACK read failed/timed out → POSSIBLY SENT
      // (at-most-once): advance the step, never retry (avoids a duplicate email).
      return { ok: false, error: `Send unconfirmed post-DATA: ${e?.message || e}`, errorClass: "sent_unconfirmed" };
    }
    const dLines = dataResp.trim().split(/\r?\n/);
    const sent = /^250[ -]/.test((dLines[dLines.length - 1] || "").trim());
    try { await send("QUIT"); } catch {}
    try { conn.close(); } catch {}
    return sent
      ? { ok: true, messageId: msgId }
      : { ok: false, error: `Send failed: ${dataResp.trim()}`, errorClass: classifySmtpError(dataResp) };
  } catch (e) {
    const msg = e?.message || String(e);
    return { ok: false, error: `SMTP error: ${msg}`, errorClass: classifySmtpError(msg) };
  }
}

// ─── Main handler ───

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ─── Global lock: only ONE queue run at a time ───
    // Stops overlapping cron ticks from double-sending follow-ups or overshooting
    // limits when a run takes longer than the cron interval (heavy multi-campaign load).
    // FAIL-CLOSED: never run without confirming we hold the lock. Two concurrent runs
    // would double-send follow-ups (which have no per-lead claim, unlike step 0). If
    // the lock RPC errors we skip this tick — the next cron tick (2 min) retries; a
    // 2-minute delay is far cheaper than a duplicate email to a prospect.
    const LOCK_NAME = "process-campaign-queue";
    const { data: gotLock, error: lockErr } = await adminClient.rpc("acquire_job_lock", {
      p_name: LOCK_NAME,
      p_ttl_seconds: 600,
    });
    if (lockErr || gotLock === false) {
      return new Response(JSON.stringify({ success: true, skipped: lockErr ? "lock_error" : "already_running" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // We hold the lock (gotLock === true) — safe to release it at the end.
    const releaseLock = async () => {
      try { await adminClient.rpc("release_job_lock", { p_name: LOCK_NAME }); } catch (_) { /* TTL will free it */ }
    };

    try {
    // FAIRNESS: order active campaigns by least-recently-served first. Without an
    // ORDER BY they came back in arbitrary heap order, so the same campaign(s)
    // always went first and ate the whole per-run send budget — starving other
    // users' campaigns ("una campaña de otro usuario tira más"). Serving the
    // campaign with the oldest last_campaign_send_at first rotates fairly across
    // every campaign and every user, tick after tick.
    const { data: campaigns, error: campError } = await adminClient
      .from("campaigns")
      .select("*")
      .eq("status", "active")
      .order("last_campaign_send_at", { ascending: true, nullsFirst: true });

    if (campError || !campaigns) {
      return new Response(JSON.stringify({ error: campError?.message || "No campaigns" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalSent = 0;
    let totalSkipped = 0;
    let newSentTotal = 0;
    let followupsSentTotal = 0;

    // Hard cap on real SMTP sends attempted in a SINGLE invocation, across every
    // campaign. Each send is a full synchronous network round-trip (connect + TLS +
    // AUTH + MAIL FROM + RCPT TO + DATA), realistically 1-5s even when everything
    // goes right. With many eligible accounts (e.g. right after activating a brand
    // new campaign, when every account has no last_send_at yet and all are eligible
    // at once), trying them all in one run reliably blows past the edge runtime's
    // execution budget (WORKER_RESOURCE_LIMIT) — killing the invocation mid-flight,
    // wasting the in-flight send, and leaving the job lock stuck until its TTL
    // expires. Capping keeps every run comfortably fast; the cron fires every 1-2
    // min, so throughput is unaffected — the same volume just spreads over more,
    // safer ticks instead of a single risky one.
    const MAX_SENDS_PER_INVOCATION = 10;
    // Counts every real SMTP attempt (success AND failure/timeout). Capping on
    // this — not just successful sends — is what actually bounds worst-case
    // wall-clock: a string of failing/hung accounts would never trip a
    // successes-only counter, but each attempt still costs up to ~15s.
    let sendAttemptsThisRun = 0;

    // ═══ Cross-campaign account coordination (shared across ALL campaigns in
    // this invocation) ═══
    // These maps are declared ONCE here, not per campaign, so the SAME mailbox
    // used by two different campaigns is coordinated: it can't send twice in the
    // same tick, and its 6–9 min cooldown / daily cap are honoured no matter which
    // campaign it belongs to. (The account row's last_send_at + sent_today are the
    // cross-TICK source of truth; these maps cover the same-tick case.)
    const accountSendsThisTick: Record<string, number> = {};
    const accountCooldownMs: Record<string, number> = {};
    const MIN_GAP_BETWEEN_SENDS_MS = 1500; // tiny natural pause between sends inside a tick

    for (const campaign of campaigns) {
      if (sendAttemptsThisRun >= MAX_SENDS_PER_INVOCATION) break;
      const now = new Date();
      const tz = campaign.timezone || "UTC";

      // Check send_days
      const sendDays: string[] = (campaign as any).send_days || ["mon", "tue", "wed", "thu", "fri"];
      const currentDay = getDayAbbr(now, tz);
      if (!sendDays.includes(currentDay)) continue;

      // Check sending window
      let currentHour: number;
      let currentMinute: number;
      try {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
        currentHour = parseInt(parts.find(p => p.type === "hour")?.value || "0");
        currentMinute = parseInt(parts.find(p => p.type === "minute")?.value || "0");
      } catch {
        currentHour = now.getUTCHours();
        currentMinute = now.getUTCMinutes();
      }

      let startHour = campaign.send_start_hour ?? 9;
      let endHour = campaign.send_end_hour ?? 18;
      // Defense against an invalid window (start>=end). The gate below would ALWAYS
      // be true → the campaign stays "active" but silently never sends, and the owner
      // (who "no revisa nada") never sees it. Fall back to the default 9–18 window.
      if (!(startHour < endHour)) {
        console.warn(`Campaign "${campaign.name}" has invalid window ${startHour}-${endHour}; using default 9-18`);
        startHour = 9; endHour = 18;
      }
      if (currentHour < startHour || currentHour >= endHour) continue;

      // Minutes left until the window closes today — used to pace sends evenly
      // across the whole window instead of bursting near the start.
      const remainingWindowMinutes = Math.max(1, endHour * 60 - (currentHour * 60 + currentMinute));

      const stopOnReply = (campaign as any).stop_on_reply ?? true;

      // Get campaign accounts
      const { data: campaignAccounts } = await adminClient
        .from("campaign_accounts")
        .select("account_id")
        .eq("campaign_id", campaign.id);

      const directAccountIds = (campaignAccounts || []).map(ca => ca.account_id);

      const accountTags: string[] = (campaign as any).account_tags || [];
      let tagAccountIds: string[] = [];
      if (accountTags.length > 0) {
        const { data: tagAccounts } = await adminClient
          .from("email_accounts")
          .select("id")
          .eq("user_id", campaign.user_id)
          .eq("status", "connected")
          .overlaps("tags", accountTags);
        tagAccountIds = (tagAccounts || []).map(a => a.id);
      }

      const allAccountIds = [...new Set([...directAccountIds, ...tagAccountIds])];
      if (!allAccountIds.length) continue;

      const { data: accounts } = await adminClient
        .from("email_accounts")
        .select("*")
        .in("id", allAccountIds)
        .eq("status", "connected")
        .order("sent_today", { ascending: true });

      if (!accounts?.length) continue;

      // ═══ Per-account effective daily limit (slow ramp aware) — computed ONCE
      // per campaign per tick, not per lead. This also drives the campaign's
      // OWN daily limit below, so it grows automatically as ramp progresses day
      // by day, or as more accounts get connected/selected — no manual number
      // to keep updating by hand. ═══
      const HARD_DAILY_CAP = 30;
      let rampDaysActive = 0;
      if ((campaign as any).slow_ramp_enabled) {
        const { data: firstSent } = await adminClient
          .from("sent_emails")
          .select("sent_at")
          .eq("campaign_id", campaign.id)
          .eq("status", "sent")
          .order("sent_at", { ascending: true })
          .limit(1);
        if (firstSent && firstSent.length && firstSent[0].sent_at) {
          const startAt = new Date(firstSent[0].sent_at);
          rampDaysActive = Math.max(0, Math.floor((now.getTime() - startAt.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }

      const getEffectiveLimit = (acc: any) => {
        let limit = Math.min(acc.daily_limit ?? HARD_DAILY_CAP, HARD_DAILY_CAP);

        // Account-level slow ramp: ramps from `warmup_started_at` by warmup_increment
        // per day up to warmup_limit. Day 1 = increment, Day 2 = 2*increment, …
        if (acc.warmup_enabled && acc.warmup_started_at) {
          const startedAt = new Date(acc.warmup_started_at);
          const days = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24)));
          const inc = acc.warmup_increment || 2;
          const target = acc.warmup_limit || limit;
          const accRamp = Math.min((days + 1) * inc, target);
          limit = Math.min(limit, accRamp);
        }

        // Campaign-level slow ramp — anchored to days of ACTUAL sending (rampDaysActive),
        // so a paused/never-sent campaign stays at the starting cap (rampMax).
        if ((campaign as any).slow_ramp_enabled) {
          const rampMax = (campaign as any).slow_ramp_max || 2;
          const rampIncrement = (campaign as any).slow_ramp_increment || 2;
          const rampLimit = rampMax + rampDaysActive * rampIncrement;
          limit = Math.min(limit, rampLimit);
        }

        return limit;
      };

      // Total capacity for THIS campaign today = sum of every selected/connected
      // account's effective limit. With slow ramp this rises day by day on its
      // own; without it, this is simply (per-account daily limit) × (number of
      // accounts) — exactly the auto-calculated total the campaign should use.
      const autoAccountCapTotal = accounts.reduce((s: number, acc: any) => s + getEffectiveLimit(acc), 0);

      // NOTE: We no longer apply a global per-campaign delay. Cadence is now
      // controlled per-account (each account waits a minimum of ~60s between
      // sends inside the same tick) so EVERY account can fully use its 30/day
      // capacity within the configured sending window.
      const windowHours = Math.max(1, endHour - startHour);

      const { data: steps } = await adminClient
        .from("campaign_steps")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("step_order", { ascending: true });

      if (!steps?.length) continue;

      // BOUNDED + DETERMINISTIC lead fetch. A single unbounded query hit PostgREST's
      // implicit 1000-row cap in NON-deterministic heap order — campaigns with 7k–12k
      // pending leads only ever saw an arbitrary ~10% slice, so follow-ups (and new
      // leads) beyond the slice could be delayed for weeks. We now fetch two ordered,
      // bounded windows: overdue FOLLOW-UPS first (oldest last_sent_at), then the
      // OLDEST new leads. Deterministic order → coverage advances monotonically.
      const LEAD_FETCH_CAP = 500; // comfortably above MAX_LEADS_SCANNED_PER_CAMPAIGN (300)
      const [followupRes, newRes] = await Promise.all([
        adminClient
          .from("campaign_leads")
          .select("*, leads(*)")
          .eq("campaign_id", campaign.id)
          .eq("status", "in_progress")
          .order("last_sent_at", { ascending: true, nullsFirst: true })
          .limit(LEAD_FETCH_CAP),
        adminClient
          .from("campaign_leads")
          .select("*, leads(*)")
          .eq("campaign_id", campaign.id)
          .eq("status", "pending")
          .order("id", { ascending: true })
          .limit(LEAD_FETCH_CAP),
      ]);
      const campaignLeads = [...(followupRes.data || []), ...(newRes.data || [])];

      if (!campaignLeads?.length) continue;

      // PRIORIDAD DE ENVÍO: por defecto los follow-ups (current_step > 0) van ANTES que
      // los leads nuevos (current_step 0), para que los seguimientos nunca se retrasen.
      // El cupo que sobre tras los follow-ups se usa igualmente para leads nuevos.
      // Si la campaña tiene prioritize_new_leads = true, se invierte.
      const prioritizeNew = (campaign as any).prioritize_new_leads === true;
      campaignLeads.sort((a: any, b: any) => {
        const aNew = (a.current_step || 0) === 0;
        const bNew = (b.current_step || 0) === 0;
        if (aNew === bNew) return 0;
        if (prioritizeNew) return aNew ? -1 : 1;   // nuevos primero
        return aNew ? 1 : -1;                       // follow-ups primero (por defecto)
      });
      // Tope opcional de leads nuevos por día (si la campaña lo define).
      const maxNewLeads = Number.isFinite(Number((campaign as any).max_new_leads))
        ? Number((campaign as any).max_new_leads) : null;
      let newLeadsSentThisRun = 0;
      // Per-campaign send counter for THIS run. The daily-limit gate must use this,
      // NOT the global totalSent (which sums other campaigns' sends in the same tick
      // and would cut this campaign off early).
      let sentThisCampaign = 0;

      // Campaign daily limit check
      let todayStart: string;
      try {
        const localDateStr = now.toLocaleDateString("en-CA", { timeZone: tz });
        todayStart = new Date(`${localDateStr}T00:00:00`).toISOString();
      } catch {
        todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      }
      const { data: sentToday } = await adminClient
        .from("sent_emails")
        .select("id", { count: "exact" })
        .eq("campaign_id", campaign.id)
        .gte("sent_at", todayStart);

      const campaignSentToday = sentToday?.length || 0;
      // HARD CEILING = the LOWER of the campaign's configured daily_limit and what its
      // accounts can safely support today (autoAccountCapTotal, slow-ramp aware). The
      // old code used max(), so a campaign with daily_limit=50 whose accounts could do
      // 80 sent 80 — OVER the user's limit (CHIPSFINDER ITALIA hit 68/50). Now the
      // configured limit is respected as a true ceiling; the campaign STOPS when reached.
      const configuredLimit = (campaign.daily_limit && campaign.daily_limit > 0) ? campaign.daily_limit : autoAccountCapTotal;
      const campaignDailyLimit = Math.min(configuredLimit, autoAccountCapTotal);
      if (campaignSentToday >= campaignDailyLimit) continue;

      // ═══ Hour-based pacing (self-regulating "token bucket") ═══
      // Spread the day's quota EVENLY across the sending window instead of firing
      // it all in the first few minutes. We compute how many emails "should" have
      // gone out by now if the daily quota were spread linearly across the window,
      // and only allow the campaign to catch up to that number this run. Result:
      //   • a smooth trickle all day long (no bursts, no multi-hour silences),
      //   • fully automatic — as the hour advances the allowance grows on its own,
      //   • self-healing — if it was paused/behind, it catches back up to pace,
      //   • window-aware — nothing before send_start_hour or after send_end_hour.
      // A small floor keeps things moving right after the window opens.
      const totalWindowMinutes = Math.max(1, (endHour - startHour) * 60);
      const elapsedWindowMinutes = Math.max(0, totalWindowMinutes - remainingWindowMinutes);
      const paceFraction = Math.min(1, elapsedWindowMinutes / totalWindowMinutes);
      const expectedByNow = Math.max(4, Math.ceil(campaignDailyLimit * paceFraction));
      const paceBudgetThisRun = Math.max(0, expectedByNow - campaignSentToday);
      if (paceBudgetThisRun <= 0) continue; // on pace for this hour — nothing due yet

      // ═══ Blocklist check (load once per campaign) ═══
      const { data: blocklist } = await adminClient
        .from("blocklist")
        .select("value, entry_type")
        .eq("user_id", campaign.user_id);

      const blockedEmails = new Set<string>();
      const blockedDomains = new Set<string>();
      for (const b of blocklist || []) {
        if (b.entry_type === "domain") blockedDomains.add(b.value.toLowerCase());
        else blockedEmails.add(b.value.toLowerCase());
      }

      // ═══ Domain daily limit tracking ═══
      const domainLimitEnabled = (campaign as any).domain_limit_enabled ?? false;
      const domainDailyLimit = (campaign as any).domain_daily_limit ?? 50;
      const domainSentCounts: Record<string, number> = {};

      if (domainLimitEnabled) {
        // Count how many emails were sent to each recipient domain today
        const { data: sentTodayAll } = await adminClient
          .from("sent_emails")
          .select("to_email")
          .eq("campaign_id", campaign.id)
          .eq("status", "sent")
          .gte("sent_at", todayStart);

        for (const s of sentTodayAll || []) {
          const d = s.to_email.split("@")[1]?.toLowerCase();
          if (d) domainSentCounts[d] = (domainSentCounts[d] || 0) + 1;
        }
      }

      // ═══ Per-account cadence control ═══
      // At most ONE email per account per tick (burst protection). accountSendsThisTick
      // is invocation-global (declared above the campaign loop) so this cap also spans
      // campaigns that share the same mailbox.
      const MAX_PER_ACCOUNT_PER_TICK = 1;

      // This campaign's OWN target spacing, computed independently from ITS accounts
      // and ITS slow-ramp-aware daily quota — so every campaign paces itself and none
      // affects another. "1 email per account roughly every N minutes":
      //   quota_per_account = (sum of effective daily limits) / (number of accounts)
      //   interval_per_account = window_minutes / quota_per_account
      const quotaPerAccount = accounts.length > 0 ? autoAccountCapTotal / accounts.length : 0;
      const intervalPerAccountMin = quotaPerAccount > 0 ? Math.round(totalWindowMinutes / quotaPerAccount) : 0;
      console.log(`Campaign "${campaign.name}": ${accounts.length} accounts · ~${Math.round(quotaPerAccount)}/account/day · pace ≈ 1 email per account every ${intervalPerAccountMin} min · budget this run: ${paceBudgetThisRun}`);

      // Per-account cooldown between consecutive sends: a flat random 6–9 min.
      // Pure deliverability floor so no single mailbox bursts — the OVERALL spread
      // across the day is handled by the hour-based pace budget above. accountCooldownMs
      // is invocation-global, so a shared mailbox keeps one consistent gap across campaigns.
      const cooldownFor = (acc: any) => {
        if (!accountCooldownMs[acc.id]) {
          accountCooldownMs[acc.id] = 6 * 60_000 + Math.floor(Math.random() * 3 * 60_000); // [6m, 9m)
        }
        return accountCooldownMs[acc.id];
      };
      const isAccountOnCooldown = (acc: any) => {
        if (!acc?.last_send_at) return false;
        const last = new Date(acc.last_send_at).getTime();
        return (now.getTime() - last) < cooldownFor(acc);
      };

      // Track the last send timestamp per account already in DB (sent_today
      // counter is enough for daily cap; this tick-level limit is just for
      // burst protection when many leads are pending).

      let leadsScannedThisCampaign = 0;
      // Generous but bounded: protects against a future steady-state where
      // thousands of leads at the front of the list are already in_progress/on
      // cooldown and would otherwise cost a DB round-trip each to skip past,
      // before ever reaching a fresh one worth attempting.
      const MAX_LEADS_SCANNED_PER_CAMPAIGN = 300;

      for (const cl of campaignLeads) {
        if (campaignSentToday + sentThisCampaign >= campaignDailyLimit) break;
        if (sentThisCampaign >= paceBudgetThisRun) break; // stay on the hourly pace
        if (sendAttemptsThisRun >= MAX_SENDS_PER_INVOCATION) break;
        if (++leadsScannedThisCampaign > MAX_LEADS_SCANNED_PER_CAMPAIGN) break;

        const lead = cl.leads;
        if (!lead) continue;

        if (!isValidEmail(lead.email)) {
          console.warn(`Skipping lead ${lead.id}: invalid email "${lead.email}"`);
          await adminClient.from("campaign_leads").update({ status: "completed" }).eq("id", cl.id);
          continue;
        }

        // Blocklist check
        const leadEmail = lead.email.toLowerCase();
        const leadDomain = leadEmail.split("@")[1] || "";
        if (blockedEmails.has(leadEmail) || blockedDomains.has(leadDomain)) {
          await adminClient.from("campaign_leads").update({ status: "completed" }).eq("id", cl.id);
          continue;
        }

        // Domain daily limit check
        if (domainLimitEnabled) {
          const currentDomainCount = domainSentCounts[leadDomain] || 0;
          if (currentDomainCount >= domainDailyLimit) {
            totalSkipped++;
            continue;
          }
        }

        // Check stop_on_reply
        if (stopOnReply) {
          const { data: replies } = await adminClient
            .from("inbox_messages")
            .select("id")
            .eq("lead_id", lead.id)
            .limit(1);
          if (replies?.length) {
            await adminClient.from("campaign_leads").update({ status: "replied" }).eq("id", cl.id);
            continue;
          }
          if (cl.status === "replied") continue;
        }

        const currentStepIndex = cl.current_step || 0;
        if (currentStepIndex >= steps.length) {
          await adminClient.from("campaign_leads").update({ status: "completed" }).eq("id", cl.id);
          continue;
        }

        const step = steps[currentStepIndex];

        // Check delay between steps
        if (currentStepIndex > 0 && cl.last_sent_at) {
          const lastSent = new Date(cl.last_sent_at);
          const delayMs = (step.delay_days || 0) * 24 * 60 * 60 * 1000;
          if (now.getTime() - lastSent.getTime() < delayMs) {
            totalSkipped++;
            continue;
          }
        }

        // getEffectiveLimit / rampDaysActive are computed once per campaign per
        // tick (above, right after `accounts` is fetched) — not re-queried here
        // for every lead.

        // Expert rotation / account selection
        const selectAccount = () => {
          if ((campaign as any).expert_rotation && accounts.length > 1) {
            const domainMap: Record<string, any[]> = {};
            for (const acc of accounts) {
              const domain = acc.email.split("@")[1] || "unknown";
              if (!domainMap[domain]) domainMap[domain] = [];
              domainMap[domain].push(acc);
            }
            const domains = Object.keys(domainMap);

            // Provider matching: prefer sender domain matching recipient domain
            const providerMatching = (campaign as any).provider_matching ?? false;

            const scored = accounts
              .filter(acc => acc.sent_today < getEffectiveLimit(acc) && (accountSendsThisTick[acc.id] || 0) < MAX_PER_ACCOUNT_PER_TICK && !isAccountOnCooldown(acc))
              .map(acc => {
                const domain = acc.email.split("@")[1] || "unknown";
                const domainAccounts = domainMap[domain];
                const domainSentTotal = domainAccounts.reduce((s: number, a: any) => s + a.sent_today, 0);
                const domainCapacity = domainAccounts.reduce((s: number, a: any) => s + getEffectiveLimit(a), 0);
                const domainUsageRatio = domainCapacity > 0 ? domainSentTotal / domainCapacity : 1;
                const accUsageRatio = getEffectiveLimit(acc) > 0 ? acc.sent_today / getEffectiveLimit(acc) : 1;
                const warmupBonus = acc.warmup_enabled ? 0.1 : 0;
                const diversityBonus = domains.length > 1 ? (1 / domainAccounts.length) * 0.2 : 0;

                // Provider matching bonus
                let providerBonus = 0;
                if (providerMatching && leadDomain) {
                  const senderProvider = getEmailProvider(domain);
                  const recipientProvider = getEmailProvider(leadDomain);
                  if (senderProvider && senderProvider === recipientProvider) {
                    providerBonus = 0.3; // Significant bonus for matching providers
                  }
                }

                const score = (domainUsageRatio * 0.5) + (accUsageRatio * 0.4) - warmupBonus - diversityBonus - providerBonus;
                return { acc, score };
              });

            if (scored.length === 0) return null;
            // Sort primarily by sent_today (least used first) to guarantee true rotation,
            // then by expert score for tie-breaking. This ensures EVERY account is used.
            scored.sort((a, b) => {
              if (a.acc.sent_today !== b.acc.sent_today) return a.acc.sent_today - b.acc.sent_today;
              return (a.score + Math.random() * 0.05) - (b.score + Math.random() * 0.05);
            });
            return scored[0].acc;
          }

          // True round-robin: pick the account with the LEAST sent_today
          // so load is evenly distributed across all available accounts.
          const eligible = accounts.filter((acc: any) => acc.sent_today < getEffectiveLimit(acc) && (accountSendsThisTick[acc.id] || 0) < MAX_PER_ACCOUNT_PER_TICK && !isAccountOnCooldown(acc));
          if (eligible.length === 0) return null;
          eligible.sort((a: any, b: any) => {
            if (a.sent_today !== b.sent_today) return a.sent_today - b.sent_today;
            // tie-break with random jitter for natural distribution
            return Math.random() - 0.5;
          });
          return eligible[0];
        };

        // ═══ STRICT ACCOUNT BINDING ═══
        // A lead is forever tied to the FIRST account assigned to it. The DB column is the
        // source of truth; sent_emails is a compatibility fallback for older campaign rows.
        let account: any = null;
        const assignedAccountId = (cl as any).assigned_account_id as string | null | undefined;
        const { data: anyPrior } = await adminClient
          .from("sent_emails")
          .select("account_id, status")
          .eq("campaign_id", campaign.id)
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: true })
          .limit(1);

        const boundId = assignedAccountId || (anyPrior?.length ? anyPrior[0].account_id : null);
        if (boundId) {
          account = accounts.find((a: any) => a.id === boundId);
          if (!account) {
            // Bound account not in current pool — fetch directly
            const { data: origAcc } = await adminClient
              .from("email_accounts")
              .select("*")
              .eq("id", boundId)
              .eq("status", "connected")
              .maybeSingle();
            account = origAcc;
          }
          if (!account) {
            // Bound account is disconnected — skip lead instead of switching sender
            console.warn(`Lead ${lead.id} bound to unavailable account ${boundId}; skipping to preserve identity`);
            totalSkipped++;
            continue;
          }
          // Respect daily caps even on the bound account
          if (account.sent_today >= getEffectiveLimit(account)) {
            totalSkipped++;
            continue;
          }
          // Respect 7–9 min cooldown on the bound account
          if (isAccountOnCooldown(account)) {
            totalSkipped++;
            continue;
          }
        } else {
          // First touch (lead nuevo) — respeta el tope diario de leads nuevos si existe
          if (maxNewLeads != null && newLeadsSentThisRun >= maxNewLeads) {
            totalSkipped++;
            continue;
          }
          // pick via rotation and persist on the very first send
          account = selectAccount();
          if (account) {
            const { data: claimedLead, error: claimErr } = await adminClient
              .from("campaign_leads")
              .update({ assigned_account_id: account.id })
              .eq("id", cl.id)
              .is("assigned_account_id", null)
              .select("assigned_account_id")
              .maybeSingle();

            // Surface real query errors (bad column, permissions, etc.) instead of
            // silently treating them the same as "another tick already claimed this
            // lead" — that silent conflation is exactly what let a missing column
            // cause every single lead to be skipped with zero visible error.
            if (claimErr) {
              console.error(`assigned_account_id claim failed for lead ${lead.id}: ${claimErr.message}`);
            }
            if (!claimedLead) {
              totalSkipped++;
              continue;
            }
          }
        }
        if (!account) break;

        // Per-tick burst protection: don't allow a single account to send too
        // many emails in one cron invocation, even if it has remaining daily
        // capacity. Spreads load across cron ticks naturally.
        if ((accountSendsThisTick[account.id] || 0) >= MAX_PER_ACCOUNT_PER_TICK) {
          totalSkipped++;
          continue;
        }

        // ═══ A/B variant selection ═══
        // For step 0: pick a random variant.
        // For follow-ups: REUSE the same variant_index that was used for this lead's
        // first email — so a lead that got variant A in step 1 keeps getting A in step 2, 3, etc.
        const variants: any[] = step.variants || [];
        let finalSubjectTemplate = step.subject;
        let finalBodyTemplate = step.body;
        let variantIndex = 0;

        const allVariants = [
          { subject: step.subject, body: step.body },
          ...variants.map((v: any) => ({ subject: v.subject || step.subject, body: v.body || step.body })),
        ];

        if (currentStepIndex > 0) {
          // Look up the variant_index used in the FIRST email to this lead in this campaign
          const { data: firstSentVariant } = await adminClient
            .from("sent_emails")
            .select("variant_index")
            .eq("campaign_id", campaign.id)
            .eq("lead_id", lead.id)
            .eq("status", "sent")
            .order("sent_at", { ascending: true })
            .limit(1);

          if (firstSentVariant?.length) {
            variantIndex = firstSentVariant[0].variant_index ?? 0;
          }
          // Clamp to available range — if this step has fewer variants than the original, fall back to base (0)
          if (variantIndex >= allVariants.length) variantIndex = 0;
        } else if (allVariants.length > 1) {
          // First step: random pick across variants
          variantIndex = Math.floor(Math.random() * allVariants.length);
        }

        const picked = allVariants[variantIndex];
        finalSubjectTemplate = picked.subject;
        finalBodyTemplate = picked.body;

        // Replace variables
        const customFields = (lead.custom_fields || {}) as Record<string, string>;
        const fields: Record<string, string> = {
          ...customFields,
          Email: lead.email,
        };
        // Add sender fields
        if (account.first_name) fields["SenderFirstName"] = account.first_name;
        if (account.last_name) fields["SenderLastName"] = account.last_name;
        if (account.email) fields["SenderEmail"] = account.email;

        const finalSubject = replaceVariables(finalSubjectTemplate, fields).replace(/\s+/g, " ").trim();

        // Determine text-only mode — honors the campaign's own Options toggles
        // ("Enviar emails como solo texto" / "Enviar primer email como solo texto").
        // Plain text without links is the highest-deliverability mode and reduces
        // spam classification, so it stays the recommended default in the UI —
        // but the user's explicit choice here is respected, not silently overridden.
        const isFirstStep = currentStepIndex === 0;
        const textOnlyEmails = (campaign as any).text_only_emails === true;
        const firstEmailTextOnly = (campaign as any).first_email_text_only === true;

        const personalizedBody = replaceVariables(finalBodyTemplate, fields).trim();
        // If the personalized body carries explicit HTML (e.g. a {{personalized_message}}
        // with <p>…</p> markup from the CSV), force HTML delivery so it renders with real
        // paragraph spacing. Sending HTML through the text-only path would leak raw tags.
        const bodyHasHtml = hasExplicitHtml(personalizedBody);
        const forceTextOnly = !bodyHasHtml && (textOnlyEmails || (isFirstStep && firstEmailTextOnly));
        const campaignSignature = ((campaign as any).signature_html || "").trim();
        const shouldIncludeSignature = !isFirstStep && !!campaignSignature;
        const signatureHtml = shouldIncludeSignature ? campaignSignature : undefined;

        const finalBody = forceTextOnly
          ? removeUrlsAndTracking(personalizedBody)
          : textToHtml(personalizedBody);

        // ═══ Threading: use REAL Message-IDs from DB for proper threading ═══
        const fromDomain = account.email.split("@")[1] || "mail.local";
        let inReplyTo: string | undefined;
        let references: string | undefined;
        let threadSubject = finalSubject;
        
        // Generate a unique Message-ID for THIS email
        const thisMsgId = generateMessageId(fromDomain);

        const breakThreadAfter = (campaign as any).break_thread_after || 0;
        const shouldThread = currentStepIndex > 0 && (breakThreadAfter === 0 || currentStepIndex < breakThreadAfter);

        if (shouldThread) {
          // Look up the REAL smtp_message_id from previous sent emails to this lead
          const { data: previousSent } = await adminClient
            .from("sent_emails")
            .select("smtp_message_id, subject")
            .eq("campaign_id", campaign.id)
            .eq("lead_id", lead.id)
            .eq("status", "sent")
            .order("sent_at", { ascending: true });

          if (previousSent?.length) {
            // In-Reply-To: the most recent email in the thread
            const lastSent = previousSent[previousSent.length - 1];
            if (lastSent.smtp_message_id) {
              inReplyTo = lastSent.smtp_message_id;
            }

            // References: all previous emails in order (proper RFC 2822 threading)
            const refs = previousSent
              .map((s: any) => s.smtp_message_id)
              .filter(Boolean);
            if (refs.length) {
              references = refs.join(' ');
            }

            // Use Re: <original first subject> for thread grouping
            const firstSubject = previousSent[0].subject || finalSubject;
            const baseSubject = firstSubject.replace(/^(Re:\s*)+/i, '');
            threadSubject = `Re: ${baseSubject}`;
          }
        }
        // If breakThreadAfter > 0 and currentStepIndex >= breakThreadAfter,
        // this follow-up and the next ones are sent as fresh new messages

        // Instantly API v2 does NOT support outbound transactional sending — only
        // EMAIL-LEVEL DE-DUP. The same person can exist as several lead rows in one
        // campaign (imported twice) — leads has no unique (user_id, email). Without
        // this, each duplicate row gets the full sequence, so a prospect receives the
        // same cold email 2-3× (spam complaints, domain burn). If a sibling row for
        // the SAME email already received THIS step, advance this lead WITHOUT sending
        // (it shadows the primary and completes silently). Runs only for leads that
        // already passed every gate and are about to send — a handful per tick.
        {
          const { data: sibSent } = await adminClient
            .from("sent_emails")
            .select("id")
            .eq("campaign_id", campaign.id)
            .eq("campaign_step_id", step.id)
            .ilike("to_email", leadEmail)
            .in("status", ["sent", "bounced"])
            .limit(1);
          if (sibSent?.length) {
            const advStep = currentStepIndex + 1;
            await adminClient.from("campaign_leads").update({
              current_step: advStep,
              last_sent_at: now.toISOString(),
              assigned_account_id: (cl as any).assigned_account_id || account.id,
              status: advStep >= steps.length ? "completed" : "in_progress",
            }).eq("id", cl.id);
            totalSkipped++;
            continue;
          }
        }

        // inbox/reply ops on existing campaigns. We always send via local SMTP
        // (with full deliverability headers: List-Unsubscribe, Reply-To, QP, Feedback-ID).
        let result: { ok: boolean; error?: string; messageId?: string; errorClass?: string };
        const transportUsed: 'instantly' | 'smtp' = 'smtp';

        // Opt-out link — only on the FIRST email (step 0), and only if the campaign
        // enabled it AND this sending account is in the chosen scope. Follow-ups stay
        // in the same thread without repeating the unsubscribe footer.
        let unsubscribeUrl: string | undefined;
        if ((campaign as any).include_unsubscribe && currentStepIndex === 0) {
          const unsubAll = (campaign as any).unsubscribe_all ?? true;
          const unsubIds: string[] = (campaign as any).unsubscribe_account_ids || [];
          const unsubTags: string[] = (campaign as any).unsubscribe_account_tags || [];
          const accTags: string[] = account.tags || [];
          const accountInScope = unsubAll
            || unsubIds.includes(account.id)
            || accTags.some((t: string) => unsubTags.includes(t));
          if (accountInScope) {
            const token = await makeUnsubToken(campaign.user_id, lead.email, Deno.env.get("UNSUB_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
            unsubscribeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/unsubscribe?t=${token}`;
          }
        }

        {
          sendAttemptsThisRun++;
          result = await sendSmtpEmail(
            account.smtp_host, account.smtp_port,
            account.smtp_username, account.smtp_password,
            account.email, lead.email, threadSubject, finalBody,
            {
              messageId: thisMsgId,
              firstName: account.first_name || undefined,
              lastName: account.last_name || undefined,
              signatureHtml,
              textOnly: forceTextOnly,
              inReplyTo,
              references,
              userId: campaign.user_id,
              campaignId: campaign.id,
              unsubscribeUrl,
            }
          );
        }


        // Determine final status based on error class (Instantly-style smart handling)
        const errClass = (result as any).errorClass as string | undefined;
        // A post-DATA timeout ('sent_unconfirmed') is treated as SENT: the message
        // was already handed to the server, so we advance the step and never retry
        // (at-most-once) — a duplicate cold email is worse than a possibly-missed one.
        const treatAsSent = result.ok || errClass === 'sent_unconfirmed';
        let finalStatus: string = treatAsSent ? "sent" : "failed";
        if (!result.ok && (errClass === 'hard')) {
          finalStatus = 'bounced'; // permanent — don't retry
        }

        const sentEmailPayload = {
          user_id: campaign.user_id, campaign_id: campaign.id,
          campaign_step_id: step.id, account_id: account.id,
          lead_id: lead.id, to_email: lead.email,
          subject: threadSubject, body: finalBody,
          status: finalStatus,
          sent_at: treatAsSent ? now.toISOString() : null,
          bounced_at: finalStatus === 'bounced' ? now.toISOString() : null,
          error_message: result.error || null,
          variant_index: variantIndex,
          smtp_message_id: thisMsgId,
          transport: transportUsed,
        };
        const insertWithTransport = await adminClient.from("sent_emails").insert(sentEmailPayload);
        if (insertWithTransport.error && /transport/i.test(insertWithTransport.error.message || "")) {
          const { transport: _transport, ...fallbackPayload } = sentEmailPayload;
          await adminClient.from("sent_emails").insert(fallbackPayload);
        }

        if (treatAsSent) {
          totalSent++;
          sentThisCampaign++;
          if (currentStepIndex === 0) { newSentTotal++; newLeadsSentThisRun++; }
          else { followupsSentTotal++; }

          // ATOMIC increment (sent_today = sent_today + 1 in the DB). The old
          // read-modify-write wrote the in-memory value read minutes earlier, so if
          // the daily reset ran in between it could resurrect a stale count (account
          // "wakes up" at ~30 and sends nothing all day) or lose a concurrent bump.
          await adminClient.rpc("increment_account_sent", { p_account_id: account.id });
          account.sent_today++;
          account.last_send_at = now.toISOString();
          accountSendsThisTick[account.id] = (accountSendsThisTick[account.id] || 0) + 1;

          // Update domain sent count
          if (domainLimitEnabled) {
            domainSentCounts[leadDomain] = (domainSentCounts[leadDomain] || 0) + 1;
          }

          const newStep = currentStepIndex + 1;
          await adminClient.from("campaign_leads").update({
            current_step: newStep, last_sent_at: now.toISOString(),
            assigned_account_id: account.id,
            status: newStep >= steps.length ? "completed" : "in_progress",
          }).eq("id", cl.id);

          await adminClient.from("campaigns").update({
            last_campaign_send_at: new Date().toISOString(),
          }).eq("id", campaign.id);

          // Tiny pause between sends inside the same tick (natural cadence)
          await new Promise(r => setTimeout(r, MIN_GAP_BETWEEN_SENDS_MS + Math.floor(Math.random() * 1500)));
        } else {
          // Smart error reaction (Instantly behaviour)
          console.warn(`SMTP fail [${errClass}] account=${account.email} → ${lead.email}: ${result.error}`);

          if (errClass === 'auth') {
            // Special bypass: never disconnect Dekano accounts (keep campaigns running)
            const NEVER_DISCONNECT_USERS = new Set<string>([
              "e6d759aa-c8e0-4bc3-820f-2d64d88cda06", // eric@dekano-core.es
            ]);
            if (!NEVER_DISCONNECT_USERS.has(account.user_id)) {
              // Credential problem — disconnect account so it stops being used
              await adminClient.from("email_accounts")
                .update({ status: "auth_failed" })
                .eq("id", account.id);
              // Remove from in-memory rotation for the rest of this run
              const idx = accounts.findIndex((a: any) => a.id === account.id);
              if (idx >= 0) accounts.splice(idx, 1);
            } else {
              console.warn(`[bypass] auth error on ${account.email} ignored — account kept active`);
            }
          } else if (errClass === 'hard') {
            // Permanent recipient failure — finish the lead, no more retries
            await adminClient.from("campaign_leads")
              .update({ status: "bounced" })
              .eq("id", cl.id);
          } else if (errClass === 'rate') {
            // Account is being throttled — back off this account for the rest of the run
            const idx = accounts.findIndex((a: any) => a.id === account.id);
            if (idx >= 0) accounts.splice(idx, 1);
          }
          // 'soft' / 'unknown' → leave campaign_lead pending, will retry next cron cycle
        }
      }
    }

    return new Response(JSON.stringify({
      success: true, sent: totalSent, followups_sent: followupsSentTotal,
      new_sent: newSentTotal, skipped: totalSkipped,
      campaigns_processed: campaigns.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } finally {
      await releaseLock();
    }
  } catch (e) {
    console.error("process-campaign-queue error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Provider matching helper ───

function getEmailProvider(domain: string): string | null {
  const d = domain.toLowerCase();
  if (d === "gmail.com" || d === "googlemail.com" || d.endsWith(".google.com")) return "google";
  if (d === "outlook.com" || d === "hotmail.com" || d === "live.com" || d === "msn.com") return "microsoft";
  if (d === "yahoo.com" || d === "ymail.com") return "yahoo";
  // For custom domains, check MX pattern (simplified — would need DNS lookup for accuracy)
  return null;
}
