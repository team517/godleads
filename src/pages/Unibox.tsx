import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { containsProfanity } from "@/lib/profanity-filter";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Archive, RefreshCw, Send, Inbox as InboxIcon, Mail, MailOpen, User, Sparkles, X, Loader2, Bell, Clock, Trash2, ArchiveX, Link2, Megaphone, ArrowLeft, Languages, Ban, ShieldBan, Globe } from "lucide-react";
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

function cleanBodyText(raw: string | null): string {
  if (!raw) return "";
  let text = repairMojibake(raw);

  // Remove IMAP artifacts
  text = text.replace(/^BODY\[TEXT\]\s*\{\d+\}\s*/i, "");

  // Remove MIME boundaries (all common formats)
  text = text.replace(/^--[a-zA-Z0-9_=.-]{10,}--?\s*$/gm, "");
  text = text.replace(/----_[^\r\n]+/g, "");
  text = text.replace(/^--=_[^\r\n]+/gm, "");
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

  // Remove warmup tracking codes (e.g., CHBV6J7, 2YSB82T)
  text = text.replace(/\b[A-Z0-9]{5,12}\b/g, (match) => {
    const hasLetter = /[A-Za-z]/.test(match);
    const hasDigit = /[0-9]/.test(match);
    if (hasLetter && hasDigit && /[A-Za-z][0-9]|[0-9][A-Za-z]/.test(match)) return "";
    return match;
  });

  // Clean pipe separators from warmup codes
  text = text.replace(/\s*\|\s*$/gm, "");

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
      return resultLines.slice(0, mid).join("\n").trim();
    }
  }
  return result;
}

