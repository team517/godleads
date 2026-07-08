import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { containsProfanity } from "@/lib/profanity-filter";
import { publishUniboxUnread } from "@/lib/uniboxBadge";
import DOMPurify from "dompurify";
import { signatureToBrLines } from "@/lib/signature";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Archive, RefreshCw, Send, Inbox as InboxIcon, Mail, MailOpen, User, Sparkles, X, Loader2, Bell, Clock, Trash2, ArchiveX, Link2, Megaphone, ArrowLeft, Languages, Ban, ShieldBan, Globe, Forward, UserX, Paperclip, FileText, FolderInput, Maximize2, Minimize2, Download, Check, Pencil, Star } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow, addDays, addWeeks, startOfTomorrow, format, nextMonday } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

/* ── Helpers ───────────────────────────────────────────────────── */

/**
 * Remove warm-up / tracking codes that providers (Instantly, Mailreef…) inject
 * into subjects and bodies — e.g. "GAJIE920CWH", "CHBV6J7", "2YSB82T",
 * "t27109847387709683". They are alphanumeric tokens mixing letters AND digits,
 * or long pure-digit runs. We STRIP them so the email stays readable, instead of
 * hiding the whole message (which was throwing away real lead replies).
 */
const MIXED_CODE_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20}\b/g;
// 12+ pure digits = tracking id (real phone numbers are 9–11 digits → kept).
const LONG_DIGIT_RE = /\b\d{12,}\b/g;
// 14+ hex chars = message/tracking hash, e.g. "0000000000004f31700653fc0cdf".
const LONG_HEX_RE = /\b[0-9a-f]{14,}\b/gi;
// 21+ alphanumeric mix (letters+digits) = long tracking ref beyond MIXED_CODE_RE.
const LONG_MIXED_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{21,}\b/g;
function stripWarmupTokens(input: string | null): string {
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
function tryDecodeBase64(compact: string): string | null {
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
function decodeBase64Body(input: string): string {
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
const ATTACHMENT_CUT_RE = /(?:^|\n)\s*(?:Content-Disposition:\s*attachment|Content-ID:|Content-Type:\s*application\/(?:pdf|octet-stream|zip|msword|vnd\.|x-)|(?:file)?name\*?=\s*"?=\?|%PDF-|\/FlateDecode\b|\/XObject\b|\/Producer\s*\(|\/Creator\s*\(|\bendobj\b|\bendstream\b|^\s*\d+\s+\d+\s+obj\b)/im;

/** Cut the raw body at the first attachment/PDF marker and remove leftover MIME
 *  attachment header lines, so the binary garbage never shows in the message. */
function stripAttachmentJunk(text: string): string {
  if (!text) return text;
  const idx = text.search(ATTACHMENT_CUT_RE);
  let t = idx >= 0 ? text.slice(0, idx) : text;
  t = t.replace(/^.*\b(?:file)?name\*?=.*$/gim, "");
  t = t.replace(/^Content-(?:Disposition|ID|Type|Transfer-Encoding|Description):.*$/gim, "");
  return t;
}

/** Decode attachment file names found in the raw MIME body (e.g. name="...pdf"). */
function extractAttachmentNames(raw: string | null): string[] {
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
function decodeFilename(raw: string): string {
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
function extractAttachments(raw: string | null): ParsedAttachment[] {
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
function attachmentObjectUrl(att: ParsedAttachment): string | null {
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
const QUOTE_MARKERS: RegExp[] = [
  /(^|\n)\s*Missatge de\b[\s\S]{0,180}?a les\s+\d{1,2}[:.]\d{2}\s*:/i,        // CA "Missatge de … a les 22:18:"
  /(^|\n)\s*(El|On|Le|Em|Il|Am)\b[\s\S]{0,160}?(escri(b|v)i[óo]|wrote|a écrit|escreveu|ha scritto|va escriure|schrieb)[^\n]{0,40}:/i, // "El … escribió:" / "On … wrote:"
  /(^|\n)\s*-{2,}\s*(Original Message|Mensaje original|Missatge original|Forwarded message)\s*-{2,}/i,
  /(^|\n)\s*(De|From|Von|Da)\s*:\s*.+\n\s*(Enviado|Sent|Date|Fecha|Data|Datum)\s*:/i,
  /<blockquote/i,
  /class=["']?gmail_quote/i,
  /(^|\n)\s*>{1,}\s?\S/,                                                       // "> quoted line"
];
/** Trim quoted reply chains so only the new message shows. */
function stripQuotedReply(text: string): string {
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
const IMPORTANT_LABEL = "Importante";

/** Append the account's HTML signature to a reply BODY, client-side, so it works with
 *  just a frontend redeploy (no edge deploy needed). We build proper HTML: the plain
 *  reply → paragraphs/<br> (mirrors send-email's textToHtml so line breaks survive),
 *  then the signature as a COMPACT block (its <p> tags → single <br>, so the email
 *  client's default ~16px paragraph margins don't blow it apart). Because the result
 *  contains <br>/<p>, send-email's textToHtml passes it through untouched. */
function buildBodyWithSignature(reply: string, sigHtmlRaw: string): string {
  const tightSig = signatureToBrLines(sigHtmlRaw);
  if (!tightSig) return reply;
  const replyHtml = /<(p|div|br)\b/i.test(reply)
    ? reply
    : reply.split(/\n\n+/).filter((p) => p.trim()).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `${replyHtml}<br><br>${tightSig}`;
}

/** Columns the list/search/thread need (NOT body_html — fetched only when a message
 *  is opened). Typed loosely because the generated types.ts is stale. */
const INBOX_LIST_COLS = "id, user_id, account_id, lead_id, campaign_id, message_id, from_email, from_name, subject, body_text, received_at, is_read, is_archived, folder_id, labels, dedupe_hash, ref_chain";

/** Rejoin words that a sender's client hard-wrapped MID-WORD (e.g. "respo\nnsable de…"
 *  "explic\nar", "ofre\ncéis"). We only act when the message is CLEARLY wrapped that
 *  way — a majority of its line breaks split a word (previous line ends in a letter/
 *  digit, next line continues in lowercase). Then we glue those broken words back with
 *  no space. Blank lines, new sentences and signature lines (which start uppercase)
 *  keep their break, so normal emails are never altered. Fixes "el mensaje no se ve
 *  completo": the body was showing chopped every ~40–55 chars in the middle of words. */
function unwrapHardBreaks(text: string): string {
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
const _cleanTextCache = new Map<string, string>();
function cleanBodyText(raw: string | null, keepCodes = false): string {
  if (!raw) return "";
  const key = (keepCodes ? "1|" : "0|") + raw;
  const hit = _cleanTextCache.get(key);
  if (hit !== undefined) return hit;
  const out = cleanBodyTextRaw(raw, keepCodes);
  if (_cleanTextCache.size > 5000) _cleanTextCache.clear();
  _cleanTextCache.set(key, out);
  return out;
}
function cleanBodyTextRaw(raw: string | null, keepCodes = false): string {
  if (!raw) return "";
  // Decode base64-encoded bodies that arrived un-decoded (whole body or per-line)
  let text = decodeBase64Body(raw);
  text = repairMojibake(text);
  // Remove attachment/PDF binary so only the real message text remains
  text = stripAttachmentJunk(text);
  // Trim the quoted previous message so only the new reply remains
  text = stripQuotedReply(text);

  // Remove IMAP artifacts
  text = text.replace(/^BODY\[TEXT\]\s*\{\d+\}\s*/i, "");

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

/** Clean HTML email body for safe rendering — aggressively strips artifacts for a clean Gmail-style view */
function cleanBodyHtml(raw: string | null, keepQuote = false): string {
  if (!raw) return "";
  // Decode a base64-encoded HTML body if it arrived un-decoded
  let html = repairMojibake(decodeBase64Body(raw));
  // Drop attachment/PDF binary that leaked into the HTML body
  html = stripAttachmentJunk(html);

  // Cut the quoted reply chain (everything from the gmail/outlook quote block on)
  // so only the new message is shown — like Gmail collapses the quote. When the
  // user asks for the full email ("Ver completo"), keep the quote.
  if (!keepQuote) {
    const qIdx = html.search(/<(?:blockquote|div)[^>]*class=["']?[^"'>]*(?:gmail_quote|yahoo_quoted|moz-cite-prefix)|<blockquote\b|(?:^|\n)\s*Missatge de\b[\s\S]{0,160}?a les\s+\d{1,2}[:.]\d{2}\s*:|(?:^|\n)\s*(?:El|On)\b[\s\S]{0,140}?(?:escri(?:b|v)i[óo]|wrote|va escriure)[^\n]{0,30}:/i);
    if (qIdx > 30) html = html.slice(0, qIdx);
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
    final = final.replace(/<(p|div|span|td|tr|table|tbody|thead|th|blockquote)(\s[^>]*)?>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, "");
  }
  final = final.replace(/(<br\s*\/?>[\s]*){3,}/gi, "<br><br>");
  // Remove leading/trailing whitespace nodes
  final = final.replace(/^(\s|<br\s*\/?>|&nbsp;)+/i, "").replace(/(\s|<br\s*\/?>|&nbsp;)+$/i, "");

  return final;
}

/**
 * Repair mojibake — text where UTF-8 bytes were misinterpreted as Latin-1/Windows-1252.
 * Common patterns: "Ã±" → "ñ", "Ã©" → "é", "Â¿" → "¿", "â‚¬" → "€".
 * Also handles already-corrupted "" (U+FFFD) by best-effort substitution
 * for common Spanish patterns where context makes the original character obvious.
 */
function repairMojibake(input: string): string {
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

/** Decode a byte array using the given charset (defaults to utf-8). */
function decodeBytes(bytes: number[], charset?: string): string {
  const cs = (charset || "utf-8").toLowerCase().replace(/^iso-?/, "iso-").replace(/^windows-?/, "windows-");
  try {
    return new TextDecoder(cs as string, { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    try { return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes)); }
    catch { return String.fromCharCode(...bytes); }
  }
}

function decodeHtmlEntities(input: string): string {
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
function decodeSubjectKeepCodes(raw: string | null): string {
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
function decodeSubject(raw: string | null): string {
  return stripWarmupTokens(decodeSubjectKeepCodes(raw)) || "(sin asunto)";
}

/** Strict warmup detector — drops messages with any mixed letter+digit code in the subject.
 *  Examples blocked: "Eric - quick question | GH2RZD5 CHBV6J7", "ot 2 | CHBV6J7 WK2FX1R",
 *  "VC3Q3N2", "isition challenge | any.trail.manufactur CHBV6J7", "t27109847387709683 ...". */
const WARMUP_MIXED_CODE_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20}\b/;
const WARMUP_LONG_DIGIT_RE = /\b\d{8,}\b/;
const WARMUP_UUID_LIKE_RE = /\b[a-f0-9]{4,}-[a-f0-9-]{8,}\b/i;
const WARMUP_DOTTED_LOWER_RE = /\b[a-z]+\.[a-z]+(?:\.[a-z]+)+\b/;
const WARMUP_MARKER_RE = /#warmup|instantly-warmup|warmup-|x-warmup/i;
/** Spam detection – hide ONLY clear warmup-network / automated messages.
 *  IMPORTANT: a message is no longer hidden just because it contains a code
 *  (those are stripped from the display instead). We only drop emails that are
 *  unmistakably warm-up traffic (explicit markers) or automated system senders,
 *  so real lead replies are never thrown away. */
function isSpam(subject: string | null, body: string | null, fromEmail: string | null): boolean {
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
const WARMUP_WHITELIST = new Set([
  "TCX", "AWS", "GCP", "API", "S3", "AI", "ML", "CRM", "ERP", "UX", "UI",
  "SEO", "SEM", "B2B", "B2C", "SAAS", "VAT", "IVA", "IBAN", "CIF", "NIF", "DNI",
  "VIP", "CEO", "CTO", "CFO", "COO", "RRHH", "HR", "IT", "PM", "QA", "SLA",
  "KPI", "ROI", "MVP", "GDPR", "RGPD", "MICRO", "MACRO", "PRO", "PREMIUM",
  "STANDARD", "BASIC", "PLUS", "ULTRA", "ALPHA", "BETA",
]);

/** A) True when the subject contains an UPPERCASE code that mixes letters+digits
 *  (5–16 chars), e.g. "New HR Policy | 9XAT619 CHBV6J7". Whitelisted brands,
 *  plain uppercase words and years (2024) are NOT treated as codes. */
function subjectHasWarmupCode(subject: string | null): boolean {
  return textHasWarmupCode(decodeSubjectKeepCodes(subject || ""));
}

/** INTELLIGENT warm-up code detector for a SINGLE token. A warm-up/tracking code
 *  (e.g. "FJRI829FJSC", "GH2RZD5", "9XAT619", "CHBV6J7") mixes letters AND digits
 *  and is high-entropy. Real references ("Order ABC12345", "iPhone13", "COVID19",
 *  "Q4-2024") are NOT flagged, so genuine replies survive. Signals used:
 *   - must mix letters+digits, 6–20 chars, not a whitelisted brand nor a year;
 *   - ≥2 letter↔digit transitions (interleaved) → random code; OR
 *   - the letters are ALL-UPPERCASE with no vowels (e.g. "CHBVJ7") → random code. */
function looksLikeWarmupCode(t: string): boolean {
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
const ID_WHITELIST_RE = /^(?:[XYZ]\d{7}[A-Z]|[A-HJ-NP-SUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[A-Z]{1,2}\d{4}[A-Z]{0,2})$/;

/** True if the text (subject OR body) contains warm-up codes. URLs, emails and HTML
 *  are stripped first so link slugs / tracking params never trip it. To avoid hiding
 *  real replies, we require **≥2** code-like tokens — warm-up traffic reliably injects
 *  several ("FJRI829FJSC CHBV6J7"), whereas a genuine message almost never contains
 *  two random alphanumeric tokens (a lone order ref / NIE / CIF is kept). */
function countWarmupCodes(text: string | null): number {
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
function textHasWarmupCode(text: string | null): boolean {
  return countWarmupCodes(text) >= 2;
}

/** C) Bounce / delivery-failure / known system senders — always hidden. */
function isBounceOrNoise(fromEmail: string | null): boolean {
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
const REPLY_SUBJECT_RE = /^\s*(re|res|rv|aw|tr|fw|fwd)\s*[:\]]|^\s*(respuesta autom|automatic reply|out of office|fuera de (la )?oficina|ausente|absent)/i;
function isRelevantInboxItem(m: any): boolean {
  if (m?.lead_id || m?.campaign_id) return true;
  const labels: string[] = Array.isArray(m?.labels) ? m.labels : [];
  if (labels.some((l) => ["Interesado", "No interesado", "Pregunta", "Fuera / Auto"].includes(l))) return true;
  return REPLY_SUBJECT_RE.test(decodeSubjectKeepCodes(m?.subject || ""));
}

// B) Language detection. Goal: ONLY Spanish/Catalan stays in the bandeja; English
// (and other languages) are hidden. Returns "es" | "en" | "other" | "unknown".
//
// LANG_ES_CA: words that are distinctly Spanish/Catalan (deliberately avoids
// 2-letter words that also exist in English, e.g. "me", "son", "no", "a", "i").
const LANG_ES_CA = /\b(el|la|los|las|un[oa]?s?|del|al|que|qué|por|para|con|como|pero|porque|cuando|cuándo|donde|dónde|gracias|hola|saludos|buenos|buenas|cordial(?:es|mente)?|atentamente|estimad[oa]s?|señor(?:a|es)?|empresa|reunión|información|interesa|interesad[oa]s?|necesito|necesitamos|necesita|quiero|queremos|quería|querría|puede[ns]?|podemos|podríamos?|tengo|tenemos|tiene[ns]?|somos|estamos|está[ns]?|esto|esta|este|estos|estas|eso|esa|nuestr[oa]s?|vuestr[oa]s?|usted(?:es)?|también|según|sólo|solo|muy|más|sin|sobre|desde|hasta|mientras|aunque|entonces|vale|claro|perfecto|genial|encantad[oa]|quedamos|llamada|correo|adjunto|propuesta|presupuesto|consulta|pregunta|duda|cita|amb|per|què|gràcies|salutacions|atentament|nosaltres|aquest[a]?|aquests|aquestes|també|molt|més|sense|fins|vostè|voldria|d'acord|tinc|tenim|podem|bon\s?dia)\b/gi;
// LANG_EN: very common English words — almost every English email hits several.
const LANG_EN = /\b(the|and|you|your|yours|for|with|this|that|these|those|have|has|had|are|was|were|will|would|could|should|been|being|is|of|to|in|on|at|as|be|by|or|if|from|but|not|can|just|get|got|know|let|let's|see|time|week|day|here|there|our|we|us|i'm|i'll|we're|we'll|don't|doesn't|thanks|thank|regards|best|hi|hello|hey|dear|please|company|meeting|information|interested|need|want|team|cheers|sincerely|looking|forward|kind|sounds|great|schedule|call|available|reach|reaching|out)\b/gi;
// French markers — real business replies from FR leads should be SHOWN, not hidden.
const LANG_FR = /\b(merci|bonjour|cordialement|salutations|madame|monsieur|votre|notre|nous|vous|êtes|suis|absent[e]?|bureau|jusqu'au|jusqu|veuillez|prie|s'il\s?vous\s?plaît|disponible|répondre|réponse|entreprise|réunion|rendez-vous|actuellement|serai|retour|contacter|contactez|message|société|joindre|dès|meilleures)\b/gi;
// Italian markers — real business replies from IT leads should be SHOWN, not hidden.
const LANG_IT = /\b(grazie|salve|buongiorno|cordiali|saluti|distinti|sono|assente|ufficio|fino|contattare|contatti|prego|gentile|egregio|signor[ae]?|vostr[oa]|nostr[oa]|siamo|essere|disponibile|rispondere|risposta|azienda|riunione|messaggio|ritorno|tornerò|cortesia|attualmente|potete|grazie\s?mille)\b/gi;
// Remaining clearly-foreign languages (German / Portuguese / Polish / Russian) — hidden as noise.
const LANG_OTHER = /\b(danke|sehr|freundlichen|grüße|guten|ich|und|mit|obrigad[oa]|olá|você|atenciosamente|dziękuję|pozdrawiam|spasibo|zdravstvuyte)\b/gi;

function detectLanguageBucket(text: string): "es" | "en" | "fr" | "it" | "other" | "unknown" {
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

type MessageCategory = "interested" | "not_interested" | "question" | "out_of_office" | "neutral";

function classifyMessage(subject: string | null, body: string | null): MessageCategory {
  const rawSubject = decodeSubject(subject);
  const rawBody = cleanBodyText(body);
  // Prioritize body over subject for intent detection
  const bodyText = rawBody.toLowerCase();
  const subjectText = rawSubject.toLowerCase();
  const text = `${subjectText} ${bodyText}`;

  // Out of office / auto-reply – check first as it overrides other signals
  const oooPatterns = [
    /out of (the )?office/i, /fuera de (la )?oficina/i, /auto[- ]?reply/i,
    /respuesta autom[áa]tica/i, /vacacion/i, /vacation/i, /away from/i, /estaré ausente/i,
    /no disponible/i, /not available/i, /automatic reply/i, /delivery.*fail/i,
    /undeliverable/i, /mailer[- ]?daemon/i, /postmaster/i, /on leave/i,
    /currently out/i, /will be back/i, /vuelvo el/i, /regreso el/i,
    /ausencia/i, /congé/i, /abwesend/i,
  ];
  if (oooPatterns.some(p => p.test(text))) return "out_of_office";

  // ── Engagement signals: if the person asks for info, wants to talk, etc.,
  //    they are NOT "not interested" even if they express doubt ──
  const engagementPatterns = [
    /p[áa]sa(me|nos)\s+(info|informaci[óo]n|datos|m[áa]s)/i,
    /env[íi]a(me|nos)\s+(info|informaci[óo]n|datos|m[áa]s)/i,
    /manda(me|nos)\s+(info|informaci[óo]n|datos)/i,
    /send.*(info|details|more)/i,
    /tell.*more/i, /cu[ée]nta.*m[áa]s/i, /cu[ée]ntame/i, /cu[ée]ntanos/i,
    /quiero.*(info|saber|ver|conocer)/i,
    /me\s+gustar[íi]a\s+(saber|conocer|ver)/i,
    /igualmente.*(p[áa]sa|env[íi]a|manda|info)/i,
    /pero.*(p[áa]sa|env[íi]a|manda|info|cu[ée]nta)/i,
    /de\s+todas\s+(formas|maneras).*(info|saber)/i,
    /anyway.*(send|tell|info)/i,
  ];
  const hasEngagement = engagementPatterns.some(p => p.test(text));

  // Not interested – ONLY strong, unambiguous negative signals
  // These patterns require explicit rejection WITHOUT engagement signals
  const notInterestedPatterns = [
    /no\s+me\s+interesa\b/i, /no\s+nos\s+interesa\b/i,
    /no\s+estoy\s+interesad/i, /no\s+estamos\s+interesad/i,
    /\bnot\s+interested\b/i,
    /unsubscri/i, /take.*off.*(list|lista)/i,
    /remove.*from/i, /stop.*send/i, /don'?t.*contact/i,
    /no.*thanks/i, /no.*gracias/i,
    /darse de baja/i, /desuscri/i,
    /please.*remove/i, /quitar.*de.*lista/i,
    /no ens interessa/i,
    /leave me alone/i,
    /do not (email|write|contact)/i,
    /deja\s+de\s+(enviar|escribir|contactar)/i,
    /no\s+(me\s*)?(contacte|escriba|env[íi]e)/i,
    /pas intéressé/i, /kein interesse/i,
    // Spanish removal / "stop emailing me" requests
    /\bqu[íi]ta\S*\b[\s\S]{0,30}\blista\b/i,        // quítame de la lista
    /\bb[óo]rra\S*\b[\s\S]{0,30}\b(lista|correo)\b/i, // bórrame de la lista
    /\belim[íi]na\S*\b[\s\S]{0,30}\blista\b/i,       // elimíname de la lista
    /\bs[áa]ca\S*\b[\s\S]{0,30}\blista\b/i,          // sácame de la lista
    /no\s+(me|nos)\s+(mand\S*|env\S*|escrib\S*)\s+(m[áa]s|nada|nunca)/i, // no me mandéis más
    /no\s+insist/i,                                  // no insistas
  ];
  // Only classify as not_interested if there's NO engagement signal
  if (!hasEngagement && notInterestedPatterns.some(p => p.test(text))) return "not_interested";

  // Uncertainty / doubt – if the person expresses doubt, it's a Question even if they also ask for info
  const uncertaintyPatterns = [
    /no\s+s[ée]\s+si\s+(me\s+)?interes/i,   // "no sé si me interesa"
    /not\s+sure\s+(if|whether).*interest/i,   // "not sure if I'm interested"
    /no\s+tengo\s+claro/i,                    // "no tengo claro"
    /no\s+estoy\s+segur[oa]/i,               // "no estoy seguro/a"
    /i'?m\s+not\s+sure/i,                     // "I'm not sure"
    /no\s+s[ée]\s+si\s+(nos|me)\s+(conviene|sirve|aplica)/i,
    /quizás|quiz[áa]s|tal\s+vez|maybe|perhaps/i,
  ];
  if (uncertaintyPatterns.some(p => p.test(text))) return "question";

  // Interested – positive buying signals
  const interestedPatterns = [
    /let'?s.*chat/i, /schedule.*call/i, /love.*to.*hear/i,
    /\b(i'?m|we'?re|estoy|estamos)\s+interested/i, /me\s+interesa/i,
    /\binteresad[oa]\b/i, /\bestoy\s+interesad/i, /\bestamos\s+interesad/i,
    /\binterested\b/i,
    /tell.*more/i, /send.*info/i, /cu[ée]nta.*m[áa]s/i, /cu[ée]ntame/i, /cu[ée]ntanos/i,
    /hablemos/i, /agend(a|ar|emos)/i, /reuni[óo]n/i, /meeting/i, /sounds.*good/i,
    /let'?s.*connect/i, /would.*love/i, /can.*we.*talk/i,
    /podemos.*hablar/i, /disponible.*para/i, /book.*(time|slot|call)/i,
    /calendar/i, /calendly/i, /set up.*(time|call)/i,
    /me gustar[íi]a (saber|conocer)/i, /quiero.*(info|saber|ver)/i,
    /\bs[íi]\b.*\b(claro|por supuesto|encantado)\b/i,
    /\byes\b.*\b(please|sure|absolutely|definitely)\b/i,
    /send.*(proposal|quote|pricing|presupuesto|cotizaci[óo]n)/i,
    /when.*(available|free|meet)/i, /cu[áa]ndo.*(puedes|podemos)/i,
    /suena.*bien/i, /me.*parece.*bien/i, /dale/i, /perfecto/i,
    /vamos.*adelante/i, /go.*ahead/i, /let'?s.*do/i,
    /\bdisponibilidad\b/i, /\bavailab(le|ility)\b/i,
    /tengo.*disponib/i, /estoy.*disponib/i, /i'?m.*available/i,
    /a las \d/i, /sobre las \d/i, /from \d/i,
    /podr[íi]a(mos)?\s+(quedar|vernos|hablar|reunir)/i,
    /can.*meet/i, /let'?s.*meet/i, /nos vemos/i,
    /p[áa]sa(me|nos)\s+(info|informaci[óo]n|datos)/i,
    /env[íi]a(me|nos)\s+(info|informaci[óo]n|datos)/i,
  ];
  if (interestedPatterns.some(p => p.test(text))) return "interested";

  // If there's engagement (asking for info despite doubt), classify as question
  if (hasEngagement) return "question";

  // Question – inquiry without clear buying signal
  const questionPatterns = [
    /\?/, /wondering/i, /could.*you/i, /can.*you/i, /how.*does/i,
    /what.*is/i, /pregunt/i, /podr[íi]as/i, /c[óo]mo\s+(funciona|es|hac)/i,
    /cu[áa]nto\s+(cuesta|vale|cost)/i, /what.*(price|cost)/i,
    /do you (offer|have|support)/i, /qu[ée].*incluye/i,
    /no\s+s[ée]\s+(si|qu[ée])/i,  // "no sé si..." = uncertainty = question
    /not\s+sure\s+(if|about|whether)/i,
  ];
  if (questionPatterns.some(p => p.test(text))) return "question";

  return "neutral";
}

const categoryConfig: Record<MessageCategory, { label: string; bg: string; text: string; dot: string }> = {
  interested:     { label: "Interesado",     bg: "bg-emerald-500/10", text: "text-emerald-600", dot: "bg-emerald-500" },
  not_interested: { label: "No interesado", bg: "bg-red-500/10",     text: "text-red-600",     dot: "bg-red-500" },
  question:       { label: "Pregunta",      bg: "bg-blue-500/10",    text: "text-blue-600",    dot: "bg-blue-500" },
  out_of_office:  { label: "Fuera / Auto",  bg: "bg-violet-500/10",  text: "text-violet-600",  dot: "bg-violet-500" },
  neutral:        { label: "",              bg: "",                  text: "text-muted-foreground", dot: "bg-muted-foreground" },
};

type FilterType = "all" | MessageCategory;

const langLabels: Record<string, string> = {
  en: "inglés", fr: "francés", de: "alemán", pt: "portugués", it: "italiano",
  zh: "chino", ja: "japonés", ko: "coreano", ar: "árabe", ru: "ruso",
  nl: "neerlandés", sv: "sueco", da: "danés", no: "noruego", fi: "finés",
  pl: "polaco", cs: "checo", tr: "turco", hi: "hindi", ca: "catalán", es: "español",
};

function timeAgo(dateStr: string) {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es });
}

// Compact "hace X" — Spanish formatDistanceToNow gets long ("hace alrededor de 2
// horas") and clipped in the narrow list. This stays short and always fits.
function shortTimeAgo(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return "ahora";
  const m = Math.floor(secs / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `hace ${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  return `hace ${Math.floor(months / 12)} a`;
}

function getInitials(name: string | null, email: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function getMessageDeduplicationKey(message: any): string {
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

function fileKind(name: string, mime: string): { label: string; color: string; isImage: boolean } {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"].includes(ext)) return { label: "Imagen", color: "bg-violet-100 text-violet-600", isImage: true };
  if (m.includes("pdf") || ext === "pdf") return { label: "PDF", color: "bg-red-100 text-red-600", isImage: false };
  if (["doc", "docx", "odt", "rtf"].includes(ext) || m.includes("word") || m.includes("opendocument.text")) return { label: "Documento", color: "bg-blue-100 text-blue-600", isImage: false };
  if (["xls", "xlsx", "csv", "ods"].includes(ext) || m.includes("sheet") || m.includes("excel")) return { label: "Hoja de cálculo", color: "bg-emerald-100 text-emerald-600", isImage: false };
  if (["ppt", "pptx", "odp"].includes(ext) || m.includes("presentation") || m.includes("powerpoint")) return { label: "Presentación", color: "bg-orange-100 text-orange-600", isImage: false };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { label: "Comprimido", color: "bg-amber-100 text-amber-600", isImage: false };
  return { label: ext ? ext.toUpperCase() : "Archivo", color: "bg-slate-100 text-slate-600", isImage: false };
}

function humanSize(base64: string): string {
  const bytes = Math.floor(base64.length * 0.75);
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function humanBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export type StoredAttachment = { name: string; mime: string; size: number; path: string };

/** Attachment whose binary lives in Supabase Storage. Opens/downloads via a
 *  short-lived signed URL; images get an inline thumbnail. */
function StoredAttachmentCard({ att }: { att: StoredAttachment }) {
  const kind = useMemo(() => fileKind(att.name, att.mime), [att.name, att.mime]);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!kind.isImage) return;
    let alive = true;
    supabase.storage.from("inbox-attachments").createSignedUrl(att.path, 3600).then(({ data }) => {
      if (alive) setThumb(data?.signedUrl || null);
    });
    return () => { alive = false; };
  }, [att.path, kind.isImage]);

  const open = async () => {
    const { data } = await supabase.storage.from("inbox-attachments").createSignedUrl(att.path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };
  const download = async () => {
    const { data } = await supabase.storage.from("inbox-attachments").createSignedUrl(att.path, 3600, { download: att.name });
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl; a.download = att.name;
      document.body.appendChild(a); a.click(); a.remove();
    }
  };

  if (kind.isImage && thumb) {
    return (
      <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-muted/30">
        <button type="button" onClick={open} title={`Ver ${att.name}`} className="block">
          <img src={thumb} alt={att.name} className="max-h-56 w-auto max-w-full object-contain" />
        </button>
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-card/80 px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11px] font-medium text-foreground" title={att.name}>{att.name}</span>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{humanBytes(att.size)}</span>
            <button type="button" onClick={download} title="Descargar" className="text-muted-foreground hover:text-primary"><Download className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[300px] items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${kind.color}`}>
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-foreground" title={att.name}>{att.name}</div>
        <div className="text-[11px] text-muted-foreground">{kind.label}{att.size ? ` · ${humanBytes(att.size)}` : ""}</div>
        <div className="mt-1 flex items-center gap-3">
          <button type="button" onClick={open} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
            <MailOpen className="h-3 w-3" /> Ver
          </button>
          <button type="button" onClick={download} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
            <Download className="h-3 w-3" /> Descargar
          </button>
        </div>
      </div>
    </div>
  );
}

/** One received attachment. Images show an inline thumbnail; everything else a
 *  typed file card. Both open in a new tab and download. */
function AttachmentCard({ att }: { att: ParsedAttachment }) {
  const kind = useMemo(() => fileKind(att.name, att.mime), [att.name, att.mime]);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!kind.isImage) return;
    const u = attachmentObjectUrl(att);
    setThumbUrl(u);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [att, kind.isImage]);

  const open = () => {
    const url = attachmentObjectUrl(att);
    if (url) { window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 120000); }
  };
  const download = () => {
    const url = attachmentObjectUrl(att);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url; a.download = att.name || "adjunto";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  };

  if (kind.isImage && thumbUrl) {
    return (
      <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-muted/30">
        <button type="button" onClick={open} title={`Ver ${att.name}`} className="block">
          <img src={thumbUrl} alt={att.name} className="max-h-56 w-auto max-w-full object-contain" />
        </button>
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-card/80 px-2.5 py-1.5 backdrop-blur">
          <span className="min-w-0 truncate text-[11px] font-medium text-foreground" title={att.name}>{att.name}</span>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{humanSize(att.base64)}</span>
            <button type="button" onClick={download} title="Descargar" className="text-muted-foreground hover:text-primary"><Download className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[300px] items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${kind.color}`}>
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-foreground" title={att.name}>{att.name}</div>
        <div className="text-[11px] text-muted-foreground">{kind.label} · {humanSize(att.base64)}</div>
        <div className="mt-1 flex items-center gap-3">
          <button type="button" onClick={open} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
            <MailOpen className="h-3 w-3" /> Ver
          </button>
          <button type="button" onClick={download} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
            <Download className="h-3 w-3" /> Descargar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shows attachments (e.g. a PDF) under a message. When the base64 payload is
 *  present it renders rich cards (Ver/Descargar + image previews); otherwise a
 *  name-only chip. */
function AttachmentChips({ bodyText, bodyHtml, stored }: { bodyText?: string | null; bodyHtml?: string | null; stored?: StoredAttachment[] | null }) {
  // Prefer attachments stored in Storage by the sync (real binary → view/download).
  const storedAtts = useMemo(() => (Array.isArray(stored) ? stored.filter((a) => a && a.path) : []), [stored]);

  const atts = useMemo(() => {
    if (storedAtts.length > 0) return [];
    const found = [...extractAttachments(bodyHtml || ""), ...extractAttachments(bodyText || "")];
    const byKey = new Map<string, ParsedAttachment>();
    for (const a of found) if (!byKey.has(a.name)) byKey.set(a.name, a);
    return Array.from(byKey.values());
  }, [bodyText, bodyHtml, storedAtts]);

  // Fallback: names only (no stored binary and none decodable from the body).
  const nameOnly = useMemo(() => {
    if (storedAtts.length > 0 || atts.length > 0) return [];
    const set = new Set<string>();
    extractAttachmentNames(bodyText || "").forEach((n) => set.add(n));
    extractAttachmentNames(bodyHtml || "").forEach((n) => set.add(n));
    return Array.from(set);
  }, [storedAtts, atts, bodyText, bodyHtml]);

  if (storedAtts.length === 0 && atts.length === 0 && nameOnly.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2.5">
      {storedAtts.map((att) => <StoredAttachmentCard key={att.path} att={att} />)}
      {atts.map((att) => <AttachmentCard key={att.name} att={att} />)}
      {nameOnly.map((name) => (
        <div key={name} title={name} className="inline-flex max-w-full items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <FileText className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-foreground">{name}</span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Paperclip className="h-3 w-3" /> Adjunto
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export default function Unibox() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  // Instant re-entry: seed from the session cache so coming back to the Unibox
  // paints the last known list immediately; loadMessages refreshes in background.
  const [messages, setMessages] = useState<any[]>(() => cacheGet<any[]>("unibox:messages") || []);
  // English gate: domains that belong to leads in the user's lists. English (or
  // other-foreign) messages from senders OUTSIDE these domains are hidden.
  // ALL lead domains for this user, loaded once via the get_lead_domains RPC.
  // English/other-foreign messages are HIDDEN unless the sender is a known lead
  // (lead_id/campaign_id) or its domain is in this set — strict, no leaks.
  const [leadDomains, setLeadDomains] = useState<Set<string>>(new Set());
  const [leadDomainsReady, setLeadDomainsReady] = useState(false);
  const [mailboxMode, setMailboxMode] = useState<"clean" | "all">("clean");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Multi-select for bulk delete of Unibox messages.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [loading, setLoading] = useState(() => !cacheGet<any[]>("unibox:messages"));
  const [syncing, setSyncing] = useState(false);


  const [search, setSearch] = useState("");
  const [showWarmup, setShowWarmup] = useState(false);
  const [langNonce, setLangNonce] = useState(0);
  const [tcxAccounts, setTcxAccounts] = useState<Set<string>>(new Set());
  const langCacheRef = useRef<Map<string, "es" | "en" | "fr" | "it" | "other" | "unknown">>(new Map());
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<FilterType>("all");
  const [showTodayOnly, setShowTodayOnly] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncLockRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyDraftRef = useRef(""); // mirrors `reply` so the debounced reload can skip while composing
  const backgroundSyncOffsetRef = useRef(0);
  const lastAutoSyncAttemptRef = useRef(0);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  // Reading pane: on desktop the reader is portalled INTO this box so it fills
  // the "Tu bandeja unificada" area exactly (inline, no popup/overlay).
  const readingPaneRef = useRef<HTMLDivElement>(null);
  // "Wide" = ≥1280px (xl): only then is there room for the 2-column inline reader
  // inside the pane. Below that (laptops), a message opens as a comfortable wide
  // modal so it's actually readable instead of a cramped ~480px column.
  const [isDesktop, setIsDesktop] = useState(false);
  // Reader can be expanded to a big centered fullscreen modal (with backdrop).
  const [readerExpanded, setReaderExpanded] = useState(false);
  // Show the FULL original email (signature + quoted thread) instead of the clean
  // collapsed version — matches how a normal webmail shows the message.
  const [showFullEmail, setShowFullEmail] = useState(false);
  // Files the user attaches to a reply (sent via send-email as base64 parts).
  const [replyFiles, setReplyFiles] = useState<{ filename: string; mime: string; base64: string; size: number }[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1536px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPromptName, setAiPromptName] = useState("");
  const [aiPrompts, setAiPrompts] = useState<any[]>([]);
  const [accountsMap, setAccountsMap] = useState<Record<string, string[]>>({});
  const [accountEmailMap, setAccountEmailMap] = useState<Record<string, string>>({});
  // ── Signature manager (also reachable from Email Accounts) ──
  const [sigAccounts, setSigAccounts] = useState<{ id: string; email: string; tags: string[]; signature_html?: string }[]>([]);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigHtml, setSigHtml] = useState("");
  const [sigScope, setSigScope] = useState<"all" | "tag" | "account">("all");
  const [sigTag, setSigTag] = useState("");
  const [sigAccountId, setSigAccountId] = useState("");
  const [sigSaving, setSigSaving] = useState(false);
  const [reminders, setReminders] = useState<Record<string, any>>({});
  const [reminderBody, setReminderBody] = useState("");
  const [folders, setFolders] = useState<any[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState("#6366f1");
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [viewTab, setViewTab] = useState<"global" | "all_mailboxes" | "important" | "campaigns" | "reminders" | "sent">("global");
  const [sentItems, setSentItems] = useState<any[]>([]); // manual replies/forwards you sent
  const [importantItems, setImportantItems] = useState<any[]>([]); // messages you starred (label "Importante")
  // Recipients you PERSONALLY replied to from the Unibox (campaign_id null). Any
  // inbound from one of these is a real conversation → it must always show in the
  // clean bandeja ("Todos"), whatever language it is in. Loaded on mount so the
  // filter is correct from the first render (not only after visiting "Enviados").
  const [repliedToSet, setRepliedToSet] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");
  const [translatedBody, setTranslatedBody] = useState("");
  const [translating, setTranslating] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [replyLang, setReplyLang] = useState<string | null>(null); // lang the reply was translated into
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<{ email: string; domain: string } | null>(null);
  const [blocking, setBlocking] = useState(false);
  // Blocklist manager (view + unblock emails/domains)
  const [blockManagerOpen, setBlockManagerOpen] = useState(false);
  const [blockedEntries, setBlockedEntries] = useState<any[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<any[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  // Forward (reenviar)
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardNote, setForwardNote] = useState("");
  const [forwarding, setForwarding] = useState(false);
  // Delete lead (cascade)
  const [deleteLeadOpen, setDeleteLeadOpen] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);
  const loadReminders = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("message_reminders")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_done", false);
    const map: Record<string, any> = {};
    (data || []).forEach((r: any) => { map[r.message_id] = r; });
    setReminders(map);
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    // TWO-LANE LOAD. A single "latest 800" window let warm-up floods crowd real
    // replies out of view (live check: 800 latest = only 5 lead-linked, ~700
    // warmup). Lane 1 always brings the latest LEAD-LINKED messages (real
    // replies); lane 2 brings the latest unlinked ones. Real replies can never
    // be displaced by warm-up volume.
    // List payload: everything the list/filters/snippet need, but NOT body_html
    // (up to ~50 KB each). The full HTML + attachments are fetched only when a
    // message is opened (loadThread). This cut the Unibox load from ~55 MB to a
    // few MB → much faster first paint and a fraction of the egress.
    // Typed as `string` on purpose: the generated types.ts is stale (missing
    // folder_id/labels/etc.), so a literal column list would fail TS validation
    // even though the columns exist at runtime. Widening to string skips that.
    const LIST_COLS: string = INBOX_LIST_COLS;
    const [linkedRes, unlinkedRes] = await Promise.all([
      supabase
        .from("inbox_messages")
        .select(LIST_COLS)
        .eq("user_id", user.id)
        .eq("is_archived", false)
        .or("lead_id.not.is.null,campaign_id.not.is.null")
        .order("received_at", { ascending: false })
        .limit(500),
      supabase
        .from("inbox_messages")
        .select(LIST_COLS)
        .eq("user_id", user.id)
        .eq("is_archived", false)
        .is("lead_id", null)
        .is("campaign_id", null)
        .order("received_at", { ascending: false })
        .limit(500),
    ]);
    const seenIds = new Set<string>();
    const raw = [...((linkedRes.data as any[]) || []), ...((unlinkedRes.data as any[]) || [])]
      .filter((m) => (seenIds.has(m.id) ? false : (seenIds.add(m.id), true)))
      .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());

    const seenMessageKeys = new Set<string>();
    const msgs = raw.filter((message) => {
      // Download everything (deduped); the unibox filters (warmup A / language B /
      // bounces C) and the "Mostrar warmup" toggle decide visibility in the view layer.
      const key = getMessageDeduplicationKey(message);
      if (seenMessageKeys.has(key)) return false;
      seenMessageKeys.add(key);
      return true;
    });
    setMessages(msgs);
    cacheSet("unibox:messages", msgs); // instant paint on next visit
    setLoading(false);

    // Auto-label messages classified as "Interesado" that don't already have the label
    const toLabel = msgs.filter(m => {
      if (isSpam(m.subject, m.body_text, m.from_email)) return false;
      const cat = classifyMessage(m.subject, m.body_text);
      const labels: string[] = m.labels || [];
      if (cat === "interested" && !labels.includes("Interesado")) return true;
      if (cat === "not_interested" && !labels.includes("No interesado")) return true;
      if (cat === "out_of_office" && !labels.includes("Fuera / Auto")) return true;
      if (cat === "question" && !labels.includes("Pregunta")) return true;
      return false;
    });

    for (const m of toLabel) {
      const cat = classifyMessage(m.subject, m.body_text);
      const currentLabels: string[] = m.labels || [];
      let newLabel = "";
      if (cat === "interested") newLabel = "Interesado";
      else if (cat === "not_interested") newLabel = "No interesado";
      else if (cat === "out_of_office") newLabel = "Fuera / Auto";
      else if (cat === "question") newLabel = "Pregunta";
      if (newLabel && !currentLabels.includes(newLabel)) {
        const updatedLabels = [...currentLabels, newLabel];
        supabase
          .from("inbox_messages")
          .update({ labels: updatedLabels })
          .eq("id", m.id)
          .then(() => {
            // Update local state too
            setMessages(prev => prev.map(msg =>
              msg.id === m.id ? { ...msg, labels: updatedLabels } : msg
            ));
          });
      }
    }
  }, [user]);

  const syncInbox = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!user || syncLockRef.current) return;
    syncLockRef.current = true;
    if (!silent) setSyncing(true);

    // Small batches keep each fetch-inbox call UNDER the edge function's compute
    // limit. Big batches (≥16 accounts at once) return WORKER_RESOURCE_LIMIT and the
    // whole sync used to fail. We loop with an offset and, if a batch fails, retry it
    // with progressively smaller batches and finally skip the single heavy mailbox —
    // so one bad account never aborts the sync.
    const BATCH = silent ? 4 : 5;
    const FETCH_LIMIT = silent ? 60 : 120;
    // Background sync must cover ALL of the user's accounts each cycle so every
    // Spanish/Catalan message arrives automatically (no manual "Sincronizar").
    const MAX_ROUNDS = silent ? 40 : 40;
    const PROGRESS_ID = "unibox-sync";

    // Fetch the token ONCE per sync (not per round) — avoids pinging Auth up to
    // 40× per sync, which needlessly loaded the auth service.
    const { data: { session: syncSession } } = await supabase.auth.getSession();
    const accessToken = syncSession?.access_token;

    const callOnce = async (offset: number, batch: number) => {
      try {
        if (!accessToken) return { ok: false, status: 401, json: { error: "Sesión no válida" } };
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-inbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ offset, batch_size: batch, fetch_limit: FETCH_LIMIT }),
        });
        let json: any = null;
        try { json = await resp.json(); } catch { json = null; }
        return { ok: resp.ok && json && !json.error, status: resp.status, json };
      } catch (e: any) {
        return { ok: false, status: 0, json: { error: e?.message || "network" } };
      }
    };

    try {
      let totalNew = 0;
      let offset = silent ? backgroundSyncOffsetRef.current : 0;
      let hasMore = true;
      let rounds = 0;
      let failures = 0;
      let anySuccess = false;
      let firstError: string | null = null;

      if (!silent) toast.loading("Conectando cuentas…", { id: PROGRESS_ID });

      while (hasMore && rounds < MAX_ROUNDS) {
        let res = await callOnce(offset, BATCH);
        // On resource-limit / failure, retry the SAME offset with smaller batches
        if (!res.ok) res = await callOnce(offset, 2);
        if (!res.ok) res = await callOnce(offset, 1);

        if (res.ok) {
          anySuccess = true;
          totalNew += Number(res.json.new_messages || 0);
          hasMore = Boolean(res.json.has_more);
          offset = Number(res.json.next_offset ?? offset + BATCH);
        } else {
          // Single mailbox still failing → skip it and keep going
          failures += 1;
          if (!firstError) firstError = res.json?.message || res.json?.error || `HTTP ${res.status}`;
          offset = offset + 1;
          hasMore = true;
        }
        backgroundSyncOffsetRef.current = hasMore ? offset : 0;
        rounds += 1;
        if (!silent && rounds % 3 === 0) {
          toast.loading(`Conectando… ${offset} cuentas revisadas · ${totalNew} mensajes`, { id: PROGRESS_ID });
        }
      }

      setLastSyncAt(new Date());
      await load();
      if (!silent) {
        if (!anySuccess) {
          toast.error(firstError ? `No se pudo sincronizar: ${firstError}` : "No se pudo sincronizar", { id: PROGRESS_ID });
        } else if (failures > 0) {
          toast.success(`${totalNew} mensajes nuevos · ${failures} cuentas pesadas se reintentarán solas`, { id: PROGRESS_ID });
        } else {
          toast.success(`${totalNew} mensajes nuevos`, { id: PROGRESS_ID });
        }
      }
    } catch (e: any) {
      if (!silent) toast.error(`Error: ${e.message}`, { id: PROGRESS_ID });
    } finally {
      syncLockRef.current = false;
      if (!silent) setSyncing(false);
    }
  }, [user, load]);

  /** Silent background IMAP sync – no toasts, no loading state */
  const autoSync = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    // Throttle to ~50s so the background IMAP sync runs about once a minute.
    if (now - lastAutoSyncAttemptRef.current < 50_000) return;
    lastAutoSyncAttemptRef.current = now;
    await syncInbox({ silent: true });
  }, [syncInbox]);

  // Load AI prompts and account tags
  useEffect(() => {
    if (!user) return;
    const loadAI = async () => {
      const [{ data: prompts }, { data: accounts }, { data: campaignsData }, { data: foldersData }] = await Promise.all([
        supabase.from("ai_prompts").select("*").eq("user_id", user.id),
        supabase.from("email_accounts").select("id, email, tags, signature_html").eq("user_id", user.id),
        supabase.from("campaigns").select("id, name").eq("user_id", user.id).order("name"),
        (supabase as any).from("unibox_folders").select("*").eq("user_id", user.id).order("created_at"),
      ]);
      setAiPrompts(prompts || []);
      setCampaigns(campaignsData || []);
      setFolders(foldersData || []);
      const map: Record<string, string[]> = {};
      // tcx = accounts EXPLICITLY tagged "tcx" (international → allow any language).
      // Opt-in only: a tag exactly equal to "tcx". We deliberately do NOT infer it
      // from the email address, so the Spanish/Catalan filter applies everywhere
      // by default and English never leaks through.
      const tcx = new Set<string>();
      const emailMap: Record<string, string> = {};
      accounts?.forEach((a: any) => {
        map[a.id] = a.tags || [];
        if (a.email) emailMap[a.id] = a.email;
        const tagHit = (a.tags || []).some((t: string) => String(t).trim().toLowerCase() === "tcx");
        if (tagHit) tcx.add(a.id);
      });
      setAccountsMap(map);
      setAccountEmailMap(emailMap);
      setSigAccounts((accounts || []).map((a: any) => ({ id: a.id, email: a.email, tags: a.tags || [], signature_html: a.signature_html || "" })));
      setTcxAccounts(tcx);
    };
    loadAI();
  }, [user]);

  

  const handleAiSuggest = async () => {
    if (!selected) return;
    setAiLoading(true);
    setAiSuggestion("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ message_id: selected.id }),
      });
      const result = await resp.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        setAiSuggestion(result.suggestion);
        setAiPromptName(result.prompt_name || "IA");
      }
    } catch (e: any) {
      toast.error(`Error IA: ${e.message}`);
    }
    setAiLoading(false);
  };

  // Load conversation thread when selecting a message
  const loadThread = useCallback(async (msg: any) => {
    if (!user || !msg) { setThreadMessages([]); return; }
    setThreadLoading(true);
    try {
      // Get all inbox messages from this contact to this account
      const { data: inboxMsgs } = await supabase
        .from("inbox_messages")
        .select("*")
        .eq("user_id", user.id)
        .eq("account_id", msg.account_id)
        .eq("from_email", msg.from_email)
        .eq("is_archived", false)
        .order("received_at", { ascending: true });

      // Get all sent emails to this contact from this account
      const { data: sentMsgs } = await supabase
        .from("sent_emails")
        .select("*")
        .eq("user_id", user.id)
        .eq("account_id", msg.account_id)
        .eq("to_email", msg.from_email)
        .eq("status", "sent")
        .order("sent_at", { ascending: true });

      // Merge into unified thread
      const thread: any[] = [];
      
      // Deduplicate inbox messages
      const seenKeys = new Set<string>();
      for (const m of (inboxMsgs || [])) {
        const key = getMessageDeduplicationKey(m);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        // Keep every real reply in the thread (codes are stripped on display);
        // only drop delivery-failure / system noise.
        if (isBounceOrNoise(m.from_email)) continue;
        thread.push({ ...m, _type: "received", _date: m.received_at });
      }

      for (const s of (sentMsgs || [])) {
        thread.push({ ...s, _type: "sent", _date: s.sent_at });
      }

      thread.sort((a, b) => new Date(a._date).getTime() - new Date(b._date).getTime());
      setThreadMessages(thread);
    } catch (e) {
      console.error("Error loading thread:", e);
      setThreadMessages([]);
    }
    setThreadLoading(false);
  }, [user]);

  // ENVIADOS: your manual replies/forwards live in sent_emails with campaign_id NULL
  // (campaign auto-sends have a campaign_id). Map them into the same list shape so the
  // existing row/detail/thread UI just works. from_email = the recipient, so clicking
  // opens the full conversation.
  const loadSent = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("sent_emails")
      .select("id, account_id, to_email, subject, body, sent_at, campaign_id, lead_id, smtp_message_id")
      .eq("user_id", user.id)
      .is("campaign_id", null)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(500);
    setSentItems((data || []).map((s: any) => ({
      id: s.id,
      account_id: s.account_id,
      from_email: s.to_email,
      from_name: s.to_email,
      to_email: s.to_email,
      subject: s.subject,
      body_text: s.body,
      body_html: s.body,
      received_at: s.sent_at,
      is_read: true,
      is_archived: false,
      campaign_id: s.campaign_id,
      lead_id: s.lead_id,
      message_id: s.smtp_message_id,
      _sent: true,
    })));
  }, [user]);

  useEffect(() => { if (viewTab === "sent") loadSent(); }, [viewTab, loadSent]);

  // Load ALL starred messages straight from the DB (not just the ones inside the
  // in-memory 500+500 window), so the "Importantes" tab always shows everything you
  // flagged. Loaded on mount (for the tab badge count) and whenever the tab is opened.
  const loadImportant = useCallback(async () => {
    if (!user) return;
    const { data, error } = await (supabase as any)
      .from("inbox_messages")
      .select(INBOX_LIST_COLS)
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .contains("labels", [IMPORTANT_LABEL])
      .order("received_at", { ascending: false })
      .limit(500);
    if (error) { console.warn("loadImportant failed, keeping current list:", error.message); return; }
    setImportantItems(data || []);
  }, [user]);

  // ── Global search straight from the DB ──────────────────────────────────────
  // The in-memory search only saw the loaded 500+500 window AND ran AFTER the
  // language/warmup filter, so typing an email often found nothing. This queries the
  // whole mailbox (received messages) by email / name / subject / body, ignoring the
  // clean-bandeja filter — so a contact's conversation is always findable. Clicking a
  // result opens the full thread (received + sent) via loadThread.
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setSearchResults(null); setSearching(false); return; }
    if (!user) return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      // Sanitize for PostgREST or()/ilike: strip chars that break the filter grammar
      // (comma, parens, asterisk). Dots/@/dashes in an email are fine.
      const safe = q.replace(/[,()*]/g, " ").trim();
      const pat = `*${safe}*`;
      const { data, error } = await (supabase as any)
        .from("inbox_messages")
        .select(INBOX_LIST_COLS)
        .eq("user_id", user.id)
        .eq("is_archived", false)
        .or(`from_email.ilike.${pat},from_name.ilike.${pat},subject.ilike.${pat},body_text.ilike.${pat}`)
        .order("received_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) { console.warn("unibox search failed:", error.message); setSearching(false); return; }
      // One row per contact (newest), so results read like conversations, not dupes.
      const byContact = new Map<string, any>();
      for (const m of (data || [])) {
        const key = (m.from_email || m.id).toLowerCase();
        if (!byContact.has(key)) byContact.set(key, m);
      }
      setSearchResults(Array.from(byContact.values()));
      setSearching(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, user]);
  useEffect(() => { loadImportant(); }, [loadImportant]);
  useEffect(() => { if (viewTab === "important") loadImportant(); }, [viewTab, loadImportant]);

  // Load the set of addresses you've personally replied to (Unibox sends, not the
  // campaign engine) so the clean-bandeja filter never hides a conversation you're
  // already part of. Cheap: one slim query, to_email only.
  const loadRepliedTo = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("sent_emails")
      .select("to_email")
      .eq("user_id", user.id)
      .is("campaign_id", null)   // manual/unibox replies only, never bulk campaign sends
      .eq("status", "sent")
      .limit(3000);
    setRepliedToSet(new Set((data || []).map((r: any) => String(r.to_email || "").toLowerCase()).filter(Boolean)));
  }, [user]);
  useEffect(() => { loadRepliedTo(); }, [loadRepliedTo]);

  // Clear the translation ONLY when the selected message changes — not on every
  // 30s messages reload (that used to make a just-made translation disappear).
  useEffect(() => { setTranslatedBody(""); }, [selectedId]);

  // Clear AI suggestion + probe language + load thread on select / refresh
  useEffect(() => {
    setAiSuggestion("");
    setAiPromptName("");
    const msg = messages.find(m => m.id === selectedId) || searchResults?.find(m => m.id === selectedId) || importantItems.find(m => m.id === selectedId) || sentItems.find(m => m.id === selectedId);
    if (msg) {
      // Proactively flag the language (cheap local detector) so the reply box can
      // offer auto-translate without the user first pressing "Traducir". Only the
      // clear English case is set; es/other/unknown stay null as before.
      const probe = detectLanguageBucket(`${decodeSubjectKeepCodes(msg.subject || "")} ${(msg.body_text || "").slice(0, 800)}`);
      setDetectedLang(probe === "en" ? "en" : null);
      loadThread(msg);
    } else {
      setDetectedLang(null);
      setThreadMessages([]);
    }
  }, [selectedId, messages, sentItems, searchResults, importantItems, loadThread]);




  // Initial load + initial IMAP sync + reminders + blocklist (for filtering)
  useEffect(() => {
    load();
    loadReminders();
    loadBlockedEntries();
    const syncTimeout = setTimeout(() => {
      autoSync();
    }, 1500);
    return () => clearTimeout(syncTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, autoSync, loadReminders]);

  // Keep a ref of the reply draft so the debounced reload can tell if the user is
  // mid-compose without re-creating the callback on every keystroke.
  useEffect(() => { replyDraftRef.current = reply; }, [reply]);

  // DEBOUNCED, compose-aware reload. A background IMAP sync inserts many rows at
  // once; firing load() on each realtime event re-rendered the whole list over and
  // over ("the screen keeps refreshing"). Now we coalesce bursts into ONE reload a
  // few seconds after activity settles, and NEVER reload while the user is writing a
  // reply — the data still syncs, the screen just doesn't yank under their hands.
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    const run = () => {
      if (replyDraftRef.current.trim().length > 0) {
        reloadTimerRef.current = setTimeout(run, 8000); // busy composing → try again later
        return;
      }
      load();
    };
    reloadTimerRef.current = setTimeout(run, 4000);
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("unibox-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_messages", filter: `user_id=eq.${user.id}` }, () => scheduleReload())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, scheduleReload]);

  // Safety net refresh (much less often than before, and coalesced/compose-aware).
  useEffect(() => {
    intervalRef.current = setInterval(() => { scheduleReload(); }, 120_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, [scheduleReload]);

  // Auto-sync IMAP every 60 seconds (no manual "Sincronizar" needed)
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => { autoSync(); }, 60_000);
    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
  }, [autoSync]);

  // Detail opens in a modal — no auto-selection so closing actually closes.

  const selected = useMemo(() => messages.find(m => m.id === selectedId) || (searchResults || []).find(m => m.id === selectedId) || importantItems.find(m => m.id === selectedId) || sentItems.find(m => m.id === selectedId) || null, [messages, sentItems, searchResults, importantItems, selectedId]);

  // Language bucket per message, cached by id (text never changes). Cleared by "Re-filtrar idioma".
  const messageLang = useCallback((m: any): "es" | "en" | "fr" | "it" | "other" | "unknown" => {
    const cache = langCacheRef.current;
    const hit = cache.get(m.id);
    if (hit) return hit;
    let body = cleanBodyText(m.body_text || "");
    // HTML-only emails have little/no plain text — fall back to the HTML body
    // (cleanBodyText strips tags) so English HTML mails are still classified.
    if (body.replace(/\s+/g, " ").trim().length < 15 && m.body_html) {
      body = cleanBodyText(m.body_html);
    }
    const text = `${decodeSubjectKeepCodes(m.subject)} ${body.slice(0, 800)}`;
    const bucket = detectLanguageBucket(text);
    cache.set(m.id, bucket);
    return bucket;
  }, []);

  // Load ALL of this user's lead domains ONCE (get_lead_domains RPC, auth.uid-scoped).
  // Complete + deterministic → English is gated strictly with no per-message lazy
  // lookups and no leaks. Retries a few times on failure.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        const { data, error } = await (supabase as any).rpc("get_lead_domains");
        if (!error && Array.isArray(data)) {
          const set = new Set<string>();
          for (const r of data) {
            const d = (r?.domain || "").toLowerCase().trim();
            if (d) set.add(d);
          }
          if (!cancelled) { setLeadDomains(set); setLeadDomainsReady(true); }
          return;
        }
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Warm-up classification — revealed by "Mostrar warmup". Rules:
  //  1) A message with ≥2 random letters+digits codes (e.g. "FJRI829FJSC CHBV6J7")
  //     in subject+body is hidden — intelligent detector, no false positives.
  //  2) ENGLISH GATE (strict): English/other-foreign messages are HIDDEN unless the
  //     sender is a known lead — linked lead_id/campaign_id, OR its domain is in the
  //     user's lead domains. Everything else English = warm-up/outreach noise → hidden.
  //     ES/CA, FR, IT and ambiguous messages always show.
  const isWarmupHidden = useCallback((m: any): boolean => {
    // A message from a REAL lead is NEVER warm-up — warm-up traffic comes from other
    // seed mailboxes, never from your prospects. Show it in full, in any language,
    // WITH whatever letter+digit refs it carries (e.g. a chip part number a
    // CHIPSFINDER lead replied with: "STM32F407", "ATMEGA328P", "LM358"). This gate
    // MUST run BEFORE the warm-up-code rule, or a genuine reply listing 2+ part
    // numbers would be wrongly hidden as "codes".
    if (m.lead_id || m.campaign_id) return false;
    const dom = (m.from_email || "").split("@")[1]?.toLowerCase() || "";
    if (dom && leadDomains.has(dom)) return false;

    // Unknown sender only (NOT a lead, NOT a lead domain):
    let body = cleanBodyText(m.body_text || "");
    if (body.replace(/\s+/g, " ").trim().length < 15 && m.body_html) {
      body = cleanBodyText(m.body_html);
    }
    // ≥2 random letter+digit code tokens = warm-up noise → hide.
    if (countWarmupCodes(`${decodeSubjectKeepCodes(m.subject)} ${body}`) >= 2) return true;
    // Only clearly home-language inbound (ES/CA, FR, IT) from a stranger is shown;
    // English / ambiguous from an unknown sender = outreach noise → hidden.
    const lang = messageLang(m);
    if (lang === "es" || lang === "fr" || lang === "it") return false;
    return true;
  }, [messageLang, leadDomains]);

  // Hidden from the CLEAN bandeja (Global / Campaigns / Recordatorios).
  const hiddenFromClean = useCallback((m: any): boolean => {
    if (isBounceOrNoise(m.from_email)) return true;   // bounces / system senders
    // If YOU already replied to this sender from the Unibox, it's a real, ongoing
    // conversation — never hide it from "Todos", whatever language it's written in.
    // (Fixes: reply to a FR/EN lead → the inbound vanished from the clean bandeja and
    // only the sent copy remained under "Enviados".)
    if (repliedToSet.has((m.from_email || "").toLowerCase())) return false;
    if (isWarmupHidden(m)) return true;               // warmup codes + clearly-foreign language
    // NOTE: the old "only relevant replies" gate hid normal inbound mail and made the
    // bandeja look empty. We now show every non-bounce, non-warmup ES/CA message.
    return false;
  }, [isWarmupHidden, repliedToSet]);

  const handleRefilterLanguage = useCallback(() => {
    langCacheRef.current.clear();
    setLangNonce((n) => n + 1);
    toast.success("Filtro de idioma reaplicado");
  }, []);

  // No longer auto-detect on select — detect happens on translate click

  const handleTranslateBody = async () => {
    if (!selected) return;
    if (translatedBody) { setTranslatedBody(""); setDetectedLang(null); return; }
    setTranslating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Use the SAME text the user is reading: fall back to the HTML body for
      // HTML-only emails (empty/thin body_text) so we never translate an empty string.
      let body = cleanBodyText(selected.body_text || "");
      if (body.replace(/\s+/g, " ").trim().length < 15 && selected.body_html) {
        body = cleanBodyText(selected.body_html);
      }
      if (!body.trim()) { toast.error("No hay texto que traducir"); setTranslating(false); return; }
      // Detect is BEST-EFFORT (only to label the language + skip if already Spanish).
      // If it fails, we translate anyway — the user clicked "Traducir". DeepSeek
      // translates ANY language (Italian, German, etc.) to Spanish.
      try {
        const detectResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ text: body.slice(0, 500), mode: "detect" }),
        });
        const detectResult = await detectResp.json();
        const lang = detectResult.language || null;
        if (lang) setDetectedLang(lang);
        if (lang === "es" || lang === "ca") { toast.info("El mensaje ya está en español"); setTranslating(false); return; }
      } catch { /* detect failed — translate anyway */ }
      // Translate to Spanish (works for any source language)
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ text: body, target_lang: "es", mode: "translate" }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else setTranslatedBody(result.translated);
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setTranslating(false);
  };

  // ── Signature manager (Unibox entry) ──
  const sigAllTags = useMemo(() => {
    const s = new Set<string>();
    sigAccounts.forEach(a => (a.tags || []).forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [sigAccounts]);
  const sigTargetIds = useMemo(() => {
    if (sigScope === "account") return sigAccountId ? [sigAccountId] : [];
    if (sigScope === "tag") return sigAccounts.filter(a => (a.tags || []).includes(sigTag)).map(a => a.id);
    return sigAccounts.map(a => a.id); // "all"
  }, [sigScope, sigTag, sigAccountId, sigAccounts]);
  const openSignature = () => {
    const existing = sigAccounts.find(a => (a.signature_html || "").trim())?.signature_html || "";
    setSigHtml(existing);
    setSigScope("all");
    setSigTag(sigAllTags[0] || "");
    setSigAccountId(sigAccounts[0]?.id || "");
    setSigOpen(true);
  };
  const applyUniboxSignature = async () => {
    if (!user) return;
    const ids = sigTargetIds;
    if (!ids.length) { toast.error("No hay cuentas en el alcance elegido"); return; }
    setSigSaving(true);
    const { error } = await supabase.from("email_accounts").update({ signature_html: sigHtml } as any).in("id", ids);
    setSigSaving(false);
    if (error) { toast.error(`No se pudo aplicar la firma: ${error.message}`); return; }
    // Reflect locally so the prefill/preview stay in sync without a full reload.
    setSigAccounts(prev => prev.map(a => (ids.includes(a.id) ? { ...a, signature_html: sigHtml } : a)));
    toast.success(sigHtml.trim() ? `Firma aplicada a ${ids.length} cuenta(s)` : `Firma quitada de ${ids.length} cuenta(s)`);
    setSigOpen(false);
  };

  // ── Importantes: mark/unmark a message with the "Importante" label ──
  const isImportant = (m: any): boolean => Array.isArray(m?.labels) && m.labels.includes(IMPORTANT_LABEL);
  // Count = union of DB-loaded starred rows + any in-memory message carrying the label.
  const importantCount = useMemo(() => {
    const ids = new Set<string>();
    for (const m of importantItems) if (!m.is_archived) ids.add(m.id);
    for (const m of messages) if (isImportant(m) && !m.is_archived) ids.add(m.id);
    return ids.size;
  }, [importantItems, messages]);
  const toggleImportant = async (m: any) => {
    if (!user || !m) return;
    const cur: string[] = Array.isArray(m.labels) ? m.labels : [];
    const wasImportant = cur.includes(IMPORTANT_LABEL);
    const next = wasImportant ? cur.filter((l) => l !== IMPORTANT_LABEL) : [...cur, IMPORTANT_LABEL];
    // Optimistic: update the list (star icon) + cache and the Importantes tab NOW.
    setMessages((prev) => {
      const upd = prev.map((msg) => (msg.id === m.id ? { ...msg, labels: next } : msg));
      cacheSet("unibox:messages", upd);
      return upd;
    });
    setImportantItems((prev) => {
      if (wasImportant) return prev.filter((msg) => msg.id !== m.id);
      if (prev.some((msg) => msg.id === m.id)) return prev;
      return [{ ...m, labels: next }, ...prev];
    });
    // Persist AND confirm: .select() returns the affected rows, so we know the write
    // actually landed (0 rows = it silently didn't stick → tell the user, don't lie).
    const { data, error } = await supabase
      .from("inbox_messages")
      .update({ labels: next } as any)
      .eq("id", m.id)
      .eq("user_id", user.id)
      .select("id, labels");
    if (error || !data || data.length === 0) {
      toast.error(error ? `No se pudo guardar: ${error.message}` : "No se pudo guardar la marca (no se encontró el mensaje).");
      // Roll back the optimistic changes.
      setMessages((prev) => prev.map((msg) => (msg.id === m.id ? { ...msg, labels: cur } : msg)));
      setImportantItems((prev) => (wasImportant
        ? [{ ...m, labels: cur }, ...prev.filter((x) => x.id !== m.id)]
        : prev.filter((x) => x.id !== m.id)));
      return;
    }
    toast.success(wasImportant ? "Quitado de Importantes" : "Marcado como importante");
  };

  // Check if the selected message has a matching AI prompt
  const selectedAccountTags = selected ? (accountsMap[selected.account_id] || []) : [];
  const hasAiMatch = aiPrompts.some((p: any) =>
    p.tags.some((t: string) => selectedAccountTags.includes(t))
  );

  const isReminderDue = (messageId: string): boolean => {
    const r = reminders[messageId];
    if (!r) return false;
    return new Date(r.remind_at) <= new Date();
  };

  // Blocked senders/domains → their messages never appear in the Unibox (not
  // even in "Todos"/warmup), so blocking truly removes them from view.
  const blockedEmailSet = useMemo(
    () => new Set(blockedEntries.filter((e) => e.entry_type === "email").map((e) => String(e.value).toLowerCase())),
    [blockedEntries],
  );
  const blockedDomainSet = useMemo(
    () => new Set(blockedEntries.filter((e) => e.entry_type === "domain").map((e) => String(e.value).toLowerCase())),
    [blockedEntries],
  );
  const isBlockedSender = useCallback((email?: string | null) => {
    const e = (email || "").toLowerCase();
    if (!e) return false;
    if (blockedEmailSet.has(e)) return true;
    const dom = e.split("@")[1] || "";
    return dom ? blockedDomainSet.has(dom) : false;
  }, [blockedEmailSet, blockedDomainSet]);

  // Apply the unibox filters ALWAYS (Spanish/Catalan only, no warmup, no bounces,
  // only real replies). English/other languages never appear anywhere.
  const filtered = useMemo(() => {
    // ENVIADOS tab: show the messages YOU sent (newest first), search by recipient/subject.
    if (viewTab === "sent") {
      const q = search.toLowerCase();
      return sentItems.filter(m =>
        !search || m.to_email?.toLowerCase().includes(q) || m.subject?.toLowerCase().includes(q)
      );
    }
    // IMPORTANTES tab: UNION of (starred rows loaded straight from the DB) + (any
    // in-memory message that carries the label). The union means a just-starred
    // message is never missing — not to a stale reload, not to a write/read race, not
    // to the 500+500 window.
    if (viewTab === "important") {
      const q = search.toLowerCase();
      const byId = new Map<string, any>();
      for (const m of importantItems) if (!m.is_archived) byId.set(m.id, m);
      for (const m of messages) if (isImportant(m) && !m.is_archived) byId.set(m.id, m);
      return Array.from(byId.values())
        .filter(m => !search ||
          m.from_email?.toLowerCase().includes(q) ||
          m.from_name?.toLowerCase().includes(q) ||
          decodeSubject(m.subject)?.toLowerCase().includes(q))
        .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
    }
    // SEARCH (main inbox tabs): when there's a query, show the DB search results —
    // the whole mailbox, ignoring the language/warmup filter and the loaded window —
    // filtered only by the blocklist. This is what makes "type an email → find the
    // conversation" actually work.
    if (search.trim().length >= 2 && searchResults !== null) {
      return searchResults
        .filter(m => !isBlockedSender(m.from_email))
        .filter(m => !folderFilter || m.folder_id === folderFilter);
    }
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // ESCAPE HATCH: the "Todos" tab (all_mailboxes) shows the RAW mailbox and the
    // "Mostrar warmup" toggle reveals filtered messages — so nothing the strict
    // English/warmup filter hides is ever unrecoverable from the UI.
    const bypassFilters = viewTab === "all_mailboxes" || showWarmup;
    const list = messages
      .filter(m => !isBlockedSender(m.from_email)) // blocked senders never show
      .filter(m => bypassFilters || !hiddenFromClean(m))
      .filter(m => {
        if (viewTab === "reminders") return !!reminders[m.id];
        if (viewTab === "campaigns") {
          if (selectedCampaignId === "all") return true;
          return m.campaign_id === selectedCampaignId;
        }
        return true;
      })
      .filter(m => !showTodayOnly || new Date(m.received_at) >= now24h)
      .filter(m => !folderFilter || m.folder_id === folderFilter)
      .filter(m => categoryFilter === "all" || classifyMessage(m.subject, m.body_text) === categoryFilter)
      .filter(m => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          m.from_email?.toLowerCase().includes(q) ||
          m.from_name?.toLowerCase().includes(q) ||
          decodeSubject(m.subject)?.toLowerCase().includes(q) ||
          cleanBodyText(m.body_text, true).toLowerCase().includes(q)
        );
      });
    // Sort: due reminders first (yellow), then by received_at desc
    return list.sort((a, b) => {
      const aDue = isReminderDue(a.id);
      const bDue = isReminderDue(b.id);
      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    });
  }, [messages, sentItems, importantItems, searchResults, mailboxMode, search, categoryFilter, showTodayOnly, folderFilter, viewTab, selectedCampaignId, reminders, hiddenFromClean, langNonce, showWarmup, isBlockedSender]);

  const categoryCounts = useMemo(() => {
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const base = messages.filter(m => !hiddenFromClean(m));
    const visible = base.filter(m => !showTodayOnly || new Date(m.received_at) >= now24h);
    const counts: Record<string, number> = { all: visible.length };
    for (const m of visible) {
      const cat = classifyMessage(m.subject, m.body_text);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [messages, mailboxMode, showTodayOnly, hiddenFromClean, langNonce]);

  const unreadCount = useMemo(() =>
    messages.filter(m => !m.is_read && !hiddenFromClean(m)).length
  , [messages, hiddenFromClean, langNonce]);

  // Publish the REAL relevant-unread count so the sidebar/mobile-nav badge shows
  // the same number the Unibox shows (not the raw thousands of warm-up rows).
  // Only once the message list + lead-domains are loaded, so we don't broadcast a
  // transient 0 before filtering is ready.
  useEffect(() => {
    if (!leadDomainsReady) return;
    publishUniboxUnread(unreadCount);
  }, [unreadCount, leadDomainsReady]);

  const handleSync = async () => {
    await syncInbox();
  };

  const handleMarkRead = async (id: string) => {
    await supabase.from("inbox_messages").update({ is_read: true }).eq("id", id);
  };

  // Remove a message from the visible list + the instant cache so it doesn't
  // flash back on the next re-entry before the reload.
  const dropMessageLocally = (id: string): any[] => {
    const remaining = messages.filter((message) => message.id !== id);
    setMessages(remaining);
    cacheSet("unibox:messages", remaining);
    return remaining;
  };

  // ── Multi-select bulk delete ──────────────────────────────────────────────
  const toggleBulk = (id: string) => setBulkSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearBulk = () => setBulkSelected(new Set());
  const selectAllVisible = () => setBulkSelected(new Set(filtered.map((m: any) => m.id)));

  const handleBulkDelete = async () => {
    if (!user || bulkSelected.size === 0) return;
    const ids = Array.from(bulkSelected);
    if (!window.confirm(`¿Eliminar ${ids.length} mensaje(s) seleccionado(s)?`)) return;
    setBulkDeleting(true);
    try {
      // Soft-delete (is_archived) in chunks so they never re-appear on the next sync.
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await supabase.from("inbox_messages")
          .update({ is_archived: true })
          .in("id", ids.slice(i, i + 100))
          .eq("user_id", user.id);
        if (error) { toast.error(error.message); setBulkDeleting(false); return; }
      }
      const remaining = messages.filter((m) => !bulkSelected.has(m.id));
      setMessages(remaining);
      cacheSet("unibox:messages", remaining);
      if (selectedId && bulkSelected.has(selectedId)) setSelectedId(null);
      clearBulk();
      toast.success(`${ids.length} mensaje(s) eliminado(s)`);
    } catch (e: any) { toast.error(e?.message || "Error al eliminar"); }
    setBulkDeleting(false);
  };

  const handleArchive = async (id: string) => {
    const { error } = await supabase.from("inbox_messages").update({ is_archived: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    const remaining = dropMessageLocally(id);
    setSelectedId((current) => (current === id ? (isMobile ? null : remaining[0]?.id ?? null) : current));
    toast.success("Archivado");
  };

  const handleDeleteMessage = async (id: string) => {
    const target = messages.find((message) => message.id === id);
    if (!target) return;
    if (!window.confirm(`¿Eliminar el email de ${target.from_name || target.from_email}?`)) return;

    // Soft-delete (is_archived=true) instead of a hard delete. A hard delete
    // removes the dedupe row, so the very next IMAP sync re-downloads and
    // re-inserts the SAME message → it reappears. Keeping the row hidden means
    // it's gone from view AND never comes back.
    const { error } = await supabase.from("inbox_messages").update({ is_archived: true }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }

    const remaining = dropMessageLocally(id);
    setReminders((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setReply("");
    setAiSuggestion("");
    setTranslatedBody("");
    setDetectedLang(null);
    setSelectedId((current) => current === id ? (isMobile ? null : remaining[0]?.id ?? null) : current);
    toast.success("Email eliminado");
  };

  const handleCleanAll = async () => {
    if (!user) return;
    // Guard: this archives the ENTIRE inbox, unread real replies included. One
    // misclick used to bury everything silently — confirm, and say how many
    // unread real replies are about to be archived.
    const unreadReal = messages.filter((m) => !m.is_read && !hiddenFromClean(m)).length;
    const warn = unreadReal > 0
      ? `Vas a archivar TODO el Unibox, incluidas ${unreadReal} respuesta(s) sin leer. Podrás recuperarlas en "Archivados". ¿Seguro?`
      : "Vas a archivar todos los mensajes del Unibox. ¿Seguro?";
    if (!window.confirm(warn)) return;
    const { error } = await supabase
      .from("inbox_messages")
      .update({ is_archived: true })
      .eq("user_id", user.id)
      .eq("is_archived", false);
    if (error) { toast.error(error.message); return; }
    toast.success("Unibox limpiado — todos los mensajes archivados");
    setMessages([]);
    setSelectedId(null);
  };

  const handleSetReminder = async (messageId: string, remindAt: Date) => {
    if (!user) return;
    const msg = messages.find((m) => m.id === messageId);
    // Upsert: remove existing reminder for this message first
    await supabase.from("message_reminders").delete().eq("message_id", messageId).eq("user_id", user.id);
    await supabase.from("message_reminders").insert({
      user_id: user.id,
      message_id: messageId,
      remind_at: remindAt.toISOString(),
      scheduled_at: remindAt.toISOString(),
      status: "pending",
      recipient: msg?.from_email ? String(msg.from_email).toLowerCase() : null,
      original_subject: msg ? decodeSubject(msg.subject) : null,
      original_message_id: msg?.message_id || null,
      original_references: msg?.ref_chain || msg?.message_id || null,
      reminder_body: reminderBody.trim() || null,
    } as any);
    toast.success(`Recordatorio: ${format(remindAt, "d MMM yyyy", { locale: es })}`);
    setReminderBody("");
    loadReminders();
  };

  const handleClearReminder = async (messageId: string) => {
    if (!user) return;
    await supabase.from("message_reminders").delete().eq("message_id", messageId).eq("user_id", user.id);
    toast.success("Recordatorio eliminado");
    loadReminders();
  };

  const createFolder = async (name: string, color: string) => {
    if (!user || !name.trim()) return;
    const { data, error } = await (supabase as any)
      .from("unibox_folders")
      .insert({ user_id: user.id, name: name.trim(), color: color || "#6366f1" })
      .select("*")
      .single();
    if (error) { toast.error(error.message); return; }
    setFolders((prev) => [...prev, data]);
    setNewFolderName("");
    setFolderPopoverOpen(false);
    toast.success(`Carpeta "${data.name}" creada`);
  };

  const moveToFolder = async (messageId: string, folderId: string | null) => {
    const { error } = await (supabase as any).from("inbox_messages").update({ folder_id: folderId }).eq("id", messageId);
    if (error) { toast.error(error.message); return; }
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, folder_id: folderId } : m)));
    toast.success(folderId ? "Movido a la carpeta" : "Quitado de la carpeta");
  };


  // Hide (archive) every inbox message from a blocked email/domain + drop them
  // from the local list and cache, so blocking removes them from view right away
  // and they persist hidden (never re-synced into view).
  const hideMessagesFromSender = async (predicate: (m: any) => boolean) => {
    const ids = messages.filter(predicate).map((m) => m.id);
    if (ids.length > 0) {
      for (let i = 0; i < ids.length; i += 100) {
        await supabase.from("inbox_messages").update({ is_archived: true }).in("id", ids.slice(i, i + 100));
      }
    }
    const remaining = messages.filter((m) => !predicate(m));
    setMessages(remaining);
    cacheSet("unibox:messages", remaining);
    setSelectedId((cur) => (cur && ids.includes(cur) ? null : cur));
    return ids.length;
  };

  const handleBlockEmail = async (email: string) => {
    if (!user) return;
    const value = email.toLowerCase();
    setBlocking(true);
    try {
      await supabase.from("blocklist").upsert({ user_id: user.id, entry_type: "email", value }, { onConflict: "user_id,entry_type,value" });
      // Filter it out of the Unibox now (optimistic), then hide its messages.
      setBlockedEntries((prev) => (prev.some((e) => e.entry_type === "email" && e.value === value) ? prev : [{ id: `tmp-${value}`, entry_type: "email", value, created_at: new Date().toISOString() }, ...prev]));
      await hideMessagesFromSender((m) => (m.from_email || "").toLowerCase() === value);
      const { data: leads } = await supabase.from("leads").select("id").eq("user_id", user.id).eq("email", value);
      for (const l of leads || []) await supabase.from("campaign_leads").delete().eq("lead_id", l.id);
      loadBlockedEntries();
      toast.success(`${email} bloqueado — sus mensajes ocultados y fuera de campañas`);
    } catch (e: any) { toast.error(e.message); }
    setBlocking(false);
    setBlockDialogOpen(false);
    setBlockTarget(null);
  };

  const handleBlockDomain = async (domain: string) => {
    if (!user) return;
    const value = domain.toLowerCase();
    setBlocking(true);
    try {
      await supabase.from("blocklist").upsert({ user_id: user.id, entry_type: "domain", value }, { onConflict: "user_id,entry_type,value" });
      setBlockedEntries((prev) => (prev.some((e) => e.entry_type === "domain" && e.value === value) ? prev : [{ id: `tmp-${value}`, entry_type: "domain", value, created_at: new Date().toISOString() }, ...prev]));
      const n = await hideMessagesFromSender((m) => (m.from_email || "").toLowerCase().endsWith(`@${value}`));
      const { data: leads } = await supabase.from("leads").select("id, email").eq("user_id", user.id);
      for (const lead of (leads || []).filter((l) => (l.email || "").toLowerCase().endsWith(`@${value}`))) {
        await supabase.from("campaign_leads").delete().eq("lead_id", lead.id);
      }
      loadBlockedEntries();
      toast.success(`Dominio @${domain} bloqueado — ${n} mensaje(s) ocultados`);
    } catch (e: any) { toast.error(e.message); }
    setBlocking(false);
    setBlockDialogOpen(false);
    setBlockTarget(null);
  };

  const loadBlockedEntries = async () => {
    if (!user) return;
    setBlockedLoading(true);
    const { data, error } = await supabase
      .from("blocklist")
      .select("id, entry_type, value, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(`No se pudo cargar la lista: ${error.message}`);
    setBlockedEntries(data || []);
    setBlockedLoading(false);
  };

  const openBlockManager = () => { setBlockManagerOpen(true); loadBlockedEntries(); };

  const handleUnblock = async (entry: { id: string; entry_type: string; value: string }) => {
    if (!user) return;
    setUnblockingId(entry.id);
    const { error } = await supabase.from("blocklist").delete().eq("id", entry.id).eq("user_id", user.id);
    if (error) { toast.error(`No se pudo desbloquear: ${error.message}`); setUnblockingId(null); return; }
    setBlockedEntries((prev) => prev.filter((e) => e.id !== entry.id));
    toast.success(`${entry.entry_type === "domain" ? "@" + entry.value : entry.value} desbloqueado`);
    setUnblockingId(null);
  };

  // Translate the reply the user typed INTO the language the lead wrote in, in
  // place, so they SEE exactly what will be sent (WYSIWYG) and then hit Responder.
  // Replaces the old invisible auto-translate-on-send.
  const translateReplyToLeadLang = async () => {
    if (!selected || !reply.trim()) return;
    setAutoTranslating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // 1) Detect the LEAD's language. Fast client heuristic first; if inconclusive,
      //    ask the server to detect it from the incoming message.
      let target: string | null = null;
      const heur = messageLang(selected);
      if (heur === "es" || heur === "en" || heur === "fr" || heur === "it") target = heur;
      if (!target) {
        let body = cleanBodyText(selected.body_text || "", true);
        if (body.replace(/\s+/g, " ").trim().length < 15 && selected.body_html) body = cleanBodyText(selected.body_html, true);
        try {
          const dResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
            body: JSON.stringify({ text: `${decodeSubject(selected.subject) || ""}\n${body}`.slice(0, 1500), mode: "detect" }),
          });
          const d = await dResp.json();
          if (d.language) target = String(d.language).toLowerCase().slice(0, 2);
        } catch { /* fall through */ }
      }
      if (!target) { toast.error("No pude detectar el idioma del lead."); setAutoTranslating(false); return; }
      if (target === "es" || target === "ca") {
        toast.info("El lead escribe en español — tu respuesta ya está en su idioma.");
        setAutoTranslating(false); return;
      }
      // 2) Translate the reply into that language, in place.
      const tResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ text: reply, target_lang: target, mode: "translate" }),
      });
      const t = await tResp.json();
      if (t.translated) {
        setReply(t.translated);
        setReplyLang(target);
        toast.success(`Traducido al ${langLabels[target] || target}. Revísalo y pulsa Responder.`);
      } else {
        toast.error(t.error || "No se pudo traducir.");
      }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setAutoTranslating(false);
  };

  // Read picked files → base64 chips (capped: 10 files / 15 MB total).
  const handlePickReplyFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const f of files) {
      const currentTotal = replyFiles.reduce((n, a) => n + a.size, 0);
      if (replyFiles.length >= 10) { toast.error("Máximo 10 adjuntos por email"); break; }
      if (currentTotal + f.size > 15 * 1024 * 1024) { toast.error("Los adjuntos superan 15 MB"); break; }
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(f);
        });
        setReplyFiles((prev) => [...prev, { filename: f.name, mime: f.type || "application/octet-stream", base64, size: f.size }]);
      } catch { toast.error(`No se pudo adjuntar ${f.name}`); }
    }
  };

  const handleReply = async () => {
    if (!selected || (!reply.trim() && replyFiles.length === 0) || !user) return;
    if (containsProfanity(reply)) {
      toast.error("Tu respuesta contiene lenguaje inapropiado. Por favor, modifícala antes de enviar.");
      return;
    }
    setSending(true);
    // Never hang forever waiting for a slow/overloaded server.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Sesión no válida. Vuelve a iniciar sesión y reintenta.");
        return;
      }
      // WYSIWYG: send EXACTLY what's in the box. If the user wants it in the lead's
      // language, they click "Su idioma" first (translateReplyToLeadLang) and review it.
      // Then append the SENDING ACCOUNT's signature (client-side, so it works with just
      // a frontend deploy — no edge deploy needed). "no se ve la firma" fix.
      const acctSignature = (sigAccounts.find((a) => a.id === selected.account_id)?.signature_html || "").trim();
      const finalBody = buildBodyWithSignature(reply, acctSignature);

      // THREADING: reply to the LATEST RECEIVED message in the loaded conversation
      // (its Message-ID is exactly what the recipient's client matches to thread),
      // not just the clicked row — which sometimes had a missing/weak message_id and
      // landed the reply as a brand-new message. Fall back to the selected row.
      const receivedInThread = (threadMessages || []).filter((tm: any) => tm && tm._type !== "sent" && tm.message_id);
      const replyTarget: any = receivedInThread.length ? receivedInThread[receivedInThread.length - 1] : selected;
      let targetMsgId: string = replyTarget?.message_id || selected.message_id || "";
      let targetRefChain: string = replyTarget?.ref_chain || selected.ref_chain || "";

      // THREADING SAFETY NET: if neither the clicked row nor the loaded thread gave us
      // a Message-ID (e.g. the row was synced before Message-ID capture, or a timing
      // gap left the thread empty), ask the DB directly for the LATEST inbound from this
      // contact that actually has one. Without this, the reply goes out with no
      // In-Reply-To and lands as a brand-new message instead of threading.
      if (!targetMsgId) {
        const { data: lastInbound } = await supabase
          .from("inbox_messages")
          .select("message_id, ref_chain")
          .eq("user_id", user.id)
          .eq("from_email", selected.from_email)
          .not("message_id", "is", null)
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if ((lastInbound as any)?.message_id) {
          targetMsgId = (lastInbound as any).message_id;
          if (!targetRefChain) targetRefChain = (lastInbound as any).ref_chain || "";
        }
      }

      const originalSubject = decodeSubject(replyTarget?.subject || selected.subject) || "";
      const replySubject = originalSubject.toLowerCase().startsWith("re:") ? originalSubject : `Re: ${originalSubject}`;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          account_id: selected.account_id,
          to_email: selected.from_email,
          subject: replySubject,
          body: finalBody,
          in_reply_to: targetMsgId || undefined,
          // Full thread chain (original References + the target's Message-ID) so the
          // reply threads perfectly in every client, not just by subject.
          references: ([targetRefChain, targetMsgId].filter(Boolean).join(" ").trim()) || undefined,
          attachments: replyFiles.map(({ filename, mime, base64 }) => ({ filename, mime, base64 })),
        }),
        signal: controller.signal,
      });
      let result: any = null;
      try { result = await resp.json(); } catch { /* non-JSON / empty response */ }

      // Only celebrate a REAL success. Any non-2xx, missing body, or error field
      // means the mail did NOT go out — say so and keep the draft for a retry.
      if (!resp.ok || !result || result.error) {
        toast.error(result?.error || `No se pudo enviar la respuesta (HTTP ${resp.status}). El correo NO ha salido — revisa la cuenta e inténtalo de nuevo.`);
        return;
      }

      toast.success("Respuesta enviada");
      setReply("");
      setReplyFiles([]);
      setReplyLang(null);
      // Mark this sender as "replied-to" NOW so the inbound message stays visible in
      // "Todos" immediately (no wait for the next sent_emails reload).
      const repliedEmail = (selected.from_email || "").toLowerCase();
      if (repliedEmail) setRepliedToSet(prev => (prev.has(repliedEmail) ? prev : new Set(prev).add(repliedEmail)));
      loadSent(); // keep the "Enviados" list fresh
      // Refresh thread to show the sent message
      const msg = messages.find(m => m.id === selectedId);
      if (msg) setTimeout(() => loadThread(msg), 500);
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      toast.error(aborted
        ? "El envío tardó demasiado (servidor sobrecargado). El correo NO se confirmó — inténtalo de nuevo en unos segundos."
        : `No se pudo enviar: ${e?.message || e}. El correo NO ha salido.`);
    } finally {
      clearTimeout(timeoutId);
      setSending(false);
    }
  };

  /** Forward (reenviar) the selected email to another address via the same account. */
  const handleForward = async () => {
    if (!selected || !forwardTo.trim() || !user) return;
    const to = forwardTo.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast.error("Email de destino no válido"); return; }
    setForwarding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const origSubject = decodeSubject(selected.subject) || "";
      const fwdSubject = /^fwd?:/i.test(origSubject) ? origSubject : `Fwd: ${origSubject}`;
      const origText = cleanBodyText(selected.body_text || "");
      const when = new Date(selected.received_at).toLocaleString("es");
      const quoted =
        (forwardNote.trim() ? forwardNote.trim() + "\n\n" : "") +
        "---------- Mensaje reenviado ----------\n" +
        `De: ${selected.from_name ? selected.from_name + " " : ""}<${selected.from_email}>\n` +
        `Fecha: ${when}\n` +
        `Asunto: ${origSubject}\n\n` +
        origText;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          account_id: selected.account_id,
          to_email: to,
          subject: fwdSubject,
          body: quoted,
        }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Reenviado a ${to}`);
        setForwardOpen(false);
        setForwardTo("");
        setForwardNote("");
      }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setForwarding(false);
  };

  /** Delete the lead behind the selected message everywhere: from the leads table,
   *  every campaign/list (campaign_leads), sent_emails, inbox_messages and reminders.
   *  Uses the bulk_delete_leads SECURITY DEFINER RPC, then blocklists the address. */
  const handleDeleteLead = async () => {
    if (!selected || !user) return;
    setDeletingLead(true);
    try {
      const email = (selected.from_email || "").toLowerCase();

      // 1. Find every lead that matches this sender (across all lists & campaigns)
      const { data: leads } = await supabase
        .from("leads").select("id").eq("user_id", user.id).eq("email", email);
      const leadIds = (leads || []).map((l: any) => l.id);

      // 2. Cascade-delete the lead from the whole database
      if (leadIds.length > 0) {
        const { error } = await (supabase as any).rpc("bulk_delete_leads", { lead_ids: leadIds });
        if (error) { toast.error(error.message); setDeletingLead(false); return; }
      }

      // 3. Remove any leftover inbox messages from this sender (not lead-linked)
      await supabase.from("inbox_messages").delete()
        .eq("user_id", user.id).eq("from_email", email);

      // 4. Block the address so it can't re-enter any list
      await supabase.from("blocklist").upsert(
        { user_id: user.id, entry_type: "email", value: email },
        { onConflict: "user_id,entry_type,value" }
      );

      // 5. Update local state — drop every message from this sender
      setMessages((prev) => prev.filter((m) => (m.from_email || "").toLowerCase() !== email));
      setSelectedId(null);
      setDeleteLeadOpen(false);
      loadReminders();
      toast.success(`Lead ${email} eliminado de la base de datos y de todas las listas`);
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setDeletingLead(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const filterButtons: { key: FilterType; label: string; dot?: string }[] = [
    { key: "all", label: "Todos" },
    { key: "interested", label: "Interesados", dot: "bg-success" },
    { key: "question", label: "Preguntas", dot: "bg-info" },
    { key: "not_interested", label: "No interesados", dot: "bg-destructive" },
    { key: "out_of_office", label: "Fuera / Auto", dot: "bg-brand-purple" },
  ];

  const selectedCategory = selected ? classifyMessage(selected.subject, selected.body_text) : null;
  const selectedCatConfig = selectedCategory ? categoryConfig[selectedCategory] : null;

  return (
    <div className="flex h-[calc(100dvh-132px)] min-h-0 flex-col gap-2.5 lg:h-[calc(100vh-80px)] lg:gap-3">
      {/* Header */}
      <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5 shadow-sm md:px-4 md:py-3">
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight md:text-2xl">Unibox</h1>
            <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">
            {filtered.length} mensajes · {unreadCount} sin leer
            {!isMobile && lastSyncAt && (
              <span className="ml-2 text-xs text-muted-foreground/50">
                · Última sync {formatDistanceToNow(lastSyncAt, { addSuffix: true, locale: es })}
              </span>
            )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="h-7 rounded-md px-2 text-[11px] font-medium">
              <MailOpen className="mr-1.5 h-3.5 w-3.5" /> {unreadCount} pendientes
            </Badge>
            <Badge variant="secondary" className="h-7 rounded-md px-2 text-[11px] font-medium">
              <InboxIcon className="mr-1.5 h-3.5 w-3.5" /> {messages.length} totales
            </Badge>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs sm:px-3 md:text-sm" onClick={openBlockManager}
              title="Ver y desbloquear emails y dominios bloqueados">
              <ShieldBan className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Bloqueados</span>
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs sm:px-3 md:text-sm" onClick={openSignature}
              title="Poner o cambiar la firma electrónica que se añade debajo de cada correo">
              <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Firma</span>
            </Button>
            <Button variant="default" size="sm" className="h-8 gap-1.5 px-2.5 text-xs sm:px-3 md:text-sm" onClick={handleSync} disabled={syncing}
              title="Reconecta todas las cuentas IMAP y trae los mensajes nuevos">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span className={syncing ? "" : "hidden sm:inline"}>{syncing ? "Actualizando…" : "Actualizar"}</span>
            </Button>
            <Button
              variant={showWarmup ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs sm:px-3 md:text-sm"
              onClick={() => setShowWarmup(v => !v)}
              title="Muestra también los correos que el filtro oculta (inglés de desconocidos, warmup). Úsalo para recuperar algo si se ocultó por error."
            >
              <Megaphone className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{showWarmup ? "Ocultar warmup" : "Mostrar warmup"}</span>
            </Button>
            {!isMobile && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 border-destructive/30 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive md:text-sm"
                onClick={handleCleanAll}
                disabled={messages.length === 0}
              >
                <ArchiveX className="h-3.5 w-3.5" />
                Limpiar todo
              </Button>
            )}
          </div>
        </div>
        {syncing && (
          <div className="mt-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin text-primary" /> Conectando cada cuenta y trayendo mensajes en español…
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
            </div>
          </div>
        )}
      </div>

      {/* Tabs: Global / Campaigns */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 md:flex-row md:items-center md:justify-between md:px-4">
        <Tabs value={viewTab} onValueChange={(v) => {
          const nextTab = v as "global" | "all_mailboxes" | "important" | "campaigns" | "reminders" | "sent";
          setViewTab(nextTab);
          setMailboxMode(nextTab === "all_mailboxes" ? "all" : "clean");
        }}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto no-scrollbar [&>*]:flex-shrink-0 md:w-auto md:overflow-visible">
            <TabsTrigger value="global" className="gap-1.5 text-xs">
              <InboxIcon className="h-3.5 w-3.5" /> Global
            </TabsTrigger>
            <TabsTrigger value="all_mailboxes" className="gap-1.5 text-xs">
              <Globe className="h-3.5 w-3.5" /> Todos
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5 text-xs">
              <Megaphone className="h-3.5 w-3.5" /> Campaigns
            </TabsTrigger>
            <TabsTrigger value="important" className="gap-1.5 text-xs">
              <Star className="h-3.5 w-3.5" /> Importantes
              {importantCount > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {importantCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sent" className="gap-1.5 text-xs">
              <Send className="h-3.5 w-3.5" /> Enviados
            </TabsTrigger>
            <TabsTrigger value="reminders" className="gap-1.5 text-xs">
              <Bell className="h-3.5 w-3.5" /> Recordatorios
              {Object.keys(reminders).length > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground">
                  {Object.keys(reminders).length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {viewTab === "campaigns" && (
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="h-9 w-full text-xs md:w-[240px]">
              <SelectValue placeholder="Todas las campañas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las campañas</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {viewTab === "all_mailboxes" && (
          <Badge variant="secondary" className="h-8 rounded-md px-3 text-[11px] font-medium">
            <Globe className="mr-1.5 h-3.5 w-3.5" /> Todas las bandejas completas
          </Badge>
        )}
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-border/60 bg-card px-3 py-2.5 no-scrollbar">
        <button
          onClick={() => setShowTodayOnly(!showTodayOnly)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
            showTodayOnly
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          <Clock className="h-3 w-3" />
          Hoy
        </button>
        <span className="w-px h-4 bg-border mx-0.5 flex-shrink-0" />
        {filterButtons.map(fb => (
          <button
            key={fb.key}
            onClick={() => setCategoryFilter(fb.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
              categoryFilter === fb.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {fb.dot && <span className={`inline-block h-2 w-2 rounded-full ${fb.dot}`} />}
            {fb.label}
            {categoryCounts[fb.key] !== undefined && (
              <span className="opacity-60 ml-0.5">{categoryCounts[fb.key] || 0}</span>
            )}
          </button>
        ))}
      </div>

      {/* Folder chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-border/60 bg-card px-3 py-2 no-scrollbar">
        <button
          onClick={() => setFolderFilter(null)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
            folderFilter === null ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Todas
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            onClick={() => setFolderFilter(folderFilter === f.id ? null : f.id)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap border"
            style={folderFilter === f.id
              ? { backgroundColor: f.color, color: "#fff", borderColor: f.color }
              : { backgroundColor: `${f.color}22`, color: f.color, borderColor: `${f.color}55` }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.color }} />
            {f.name}
          </button>
        ))}
        <Popover open={folderPopoverOpen} onOpenChange={setFolderPopoverOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 whitespace-nowrap">
              + Carpeta
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3" align="start">
            <p className="text-xs font-medium mb-2">Nueva carpeta</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newFolderColor}
                onChange={(e) => setNewFolderColor(e.target.value)}
                className="h-8 w-9 rounded border border-border bg-transparent p-0.5"
              />
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Nombre"
                className="h-8 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") createFolder(newFolderName, newFolderColor); }}
              />
            </div>
            <Button size="sm" className="mt-2 h-8 w-full text-xs" disabled={!newFolderName.trim()} onClick={() => createFolder(newFolderName, newFolderColor)}>
              Crear carpeta
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-border/60 bg-card py-20">
          <InboxIcon className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="font-display font-semibold mb-2">Bandeja vacía</h3>
          <p className="text-sm text-muted-foreground mb-4">Sincroniza para traer mensajes de tus cuentas.</p>
          <Button onClick={handleSync} disabled={syncing} size="sm" className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Actualizando…" : "Actualizar"}
          </Button>
        </div>
      ) : (
        <>
        <div className="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
          {/* ── Message list — fixed width on desktop, full width on mobile ── */}
          <div className="flex w-full flex-col bg-card lg:w-[380px] lg:flex-shrink-0 lg:border-r lg:border-border/60 xl:w-[420px]">
            <div className="border-b border-border/60 bg-card p-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por email, nombre o texto…"
                  className="pl-9 pr-8 h-8 text-sm bg-muted/40 border-0 focus-visible:ring-1"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {searching ? (
                  <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
                ) : search ? (
                  <button type="button" onClick={() => setSearch("")} title="Limpiar búsqueda"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {search.trim().length >= 2 && !searching && (
                <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                  {filtered.length === 0
                    ? "Sin resultados en toda la bandeja."
                    : `${filtered.length} conversación(es) — se busca en toda la bandeja.`}
                </p>
              )}
            </div>
            {/* Bulk-select action bar */}
            {bulkSelected.size > 0 && (
              <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-primary/5 px-3 py-2">
                <span className="text-xs font-semibold text-foreground">{bulkSelected.size} seleccionado(s)</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectAllVisible} title="Seleccionar todos los visibles">Todos</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearBulk}>Cancelar</Button>
                  <Button size="sm" variant="destructive" className="h-7 gap-1.5 px-2.5 text-xs" onClick={handleBulkDelete} disabled={bulkDeleting}>
                    {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Eliminar
                  </Button>
                </div>
              </div>
            )}
            <ScrollArea className="flex-1">
              {filtered.map((msg) => {
                const isActive = selectedId === msg.id;
                const isUnread = !msg.is_read;
                const category = classifyMessage(msg.subject, msg.body_text);
                const catCfg = categoryConfig[category];
                const due = isReminderDue(msg.id);
                const hasReminder = !!reminders[msg.id];
                const msgFolder = msg.folder_id ? folders.find((f) => f.id === msg.folder_id) : null;
                const campaignName = msg.campaign_id ? (campaigns.find((c) => c.id === msg.campaign_id)?.name || null) : null;
                const isChecked = bulkSelected.has(msg.id);
                return (
                  <div
                    key={msg.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedId(msg.id);
                      setShowFullEmail(false);
                      if (isUnread) handleMarkRead(msg.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(msg.id);
                        setShowFullEmail(false);
                        if (isUnread) handleMarkRead(msg.id);
                      }
                    }}
                    className={`group relative w-full cursor-pointer border-b border-border/30 px-4 py-3.5 text-left transition-all
                      ${isChecked ? "bg-primary/10 border-l-2 border-l-primary" : due ? "bg-amber-100/70 dark:bg-amber-900/20 border-l-2 border-l-amber-500" : isActive ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent"}
                    `}
                  >
                    <div className="flex items-center gap-3">
                      {/* Select checkbox (bulk delete) */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleBulk(msg.id); }}
                        title="Seleccionar"
                        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[3px] border transition-all sm:h-4 sm:w-4 ${
                          isChecked ? "border-primary bg-primary text-white" : "border-border bg-card hover:border-primary/60 sm:opacity-0 sm:group-hover:opacity-100"
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </button>
                      {/* Avatar */}
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${catCfg.bg || "bg-muted"} ${catCfg.text}`}>
                        {getInitials(msg.from_name, msg.from_email)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {isUnread && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" title="Nueva respuesta" />}
                          {isImportant(msg) && <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-500 text-amber-500" aria-label="Importante" />}
                          <span className="flex-shrink-0 whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">
                            {shortTimeAgo(msg.received_at)}
                          </span>
                          <span className={`min-w-0 truncate text-[15px] ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/85"}`}>
                            {msg.from_name || msg.from_email?.split("@")[0]}
                          </span>
                        </div>
                        <p className={`text-sm truncate mt-0.5 ${isUnread ? "text-foreground/85 font-medium" : "text-muted-foreground"}`}>
                          {decodeSubject(msg.subject)}
                        </p>
                        <p className="line-clamp-2 text-[13px] leading-[1.5] text-muted-foreground/75 mt-1">
                          {cleanBodyText(msg.body_text, true).slice(0, 120)}
                        </p>
                        {/* Bottom row: campaign tag (only if it belongs to a campaign) + folder */}
                        {(campaignName || msgFolder) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {campaignName && (
                              <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 py-0.5 text-[11px] font-semibold text-primary whitespace-nowrap">
                                <Megaphone className="h-3 w-3" /> {campaignName}
                              </span>
                            )}
                            {msgFolder && (
                              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap" style={{ backgroundColor: `${msgFolder.color}18`, color: msgFolder.color }}>
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: msgFolder.color }} />
                                {msgFolder.name}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        {hasReminder && (
                          <Bell className={`h-3.5 w-3.5 ${due ? "text-amber-500" : "text-muted-foreground/40"}`} />
                        )}
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No hay mensajes en esta categoría
                </div>
              )}
            </ScrollArea>
          </div>

          {/* ── Reading pane (desktop): persistent box. Shows the empty state
              underneath; the reader is portalled INTO this same box (absolute
              inset-0) so it fills exactly this area inline — no popup. ── */}
          <div ref={readingPaneRef} className="relative hidden lg:flex flex-1 flex-col bg-card">
            {!selected && (
              <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <MailOpen className="h-8 w-8 text-primary" />
                </div>
                <h3 className="font-display text-lg font-bold text-foreground">Tu bandeja unificada</h3>
                <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                  Selecciona un mensaje de la lista para leerlo y responder aquí.
                </p>
              </div>
            )}
          </div>

        </div>

      {/* ── Conversation reader — on desktop it is portalled INTO the reading
          pane box (fills it exactly, inline, no overlay); on mobile it is a
          normal fullscreen modal with backdrop. ── */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelectedId(null); setReaderExpanded(false); setReplyFiles([]); setShowFullEmail(false); } }}>
        <DialogContent
          className={`p-0 gap-0 flex flex-col overflow-hidden bg-card border-border/60 shadow-2xl outline-none focus:outline-none focus-visible:outline-none [&>button.absolute]:hidden ${
            readerExpanded
              ? "w-screen h-screen max-w-none rounded-none border-0"
              : "w-[95vw] max-w-[1400px] h-[92dvh] max-h-[92dvh] rounded-xl"
          }`}
        >
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
            {selected ? (
              <>
                {/* Subject bar — top like Gmail */}
                <div className="border-b border-border/60 px-4 pb-4 pt-4 md:px-8 md:pb-5 md:pt-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                    <div className="flex min-w-0 items-start gap-2 sm:flex-1">
                    <Button variant="ghost" size="icon" className="-ml-2 mt-0.5 h-9 w-9 flex-shrink-0 lg:hidden" onClick={() => setSelectedId(null)}>
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg md:text-xl font-semibold text-foreground leading-tight flex items-center gap-2 flex-wrap">
                        {decodeSubject(selected.subject)}
                        {selectedCatConfig?.label && (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${selectedCatConfig.bg} ${selectedCatConfig.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${selectedCatConfig.dot}`} />
                            {selectedCatConfig.label}
                          </span>
                        )}
                      </h2>
                    </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0 overflow-x-auto no-scrollbar -mx-1 px-1 sm:mx-0 sm:px-0 [&_button]:h-9 [&_button]:w-9 sm:[&_button]:h-8 sm:[&_button]:w-8">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className={`h-8 w-8 ${selected.folder_id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} title="Mover a carpeta">
                            <FolderInput className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-2" align="end">
                          <p className="text-xs font-medium mb-2 px-1">Mover a carpeta…</p>
                          {folders.length === 0 && (
                            <p className="px-2 py-1 text-xs text-muted-foreground">Crea una carpeta primero</p>
                          )}
                          {folders.map((f) => (
                            <button
                              key={f.id}
                              onClick={() => moveToFolder(selected.id, f.id)}
                              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors ${selected.folder_id === f.id ? "bg-muted" : ""}`}
                            >
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: f.color }} /> {f.name}
                            </button>
                          ))}
                          {selected.folder_id && (
                            <>
                              <div className="border-t my-1" />
                              <button onClick={() => moveToFolder(selected.id, null)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors">
                                <X className="h-3.5 w-3.5" /> Quitar de la carpeta
                              </button>
                            </>
                          )}
                        </PopoverContent>
                      </Popover>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className={`h-8 w-8 ${reminders[selected.id] ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}`} title="Recordatorio">
                            <Bell className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="end">
                          <p className="text-xs font-medium mb-2 px-1">Recordar en…</p>
                          <Textarea
                            value={reminderBody}
                            onChange={(e) => setReminderBody(e.target.value)}
                            placeholder="Mensaje del recordatorio (opcional; se envía como Re:)"
                            className="mb-2 h-16 text-xs"
                          />
                          {[
                            { label: "Mañana", date: startOfTomorrow() },
                            { label: "2 días", date: addDays(new Date(), 2) },
                            { label: "Próximo lunes", date: nextMonday(new Date()) },
                            { label: "1 semana", date: addWeeks(new Date(), 1) },
                            { label: "2 semanas", date: addWeeks(new Date(), 2) },
                          ].map(opt => (
                            <button key={opt.label} onClick={() => handleSetReminder(selected.id, opt.date)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {opt.label}
                            </button>
                          ))}
                          {reminders[selected.id] && (
                            <>
                              <div className="border-t my-1" />
                              <button onClick={() => handleClearReminder(selected.id)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors">
                                <X className="h-3.5 w-3.5" /> Quitar recordatorio
                              </button>
                            </>
                          )}
                        </PopoverContent>
                      </Popover>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 ${isImportant(selected) ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground hover:text-amber-500"}`}
                        onClick={() => toggleImportant(selected)}
                        title={isImportant(selected) ? "Quitar de Importantes" : "Marcar como importante"}
                      >
                        <Star className={`h-4 w-4 ${isImportant(selected) ? "fill-amber-500" : ""}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => { setForwardTo(""); setForwardNote(""); setForwardOpen(true); }} title="Reenviar">
                        <Forward className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => { setBlockTarget({ email: selected.from_email, domain: selected.from_email.split("@")[1] || "" }); setBlockDialogOpen(true); }} title="Bloquear">
                        <Ban className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteLeadOpen(true)} title="Eliminar lead de la base de datos">
                        <UserX className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteMessage(selected.id)} title="Eliminar email">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleArchive(selected.id)} title="Archivar">
                        <Archive className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="hidden h-8 w-8 text-muted-foreground hover:text-primary sm:inline-flex" onClick={() => setReaderExpanded((v) => !v)} title={readerExpanded ? "Reducir" : "Pantalla completa"}>
                        {readerExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setSelectedId(null)} title="Cerrar">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Conversation thread */}
                <ScrollArea className="min-h-0 flex-1 outline-none focus:outline-none [&_[data-radix-scroll-area-viewport]]:outline-none [&_[data-radix-scroll-area-viewport]]:focus-visible:outline-none [&_[data-radix-scroll-area-viewport]>div]:!block">
                  <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 md:px-8 md:py-7">
                    {/* Reminder banner */}
                    {reminders[selected.id] && (
                      <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${isReminderDue(selected.id) ? "border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                        <span className="flex items-center gap-1.5">
                          <Bell className="h-3.5 w-3.5" />
                          {isReminderDue(selected.id) ? "⚡ Recordatorio vencido — " : "Recordatorio: "}
                          {format(new Date(reminders[selected.id].remind_at), "d MMM yyyy", { locale: es })}
                        </span>
                        <button onClick={() => handleClearReminder(selected.id)} className="hover:opacity-70"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    )}

                    {/* Translate button */}
                    {!translatedBody && (
                      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/40 px-4 py-2.5">
                        <Languages className="h-5 w-5 text-primary flex-shrink-0" />
                        <div className="flex-1">
                          {detectedLang && detectedLang !== "es" ? (
                            <p className="text-sm text-foreground">Parece que este mensaje está en {langLabels[detectedLang] || detectedLang}</p>
                          ) : (
                            <p className="text-sm text-foreground">Traducir este mensaje</p>
                          )}
                          <button onClick={handleTranslateBody} disabled={translating} className="text-sm text-primary font-medium hover:underline mt-0.5">
                            {translating ? "Traduciendo…" : "Traducir al español"}
                          </button>
                        </div>
                      </div>
                    )}
                    {translatedBody && (
                      <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
                        <Languages className="h-5 w-5 text-primary flex-shrink-0" />
                        <p className="text-sm text-foreground flex-1">Traducido al español</p>
                        <button onClick={handleTranslateBody} className="text-sm text-primary font-medium hover:underline">Ver original</button>
                      </div>
                    )}

                    {/* Full-email toggle: reveal signature + quoted thread, like a webmail */}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowFullEmail((v) => !v)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={showFullEmail ? "Mostrar solo el mensaje nuevo" : "Mostrar el email completo (firma e hilo citado)"}
                      >
                        <Mail className="h-3 w-3" />
                        {showFullEmail ? "Ver solo lo nuevo" : "Ver email completo"}
                      </button>
                    </div>

                    {/* Thread messages */}
                    {threadLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : threadMessages.length > 0 ? (
                      threadMessages.map((tm, idx) => {
                        const isSent = tm._type === "sent";
                        const msgDate = new Date(tm._date);
                        const dateStr = msgDate.toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

                        return (
                          <div key={tm.id + "-" + idx} className={`rounded-xl border shadow-sm ${isSent ? "border-primary/20 bg-primary/5" : "border-border/60 bg-card"}`}>
                            <div className="flex items-center gap-2.5 border-b border-border/40 px-3 py-3 sm:gap-3 sm:px-5 sm:py-3.5">
                              <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                isSent ? "bg-primary/10 text-primary" : (selectedCatConfig?.bg || "bg-muted") + " " + (selectedCatConfig?.text || "text-muted-foreground")
                              }`}>
                                {isSent ? <Send className="h-3.5 w-3.5" /> : getInitials(tm.from_name, tm.from_email)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm text-foreground">
                                    {isSent ? "Yo" : (tm.from_name || tm.from_email?.split("@")[0])}
                                  </span>
                                  {isSent && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Enviado</span>
                                  )}
                                  {isSent && accountEmailMap[tm.account_id] && (
                                    <span className="text-xs text-muted-foreground truncate">desde &lt;{accountEmailMap[tm.account_id]}&gt;</span>
                                  )}
                                  {!isSent && (
                                    <span className="text-xs text-muted-foreground truncate">&lt;{tm.from_email}&gt;</span>
                                  )}
                                </div>
                              </div>
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">{dateStr}</span>
                            </div>
                            <div className="px-3 py-4 sm:px-5 sm:py-5 md:px-8 md:py-6">
                              {isSent ? (
                                <div
                                  className="text-[15px] text-foreground leading-[1.75] break-words [&_p]:my-3 [&_a]:text-primary [&_a]:underline"
                                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(tm.body || "") }}
                                />
                              ) : (translatedBody && tm.id === selected.id) ? (
                                // Show the Spanish translation IN PLACE of this message's body.
                                <div className="text-[15px] text-foreground leading-[1.75] whitespace-pre-wrap break-words">
                                  {translatedBody}
                                </div>
                              ) : tm.body_html && tm.body_html.trim().length > 20 ? (
                                <div
                                  className="max-w-none text-foreground leading-[1.75] text-[15px] break-words overflow-x-auto
                                    [&_p]:my-3 [&_p]:leading-[1.75]
                                    [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-all
                                    [&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic [&_blockquote]:my-4
                                    [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3
                                    [&_li]:my-1
                                    [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:my-3
                                    [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic
                                    [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4
                                    [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3
                                    [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:my-3
                                    [&_table]:w-full [&_table]:border-collapse [&_table]:my-3
                                    [&_td]:p-2 [&_th]:p-2 [&_th]:font-semibold"
                                  dangerouslySetInnerHTML={{ __html: cleanBodyHtml(tm.body_html, showFullEmail) }}
                                />
                              ) : (
                                <div className="text-[15px] text-foreground leading-[1.75] whitespace-pre-wrap break-words">
                                  {cleanBodyText(tm.body_text, true)}
                                </div>
                              )}
                              {tm._type !== "sent" && <AttachmentChips bodyText={tm.body_text} bodyHtml={tm.body_html} stored={tm.attachments} />}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-border/50 bg-card">
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedCatConfig?.bg || "bg-muted"} ${selectedCatConfig?.text || "text-muted-foreground"}`}>
                            {getInitials(selected.from_name, selected.from_email)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-sm text-foreground">{selected.from_name || selected.from_email?.split("@")[0]}</span>
                            <span className="text-xs text-muted-foreground ml-2">&lt;{selected.from_email}&gt;</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(selected.received_at).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <div className="px-6 pb-6 pl-[3.75rem]">
                          {translatedBody ? (
                            // Show the Spanish translation IN PLACE of the original body.
                            <div className="text-[15px] text-foreground leading-[1.8] whitespace-pre-wrap break-words">
                              {translatedBody}
                            </div>
                          ) : selected.body_html && selected.body_html.trim().length > 20 ? (
                            <div
                              className="max-w-none text-foreground leading-[1.8] text-[15px] break-words overflow-x-auto
                                [&_p]:my-3 [&_a]:text-primary [&_a]:underline [&_a]:break-all
                                [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6
                                [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:my-3
                                [&_strong]:font-semibold [&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground"
                              dangerouslySetInnerHTML={{ __html: cleanBodyHtml(selected.body_html, showFullEmail) }}
                            />
                          ) : (
                            <div className="text-[15px] text-foreground leading-[1.8] whitespace-pre-wrap break-words">
                              {cleanBodyText(selected.body_text, true)}
                            </div>
                          )}
                          <AttachmentChips bodyText={selected.body_text} bodyHtml={selected.body_html} stored={selected.attachments} />
                        </div>
                      </div>
                    )}

                    {threadMessages.length > 1 && (
                      <div className="flex items-center justify-center">
                        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                          {threadMessages.length} mensajes en esta conversación
                        </span>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Reply box */}
                  <div className="border-t border-border/60 bg-card px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-4 md:pt-3 md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-[10px] md:text-xs text-muted-foreground">
                      <Send className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">→ {selected.from_name || selected.from_email}</span>
                      {detectedLang && detectedLang !== "es" && (
                          <span className="hidden items-center gap-1 whitespace-nowrap rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info sm:inline-flex">
                          <Languages className="h-2.5 w-2.5" />
                          Auto-traducir a {langLabels[detectedLang] || detectedLang}
                        </span>
                      )}
                    </div>
                    {(
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-shrink-0 gap-1.5 border-primary/30 px-2.5 text-[11px] text-primary hover:bg-primary/10"
                        onClick={handleAiSuggest}
                        disabled={aiLoading}
                      >
                        {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        <span className="hidden sm:inline">{aiLoading ? "Generando…" : "Sugerir respuesta IA"}</span>
                        <span className="sm:hidden">{aiLoading ? "…" : "Sugerir IA"}</span>
                      </Button>
                    )}
                  </div>

                  {/* AI suggestion area */}
                  {aiSuggestion && (
                    <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-primary flex items-center gap-1">
                          <Sparkles className="h-3 w-3" /> Sugerencia de {aiPromptName}
                        </span>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setAiSuggestion("")}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-sm text-foreground/80 whitespace-pre-wrap mb-2">{aiSuggestion}</p>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 text-xs h-7"
                        onClick={() => { setReply(aiSuggestion); setAiSuggestion(""); }}
                      >
                        Usar respuesta
                      </Button>
                    </div>
                  )}

                    <Textarea
                    ref={replyRef}
                    id="unibox-reply-textarea"
                    placeholder="Escribe tu respuesta…"
                      className="mb-2.5 min-h-[92px] resize-none rounded-xl border border-border/70 bg-card px-3.5 py-3 text-sm leading-relaxed shadow-sm focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/25"
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                  />
                  {replyFiles.length > 0 && (
                    <div className="mb-2.5 flex flex-wrap gap-2">
                      {replyFiles.map((f, i) => (
                        <span key={`${f.filename}-${i}`} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 py-1 pl-2 pr-1 text-xs">
                          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                          <span className="min-w-0 truncate font-medium text-foreground">{f.filename}</span>
                          <span className="flex-shrink-0 text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                          <button type="button" onClick={() => setReplyFiles((prev) => prev.filter((_, j) => j !== i))} className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Quitar">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" title="Insertar link">
                            <Link2 className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 space-y-3 p-3" align="start">
                          <p className="text-xs font-medium">Insertar enlace</p>
                          <Input placeholder="https://ejemplo.com" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} className="h-8 text-sm" />
                          <Input placeholder="Texto del enlace (opcional)" value={linkText} onChange={e => setLinkText(e.target.value)} className="h-8 text-sm" />
                          <Button size="sm" className="w-full" disabled={!linkUrl.trim()} onClick={() => {
                            const url = linkUrl.trim();
                            const text = linkText.trim() || url;
                            const htmlLink = `<a href="${url}">${text}</a>`;
                            const ta = replyRef.current;
                            if (ta) {
                              const start = ta.selectionStart;
                              const end = ta.selectionEnd;
                              const before = reply.slice(0, start);
                              const after = reply.slice(end);
                              setReply(before + htmlLink + after);
                            } else {
                              setReply(prev => prev + htmlLink);
                            }
                            setLinkUrl("");
                            setLinkText("");
                            setLinkPopoverOpen(false);
                          }}>Insertar</Button>
                        </PopoverContent>
                      </Popover>
                      <input ref={replyFileInputRef} type="file" multiple className="hidden" onChange={handlePickReplyFiles} />
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" title="Adjuntar archivo o PDF" onClick={() => replyFileInputRef.current?.click()}>
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={translateReplyToLeadLang}
                        disabled={autoTranslating || sending || !reply.trim()}
                        title="Traduce tu respuesta al idioma en el que te escribió el lead"
                      >
                        <Languages className="h-3.5 w-3.5" />
                        {autoTranslating ? "Traduciendo…" : (replyLang ? `En ${langLabels[replyLang] || replyLang}` : "Su idioma")}
                      </Button>
                    </div>
                    <Button size="sm" className="gap-2" onClick={handleReply} disabled={sending || autoTranslating || (!reply.trim() && replyFiles.length === 0)}>
                      <Send className="h-3.5 w-3.5" /> {sending ? "Enviando…" : "Responder"}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      </>
      )}

      {/* Block Dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" /> Bloquear contacto
            </DialogTitle>
            <DialogDescription>
              Elige cómo bloquear a <strong>{blockTarget?.email}</strong>. Se eliminará de todas las campañas activas.
            </DialogDescription>
          </DialogHeader>
          {blockTarget && (
            <div className="space-y-2 py-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-3 h-auto py-3 hover:bg-destructive/5 hover:border-destructive/30"
                onClick={() => handleBlockEmail(blockTarget.email)}
                disabled={blocking}
              >
                <ShieldBan className="h-5 w-5 text-destructive flex-shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-medium">Bloquear email</p>
                  <p className="text-xs text-muted-foreground">{blockTarget.email} — eliminar de todas las campañas</p>
                </div>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-3 h-auto py-3 hover:bg-destructive/5 hover:border-destructive/30"
                onClick={() => handleBlockDomain(blockTarget.domain)}
                disabled={blocking}
              >
                <Globe className="h-5 w-5 text-destructive flex-shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-medium">Bloquear dominio</p>
                  <p className="text-xs text-muted-foreground">@{blockTarget.domain} — todos los emails de este dominio</p>
                </div>
              </Button>
            </div>
          )}
          {blocking && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Procesando...
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Blocklist manager — view + unblock emails and domains */}
      <Dialog open={blockManagerOpen} onOpenChange={setBlockManagerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldBan className="h-5 w-5 text-destructive" /> Bloqueados
            </DialogTitle>
            <DialogDescription>
              Emails y dominios que has bloqueado. No reciben envíos ni aparecen en el Unibox. Pulsa <strong>Desbloquear</strong> para quitarlos.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {blockedLoading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : blockedEntries.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No tienes nada bloqueado.</div>
            ) : (
              <div className="space-y-1.5">
                {blockedEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2">
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${entry.entry_type === "domain" ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-600"}`}>
                      {entry.entry_type === "domain" ? <Globe className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {entry.entry_type === "domain" ? `@${entry.value}` : entry.value}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {entry.entry_type === "domain" ? "Dominio" : "Email"}
                      </div>
                    </div>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 flex-shrink-0 gap-1.5 text-xs"
                      onClick={() => handleUnblock(entry)}
                      disabled={unblockingId === entry.id}
                    >
                      {unblockingId === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      Desbloquear
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {!blockedLoading && blockedEntries.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {blockedEntries.filter(e => e.entry_type === "email").length} emails · {blockedEntries.filter(e => e.entry_type === "domain").length} dominios
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Signature manager Dialog (Unibox) */}
      <Dialog open={sigOpen} onOpenChange={setSigOpen}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <Pencil className="h-5 w-5 text-primary" /> Firma electrónica
            </DialogTitle>
            <DialogDescription>
              Se añade automáticamente <b>debajo de cada correo</b> (campañas y respuestas del Unibox) de las cuentas elegidas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Scope */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Aplicar a</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "all", label: `Todas (${sigAccounts.length})`, disabled: sigAccounts.length === 0 },
                  { key: "tag", label: "Por tag", disabled: sigAllTags.length === 0 },
                  { key: "account", label: "Una cuenta", disabled: sigAccounts.length === 0 },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => setSigScope(opt.key)}
                    className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                      sigScope === opt.key ? "border-primary bg-primary/10 text-primary" : "border-border/60 hover:bg-muted"
                    } ${opt.disabled ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {sigScope === "tag" && (
                <Select value={sigTag} onValueChange={setSigTag}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Elige un tag" /></SelectTrigger>
                  <SelectContent>
                    {sigAllTags.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {sigScope === "account" && (
                <Select value={sigAccountId} onValueChange={setSigAccountId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Elige una cuenta" /></SelectTrigger>
                  <SelectContent>
                    {sigAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground">Se aplicará a <b>{sigTargetIds.length}</b> cuenta(s).</p>
            </div>

            {/* HTML editor + live preview */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Firma (HTML)</p>
              <Textarea
                value={sigHtml}
                onChange={e => setSigHtml(e.target.value)}
                placeholder={'<p>Un saludo,<br><strong>Nombre Apellido</strong><br>Empresa · <a href="https://tuweb.com">tuweb.com</a></p>'}
                className="min-h-[130px] font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
              <div className="rounded-md border border-border/60 bg-background p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Vista previa</p>
                {sigHtml.trim() ? (
                  <div
                    className="text-sm leading-relaxed break-words [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(signatureToBrLines(sigHtml)) }}
                  />
                ) : (
                  <p className="text-xs italic text-muted-foreground">Escribe tu firma HTML arriba para ver aquí cómo queda.</p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">Deja el HTML <b>vacío</b> y pulsa Aplicar para <b>quitar</b> la firma.</p>
            </div>
          </div>
          <Button onClick={applyUniboxSignature} className="w-full" disabled={sigSaving || sigTargetIds.length === 0}>
            {sigSaving ? "Aplicando…" : (sigHtml.trim() ? `Aplicar firma a ${sigTargetIds.length} cuenta(s)` : `Quitar firma de ${sigTargetIds.length} cuenta(s)`)}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Forward (reenviar) Dialog */}
      <Dialog open={forwardOpen} onOpenChange={(o) => { if (!forwarding) setForwardOpen(o); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Forward className="h-5 w-5 text-primary" /> Reenviar email
            </DialogTitle>
            <DialogDescription>
              {selected ? <>Reenviar “{decodeSubject(selected.subject)}” a otra dirección.</> : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Para</label>
              <Input
                type="email"
                placeholder="destinatario@ejemplo.com"
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                className="h-9 text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Nota (opcional)</label>
              <Textarea
                placeholder="Añade un mensaje antes del email reenviado…"
                value={forwardNote}
                onChange={(e) => setForwardNote(e.target.value)}
                className="min-h-[72px] resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForwardOpen(false)} disabled={forwarding}>Cancelar</Button>
            <Button className="gap-2" onClick={handleForward} disabled={forwarding || !forwardTo.trim()}>
              {forwarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Forward className="h-4 w-4" />}
              {forwarding ? "Reenviando…" : "Reenviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Lead Dialog */}
      <Dialog open={deleteLeadOpen} onOpenChange={(o) => { if (!deletingLead) setDeleteLeadOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5 text-destructive" /> Eliminar lead
            </DialogTitle>
            <DialogDescription>
              {selected ? (
                <>Se eliminará <strong>{selected.from_email}</strong> por completo: de la base de datos,
                de <strong>todas las listas y campañas</strong>, sus emails enviados/recibidos y recordatorios.
                Esta acción no se puede deshacer.</>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteLeadOpen(false)} disabled={deletingLead}>Cancelar</Button>
            <Button variant="destructive" className="gap-2" onClick={handleDeleteLead} disabled={deletingLead}>
              {deletingLead ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
              {deletingLead ? "Eliminando…" : "Eliminar lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