/** Clean HTML email body for safe rendering — aggressively strips artifacts for a clean Gmail-style view */
function cleanBodyHtml(raw: string | null): string {
  if (!raw) return "";
  let html = repairMojibake(raw);

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

  // Remove warmup tracking codes (mixed letters+digits, 5-12 chars)
  html = html.replace(/\b[A-Z0-9]{5,12}\b/g, (match) => {
    const hasLetter = /[A-Za-z]/.test(match);
    const hasDigit = /[0-9]/.test(match);
    if (hasLetter && hasDigit && /[A-Za-z][0-9]|[0-9][A-Za-z]/.test(match)) return "";
    return match;
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

function decodeSubject(raw: string | null): string {
  if (!raw) return "(sin asunto)";
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
  return repairMojibake(decodeHtmlEntities(decoded.replace(/\?=\s+=\?/g, "?==?"))).trim() || "(sin asunto)";
}

/** Strict warmup detector — drops messages with any mixed letter+digit code in the subject.
 *  Examples blocked: "Eric - quick question | GH2RZD5 CHBV6J7", "ot 2 | CHBV6J7 WK2FX1R",
 *  "VC3Q3N2", "isition challenge | any.trail.manufactur CHBV6J7", "t27109847387709683 ...". */
const WARMUP_MIXED_CODE_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20}\b/;
const WARMUP_LONG_DIGIT_RE = /\b\d{8,}\b/;
const WARMUP_UUID_LIKE_RE = /\b[a-f0-9]{4,}-[a-f0-9-]{8,}\b/i;
const WARMUP_DOTTED_LOWER_RE = /\b[a-z]+\.[a-z]+(?:\.[a-z]+)+\b/;
const WARMUP_MARKER_RE = /#warmup|instantly-warmup|warmup-|x-warmup/i;
export function hasWarmupCodes(subject: string | null, body: string | null): boolean {
  const sRaw = decodeSubject(subject || "");
  const s = (sRaw || "").trim();
  const b = (body || "").slice(0, 800);
  if (WARMUP_MARKER_RE.test(s + " " + b)) return true;
  // ANY mixed alphanumeric code in subject = drop (warmup signature) — even on Re:/Fwd:/leads
  if (WARMUP_MIXED_CODE_RE.test(s)) return true;
  if (WARMUP_LONG_DIGIT_RE.test(s)) return true;
  if (WARMUP_UUID_LIKE_RE.test(s) || WARMUP_UUID_LIKE_RE.test(b.slice(0, 300))) return true;
  if (WARMUP_DOTTED_LOWER_RE.test(s)) return true;
  if (WARMUP_LONG_DIGIT_RE.test(b.slice(0, 300))) return true;
  // 2+ mixed codes in body start
  const bodyMatches = b.slice(0, 800).match(new RegExp(WARMUP_MIXED_CODE_RE.source, "g")) || [];
  if (bodyMatches.length >= 2) return true;
  return false;
}

/** Spam detection – hide only clear warmup/automated messages from the cleaned views. */
function isSpam(subject: string | null, body: string | null, fromEmail: string | null): boolean {
  const sub = decodeSubject(subject || "");
  const email = fromEmail || "";

  // Hide messages whose subject contains warmup codes regardless of Re:/Fwd:
  if (hasWarmupCodes(subject, body)) return true;
  if (/#warmup|instantly-warmup/i.test(sub)) return true;

  // Known automated senders
  if (/noreply@|no-reply@|mailer-daemon@|postmaster@|bounce@/i.test(email)) return true;

  return false;
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

/* ── Component ─────────────────────────────────────────────────── */

export default function Unibox() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [messages, setMessages] = useState<any[]>([]);
  const [mailboxMode, setMailboxMode] = useState<"clean" | "all">("clean");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);


  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<FilterType>("all");
  const [showTodayOnly, setShowTodayOnly] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncLockRef = useRef(false);
  const backgroundSyncOffsetRef = useRef(0);
  const lastAutoSyncAttemptRef = useRef(0);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPromptName, setAiPromptName] = useState("");
  const [aiPrompts, setAiPrompts] = useState<any[]>([]);
  const [accountsMap, setAccountsMap] = useState<Record<string, string[]>>({});
  const [reminders, setReminders] = useState<Record<string, any>>({});
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [viewTab, setViewTab] = useState<"global" | "all_mailboxes" | "campaigns" | "reminders">("global");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");
  const [translatedBody, setTranslatedBody] = useState("");
  const [translating, setTranslating] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<{ email: string; domain: string } | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [threadMessages, setThreadMessages] = useState<any[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
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
    // ⚡ Instantly-style filter: only "real" inbox items.
    // We pull only messages that are:
    //   - linked to a known lead OR campaign (replies to our outreach), OR
    //   - already classified by the AI (Interesado / No interesado / Pregunta / Fuera-Auto), OR
    //   - obvious replies/forwards (Re:/RE:/Fw:/Fwd:/Rv:/Aw:/Tr:/Res:)
    // This skips the 60k+ warm-up garbage and "first contact" cold mails to our address.
    const allRows: any[] = [];
    const pageSize = 1000;
    const filterOr = [
      "campaign_id.not.is.null",
      "lead_id.not.is.null",
      "labels.cs.{Interesado}",
      "labels.cs.{\"No interesado\"}",
      "labels.cs.{Pregunta}",
      "labels.cs.{\"Fuera / Auto\"}",
      "subject.ilike.Re:%",
      "subject.ilike.RE:%",
      "subject.ilike.Re %",
      "subject.ilike.Fw:%",
      "subject.ilike.FW:%",
      "subject.ilike.Fwd:%",
      "subject.ilike.FWD:%",
      "subject.ilike.Rv:%",
      "subject.ilike.RV:%",
      "subject.ilike.Aw:%",
      "subject.ilike.AW:%",
      "subject.ilike.Tr:%",
      "subject.ilike.TR:%",
      "subject.ilike.Res:%",
      "subject.ilike.RES:%",
      "subject.ilike.Respuesta automática%",
      "subject.ilike.Automatic reply%",
      "subject.ilike.Out of office%",
      "subject.ilike.ABSENT%",
      "subject.ilike.AUSENTE%",
    ].join(",");

    for (let from = 0; from < 10000; from += pageSize) {
      const { data: page, error } = await supabase
        .from("inbox_messages")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_archived", false)
        .or(filterOr)
        .order("received_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) break;
      allRows.push(...(page || []));
      if (!page || page.length < pageSize) break;
    }
    const data = allRows;
    const raw = data || [];

    const seenMessageKeys = new Set<string>();
    const msgs = raw.filter((message) => {
      // Strict warmup filter — applies to ALL messages, no exceptions for lead_id/labels.
      // Any mixed letter+number code in the subject (e.g. GH2RZD5, CHBV6J7) = warmup → hide.
      if (hasWarmupCodes(message.subject, message.body_text)) return false;
      const key = getMessageDeduplicationKey(message);
      if (seenMessageKeys.has(key)) return false;
      seenMessageKeys.add(key);
      return true;
    });
    setMessages(msgs);
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

  const syncInbox = useCallback(async ({ silent = false, maxRounds = silent ? 10 : 12, fetchLimit = silent ? 200 : 1000 }: { silent?: boolean; maxRounds?: number; fetchLimit?: number } = {}) => {
    if (!user || syncLockRef.current) return;
    syncLockRef.current = true;
    if (!silent) setSyncing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      let totalNewMessages = 0;
      let offset = silent ? backgroundSyncOffsetRef.current : 0;
      let hasMore = true;
      let rounds = 0;

      while (hasMore && rounds < maxRounds) {
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-inbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ offset, batch_size: silent ? 20 : 30, fetch_limit: fetchLimit }),
        });

        const result = await resp.json();
        if (!resp.ok || result.error) {
          if (!silent) toast.error(result.error || "Error al sincronizar");
          return;
        }

        totalNewMessages += Number(result.new_messages || 0);
        hasMore = Boolean(result.has_more);
        offset = Number(result.next_offset || 0);
        backgroundSyncOffsetRef.current = hasMore ? offset : 0;
        rounds += 1;
      }

      setLastSyncAt(new Date());
      await load();
      if (!silent) toast.success(`${totalNewMessages} mensajes nuevos`);
    } catch (e: any) {
      if (!silent) toast.error(`Error: ${e.message}`);
    } finally {
      syncLockRef.current = false;
      if (!silent) setSyncing(false);
    }
  }, [user, load]);

  /** Silent background IMAP sync – no toasts, no loading state */
  const autoSync = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    if (now - lastAutoSyncAttemptRef.current < 180_000) return;
    lastAutoSyncAttemptRef.current = now;
    await syncInbox({ silent: true, maxRounds: 2 });
  }, [syncInbox]);

  // Load AI prompts and account tags
  useEffect(() => {
    if (!user) return;
    const loadAI = async () => {
      const [{ data: prompts }, { data: accounts }, { data: campaignsData }] = await Promise.all([
        supabase.from("ai_prompts").select("*").eq("user_id", user.id),
        supabase.from("email_accounts").select("id, tags").eq("user_id", user.id),
        supabase.from("campaigns").select("id, name").eq("user_id", user.id).order("name"),
      ]);
      setAiPrompts(prompts || []);
      setCampaigns(campaignsData || []);
      const map: Record<string, string[]> = {};
      accounts?.forEach((a: any) => { map[a.id] = a.tags || []; });
      setAccountsMap(map);
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
        if (hasWarmupCodes(m.subject, m.body_text)) continue;
        if (isSpam(m.subject, m.body_text, m.from_email)) continue;
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

  // Clear AI suggestion and translation when selecting different message
  useEffect(() => {
    setAiSuggestion("");
    setAiPromptName("");
    setTranslatedBody("");
    setDetectedLang(null);
    const msg = messages.find(m => m.id === selectedId);
    if (msg) loadThread(msg);
    else setThreadMessages([]);
  }, [selectedId, messages, loadThread]);




  // Initial load + initial IMAP sync + reminders
  useEffect(() => {
    load();
    loadReminders();
    const syncTimeout = setTimeout(() => {
      autoSync();
    }, 1500);
    return () => clearTimeout(syncTimeout);
  }, [load, autoSync, loadReminders]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("unibox-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_messages", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  // Auto-refresh DB every 30 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => { load(); }, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  // Auto-sync IMAP every 60 seconds
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => { autoSync(); }, 60_000);
    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
  }, [autoSync]);

  // Detail opens in a modal — no auto-selection so closing actually closes.

  const selected = useMemo(() => messages.find(m => m.id === selectedId) || null, [messages, selectedId]);

  // No longer auto-detect on select — detect happens on translate click

  const handleTranslateBody = async () => {
    if (!selected) return;
    if (translatedBody) { setTranslatedBody(""); setDetectedLang(null); return; }
    setTranslating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body = cleanBodyText(selected.body_text);
      // First detect, then translate
      const detectResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ text: body.slice(0, 500), mode: "detect" }),
      });
      const detectResult = await detectResp.json();
      if (detectResult.error) { toast.error(detectResult.error); setTranslating(false); return; }
      const lang = detectResult.language || "en";
      setDetectedLang(lang);
      if (lang === "es") { toast.info("El mensaje ya está en español"); setTranslating(false); return; }
      // Now translate
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

  // Filter out spam only in the cleaned view, then apply category + search
  const filtered = useMemo(() => {
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const list = messages
      .filter(m => mailboxMode === "all" || viewTab === "campaigns" || !isSpam(m.subject, m.body_text, m.from_email))
      .filter(m => {
        if (viewTab === "reminders") return !!reminders[m.id];
        if (viewTab === "campaigns") {
          if (selectedCampaignId === "all") return true;
          return m.campaign_id === selectedCampaignId;
        }
        return true;
      })
      .filter(m => !showTodayOnly || new Date(m.received_at) >= now24h)
      .filter(m => categoryFilter === "all" || classifyMessage(m.subject, m.body_text) === categoryFilter)
      .filter(m =>
        !search ||
        m.from_email?.toLowerCase().includes(search.toLowerCase()) ||
        m.from_name?.toLowerCase().includes(search.toLowerCase()) ||
        m.subject?.toLowerCase().includes(search.toLowerCase())
      );
    // Sort: due reminders first (yellow), then by received_at desc
    return list.sort((a, b) => {
      const aDue = isReminderDue(a.id);
      const bDue = isReminderDue(b.id);
      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    });
  }, [messages, mailboxMode, search, categoryFilter, showTodayOnly, viewTab, selectedCampaignId, reminders]);

  const categoryCounts = useMemo(() => {
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const base = (mailboxMode === "all" || viewTab === "campaigns") ? messages : messages.filter(m => !isSpam(m.subject, m.body_text, m.from_email));
    const nonSpam = base.filter(m => !showTodayOnly || new Date(m.received_at) >= now24h);
    const counts: Record<string, number> = { all: nonSpam.length };
    for (const m of nonSpam) {
      const cat = classifyMessage(m.subject, m.body_text);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [messages, mailboxMode, viewTab, showTodayOnly]);

  const unreadCount = useMemo(() =>
    messages.filter(m => !m.is_read && (mailboxMode === "all" || viewTab === "campaigns" || !isSpam(m.subject, m.body_text, m.from_email))).length
  , [messages, mailboxMode, viewTab]);

  const handleSync = async () => {
    await syncInbox();
  };

  const handleMarkRead = async (id: string) => {
    await supabase.from("inbox_messages").update({ is_read: true }).eq("id", id);
  };

  const handleArchive = async (id: string) => {
    await supabase.from("inbox_messages").update({ is_archived: true }).eq("id", id);
    toast.success("Archivado");
    setSelectedId(null);
  };

  const handleDeleteMessage = async (id: string) => {
    const target = messages.find((message) => message.id === id);
    if (!target) return;
    if (!window.confirm(`¿Eliminar el email de ${target.from_name || target.from_email}? Esta acción no se puede deshacer.`)) return;

    const { error } = await supabase.from("inbox_messages").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }

    const remaining = messages.filter((message) => message.id !== id);
    setMessages(remaining);
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
    // Upsert: remove existing reminder for this message first
    await supabase.from("message_reminders").delete().eq("message_id", messageId).eq("user_id", user.id);
    await supabase.from("message_reminders").insert({
      user_id: user.id,
      message_id: messageId,
      remind_at: remindAt.toISOString(),
    });
    toast.success(`Recordatorio: ${format(remindAt, "d MMM yyyy", { locale: es })}`);
    loadReminders();
  };

  const handleClearReminder = async (messageId: string) => {
    if (!user) return;
    await supabase.from("message_reminders").delete().eq("message_id", messageId).eq("user_id", user.id);
    toast.success("Recordatorio eliminado");
    loadReminders();
  };


  const handleBlockEmail = async (email: string) => {
    if (!user) return;
    setBlocking(true);
    try {
      // 1. Add to blocklist
      await supabase.from("blocklist").upsert({ user_id: user.id, entry_type: "email", value: email.toLowerCase() }, { onConflict: "user_id,entry_type,value" });
      // 2. Find all leads with this email
      const { data: leads } = await supabase.from("leads").select("id").eq("user_id", user.id).eq("email", email.toLowerCase());
      if (leads && leads.length > 0) {
        const leadIds = leads.map(l => l.id);
        // Remove from all campaign_leads
        for (const lid of leadIds) {
          await supabase.from("campaign_leads").delete().eq("lead_id", lid);
        }
      }
      toast.success(`${email} bloqueado y eliminado de todas las campañas`);
    } catch (e: any) { toast.error(e.message); }
    setBlocking(false);
    setBlockDialogOpen(false);
    setBlockTarget(null);
  };

  const handleBlockDomain = async (domain: string) => {
    if (!user) return;
    setBlocking(true);
    try {
      // 1. Add domain to blocklist
      await supabase.from("blocklist").upsert({ user_id: user.id, entry_type: "domain", value: domain.toLowerCase() }, { onConflict: "user_id,entry_type,value" });
      // 2. Find all leads with this domain
      const { data: leads } = await supabase.from("leads").select("id, email").eq("user_id", user.id);
      const domainLeads = (leads || []).filter(l => l.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
      if (domainLeads.length > 0) {
        for (const lead of domainLeads) {
          await supabase.from("campaign_leads").delete().eq("lead_id", lead.id);
        }
      }
      toast.success(`Dominio @${domain} bloqueado — ${domainLeads.length} leads eliminados de campañas`);
    } catch (e: any) { toast.error(e.message); }
    setBlocking(false);
    setBlockDialogOpen(false);
    setBlockTarget(null);
  };

  const handleReply = async () => {
    if (!selected || !reply.trim() || !user) return;
    if (containsProfanity(reply)) {
      toast.error("Tu respuesta contiene lenguaje inapropiado. Por favor, modifícala antes de enviar.");
      return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let finalBody = reply;

      // Auto-translate reply if the original message is in another language
      if (detectedLang && detectedLang !== "es") {
        setAutoTranslating(true);
        try {
          const transResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
            body: JSON.stringify({ text: reply, target_lang: detectedLang, mode: "translate" }),
          });
          const transResult = await transResp.json();
          if (transResult.translated) {
            finalBody = transResult.translated;
            toast.info(`Respuesta traducida automáticamente al ${langLabels[detectedLang] || detectedLang}`);
          }
        } catch { /* send in original if translation fails */ }
        setAutoTranslating(false);
      }

      const originalSubject = decodeSubject(selected.subject) || "";
      const replySubject = originalSubject.toLowerCase().startsWith("re:") ? originalSubject : `Re: ${originalSubject}`;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          account_id: selected.account_id,
          to_email: selected.from_email,
          subject: replySubject,
          body: finalBody,
          in_reply_to: selected.message_id || undefined,
          references: selected.message_id || undefined,
        }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success("Respuesta enviada");
        setReply("");
        // Refresh thread to show the sent message
        const msg = messages.find(m => m.id === selectedId);
        if (msg) setTimeout(() => loadThread(msg), 500);
      }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setSending(false);
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
    <div className="flex h-[calc(100vh-80px)] min-h-0 flex-col gap-2.5 lg:gap-3">
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
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs md:text-sm" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {isMobile ? "Sync" : syncing ? "Sincronizando…" : "Sincronizar"}
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
      </div>

      {/* Tabs: Global / Campaigns */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 md:flex-row md:items-center md:justify-between md:px-4">
        <Tabs value={viewTab} onValueChange={(v) => {
          const nextTab = v as "global" | "all_mailboxes" | "campaigns" | "reminders";
          setViewTab(nextTab);
          setMailboxMode(nextTab === "all_mailboxes" ? "all" : "clean");
        }}>
          <TabsList className="h-9 w-full justify-start md:w-auto">
            <TabsTrigger value="global" className="gap-1.5 text-xs">
              <InboxIcon className="h-3.5 w-3.5" /> Global
            </TabsTrigger>
            <TabsTrigger value="all_mailboxes" className="gap-1.5 text-xs">
              <Globe className="h-3.5 w-3.5" /> Todos
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5 text-xs">
              <Megaphone className="h-3.5 w-3.5" /> Campaigns
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

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-border/60 bg-card py-20">
          <InboxIcon className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="font-display font-semibold mb-2">Bandeja vacía</h3>
          <p className="text-sm text-muted-foreground mb-4">Sincroniza para traer mensajes de tus cuentas.</p>
          <Button onClick={handleSync} disabled={syncing} size="sm" className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sincronizar
          </Button>
        </div>
      ) : (
        <>
        <div className="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
          {/* ── Message list (full width — detail opens as modal) ── */}
          <div className="flex w-full flex-col bg-muted/20">
            <div className="border-b border-border/60 bg-card p-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre o email…"
                  className="pl-9 h-8 text-sm bg-muted/40 border-0 focus-visible:ring-1"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              {filtered.map((msg) => {
                const isActive = selectedId === msg.id;
                const isUnread = !msg.is_read;
                const category = classifyMessage(msg.subject, msg.body_text);
                const catCfg = categoryConfig[category];
                const due = isReminderDue(msg.id);
                const hasReminder = !!reminders[msg.id];
                return (
                  <button
                    key={msg.id}
                    onClick={() => {
                      setSelectedId(msg.id);
                      if (isUnread) handleMarkRead(msg.id);
                    }}
                    className={`relative w-full border-b border-border/30 px-4 py-3.5 text-left transition-all
                      ${due ? "bg-amber-100/70 dark:bg-amber-900/20 border-l-2 border-l-amber-500" : isActive ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent"}
                    `}
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${catCfg.bg || "bg-muted"} ${catCfg.text}`}>
                        {getInitials(msg.from_name, msg.from_email)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
                            {msg.from_name || msg.from_email?.split("@")[0]}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {timeAgo(msg.received_at)}
                          </span>
                        </div>
                        <p className={`text-[13px] truncate mt-0.5 ${isUnread ? "text-foreground/80" : "text-muted-foreground"}`}>
                          {decodeSubject(msg.subject)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="line-clamp-2 flex-1 text-xs leading-5 text-muted-foreground/70">
                            {cleanBodyText(msg.body_text).slice(0, 96)}
                          </p>
                          {catCfg.label && (
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${catCfg.text} whitespace-nowrap`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${catCfg.dot}`} />
                              {catCfg.label}
                            </span>
                          )}
                        </div>
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
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No hay mensajes en esta categoría
                </div>
              )}
            </ScrollArea>
          </div>

        </div>

      {/* ── Conversation modal — opens centered with blurred backdrop ── */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent
          className="max-w-5xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col overflow-hidden bg-card border-border/60 shadow-2xl [&>button.absolute]:hidden"
        >
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
            {selected ? (
              <>
                {/* Subject bar — top like Gmail */}
                <div className="border-b border-border/60 px-4 pb-4 pt-4 md:px-8 md:pb-5 md:pt-6">
                  <div className="flex items-start gap-3">
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
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className={`h-8 w-8 ${reminders[selected.id] ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}`} title="Recordatorio">
                            <Bell className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-2" align="end">
                          <p className="text-xs font-medium mb-2 px-1">Recordar en…</p>
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
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => { setBlockTarget({ email: selected.from_email, domain: selected.from_email.split("@")[1] || "" }); setBlockDialogOpen(true); }} title="Bloquear">
                        <Ban className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteMessage(selected.id)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleArchive(selected.id)} title="Archivar">
                        <Archive className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setSelectedId(null)} title="Cerrar">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Conversation thread */}
                <ScrollArea className="min-h-0 flex-1">
                  <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-8 md:py-6">
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
                            <div className="flex items-center gap-3 border-b border-border/40 px-5 py-3.5">
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
                                  {!isSent && (
                                    <span className="text-xs text-muted-foreground truncate">&lt;{tm.from_email}&gt;</span>
                                  )}
                                </div>
                              </div>
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">{dateStr}</span>
                            </div>
                            <div className="px-5 py-5 md:px-8 md:py-6">
                              {isSent ? (
                                <div
                                  className="text-[15px] text-foreground leading-[1.75] break-words [&_p]:my-3 [&_a]:text-primary [&_a]:underline"
                                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(tm.body || "") }}
                                />
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
                                  dangerouslySetInnerHTML={{ __html: cleanBodyHtml(tm.body_html) }}
                                />
                              ) : (
                                <div className="text-[15px] text-foreground leading-[1.75] whitespace-pre-wrap break-words">
                                  {cleanBodyText(tm.body_text)}
                                </div>
                              )}
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
                          {selected.body_html && selected.body_html.trim().length > 20 ? (
                            <div
                              className="max-w-none text-foreground leading-[1.8] text-[15px] break-words overflow-x-auto
                                [&_p]:my-3 [&_a]:text-primary [&_a]:underline [&_a]:break-all
                                [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6
                                [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:my-3
                                [&_strong]:font-semibold [&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground"
                              dangerouslySetInnerHTML={{ __html: cleanBodyHtml(selected.body_html) }}
                            />
                          ) : (
                            <div className="text-[15px] text-foreground leading-[1.8] whitespace-pre-wrap break-words">
                              {cleanBodyText(selected.body_text)}
                            </div>
                          )}
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
                  <div className="border-t border-border/60 bg-muted/10 px-3 pb-20 pt-3 md:px-4 md:pb-6 md:pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[10px] md:text-xs text-muted-foreground truncate">
                      <Send className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">→ {selected.from_name || selected.from_email}</span>
                      {detectedLang && detectedLang !== "es" && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                          <Languages className="h-2.5 w-2.5" />
                          Auto-traducir a {langLabels[detectedLang] || detectedLang}
                        </span>
                      )}
                    </div>
                    {(
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 border-primary/30 px-2.5 text-[11px] text-primary hover:bg-primary/10"
                        onClick={handleAiSuggest}
                        disabled={aiLoading}
                      >
                        {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {aiLoading ? "Generando…" : "Sugerir respuesta IA"}
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
                      className="mb-2.5 min-h-[72px] resize-none bg-card text-sm"
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                  />
                  <div className="flex items-center justify-between gap-3 pr-20 md:pr-0">
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
                    </div>
                    <Button size="sm" className="gap-2" onClick={handleReply} disabled={sending || autoTranslating || !reply.trim()}>
                      <Send className="h-3.5 w-3.5" /> {autoTranslating ? "Traduciendo…" : sending ? "Enviando…" : "Responder"}
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
    </div>
  );
}
