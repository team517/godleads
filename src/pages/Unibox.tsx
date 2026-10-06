import { hasWarmupSubjectTag, isWarmupMessage, isBounceOrFailure } from "@/lib/inbox-filters";
import { sentBodyHtml } from "@/lib/sent-body";
import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from "react";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { pendingDomains, readLeadDomainMemo, resolveLeadDomains } from "@/lib/lead-domains";
import { isCampaignRelevant, isOwnBrandDomain } from "@/lib/inbox-visibility";
import { looksBinaryText } from "@/lib/reply-text";
import { containsProfanity } from "@/lib/profanity-filter";
import { publishUniboxUnread } from "@/lib/uniboxBadge";
import { isPrimaryRow, PRIMARY_FEED } from "@/lib/mobile-inbox";
import DOMPurify from "dompurify";
import MailHtml from "@/components/unibox/MailHtml";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SavedSignatures } from "@/components/SavedSignatures";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import RichReplyEditor, { type RichReplyHandle } from "@/components/unibox/RichReplyEditor";
import { buildForwardHtml, forwardSubject, plainToForwardHtml } from "@/lib/forward";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Archive, ArchiveRestore, RefreshCw, Send, Inbox as InboxIcon, Mail, MailOpen, User, Sparkles, X, Loader2, Bell, Clock, Trash2, ArchiveX, Link2, Megaphone, ArrowLeft, Languages, Ban, ShieldBan, Globe, Forward, UserX, Paperclip, FileText, FolderInput, Maximize2, Minimize2, Download, Check, Pencil, Star } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import EmptyShowcase from "@/components/EmptyShowcase";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow, addDays, addWeeks, startOfTomorrow, format, nextMonday } from "date-fns";
import { es } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ReplyDraftPanel } from "@/components/reply-agent/ReplyDraftPanel";
import {
  ATTACHMENT_CUT_RE,
  HTML_QUOTE_START_RE,
  ID_WHITELIST_RE,
  IMPORTANT_LABEL,
  INBOX_LIST_COLS,
  LABEL_TO_CATEGORY,
  LANG_EN,
  LANG_ES_CA,
  LANG_FR,
  LANG_IT,
  LANG_OTHER,
  LONG_DIGIT_RE,
  LONG_HEX_RE,
  LONG_MIXED_RE,
  MIXED_CODE_RE,
  QUOTE_MARKERS,
  REPLY_SUBJECT_RE,
  WARMUP_DOTTED_LOWER_RE,
  WARMUP_LONG_DIGIT_RE,
  WARMUP_MARKER_RE,
  WARMUP_MIXED_CODE_RE,
  WARMUP_UUID_LIKE_RE,
  WARMUP_WHITELIST,
  _cleanTextCache,
  _renderableCache,
  attachmentObjectUrl,
  buildReplyQuoteHtml,
  categoryCache,
  categoryOf,
  classifyMessage,
  cleanBodyHtml,
  cleanBodyText,
  cleanBodyTextRaw,
  countWarmupCodes,
  decodeBase64Body,
  decodeBytes,
  decodeFilename,
  decodeHtmlEntities,
  decodeSubject,
  decodeSubjectKeepCodes,
  detectLanguageBucket,
  extractAttachmentNames,
  extractAttachments,
  findQuoteStart,
  getInitials,
  getMessageDeduplicationKey,
  isBounceOrNoise,
  isRelevantInboxItem,
  isSpam,
  looksLikeWarmupCode,
  renderableHtml,
  searchTextCache,
  searchTextOf,
  stripAttachmentJunk,
  stripCssText,
  stripQuotedReply,
  stripWarmupTokens,
  subjectHasWarmupCode,
  textHasWarmupCode,
  tryDecodeBase64,
  unwrapHardBreaks,
  visibleTextLength,
} from "@/lib/unibox-text";
import type { MessageCategory, ParsedAttachment } from "@/lib/unibox-text";
import { isAutoResent } from "@/lib/unibox-text";
export { cleanBodyHtml, buildReplyQuoteHtml, renderableHtml } from "@/lib/unibox-text";
export type { ParsedAttachment } from "@/lib/unibox-text";

/* ── Las DOS formas de chip del diseño "Primary" (DESIGN.md) ──────────────
 * PASTILLA — para filtros INTERACTIVOS: radio 999px, 13px/600, fondo de
 *   tarjeta, borde lavanda de 1px, texto del color propio y `shadow-rest`.
 * ETIQUETA MINI — para marcadores de SOLO LECTURA: radio 999px, 10.5px/600,
 *   fondo tintado con el texto del MISMO tono (p. ej. bg-accent/text-accent-foreground).
 * Las cadenas van LITERALES: Tailwind purga todo lo que se construya
 * interpolando (`bg-${hue}-100`). */
// Chip CUADRADO (6px), como los quiere el propietario: la forma de pastilla se probó
// y se descartó. El radio 6px es además el radio dominante del diseño.
const CHIP_PILL =
  "inline-flex h-[26px] flex-shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold leading-none transition-all whitespace-nowrap";
const CHIP_MINI =
  "inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[10.5px] font-semibold leading-none whitespace-nowrap";

// Category label = ETIQUETA MINI: fondo tintado del tono + texto del mismo tono.
const categoryConfig: Record<MessageCategory, { label: string; bg: string; text: string; border: string; dot: string }> = {
  interested:     { label: "Interesado",    bg: "bg-emerald-100 dark:bg-emerald-500/20", text: "text-emerald-700 dark:text-emerald-300", border: "border-transparent", dot: "bg-emerald-500" },
  not_interested: { label: "No interesado", bg: "bg-red-100 dark:bg-red-500/20",         text: "text-red-700 dark:text-red-300",         border: "border-transparent",     dot: "bg-red-500" },
  no_contactar:   { label: "No contactar",  bg: "bg-rose-100 dark:bg-rose-500/20",       text: "text-rose-700 dark:text-rose-300",       border: "border-transparent",    dot: "bg-rose-600" },
  derivado:       { label: "Derivado",      bg: "bg-amber-100 dark:bg-amber-500/20",     text: "text-amber-700 dark:text-amber-300",     border: "border-transparent",   dot: "bg-amber-500" },
  question:       { label: "Pregunta",      bg: "bg-sky-100 dark:bg-sky-500/20",         text: "text-sky-700 dark:text-sky-300",         border: "border-transparent",     dot: "bg-sky-500" },
  out_of_office:  { label: "Fuera / Auto",  bg: "bg-pink-100 dark:bg-pink-500/20",       text: "text-pink-700 dark:text-pink-300",       border: "border-transparent",    dot: "bg-pink-500" },
  neutral:        { label: "",              bg: "",                                     text: "text-muted-foreground",                  border: "border-border",         dot: "bg-muted-foreground" },
};

type FilterType = "all" | "ai_replied" | MessageCategory;

// Filter-chip palette per filter key — forma PASTILLA (ver CHIP_PILL): en reposo,
// fondo de tarjeta + borde lavanda + texto del tono; activa, el tono en sólido.
// Mismos tonos que categoryConfig más "all" (neutro) y "ai_replied" (violeta).
// Cadenas literales por el mismo motivo de purga.
const filterChipStyles: Record<FilterType, { idle: string; active: string }> = {
  all:            { idle: "border-border bg-card text-foreground shadow-rest hover:bg-muted/60",                                                    active: "border-transparent bg-primary text-primary-foreground shadow-btn" },
  interested:     { idle: "border-border bg-card text-emerald-700 shadow-rest hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/15", active: "border-transparent bg-emerald-600 text-white shadow-rest dark:bg-emerald-400 dark:text-emerald-950" },
  ai_replied:     { idle: "border-border bg-card text-violet-700 shadow-rest hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/15",     active: "border-transparent bg-violet-600 text-white shadow-rest dark:bg-violet-400 dark:text-violet-950" },
  question:       { idle: "border-border bg-card text-sky-700 shadow-rest hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/15",                 active: "border-transparent bg-sky-600 text-white shadow-rest dark:bg-sky-400 dark:text-sky-950" },
  not_interested: { idle: "border-border bg-card text-red-700 shadow-rest hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15",                 active: "border-transparent bg-red-600 text-white shadow-rest dark:bg-red-400 dark:text-red-950" },
  no_contactar:   { idle: "border-border bg-card text-rose-700 shadow-rest hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/15",             active: "border-transparent bg-rose-700 text-white shadow-rest dark:bg-rose-400 dark:text-rose-950" },
  derivado:       { idle: "border-border bg-card text-amber-700 shadow-rest hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-500/15",         active: "border-transparent bg-amber-600 text-white shadow-rest dark:bg-amber-400 dark:text-amber-950" },
  out_of_office:  { idle: "border-border bg-card text-pink-700 shadow-rest hover:bg-pink-50 dark:text-pink-300 dark:hover:bg-pink-500/15",             active: "border-transparent bg-pink-600 text-white shadow-rest dark:bg-pink-400 dark:text-pink-950" },
  neutral:        { idle: "border-border bg-card text-foreground shadow-rest hover:bg-muted/60",                                                    active: "border-transparent bg-primary text-primary-foreground shadow-btn" },
};

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

function fileKind(name: string, mime: string): { label: string; color: string; isImage: boolean } {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"].includes(ext)) return { label: "Imagen", color: "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300", isImage: true };
  if (m.includes("pdf") || ext === "pdf") return { label: "PDF", color: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300", isImage: false };
  if (["doc", "docx", "odt", "rtf"].includes(ext) || m.includes("word") || m.includes("opendocument.text")) return { label: "Documento", color: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300", isImage: false };
  if (["xls", "xlsx", "csv", "ods"].includes(ext) || m.includes("sheet") || m.includes("excel")) return { label: "Hoja de cálculo", color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300", isImage: false };
  if (["ppt", "pptx", "odp"].includes(ext) || m.includes("presentation") || m.includes("powerpoint")) return { label: "Presentación", color: "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300", isImage: false };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { label: "Comprimido", color: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300", isImage: false };
  return { label: ext ? ext.toUpperCase() : "Archivo", color: "bg-muted text-muted-foreground", isImage: false };
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

export type StoredAttachment = { name: string; mime: string; size: number; path: string; oversized?: boolean; inline?: boolean; cid?: string };

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
      <div className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/30">
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
    <div className="flex w-full max-w-[300px] items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 shadow-rest">
      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${kind.color}`}>
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
      <div className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/30">
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
    <div className="flex w-full max-w-[300px] items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 shadow-rest">
      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${kind.color}`}>
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
/** Mensajes a los que ya se les ha preguntado por sus adjuntos en esta sesión. */
const attachmentsAsked = new Set<string>();

/** A quién más iba el correo: los demás destinatarios del "Para" y las copias.
 *  Nuestro propio buzón no se repite, porque ya se sabe que es para nosotros. Sin esta línea,
 *  una respuesta que sumaba a un compañero ("ANDRES LOSADA <andreslostor@gmail.com>") parecía
 *  dirigida sólo a nosotros y nadie se enteraba de que había alguien más (24-09-2026). */
export function otrosDestinatarios(to: string | null | undefined, cc: string | null | undefined, cuenta: string | null | undefined) {
  const mio = String(cuenta || "").toLowerCase().trim();
  // Se parte por comas, pero NO por las que van dentro de comillas o de <…>:
  // '"Losada, Andres" <andres@x.com>' es UN destinatario, no dos.
  const partir = (v: string | null | undefined) => {
    const texto = String(v || "");
    const trozos: string[] = [];
    let actual = "", comillas = false, angulo = false;
    for (const ch of texto) {
      if (ch === '"') comillas = !comillas;
      else if (ch === "<") angulo = true;
      else if (ch === ">") angulo = false;
      if (ch === "," && !comillas && !angulo) { trozos.push(actual); actual = ""; continue; }
      actual += ch;
    }
    trozos.push(actual);
    return trozos
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => {
        const dir = (x.match(/<([^>]+)>/)?.[1] || x).toLowerCase().trim();
        return dir !== mio;
      });
  };
  return { para: partir(to), copia: partir(cc) };
}

function Destinatarios({ m, cuenta }: { m: { to_emails?: string | null; cc_emails?: string | null }; cuenta?: string | null }) {
  const { para, copia } = otrosDestinatarios(m.to_emails, m.cc_emails, cuenta);
  if (para.length === 0 && copia.length === 0) return null;
  return (
    <span className="text-xs text-muted-foreground truncate" title={[...para, ...copia].join(", ")}>
      {para.length > 0 && <>· también para {para.join(", ")}</>}
      {copia.length > 0 && <> · en copia {copia.join(", ")}</>}
    </span>
  );
}

function AttachmentChips({ bodyText, bodyHtml, stored, messageId }: { bodyText?: string | null; bodyHtml?: string | null; stored?: StoredAttachment[] | null; messageId?: string | null }) {
  // La sincronización sólo baja los primeros 256 KB de cada correo, así que un PDF grande puede
  // no estar guardado. Si el correo habla de adjuntos y no hay ninguno, se van a buscar al buzón.
  const [pulled, setPulled] = useState<StoredAttachment[] | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullDone, setPullDone] = useState(false);
  const effective = pulled ?? stored;
  // Prefer attachments stored in Storage by the sync (real binary → view/download).
  // Las imágenes incrustadas de la firma (inline) no son archivos: las pinta MailHtml dentro del cuerpo.
  const storedAtts = useMemo(() => (Array.isArray(effective) ? effective.filter((a) => a && a.path && !a.oversized && !a.inline) : []), [effective]);
  // Too big to store (e.g. a large video) — shown as a name/size chip so it's never invisible.
  const oversizedAtts = useMemo(() => (Array.isArray(effective) ? effective.filter((a) => a && a.oversized) : []), [effective]);

  const atts = useMemo(() => {
    if (storedAtts.length > 0 || oversizedAtts.length > 0) return [];
    const found = [...extractAttachments(bodyHtml || ""), ...extractAttachments(bodyText || "")];
    const byKey = new Map<string, ParsedAttachment>();
    for (const a of found) if (!byKey.has(a.name)) byKey.set(a.name, a);
    return Array.from(byKey.values());
  }, [bodyText, bodyHtml, storedAtts, oversizedAtts]);

  const pull = useCallback(async (manual: boolean) => {
    if (!messageId || pulling) return;
    setPulling(true);
    try {
      const { data, error } = await supabase.functions.invoke("inbox-attachments", { body: { message_id: messageId } });
      if (error) throw error;
      const list = Array.isArray(data?.attachments) ? (data.attachments as StoredAttachment[]) : [];
      setPulled(list);
      if (manual) {
        if (list.length > 0) toast.success(`${list.length} archivo(s) recuperado(s) del buzón`);
        else toast.info("Ese correo no llevaba ningún archivo adjunto");
      }
    } catch (e: any) {
      if (manual) toast.error(e?.message || "No se han podido leer los adjuntos del buzón");
    } finally {
      setPulling(false);
      setPullDone(true);
    }
  }, [messageId, pulling]);

  // Si el correo DICE que adjunta algo y no hay nada guardado, se busca solo (una vez por mensaje).
  const mentionsAttachment = useMemo(
    () => /adjunt|attach|anexo|se acompaña/i.test(`${bodyText || ""} ${String(bodyHtml || "").slice(0, 6000)}`),
    [bodyText, bodyHtml],
  );
  const nothingStored = storedAtts.length === 0 && oversizedAtts.length === 0 && atts.length === 0;
  useEffect(() => {
    if (!messageId || !nothingStored || !mentionsAttachment || pullDone) return;
    if (attachmentsAsked.has(messageId)) return;
    attachmentsAsked.add(messageId);
    void pull(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, nothingStored, mentionsAttachment]);

  // Fallback: names only (no stored binary and none decodable from the body).
  const nameOnly = useMemo(() => {
    if (storedAtts.length > 0 || atts.length > 0 || oversizedAtts.length > 0) return [];
    const set = new Set<string>();
    extractAttachmentNames(bodyText || "").forEach((n) => set.add(n));
    extractAttachmentNames(bodyHtml || "").forEach((n) => set.add(n));
    return Array.from(set);
  }, [storedAtts, atts, oversizedAtts, bodyText, bodyHtml]);

  if (storedAtts.length === 0 && atts.length === 0 && oversizedAtts.length === 0 && nameOnly.length === 0) {
    // Nada guardado. Si el correo habla de adjuntos, o simplemente por si acaso, se puede mirar
    // en el buzón: la sincronización no se trae los archivos grandes.
    if (!messageId) return null;
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void pull(true)}
          disabled={pulling}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
          title="Va al buzón, busca este correo y se trae sus archivos"
        >
          {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          {pulling ? "Buscando adjuntos…" : pullDone ? "Buscar adjuntos otra vez" : "Buscar adjuntos"}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2.5">
      {storedAtts.map((att) => <StoredAttachmentCard key={att.path} att={att} />)}
      {atts.map((att) => <AttachmentCard key={att.name} att={att} />)}
      {oversizedAtts.map((att, i) => (
        <div key={`${att.name}-${i}`} title={`${att.name} — demasiado grande para descargar aquí`} className="inline-flex max-w-full items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
            <FileText className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-foreground">{att.name}</span>
            <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
              <Paperclip className="h-3 w-3" /> {att.size ? humanBytes(att.size) + " · " : ""}demasiado grande para descargar aquí
            </span>
          </span>
        </div>
      ))}
      {nameOnly.map((name) => (
        <div key={name} title={name} className="inline-flex max-w-full items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
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

/* ── Mail "paper" ─────────────────────────────────────────────
 * Un correo recibido trae el estilo DEL REMITENTE (color:#000 en linea, tablas
 * blancas, <font color>). Pintado sobre una tarjeta oscura eso es negro sobre
 * negro o un bloque blanco cegador, asi que — como hace cualquier cliente de
 * correo real — el cuerpo se pinta sobre una "hoja" clara en LOS DOS temas: los
 * colores del remitente caen sobre la superficie para la que fueron escritos.
 * En oscuro la hoja es un blanco roto con un borde suave, para que se lea como
 * un papel sobre la pagina y no como un rectangulo blanco.
 * A proposito NO usa tokens semanticos: la superficie debe seguir siendo clara
 * cuando los tokens cambian a oscuro. */
const MAIL_PAPER =
  "mx-auto w-full max-w-[46rem] overflow-x-auto rounded-xl border px-4 py-4 shadow-sm sm:px-6 sm:py-5 " +
  "[color-scheme:light] border-black/10 bg-white text-[#141319] " +
  "dark:bg-[#f5f3ef] dark:text-[#14131a] dark:shadow-none dark:ring-1 dark:ring-white/10";

/** Tipografia del cuerpo DENTRO de la hoja. Todos los colores son fijos y
 *  pensados para fondo claro (nunca tokens), porque la hoja no cambia de tema. */
const MAIL_PROSE =
  "break-words text-[15px] leading-[1.75] " +
  "[&_p]:my-3 [&_p]:leading-[1.75] " +
  "[&_a]:text-[#5b3ad9] [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-all " +
  "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#d9d3ee] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[#57565f] " +
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 " +
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md " +
  "[&_strong]:font-semibold [&_em]:italic " +
  "[&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:my-3 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:my-3 [&_h3]:text-lg [&_h3]:font-semibold " +
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:p-2 [&_th]:p-2 [&_th]:font-semibold " +
  "[&_hr]:my-4 [&_hr]:border-[#e3e0ea]";

/** Cuerpo en texto plano: misma hoja, sin colores del remitente que respetar. */
const MAIL_PLAIN = MAIL_PAPER + " whitespace-pre-wrap break-words text-[15px] leading-[1.75]";

/* ── Component ─────────────────────────────────────────────────── */

export default function Unibox() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
  // Domains of the user's OWN mailboxes: a message whose References chain points at one of
  // them is a reply to OUR mail, even when nothing links it to a lead/campaign (sent from
  // another system with the same mailboxes) — it must never be hidden as outreach noise.
  const [ownDomains, setOwnDomains] = useState<Set<string>>(new Set());
  const [leadDomainsReady, setLeadDomainsReady] = useState(false);
  const [mailboxMode, setMailboxMode] = useState<"clean" | "all">("clean");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Multi-select for bulk delete of Unibox messages.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [loading, setLoading] = useState(() => !cacheGet<any[]>("unibox:messages"));
  const [syncing, setSyncing] = useState(false);


  const [search, setSearch] = useState("");
  // El filtro local de la lista (cientos de filas) va con una copia DIFERIDA del texto: la tecla se
  // pinta en el cuadro al instante y la lista se refiltra justo después, sin trabar el teclado.
  const deferredSearch = useDeferredValue(search);
  const [showWarmup, setShowWarmup] = useState(false);
  const [langNonce, setLangNonce] = useState(0);
  const [tcxAccounts, setTcxAccounts] = useState<Set<string>>(new Set());
  const langCacheRef = useRef<Map<string, "es" | "en" | "fr" | "it" | "other" | "unknown">>(new Map());
  // El texto del cuadro de respuesta vive en el propio editor (no controlado), para que
  // escribir sea nítido: sólo se sube a React si el cuadro pasa de vacío a con-texto. El
  // texto de verdad se lee con getReply() al enviar/traducir, y se cambia con setReplySource().
  const [replyEmpty, setReplyEmpty] = useState(true);
  const [sending, setSending] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<FilterType>("all");
  const [showTodayOnly, setShowTodayOnly] = useState(false);
  // Senders the AI auto-reply agent ACTUALLY replied to (not the ones it ignored) → "Respondido por
  // IA" badge. Loaded from the ai-replied-emails edge fn (scoped to this user).
  const [aiRepliedSet, setAiRepliedSet] = useState<Set<string>>(new Set());
  const aiReplied = (email?: string | null) => !!email && aiRepliedSet.has(String(email).toLowerCase());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncLockRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyDraftRef = useRef(""); // mirrors `reply` so the debounced reload can skip while composing
  const readingThreadRef = useRef<string | null>(null); // mirrors selectedId → skip auto-reload while a conversation is OPEN (don't yank the thread under the user)
  const backgroundSyncOffsetRef = useRef(0);
  const replyRef = useRef<RichReplyHandle>(null);
  const replyDraftSaved = useRef("");  // guarda el borrador si se cierra el lector, para restaurarlo
  const getReply = useCallback(() => replyRef.current?.getSource() ?? replyDraftSaved.current, []);
  const setReplySource = useCallback((sourceText: string) => {
    replyDraftSaved.current = sourceText;
    replyDraftRef.current = sourceText;
    replyRef.current?.setSource(sourceText);
    setReplyEmpty(!sourceText || sourceText.trim() === "");
  }, []);
  const onReplyEmptyChange = useCallback((empty: boolean) => {
    setReplyEmpty(empty);
    replyDraftRef.current = empty ? "" : "x";  // sólo importa "hay algo escrito o no"
  }, []);
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
  // Extra people added to the conversation ("Añadir persona"): the reply is sent
  // to the original sender AND these, all in the same thread (as Cc). PERSISTENT
  // per conversation (thread_cc table) — once added they stay on the thread.
  const [ccList, setCcList] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [ccOpen, setCcOpen] = useState(false);
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
  const [sigAccounts, setSigAccounts] = useState<{ id: string; email: string; tags: string[] }[]>([]);
  // Firma de cada buzón, pedida la primera vez que hace falta (al responder desde él) y
  // recordada durante la visita; el editor de firmas la actualiza al aplicar.
  const sigCacheRef = useRef<Map<string, string>>(new Map());
  const getAccountSignature = useCallback(async (accountId: string): Promise<string> => {
    if (!accountId) return "";
    const hit = sigCacheRef.current.get(accountId);
    if (hit !== undefined) return hit;
    // Un fallo de red no puede mandar la respuesta sin firma: se reintenta una vez.
    let { data, error } = await supabase.from("email_accounts").select("signature_html").eq("id", accountId).maybeSingle();
    if (error) ({ data, error } = await supabase.from("email_accounts").select("signature_html").eq("id", accountId).maybeSingle());
    const html = String((data as { signature_html?: string | null } | null)?.signature_html || "");
    if (!error) sigCacheRef.current.set(accountId, html); // un fallo pasajero no se recuerda como "sin firma"
    return html;
  }, []);
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
  // Saved reply templates (per user) — create, apply and manage from the composer.
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const loadTemplates = async () => { try { const { data } = await (supabase as any).from("reply_templates").select("id, name, body").order("created_at", { ascending: false }); setTemplates((data as any[]) || []); } catch { /* */ } };
  const applyTemplate = (t: any) => {
    replyRef.current?.insertText(t.body || "");
    setTplOpen(false);
  };
  const saveTemplate = async () => {
    const text = getReply().trim();
    if (!text) { toast.error("Escribe la respuesta primero, luego guárdala como plantilla"); return; }
    const name = window.prompt("Nombre de la plantilla:", "");
    if (!name || !name.trim()) return;
    try {
      const { error } = await (supabase as any).from("reply_templates").insert({ name: name.trim(), body: text });
      if (error) throw error;
      toast.success("Plantilla guardada");
      loadTemplates();
    } catch (e: any) { toast.error(`No se pudo guardar: ${e?.message || e}`); }
  };
  const deleteTemplate = async (id: string) => {
    // supabase-js no lanza: el error vuelve en { error }. Sin comprobarlo la plantilla
    // desaparecía de la lista y reaparecía al recargar.
    const { error } = await (supabase as any).from("reply_templates").delete().eq("id", id);
    if (error) { toast.error(`No se pudo borrar: ${error.message}`); return; }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };
  const [viewTab, setViewTab] = useState<"global" | "all_mailboxes" | "important" | "campaigns" | "reminders" | "sent">("global");
  const [sentItems, setSentItems] = useState<any[]>([]); // manual replies/forwards you sent
  const [importantItems, setImportantItems] = useState<any[]>([]); // messages you starred (label "Importante")
  // Pestaña Campaigns: sus correos se piden a la BD (los enlazados a una campaña, o a la elegida),
  // para no depender de la ventana de 500+500 del resto de pestañas.
  // Se pinta al instante con la última copia (memoria o disco) y se refresca detrás: la consulta
  // de la pestaña tarda segundos en frío en las cuentas grandes (support@: 5,8 s).
  const [campaignItems, setCampaignItems] = useState<any[]>(() => cacheGet<any[]>("unibox:campaigns") || []);
  // Mensajes DE CAMPAÑA (regla de inbox_campaign_match) → su campaña (o null si no se sabe cuál).
  // Lo que no está aquí no sale en la pestaña Campañas. Aparte, lo que el buscador encuentra.
  const [campaignMatch, setCampaignMatch] = useState<Map<string, string | null>>(
    () => new Map((cacheGet<any[]>("unibox:campaigns") || []).map((r) => [r.id, r.campaign_id || r.campaign_hint || null] as [string, string | null])),
  );
  const [searchCampaignMatch, setSearchCampaignMatch] = useState<Map<string, string | null>>(new Map());
  const [campaignItemsLoading, setCampaignItemsLoading] = useState(false);
  // Con UNA campaña elegida: todas sus respuestas, pedidas al servidor (campaign_inbox_feed), sin la
  // ventana de las 700 más recientes y con las archivadas marcadas. Antes la campaña decía
  // "respondido" y aquí no salía nada: la respuesta estaba archivada o era más vieja que la ventana.
  const [campaignFeed, setCampaignFeed] = useState<{ id: string; rows: any[] } | null>(null);
  const [campaignFeedLoading, setCampaignFeedLoading] = useState(false);
  // Sube cada vez que termina una carga del Unibox: la pestaña Campañas se refresca con ella.
  const [loadTick, setLoadTick] = useState(0);
  // Recipients you PERSONALLY replied to from the Unibox (campaign_id null). Any
  // inbound from one of these is a real conversation → it must always show in the
  // clean bandeja ("Todos"), whatever language it is in. Loaded on mount so the
  // filter is correct from the first render (not only after visiting "Enviados").
  const [repliedToSet, setRepliedToSet] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; manager_id?: string | null }[]>([]);
  // Responsables ("quién se encarga") — creados en Opciones de campaña; aquí solo se muestran.
  const [managers, setManagers] = useState<{ id: string; name: string; color: string }[]>([]);
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
    const { data, error } = await supabase
      .from("message_reminders")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_done", false);
    if (error) { console.warn("loadReminders failed, keeping current:", error.message); return; }
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
    // Un token caducado o un corte de red dejaban el Unibox vacío, sin aviso, y ese vacío se
    // guardaba en el caché para la visita siguiente. Ahora se conserva lo que hay y se avisa.
    if (linkedRes.error || unlinkedRes.error) {
      const msg = (linkedRes.error || unlinkedRes.error)?.message || "error de red";
      console.warn("Unibox load failed, keeping current list:", msg);
      toast.error(`No se pudo cargar el Unibox: ${msg}`);
      setLoading(false);
      return;
    }
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
    setLoadTick((n) => n + 1); // la pestaña Campañas se refresca detrás (con su propio freno de 20 s)

    // Auto-label from the classifier. Labels used to be ADDITIVE and sticky: a message that
    // was once (wrongly) tagged "Interesado" kept it forever, and a later classification just
    // appended a second category. Now: (1) a message with no category label gets one; (2) an
    // OPTIMISTIC auto label ("Interesado" / "Pregunta") is DOWNGRADED when the classifier now
    // reads a clear rejection / unsubscribe / auto-reply / referral (real case: ANIMSA's polite
    // "no tenemos la necesidad de…" sat under Interesado). We never upgrade over an existing
    // label and never touch non-category labels (e.g. "Importante"), so a manual correction
    // (someone hand-setting "No interesado") is always respected.
    const CATEGORY_LABELS = ["Interesado", "No interesado", "No contactar", "Derivado", "Fuera / Auto", "Pregunta"];
    const OPTIMISTIC = new Set(["Interesado", "Pregunta"]);
    // SPEC §7 / case 65: "Fuera / Auto" is an OPERATIONAL state, not a commercial one — an
    // out-of-office auto-reply arriving after a human "Interesado" must NOT overwrite it
    // ("Conservar el estado comercial humano anterior"). It is still applied to a message that
    // has no commercial label yet.
    const DOWNGRADE_TO = new Set(["No interesado", "No contactar", "Derivado"]);
    const labelFor = (cat: MessageCategory): string => (cat === "neutral" ? "" : categoryConfig[cat].label);
    const updates: Array<{ id: string; labels: string[] }> = [];
    for (const m of msgs) {
      if (isSpam(m.subject, m.body_text, m.from_email)) continue;
      // Warm-up network mail and bounces are NOT prospect replies: never label them (they were
      // getting "Interesado" by the thousand and polluting every count/report/digest).
      // A LINKED message (real lead/campaign) is a genuine reply: it must still be classified even
      // if the stored warm-up flag says otherwise — those 373 replies were never labelled at all.
      const linked = !!(m.lead_id || m.campaign_id);
      if ((m as { is_warmup?: boolean }).is_warmup && !linked) continue;
      // Only REAL thread replies get a category (same gate as the server cron): cold inbound spam
      // has no thread headers and was being labelled "Interesado" from here (wyseemail, 2026-09-15).
      if (!linked && !String((m as { ref_chain?: string | null }).ref_chain || "").trim()) continue;
      if (isBounceOrFailure(m.from_email) || isWarmupMessage({ subject: m.subject, body: m.body_text, fromEmail: m.from_email, linked })) continue;
      const current: string[] = m.labels || [];
      // The server classifier (cron, AI-backed) is the authority: it marks what it labelled with
      // "IA". A rule-based guess from whatever build this browser has must never overwrite it.
      if (current.includes("IA")) continue;
      // An inline-image body is JPEG bytes, not words — the server reads the HTML instead; a
      // browser guess from the bytes ("?" everywhere → Pregunta) is worse than no label.
      if (looksBinaryText(m.body_text)) continue;
      const newLabel = labelFor(categoryOf(m));
      if (!newLabel) continue;
      const currentCats = current.filter((l) => CATEGORY_LABELS.includes(l));
      if (currentCats.includes(newLabel)) continue; // already right
      const others = current.filter((l) => !CATEGORY_LABELS.includes(l));
      if (currentCats.length === 0) {
        updates.push({ id: m.id, labels: [...others, newLabel] });
      } else if (currentCats.every((l) => OPTIMISTIC.has(l)) && DOWNGRADE_TO.has(newLabel)) {
        updates.push({ id: m.id, labels: [...others, newLabel] });
      }
    }
    if (updates.length > 0) {
      // Apply in small parallel batches so a big backlog doesn't fire hundreds of requests at once.
      const BATCH = 10;
      (async () => {
        for (let i = 0; i < updates.length; i += BATCH) {
          const slice = updates.slice(i, i + BATCH);
          await Promise.all(slice.map((u) => supabase.from("inbox_messages").update({ labels: u.labels }).eq("id", u.id)));
          setMessages((prev) => prev.map((msg) => { const u = slice.find((x) => x.id === msg.id); return u ? { ...msg, labels: u.labels } : msg; }));
        }
      })();
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
      // A SILENT (auto) sync must not reload the list while the user is reading a
      // conversation — it would re-fire loadThread and make the open thread jump.
      // New mail still landed in the DB; the list refreshes on close / manual sync.
      if (!(silent && readingThreadRef.current)) await load();
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

  // Load AI prompts and account tags
  useEffect(() => { if (user) loadTemplates(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);
  useEffect(() => {
    if (!user) return;
    const loadAI = async () => {
      const [{ data: prompts }, { data: accounts }, { data: campaignsData }, { data: foldersData }, { data: managersData }] = await Promise.all([
        supabase.from("ai_prompts").select("*").eq("user_id", user.id),
        // Sin signature_html: la firma de cada buzón (KB de HTML × cientos de buzones) se pide
        // sólo al abrir el editor de firmas o al enviar desde ese buzón (getAccountSignature).
        supabase.from("email_accounts").select("id, email, tags, status, first_name").eq("user_id", user.id),
        (supabase as any).from("campaigns").select("id, name, manager_id").eq("user_id", user.id).order("name"),
        (supabase as any).from("unibox_folders").select("*").eq("user_id", user.id).order("created_at"),
        (supabase as any).from("campaign_managers").select("id, name, color").eq("user_id", user.id).order("name"),
      ]);
      setAiPrompts(prompts || []);
      setCampaigns(campaignsData || []);
      setManagers(managersData || []);
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
      setOwnDomains(new Set(
        (accounts || []).map((a: any) => String(a.email || "").split("@")[1]?.toLowerCase().trim() || "").filter(Boolean),
      ));
      setSigAccounts((accounts || []).map((a: any) => ({ id: a.id, email: a.email, tags: a.tags || [] })));
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
      // Get all inbox messages from this contact to this account. NOTE: we deliberately do NOT
      // filter is_archived here — the thread detail must show the WHOLE conversation. Filtering
      // archived left GAPS in the thread whenever a message got auto-archived (language/warmup
      // heuristics) or archived by hand. Warmup noise is excluded explicitly below instead.
      const { data: inboxMsgs } = await supabase
        .from("inbox_messages")
        .select("*")
        .eq("user_id", user.id)
        .eq("account_id", msg.account_id)
        .eq("from_email", msg.from_email)
        .order("received_at", { ascending: true });

      // Make sure any AI auto-reply to this contact is recorded as a sent email, so it shows in the
      // thread "como si lo hubiera enviado yo" (idempotent; only fills what's missing).
      try { await supabase.functions.invoke("ensure-ai-sent-thread", { body: { contact: msg.from_email, account_id: msg.account_id } }); } catch { /* non-fatal */ }

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
        // only drop delivery-failure / system noise and warmup traffic.
        if (isBounceOrNoise(m.from_email)) continue;
        // is_warmup exists in the DB but not in the (stale) generated row type → narrow via cast.
        // A message LINKED to a lead/campaign is a real reply and stays in the thread whatever the
        // stored flag says — a phone number or a base64 image in the sender's signature used to
        // trip the warm-up detector, so the reply showed in the list but VANISHED when opened.
        if ((m as { is_warmup?: boolean }).is_warmup && !m.lead_id && !m.campaign_id) continue;
        thread.push({ ...m, _type: "received", _date: m.received_at });
      }

      const sentIds = new Set((sentMsgs || []).map((x: any) => x.id));
      for (const s of (sentMsgs || [])) {
        thread.push({ ...s, _type: "sent", _date: s.sent_at });
      }

      // Lo que se REENVIÓ desde aquí a otra dirección (un compañero, por ejemplo) también es parte
      // de esta conversación: se busca por el mensaje del que salió, no por el destinatario.
      const inboxIds = (inboxMsgs || []).map((m: any) => m.id).filter(Boolean);
      if (inboxIds.length > 0) {
        // `forwarded_from` es una columna nueva que el tipo generado aún no conoce → cast.
        const { data: forwards } = await (supabase as any)
          .from("sent_emails")
          .select("*")
          .eq("user_id", user.id)
          .eq("status", "sent")
          .in("forwarded_from", inboxIds)
          .order("sent_at", { ascending: true });
        for (const f of (forwards || []) as any[]) {
          if (sentIds.has(f.id)) continue;
          thread.push({ ...f, _type: "sent", _forward: true, _date: f.sent_at });
        }
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
      .select("id, account_id, to_email, subject, body, sent_at, campaign_id, lead_id, smtp_message_id, forwarded_from")
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
      forwarded_from: s.forwarded_from || null,
      _sent: true,
    })));
  }, [user]);

  useEffect(() => { if (viewTab === "sent") loadSent(); }, [viewTab, loadSent]);

  // Load ALL starred messages straight from the DB (not just the ones inside the
  // in-memory 500+500 window), so the "Importantes" tab always shows everything you
  // flagged. Loaded on mount (for the tab badge count) and whenever the tab is opened.
  // CAMPAÑAS = la regla de la Unibox de campaña, la misma que Primary en la app del móvil y que los
  // avisos de "Interesado": quien escribe es un lead de una campaña (o alguien a quien escribimos
  // desde una), escribe desde el dominio de empresa de un lead de una campaña, o contesta citando
  // un correo nuestro de campaña; nunca warm-up. Antes bastaba con tener campaign_id y el warm-up
  // pegado a una campaña salía aquí ("Lucy - coffee? | KK5XRDN 0396QKE", 03-10-2026). Trae lo
  // enlazado (1.000 más recientes) y lo demás que no es warm-up (400): así entran también los
  // compañeros de la empresa de un lead, que no traen campaign_id, con la campaña de su lead.
  // Una sola petición a la vez y como mucho una cada 20 s (salvo forzada): antes cada recarga del
  // Unibox volvía a lanzar la consulta entera de la pestaña.
  const campaignItemsBusy = useRef(false);
  const campaignItemsAt = useRef(0);
  const loadCampaignItems = useCallback(async (force = false) => {
    if (!user || campaignItemsBusy.current) return;
    if (!force && Date.now() - campaignItemsAt.current < 20_000) return;
    campaignItemsBusy.current = true;
    // El "Cargando…" sólo cuando no hay nada que enseñar; con la copia anterior se refresca detrás.
    setCampaignItemsLoading(true);
    try {
      // La MISMA ventana y la MISMA regla que Primary en la app del móvil (isPrimaryRow).
      const { data, error } = await (supabase as any).rpc("mobile_inbox_feed", { p_linked: PRIMARY_FEED.linked, p_other: PRIMARY_FEED.other, p_since: null });
      if (error) { console.warn("loadCampaignItems failed, keeping current list:", error.message); return; }
      campaignItemsAt.current = Date.now();
      const rows = ((data || []) as any[]).filter((r) => isPrimaryRow(r)).map((r) => ({ ...r, user_id: user.id, is_warmup: false }));
      const match = new Map<string, string | null>();
      for (const r of rows) match.set(r.id, r.campaign_id || r.campaign_hint || null);
      setCampaignMatch(match);
      setCampaignItems(rows);
      cacheSet("unibox:campaigns", rows);
    } finally {
      campaignItemsBusy.current = false;
      setCampaignItemsLoading(false);
    }
  }, [user]);

  // La campaña elegida, entera. La última petición manda: si se cambia de campaña a media carga,
  // la respuesta vieja se descarta. Volver a una campaña ya vista la pinta al instante (memoria).
  const campaignFeedReq = useRef(0);
  const campaignFeedAt = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const loadCampaignFeed = useCallback(async (campaignId: string, onlyIfOld = false) => {
    if (!user) return;
    // Con cada recarga del Unibox, sólo si la copia tiene más de 60 s (elegir la campaña, siempre).
    if (onlyIfOld && campaignFeedAt.current.id === campaignId && Date.now() - campaignFeedAt.current.at < 60_000) return;
    campaignFeedAt.current = { id: campaignId, at: Date.now() };
    const req = ++campaignFeedReq.current;
    const cached = cacheGet<any[]>(`unibox:campfeed:${campaignId}`);
    if (cached) setCampaignFeed({ id: campaignId, rows: cached });
    setCampaignFeedLoading(true);
    const { data, error } = await (supabase as any).rpc("campaign_inbox_feed", { p_campaign: campaignId });
    if (req !== campaignFeedReq.current) return;
    setCampaignFeedLoading(false);
    if (error) { console.warn("campaign_inbox_feed failed, keeping current list:", error.message); return; }
    const rows = ((data || []) as any[])
      .filter((r) => isPrimaryRow(r))
      .map((r) => ({ ...r, user_id: user.id, is_warmup: false }));
    cacheSet(`unibox:campfeed:${campaignId}`, rows);
    setCampaignFeed({ id: campaignId, rows });
  }, [user]);

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

  // Load the set of senders the AI auto-reply agent actually replied to (for the "Respondido por
  // IA" badge). Refreshes every 2 min so newly answered prospects light up without a page reload.
  const loadAiReplied = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke("ai-replied-emails", {});
      const emails = ((data as any)?.emails as string[]) || [];
      setAiRepliedSet(new Set(emails.map((e) => String(e).toLowerCase())));
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => {
    if (!user) return;
    loadAiReplied();
    const iv = setInterval(() => { if (!document.hidden) loadAiReplied(); }, 120000);
    return () => clearInterval(iv);
  }, [user, loadAiReplied]);

  // Clear the translation ONLY when the selected message changes — not on every
  // 30s messages reload (that used to make a just-made translation disappear).
  useEffect(() => { setTranslatedBody(""); setCcInput(""); setCcOpen(false); }, [selectedId]);

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




  // Initial load + reminders + blocklist (for filtering).
  // Sin sincronización IMAP desde el navegador (05-10-2026): los crons del servidor revisan TODOS
  // los buzones cada 1-2 min (support@ con su cron propio: 889 de 891 al día en 5 min) y el correo
  // nuevo llega por tiempo real. Con el Unibox abierto, el navegador repetía ese trabajo cada minuto
  // (support@: hasta 40 llamadas seguidas de 4 buzones) y recargaba la lista al acabar. "Actualizar"
  // sigue sincronizando a mano.
  useEffect(() => {
    load();
    loadReminders();
    loadBlockedEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadReminders]);

  // Keep a ref of the reply draft so the debounced reload can tell if the user is
  // mid-compose without re-creating the callback on every keystroke.
  useEffect(() => {
    const wasReading = readingThreadRef.current;
    readingThreadRef.current = selectedId;
    // Just CLOSED a conversation → refresh the list now so any mail that arrived
    // while reading (the auto-reload was paused) shows up immediately.
    if (wasReading && !selectedId) load();
  }, [selectedId, load]);

  // DEBOUNCED, compose-aware reload. A background IMAP sync inserts many rows at
  // once; firing load() on each realtime event re-rendered the whole list over and
  // over ("the screen keeps refreshing"). Now we coalesce bursts into ONE reload a
  // few seconds after activity settles, and NEVER reload while the user is writing a
  // reply — the data still syncs, the screen just doesn't yank under their hands.
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    const run = () => {
      // Never yank the screen while the user is WRITING a reply OR just READING an
      // open conversation — the data keeps syncing in the background; we only defer
      // the list re-render (which would re-fire loadThread and make the thread jump).
      if (replyDraftRef.current.trim().length > 0 || readingThreadRef.current) {
        reloadTimerRef.current = setTimeout(run, 8000); // busy / reading → try again later
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
      // El warm-up sin enlazar (support@: 42.644 de 44.763 mensajes, casi uno por minuto) no recarga
      // la lista: no sale en ninguna pestaña salvo "Todos"/"Mostrar warmup", que se refrescan con la
      // recarga de seguridad de cada 2 min. Antes cada uno volvía a pedir 1.000 mensajes.
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_messages", filter: `user_id=eq.${user.id}` }, (payload: any) => {
        const row = payload?.new;
        if (row && row.is_warmup === true && !row.lead_id && !row.campaign_id) return;
        scheduleReload();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, scheduleReload]);

  // Safety net refresh (much less often than before, and coalesced/compose-aware).
  useEffect(() => {
    intervalRef.current = setInterval(() => { if (!document.hidden) scheduleReload(); }, 120_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, [scheduleReload]);

  // Auto-sync IMAP every 60 seconds (no manual "Sincronizar" needed)
  // (Antes: sincronización IMAP desde el navegador cada 60 s. La hacen los crons; ver arriba.)

  // Detail opens in a modal — no auto-selection so closing actually closes.

  // Las filas de la pestaña Campañas (campaignItems / campaignFeed) también se abren: antes, una
  // respuesta de campaña fuera de la ventana de 500 del resto de pestañas salía en la lista pero al
  // pulsarla no se abría nada.
  const selected = useMemo(() => messages.find(m => m.id === selectedId) || (searchResults || []).find(m => m.id === selectedId) || importantItems.find(m => m.id === selectedId) || sentItems.find(m => m.id === selectedId) || campaignItems.find(m => m.id === selectedId) || (campaignFeed?.rows || []).find(m => m.id === selectedId) || null, [messages, sentItems, searchResults, importantItems, campaignItems, campaignFeed, selectedId]);

  // ── "Añadir persona" (persistent per-conversation Cc) ──
  const ccThreadKey = (selected?.from_email || "").toLowerCase();
  // Load the saved extra people whenever the open conversation changes, so they
  // stay on the thread across sends and across sessions.
  useEffect(() => {
    if (!ccThreadKey || !user) { setCcList([]); return; }
    let alive = true;
    (async () => {
      const { data } = await (supabase as any).from("thread_cc")
        .select("cc_email").eq("user_id", user.id).eq("thread_email", ccThreadKey);
      if (alive) setCcList(((data || []) as any[]).map((r) => r.cc_email));
    })();
    return () => { alive = false; };
  }, [ccThreadKey, user]);
  const addCc = async () => {
    const e = ccInput.trim().toLowerCase();
    if (!/^[^\s<>"@]+@[^\s<>"@]+\.[^\s<>"@]+$/.test(e)) { toast.error("Email no válido"); return; }
    if (ccList.includes(e)) { setCcInput(""); return; }
    setCcList((prev) => [...prev, e]); setCcInput("");
    if (ccThreadKey && user) { try { await (supabase as any).from("thread_cc").insert({ user_id: user.id, thread_email: ccThreadKey, cc_email: e }); } catch { /* stays in-session either way */ } }
  };
  const removeCc = async (e: string) => {
    setCcList((prev) => prev.filter((x) => x !== e));
    if (ccThreadKey && user) { try { await (supabase as any).from("thread_cc").delete().eq("user_id", user.id).eq("thread_email", ccThreadKey).eq("cc_email", e); } catch { /* */ } }
  };

  // Language bucket per message, cached by id (text never changes). Cleared by "Re-filtrar idioma".
  const messageLang = useCallback((m: any): "es" | "en" | "fr" | "it" | "other" | "unknown" => {
    const cache = langCacheRef.current;
    const hit = cache.get(m.id);
    if (hit) return hit;
    let body = cleanBodyText(m.body_text || "");
    // HTML-only emails have little/no plain text — fall back to the HTML body
    // (cleanBodyText strips tags) so English HTML mails are still classified.
    // Short OR image bytes (an Outlook inline signature stored as body_text): read the HTML.
    if ((body.replace(/\s+/g, " ").trim().length < 15 || looksBinaryText(m.body_text)) && m.body_html) {
      body = cleanBodyText(m.body_html);
    }
    const text = `${decodeSubjectKeepCodes(m.subject)} ${body.slice(0, 800)}`;
    const bucket = detectLanguageBucket(text);
    cache.set(m.id, bucket);
    return bucket;
  }, []);

  // Lead domains: only those of the LOADED messages (lead_domains_in), and remembered during the
  // session. Before, get_lead_domains walked every lead of the user (support@: 59,064 domains,
  // 2.5–6 s cold) and PostgREST only returned 1,000 of them, so the filter was incomplete.
  // A failed request leaves those domains pending, and they are retried on the next load.
  useEffect(() => {
    if (!user) return;
    const memo = readLeadDomainMemo();
    if (memo.hits.size) setLeadDomains((prev) => (prev.size ? prev : memo.hits));
    const emails = [...messages, ...campaignItems].map((m: any) => m?.from_email);
    const todo = pendingDomains(emails, memo.asked);
    if (todo.length === 0) { if (messages.length || !loading) setLeadDomainsReady(true); return; }
    let cancelled = false;
    (async () => {
      const r = await resolveLeadDomains((fn, args) => (supabase as any).rpc(fn, args), todo);
      if (cancelled) return;
      setLeadDomains(r.hits);
      setLeadDomainsReady(true);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, messages, campaignItems]);

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
    // Short OR image bytes (an Outlook inline signature stored as body_text): read the HTML.
    if ((body.replace(/\s+/g, " ").trim().length < 15 || looksBinaryText(m.body_text)) && m.body_html) {
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
    // 0) Own-mailbox WARM-UP traffic (our seed mailboxes emailing each other) is flagged
    //    is_warmup at sync. Hide it FIRST — otherwise its own-brand domain (onepulso/onnepuls*)
    //    reads as "campaign relevant" below and the whole warm-up flood shows in the clean
    //    bandeja and inflates every count. A real lead reply is never is_warmup.
    // …but only when it is NOT tied to a real lead/campaign: a linked message is a genuine reply.
    // …ni cuando viene de la EMPRESA de un lead (un compañero contestando): eso es una respuesta
    // real aunque el detector de warm-up la marcara al sincronizar.
    const fromDom = String(m.from_email || "").split("@")[1]?.toLowerCase().trim() || "";
    const fromLeadCompany = !!fromDom && leadDomains.has(fromDom) && !isOwnBrandDomain(fromDom);
    if (m.is_warmup && !m.lead_id && !m.campaign_id && !fromLeadCompany) return true;
    // La etiqueta del warm-up en el asunto ("| 36P2ARY 0396QKE"): fuera, esté atado a lo que esté.
    if (hasWarmupSubjectTag(m.subject)) return true;
    // 1) CAMPAIGN-RELEVANT → always show: a lead, a lead's DOMAIN (a colleague at the same company
    //    counts, even if that exact email isn't a lead), or one of our own onepulso/variant domains.
    //    (leadDomains is empty until the get_lead_domains RPC loads, so lead_id/campaign_id/onepulso
    //    match immediately and the lead-DOMAIN match kicks in as soon as the set is ready.)
    if (isCampaignRelevant(m, leadDomains, ownDomains)) return false;
    // 2) Todo lo demás —sin lead, sin campaña, sin dominio de ningún lead y sin responder a un
    //    correo nuestro— NO es de campaña: va sólo a "Todos". Antes un correo cualquiera en español
    //    de un remitente desconocido (newsletters, proveedores, spam en castellano) se colaba en
    //    Global y en Campañas. Nada se pierde: "Todos" sigue enseñando el buzón entero.
    return true;
  }, [leadDomains, ownDomains]);

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
      if ((body.replace(/\s+/g, " ").trim().length < 15 || looksBinaryText(selected.body_text)) && selected.body_html) {
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
  const openSignature = async () => {
    setSigHtml("");
    setSigScope("all");
    setSigTag(sigAllTags[0] || "");
    setSigAccountId(sigAccounts[0]?.id || "");
    setSigOpen(true);
    // Prefill: la firma que ya tenga algún buzón (el más nuevo), pedida ahora y no con la lista.
    if (!user) return;
    const { data } = await (supabase as any).from("email_accounts")
      .select("signature_html").eq("user_id", user.id)
      .not("signature_html", "is", null).neq("signature_html", "")
      .order("created_at", { ascending: false }).limit(20);
    const existing = ((data || []) as { signature_html?: string | null }[]).find((a) => (a.signature_html || "").trim())?.signature_html || "";
    setSigHtml((cur) => (cur ? cur : existing));
  };
  const applyUniboxSignature = async () => {
    if (!user) return;
    const ids = sigTargetIds;
    if (!ids.length) { toast.error("No hay cuentas en el alcance elegido"); return; }
    setSigSaving(true);
    const { error } = await supabase.from("email_accounts").update({ signature_html: sigHtml } as any).in("id", ids);
    setSigSaving(false);
    if (error) { toast.error(`No se pudo aplicar la firma: ${error.message}`); return; }
    // Reflect locally so the next reply from those mailboxes carries the new signature.
    for (const id of ids) sigCacheRef.current.set(id, sigHtml);
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

  // A message that is part of a REAL thread (In-Reply-To / References, or tied to a lead or
  // campaign) is an answer somebody gave us. Blocking the sender stops future sends; it must
  // never erase the answer. Cold spam has no thread headers, so it stays hidden.
  const isThreadReply = useCallback(
    (m: any) => !!(m?.ref_chain || m?.in_reply_to || m?.lead_id || m?.campaign_id),
    [],
  );

  // Self-heal: archive any loaded message from a blocked sender that is still un-archived
  // (e.g. blocked back when the domain filter was broken, or synced before the backend fix).
  // Bounded to the loaded window, runs once per session, uses the user's own session (RLS).
  const blockCleanupRan = useRef(false);
  useEffect(() => {
    if (blockCleanupRan.current || !user || blockedLoading) return;
    if (blockedDomainSet.size === 0 && blockedEmailSet.size === 0) return;
    const leaked = messages.filter((m) => isBlockedSender(m.from_email) && !isThreadReply(m)).map((m) => m.id);
    if (leaked.length === 0) return;
    blockCleanupRan.current = true;
    (async () => {
      for (let i = 0; i < leaked.length; i += 100) {
        await supabase.from("inbox_messages").update({ is_archived: true }).in("id", leaked.slice(i, i + 100));
      }
      const leakedSet = new Set(leaked);
      setMessages((prev) => prev.filter((m) => !leakedSet.has(m.id)));
    })();
  }, [user, blockedLoading, messages, isBlockedSender, isThreadReply, blockedDomainSet, blockedEmailSet]);

  // Clean tabs show: campaign mail (lead / lead-domain / onepulso) ALWAYS, plus legit human mail —
  // and drop only the clear warm-up / random noise + bounces. "Todos" (all_mailboxes) and the
  // "Mostrar warmup" toggle bypass this to show the raw mailbox, so nothing is ever unrecoverable.
  // Todo lo que decide la pestaña ANTES de la categoría. Lo comparten la lista y los contadores
  // de los chips (antes los contadores ignoraban bloqueados, pestaña, carpeta y búsqueda, y en
  // "Todos" la lista saltaba el filtro limpio pero los chips no: "Interesados (12)" con 400 filas).
  const preCategory = useMemo(() => {
    if (viewTab === "sent" || viewTab === "important") return [] as any[];
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // La campaña elegida, entera desde el servidor (archivadas incluidas, con su marca).
    const feedRows = viewTab === "campaigns" && selectedCampaignId !== "all" && campaignFeed?.id === selectedCampaignId ? campaignFeed.rows : null;
    const feedIds = feedRows ? new Set<string>(feedRows.map((m: any) => m.id)) : null;
    const inTab = (m: any) => {
      if (viewTab === "reminders") return !!reminders[m.id];
      if (viewTab === "campaigns") {
        if (feedIds && feedIds.has(m.id)) return true;   // de la campaña elegida (servidor)
        const camp = campaignMatch.has(m.id) ? campaignMatch.get(m.id) : searchCampaignMatch.get(m.id);
        if (camp === undefined) return false;   // no es de campaña
        return selectedCampaignId === "all" || camp === selectedCampaignId;
      }
      return true;
    };
    // SEARCH (main inbox tabs): when there's a query, show the DB search results — the whole
    // mailbox, ignoring the language/warmup filter and the loaded window. Sigue respetando la
    // pestaña, "Hoy" y la carpeta: buscar con "Interesados" marcado ya no devolvía el buzón entero.
    if (deferredSearch.trim().length >= 2 && searchResults !== null) {
      return searchResults
        .filter(m => !isBlockedSender(m.from_email) || isThreadReply(m))
        .filter(inTab)
        .filter(m => !showTodayOnly || new Date(m.received_at) >= now24h)
        .filter(m => !folderFilter || m.folder_id === folderFilter);
    }
    // ESCAPE HATCH: the "Todos" tab (all_mailboxes) shows the RAW mailbox and the
    // "Mostrar warmup" toggle reveals filtered messages — so nothing the strict
    // English/warmup filter hides is ever unrecoverable from the UI.
    const bypassFilters = viewTab === "all_mailboxes" || showWarmup;
    let source = messages;
    if (viewTab === "campaigns") {
      const byId = new Map<string, any>();
      for (const m of campaignItems) byId.set(m.id, m);
      for (const m of messages) if (campaignMatch.has(m.id)) byId.set(m.id, m); // lo más reciente (tiempo real) gana
      if (feedRows) for (const m of feedRows) if (!byId.has(m.id)) byId.set(m.id, m);
      source = Array.from(byId.values()).sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
    }
    return source
      // Blocked senders never show — unless it is their reply inside a real thread. Blocking
      // (or a bounce suppression) must not delete an answer the lead already gave us.
      .filter(m => !isBlockedSender(m.from_email) || isThreadReply(m))
      // Campañas: la regla ya la decide campaignMatch (isPrimaryRow, la de Primary en el móvil);
      // hiddenFromClean la volvía a filtrar con un juego de dominios cortado en 1.000 de 56.000 y
      // escondía respuestas de compañeros de un lead que el móvil sí enseñaba.
      .filter(m => bypassFilters || viewTab === "campaigns" || !hiddenFromClean(m))
      .filter(inTab)
      .filter(m => !showTodayOnly || new Date(m.received_at) >= now24h)
      .filter(m => !folderFilter || m.folder_id === folderFilter)
      .filter(m => !deferredSearch || searchTextOf(m).includes(deferredSearch.toLowerCase()));
  }, [messages, campaignItems, campaignFeed, campaignMatch, searchCampaignMatch, searchResults, deferredSearch, showTodayOnly, folderFilter, viewTab, selectedCampaignId, reminders, showWarmup, hiddenFromClean, isBlockedSender, isThreadReply, langNonce, mailboxMode]);

  // Al entrar en Campaigns y cada vez que se recarga el Unibox (la campaña elegida sólo filtra).
  useEffect(() => {
    if (viewTab !== "campaigns") return;
    void loadCampaignItems();
  }, [viewTab, loadCampaignItems, loadTick]);

  // Una campaña elegida: todas sus respuestas (al elegirla y cada vez que se recarga el Unibox).
  useEffect(() => {
    if (viewTab !== "campaigns" || selectedCampaignId === "all") return;
    void loadCampaignFeed(selectedCampaignId);
  }, [viewTab, selectedCampaignId, loadCampaignFeed]);
  useEffect(() => {
    if (viewTab !== "campaigns" || selectedCampaignId === "all" || loadTick === 0) return;
    void loadCampaignFeed(selectedCampaignId, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTick]);

  // Buscando en Campaigns: lo que encuentra el buscador (todo el buzón) pasa por la misma regla.
  useEffect(() => {
    if (viewTab !== "campaigns" || !searchResults || searchResults.length === 0) return;
    const ids = searchResults.map((m: any) => m.id).filter((id: string) => !campaignMatch.has(id) && !searchCampaignMatch.has(id));
    if (ids.length === 0) return;
    let alive = true;
    (async () => {
      const byIdSearch = new Map<string, any>(searchResults.map((m: any) => [m.id, m]));
      const found = new Map<string, string | null>();
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await (supabase as any).rpc("inbox_campaign_match_mine", { p_ids: ids.slice(i, i + 300) });
        for (const h of (data || []) as { id: string; in_campaign: boolean; campaign_hint: string | null; why: string | null }[]) {
          const m = byIdSearch.get(h.id);
          if (m && isPrimaryRow({ ...m, in_campaign: h.in_campaign, match_why: h.why, campaign_hint: h.campaign_hint })) found.set(h.id, h.campaign_hint);
        }
      }
      if (alive && found.size) setSearchCampaignMatch((prev) => { const n = new Map(prev); for (const [k, v] of found) n.set(k, v); return n; });
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab, searchResults]);

  // Respuestas por campaña (para el selector), sin warm-up ni ocultos.
  const campaignReplyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const seen = new Set<string>();
    for (const m of campaignItems) {
      const camp = campaignMatch.get(m.id);
      if (!camp || seen.has(m.id) || (isBlockedSender(m.from_email) && !isThreadReply(m))) continue;
      seen.add(m.id);
      counts[camp] = (counts[camp] || 0) + 1;
    }
    return counts;
  }, [campaignItems, campaignMatch, isBlockedSender, isThreadReply]);

  const filtered = useMemo(() => {
    // ENVIADOS tab: show the messages YOU sent (newest first), search by recipient/subject.
    if (viewTab === "sent") {
      const q = deferredSearch.toLowerCase();
      return sentItems.filter(m =>
        !deferredSearch || m.to_email?.toLowerCase().includes(q) || m.subject?.toLowerCase().includes(q)
      );
    }
    // IMPORTANTES tab: UNION of (starred rows loaded straight from the DB) + (any
    // in-memory message that carries the label). The union means a just-starred
    // message is never missing — not to a stale reload, not to a write/read race, not
    // to the 500+500 window.
    if (viewTab === "important") {
      const q = deferredSearch.toLowerCase();
      const byId = new Map<string, any>();
      for (const m of importantItems) if (!m.is_archived) byId.set(m.id, m);
      for (const m of messages) if (isImportant(m) && !m.is_archived) byId.set(m.id, m);
      return Array.from(byId.values())
        .filter(m => !deferredSearch ||
          m.from_email?.toLowerCase().includes(q) ||
          m.from_name?.toLowerCase().includes(q) ||
          decodeSubject(m.subject)?.toLowerCase().includes(q))
        .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
    }
    const list = preCategory
      .filter(m => categoryFilter === "all" || (categoryFilter === "ai_replied" ? aiReplied(m.from_email) : categoryOf(m) === categoryFilter));
    // Sort: due reminders first (yellow), then by received_at desc
    return list.sort((a, b) => {
      const aDue = isReminderDue(a.id);
      const bDue = isReminderDue(b.id);
      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    });
  // aiReplied/isImportant/isReminderDue no están memoizadas: se listan sus fuentes estables.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab, sentItems, importantItems, deferredSearch, preCategory, categoryFilter, aiRepliedSet, reminders]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: preCategory.length };
    for (const m of preCategory) {
      const cat = categoryOf(m);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [preCategory]);

  // Recordatorios que la pestaña puede enseñar de verdad (en la ventana cargada y no ocultos):
  // el globo decía 3 y la pestaña enseñaba 1.
  const remindersVisible = useMemo(
    () => messages.filter(m => reminders[m.id] && !hiddenFromClean(m)).length,
    [messages, reminders, hiddenFromClean, langNonce],
  );

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
    const { error } = await supabase.from("inbox_messages").update({ is_read: true }).eq("id", id);
    // Si falla, el contador de no leídos volverá a subir al recargar: avisar en vez de callar.
    if (error) toast.error(`No se pudo marcar como leído: ${error.message}`);
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

  // Lista por tramos: con 1.000 mensajes se montaban 1.000 filas (cada una con sus chips e
  // iconos) y cualquier cambio de estado las repintaba todas. Se montan 120 y, al acercarse al
  // final, 120 más. "Seleccionar todo", los recuentos y la búsqueda siguen sobre `filtered` entero.
  const LIST_CHUNK = 120;
  const [listLimit, setListLimit] = useState(LIST_CHUNK);
  useEffect(() => { setListLimit(LIST_CHUNK); }, [viewTab, categoryFilter, search, folderFilter]);
  const visibleRows = useMemo(() => (filtered.length > listLimit ? filtered.slice(0, listLimit) : filtered), [filtered, listLimit]);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listEndRef.current;
    if (!el || filtered.length <= listLimit) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setListLimit((l) => Math.min(filtered.length, l + LIST_CHUNK));
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, listLimit]);

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
    setCampaignFeed((prev) => (prev ? { ...prev, rows: prev.rows.map((m) => (m.id === id ? { ...m, is_archived: true } : m)) } : prev));
    const remaining = dropMessageLocally(id);
    setSelectedId((current) => (current === id ? (isMobile ? null : remaining[0]?.id ?? null) : current));
    toast.success("Archivado");
  };

  // Recuperar una respuesta archivada (sale en la campaña elegida con la marca "Archivada").
  const handleUnarchive = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("inbox_messages").update({ is_archived: false }).eq("id", id).eq("user_id", user.id);
    if (error) { toast.error(error.message); return; }
    setCampaignFeed((prev) => (prev ? { ...prev, rows: prev.rows.map((m) => (m.id === id ? { ...m, is_archived: false } : m)) } : prev));
    toast.success("Recuperada: vuelve a estar en el Unibox");
    void loadCampaignItems(true);
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
    setReplySource("");
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
      ? `Vas a archivar TODO el Unibox, incluidas ${unreadReal} respuesta(s) sin leer. Las de campaña se pueden recuperar eligiendo su campaña en la pestaña Campañas. ¿Seguro?`
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
    const { error: delError } = await supabase.from("message_reminders").delete().eq("message_id", messageId).eq("user_id", user.id);
    if (delError) { toast.error(delError.message); return; }
    const { error: insError } = await supabase.from("message_reminders").insert({
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
    // Sin esto se anunciaba el recordatorio aunque el insert hubiera fallado (y el
    // anterior ya estaba borrado, así que el mensaje se quedaba sin ningún recordatorio).
    if (insError) { toast.error(insError.message); loadReminders(); return; }
    toast.success(`Recordatorio: ${format(remindAt, "d MMM yyyy", { locale: es })}`);
    setReminderBody("");
    loadReminders();
  };

  const handleClearReminder = async (messageId: string) => {
    if (!user) return;
    const { error } = await supabase.from("message_reminders").delete().eq("message_id", messageId).eq("user_id", user.id);
    if (error) { toast.error(error.message); return; }
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
        const { error } = await supabase.from("inbox_messages").update({ is_archived: true }).in("id", ids.slice(i, i + 100));
        // Propagar: quien llama está dentro de un try/catch que avisa y no da el bloqueo por
        // bueno. Antes se vaciaban de la lista local mensajes que seguían visibles en la BD.
        if (error) throw new Error(error.message);
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
      // Si el bloqueo no llega a guardarse no hay que seguir: se anunciaba "bloqueado" y el
      // remitente volvía en la siguiente carga.
      const { error: blockError } = await supabase.from("blocklist").upsert({ user_id: user.id, entry_type: "email", value }, { onConflict: "user_id,entry_type,value" });
      if (blockError) throw new Error(blockError.message);
      // Filter it out of the Unibox now (optimistic), then hide its messages.
      setBlockedEntries((prev) => (prev.some((e) => e.entry_type === "email" && e.value === value) ? prev : [{ id: `tmp-${value}`, entry_type: "email", value, created_at: new Date().toISOString() }, ...prev]));
      await hideMessagesFromSender((m) => (m.from_email || "").toLowerCase() === value);
      const { data: leads, error: leadsError } = await supabase.from("leads").select("id").eq("user_id", user.id).eq("email", value);
      if (leadsError) throw new Error(leadsError.message);
      for (const l of leads || []) {
        const { error: clError } = await supabase.from("campaign_leads").delete().eq("lead_id", l.id);
        if (clError) throw new Error(clError.message);
      }
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
      const { error: blockError } = await supabase.from("blocklist").upsert({ user_id: user.id, entry_type: "domain", value }, { onConflict: "user_id,entry_type,value" });
      if (blockError) throw new Error(blockError.message);
      setBlockedEntries((prev) => (prev.some((e) => e.entry_type === "domain" && e.value === value) ? prev : [{ id: `tmp-${value}`, entry_type: "domain", value, created_at: new Date().toISOString() }, ...prev]));
      // Archive EVERY message from this domain in the DB — not just the ones currently loaded
      // in the window — so none linger unarchived (that was leaving hundreds still visible).
      const { error: archiveError } = await supabase.from("inbox_messages").update({ is_archived: true }).eq("user_id", user.id).eq("is_archived", false).ilike("from_email", `%@${value}`);
      if (archiveError) throw new Error(archiveError.message);
      const n = await hideMessagesFromSender((m) => (m.from_email || "").toLowerCase().endsWith(`@${value}`));
      // Remove the domain's leads from every campaign. Filter by domain SERVER-side and page:
      // the old code fetched the first 1000 of ALL the user's leads and filtered in memory, so a
      // user with >1000 leads could have the blocked domain fall entirely outside that window and
      // its leads kept getting emailed.
      for (let off = 0; ; off += 1000) {
        const { data: leads, error: leadsError } = await supabase.from("leads").select("id").eq("user_id", user.id).ilike("email", `%@${value}`).range(off, off + 999);
        if (leadsError) throw new Error(leadsError.message);
        if (!leads?.length) break;
        // Un fallo aquí deja leads del dominio bloqueado dentro de campañas: no se puede
        // anunciar el bloqueo como completo.
        const { error: clError } = await supabase.from("campaign_leads").delete().in("lead_id", leads.map((l) => l.id));
        if (clError) throw new Error(clError.message);
        if (leads.length < 1000) break;
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
    // Domains are FEW but CRITICAL for filtering — load them ALL. A plain select is capped
    // at 1000 rows by PostgREST; with 5000+ blocked emails the (older) domain rows fell
    // outside that window, so `blockedDomainSet` lost them and blocked domains (e.g. gmail.com)
    // stopped being hidden. Loading domains in their own query guarantees they're always there.
    // Emails: recent 1000 for the manager list — blocked-email messages are archived on block,
    // so the visible inbox doesn't depend on having every email loaded.
    const [domRes, mailRes] = await Promise.all([
      supabase.from("blocklist").select("id, entry_type, value, created_at").eq("user_id", user.id).eq("entry_type", "domain"),
      supabase.from("blocklist").select("id, entry_type, value, created_at").eq("user_id", user.id).eq("entry_type", "email").order("created_at", { ascending: false }),
    ]);
    const err = domRes.error || mailRes.error;
    if (err) toast.error(`No se pudo cargar la lista: ${err.message}`);
    setBlockedEntries([...(domRes.data || []), ...(mailRes.data || [])]);
    setBlockedLoading(false);
  };

  const openBlockManager = () => { setBlockManagerOpen(true); loadBlockedEntries(); };

  const handleUnblock = async (entry: { id: string; entry_type: string; value: string }) => {
    if (!user) return;
    setUnblockingId(entry.id);
    const { error } = await supabase.from("blocklist").delete().eq("id", entry.id).eq("user_id", user.id);
    if (error) { toast.error(`No se pudo desbloquear: ${error.message}`); setUnblockingId(null); return; }
    setBlockedEntries((prev) => prev.filter((e) => e.id !== entry.id));
    // Un-archive that sender's/domain's messages so unblocking actually BRINGS THEM BACK.
    // Blocking archives them (and the sync pre-archives new ones); without this they'd stay
    // hidden after unblocking — that's exactly how the team@onepulso.online test got stuck.
    const value = String(entry.value).toLowerCase();
    let upd = supabase.from("inbox_messages").update({ is_archived: false }).eq("user_id", user.id).eq("is_archived", true);
    upd = entry.entry_type === "domain" ? upd.ilike("from_email", `%@${value}`) : upd.ilike("from_email", value);
    await upd;
    toast.success(`${entry.entry_type === "domain" ? "@" + entry.value : entry.value} desbloqueado — sus mensajes vuelven a la bandeja`);
    setUnblockingId(null);
    load(); // refrescar para que reaparezcan al momento
  };

  // Translate the reply the user typed INTO the language the lead wrote in, in
  // place, so they SEE exactly what will be sent (WYSIWYG) and then hit Responder.
  // Replaces the old invisible auto-translate-on-send.
  const translateReplyToLeadLang = async () => {
    if (!selected || getReply().trim() === "") return;
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
        if ((body.replace(/\s+/g, " ").trim().length < 15 || looksBinaryText(selected.body_text)) && selected.body_html) body = cleanBodyText(selected.body_html, true);
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
        body: JSON.stringify({ text: getReply(), target_lang: target, mode: "translate" }),
      });
      const t = await tResp.json();
      if (t.translated) {
        setReplySource(t.translated);
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

  /**
   * Envía la respuesta del hilo. `bodyOverride` permite enviar un texto que no
   * está en el cuadro de respuesta (el borrador del agente) POR EL MISMO CAMINO:
   * mismo send-email, mismo In-Reply-To/References, mismos límites. Se comprueba
   * con typeof porque también se usa como onClick (allí llega un MouseEvent).
   * Devuelve true solo si el correo ha salido de verdad.
   */

  const handleReply = async (bodyOverride?: string): Promise<boolean> => {
    const usingOverride = typeof bodyOverride === "string";
    const bodyToSend = usingOverride ? bodyOverride : getReply();
    if (!selected || (!bodyToSend.trim() && (usingOverride || replyFiles.length === 0)) || !user) return false;
    if (containsProfanity(bodyToSend)) {
      toast.error("Tu respuesta contiene lenguaje inapropiado. Por favor, modifícala antes de enviar.");
      return false;
    }
    setSending(true);
    // Never hang forever waiting for a slow/overloaded server.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Sesión no válida. Vuelve a iniciar sesión y reintenta.");
        return false;
      }
      // WYSIWYG: send EXACTLY what's in the box. If the user wants it in the lead's
      // language, they click "Su idioma" first (translateReplyToLeadLang) and review it.
      const finalBody = bodyToSend;
      // The sending account's RICH signature (logo/colours/badges) is sent as a SEPARATE
      // field so send-email keeps it intact (the strict body sanitizer would flatten it).
      const acctSignature = (await getAccountSignature(selected.account_id)).trim();

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

      // QUOTE the message being answered under the reply, like every real mail client
      // ("El 17 sept 2026, 9:13, X <x@y> escribió:" + the original). A two-line answer with a
      // lone link and NO quoted context, from a cold domain, is what Gmail files as junk; with
      // the quote it is visibly a conversation. The server appends it after the signature.
      const quoteSrc: any = replyTarget || selected;
      const quoteWhen = quoteSrc?.received_at
        ? new Date(quoteSrc.received_at).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";
      const quoteWho = [String(quoteSrc?.from_name || "").trim(), quoteSrc?.from_email ? `<${quoteSrc.from_email}>` : ""].filter(Boolean).join(" ");
      const quoteHeader = quoteWho ? `El ${quoteWhen}, ${quoteWho} escribió:`.replace("El ,", "") : "";
      const quoteHtml = buildReplyQuoteHtml(quoteSrc);

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
          signature_html: acctSignature || undefined,
          quote_html: quoteHtml || undefined,
          quote_header: quoteHeader || undefined,
          attachments: replyFiles.map(({ filename, mime, base64 }) => ({ filename, mime, base64 })),
          cc: ccList,   // extra people added to the thread ("Añadir persona")
        }),
        signal: controller.signal,
      });
      let result: any = null;
      try { result = await resp.json(); } catch { /* non-JSON / empty response */ }

      // Only celebrate a REAL success. Any non-2xx, missing body, or error field
      // means the mail did NOT go out — say so and keep the draft for a retry.
      if (!resp.ok || !result || result.error) {
        toast.error(result?.error || `No se pudo enviar la respuesta (HTTP ${resp.status}). El correo NO ha salido — revisa la cuenta e inténtalo de nuevo.`);
        return false;
      }

      toast.success(ccList.length ? `Respuesta enviada a ${ccList.length + 1} personas (mismo hilo)` : "Respuesta enviada");
      // El servidor sustituyó un enlace que IONOS no entrega: decirlo, para que la plantilla se corrija.
      if (Array.isArray(result?.link_fixes) && result.link_fixes.length > 0) {
        toast.info(`Enlace cambiado para que llegue: ${result.link_fixes.map((f: { from: string; to: string }) => `${f.from} → ${f.to}`).join(", ")}`, { duration: 10000 });
      }
      setReplySource("");
      setReplyFiles([]);
      setReplyLang(null);
      // Keep ccList — the added people STAY on this conversation (persisted), so
      // your next reply here also goes to them. Only close the input UI.
      setCcInput(""); setCcOpen(false);
      // Mark this sender as "replied-to" NOW so the inbound message stays visible in
      // "Todos" immediately (no wait for the next sent_emails reload).
      const repliedEmail = (selected.from_email || "").toLowerCase();
      if (repliedEmail) setRepliedToSet(prev => (prev.has(repliedEmail) ? prev : new Set(prev).add(repliedEmail)));
      loadSent(); // keep the "Enviados" list fresh
      // Refresh thread to show the sent message
      const msg = messages.find(m => m.id === selectedId);
      if (msg) setTimeout(() => loadThread(msg), 500);
      return true;
    } catch (e: any) {
      const aborted = e?.name === "AbortError";
      toast.error(aborted
        ? "El envío tardó demasiado (servidor sobrecargado). El correo NO se confirmó — inténtalo de nuevo en unos segundos."
        : `No se pudo enviar: ${e?.message || e}. El correo NO ha salido.`);
      return false;
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
      const fwdSubject = forwardSubject(origSubject);
      // El original ENTERO tal cual se ve en el detalle: mejor su HTML (referencias, tablas,
      // enlaces, la cita de abajo) y, si es un correo de solo texto, ese texto con sus saltos.
      const origHtml = (selected.body_html && selected.body_html.trim().length > 20)
        ? cleanBodyHtml(selected.body_html, true)
        : plainToForwardHtml(selected.body_text || "");
      const quoted = buildForwardHtml({
        fromName: selected.from_name,
        fromEmail: selected.from_email,
        when: new Date(selected.received_at).toLocaleString("es"),
        subject: origSubject,
        toAccountEmail: accountEmailMap[selected.account_id] || "",
        originalHtml: origHtml,
      }, forwardNote);

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          account_id: selected.account_id,
          to_email: to,
          subject: fwdSubject,
          body: quoted,
          // Se manda el hilo del mensaje original: así el reenvío queda EN LA MISMA conversación
          // y —sobre todo— el servidor no busca un hilo por su cuenta con el destinatario, que
          // era lo que cambiaba el asunto por un "Re: <cualquier otra cosa>".
          in_reply_to: selected.message_id || undefined,
          references: [selected.ref_chain, selected.message_id].filter(Boolean).join(" ").trim() || undefined,
          // Es un REENVÍO: el servidor no le busca otro hilo ni le toca el asunto, y apunta de qué
          // mensaje sale para que se vea en esta misma conversación.
          kind: "forward",
          forwarded_from: selected.id,
        }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Reenviado a ${to}`);
        if (Array.isArray(result?.link_fixes) && result.link_fixes.length > 0) {
          toast.info(`Enlace cambiado para que llegue: ${result.link_fixes.map((f: { from: string; to: string }) => `${f.from} → ${f.to}`).join(", ")}`, { duration: 10000 });
        }
        setForwardOpen(false);
        setForwardTo("");
        setForwardNote("");
        void loadThread(selected);
        void loadSent();
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
      const { data: leads, error: leadsError } = await supabase
        .from("leads").select("id").eq("user_id", user.id).eq("email", email);
      // Sin comprobarlo, un fallo de lectura parecía "0 leads" y se daba por borrado un lead
      // que seguía en sus campañas.
      if (leadsError) { toast.error(leadsError.message); setDeletingLead(false); return; }
      const leadIds = (leads || []).map((l: any) => l.id);

      // 2. Cascade-delete the lead from the whole database
      if (leadIds.length > 0) {
        const { error } = await (supabase as any).rpc("bulk_delete_leads", { lead_ids: leadIds });
        if (error) { toast.error(error.message); setDeletingLead(false); return; }
      }

      // 3. Remove any leftover inbox messages from this sender (not lead-linked)
      const { error: inboxError } = await supabase.from("inbox_messages").delete()
        .eq("user_id", user.id).eq("from_email", email);
      if (inboxError) { toast.error(inboxError.message); setDeletingLead(false); return; }

      // 4. Block the address so it can't re-enter any list
      const { error: blockError } = await supabase.from("blocklist").upsert(
        { user_id: user.id, entry_type: "email", value: email },
        { onConflict: "user_id,entry_type,value" }
      );
      // El bloqueo es lo que impide que el lead vuelva a entrar: si falla, no se anuncia éxito.
      if (blockError) { toast.error(blockError.message); setDeletingLead(false); return; }

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

  // Smartlead-style chips: the colour alone carries the category, no leading dot.
  const filterButtons: { key: FilterType; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "interested", label: "Interesados" },
    { key: "ai_replied", label: "Respondido IA" },
    { key: "question", label: "Preguntas" },
    { key: "not_interested", label: "No interesados" },
    { key: "no_contactar", label: "No contactar" },
    { key: "derivado", label: "Derivados" },
    { key: "out_of_office", label: "Fuera / Auto" },
  ];

  const selectedCategory = selected ? categoryOf(selected) : null;
  const selectedCatConfig = selectedCategory ? categoryConfig[selectedCategory] : null;

  return (
    <div className="flex h-[calc(100dvh-132px)] min-h-0 flex-col gap-2.5 lg:h-[calc(100vh-80px)] lg:gap-3">
      {/* Header */}
      <div className="rounded-md border border-border/60 bg-card px-3 py-2.5 shadow-rest md:px-4 md:py-3">
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-[-0.03em] md:text-2xl">Unibox</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
            {filtered.length} mensajes · {unreadCount} sin leer
            {!isMobile && lastSyncAt && (
              <span className="ml-2 text-xs text-muted-foreground/50 dark:text-muted-foreground/70">
                · Última sync {formatDistanceToNow(lastSyncAt, { addSuffix: true, locale: es })}
              </span>
            )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="h-8 rounded-md border-border bg-card px-3 text-[13px] font-semibold text-muted-foreground shadow-rest">
              <MailOpen className="mr-1.5 h-3.5 w-3.5" /> {unreadCount} pendientes
            </Badge>
            <Badge variant="secondary" className="h-8 rounded-md border-border bg-card px-3 text-[13px] font-semibold text-muted-foreground shadow-rest">
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
      <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-card px-3 py-2.5 md:flex-row md:items-center md:justify-between md:px-4">
        <Tabs value={viewTab} onValueChange={(v) => {
          const nextTab = v as "global" | "all_mailboxes" | "important" | "campaigns" | "reminders" | "sent";
          setViewTab(nextTab);
          setMailboxMode(nextTab === "all_mailboxes" ? "all" : "clean");
        }}>
          <TabsList className="h-9 w-full justify-start overflow-x-auto no-scrollbar [&>*]:flex-shrink-0 md:w-auto md:overflow-visible">
            <TabsTrigger value="global" className="gap-1.5 font-display text-[13px] font-semibold tracking-[-0.03em]">
              <InboxIcon className="h-3.5 w-3.5" /> Global
            </TabsTrigger>
            <TabsTrigger value="all_mailboxes" className="gap-1.5 font-display text-[13px] font-semibold tracking-[-0.03em]">
              <Globe className="h-3.5 w-3.5" /> Todos
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5 font-display text-[13px] font-semibold tracking-[-0.03em]">
              <Megaphone className="h-3.5 w-3.5" /> Campaigns
            </TabsTrigger>
            <TabsTrigger value="important" className="gap-1.5 font-display text-[13px] font-semibold tracking-[-0.03em]">
              <Star className="h-3.5 w-3.5" /> Importantes
              {importantCount > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning px-1 text-[10.5px] font-bold text-warning-foreground">
                  {importantCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sent" className="gap-1.5 font-display text-[13px] font-semibold tracking-[-0.03em]">
              <Send className="h-3.5 w-3.5" /> Enviados
            </TabsTrigger>
            <TabsTrigger value="reminders" className="gap-1.5 font-display text-[13px] font-semibold tracking-[-0.03em]">
              <Bell className="h-3.5 w-3.5" /> Recordatorios
              {remindersVisible > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning px-1 text-[10.5px] font-bold text-warning-foreground">
                  {remindersVisible}
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
              {[...campaigns]
                .sort((a, b) => (campaignReplyCounts[b.id] || 0) - (campaignReplyCounts[a.id] || 0) || String(a.name).localeCompare(String(b.name)))
                .map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{campaignReplyCounts[c.id] ? ` · ${campaignReplyCounts[c.id]}` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        {viewTab === "all_mailboxes" && (
          <Badge variant="secondary" className="h-8 rounded-md border-border bg-card px-3 text-[13px] font-semibold text-muted-foreground shadow-rest">
            <Globe className="mr-1.5 h-3.5 w-3.5" /> Todas las bandejas completas
          </Badge>
        )}
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-md border border-border/60 bg-card px-3 py-2.5 no-scrollbar">
        <button
          onClick={() => setShowTodayOnly(!showTodayOnly)}
          className={`${CHIP_PILL} ${
            showTodayOnly
              ? "border-transparent bg-primary text-primary-foreground shadow-btn"
              : "border-border bg-card text-muted-foreground shadow-rest hover:bg-muted/60"
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
            className={`${CHIP_PILL} ${
              categoryFilter === fb.key
                ? filterChipStyles[fb.key].active
                : filterChipStyles[fb.key].idle
            }`}
          >
            {fb.label}
            {categoryCounts[fb.key] !== undefined && (
              <span className="opacity-60 ml-0.5">{categoryCounts[fb.key] || 0}</span>
            )}
          </button>
        ))}
      </div>

      {/* Folder chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-md border border-border/60 bg-card px-3 py-2 no-scrollbar">
        <button
          onClick={() => setFolderFilter(null)}
          className={`${CHIP_PILL} ${
            folderFilter === null
              ? "border-transparent bg-primary text-primary-foreground shadow-btn"
              : "border-border bg-card text-muted-foreground shadow-rest hover:bg-muted/60"
          }`}
        >
          Todas
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            onClick={() => setFolderFilter(folderFilter === f.id ? null : f.id)}
            className={`${CHIP_PILL} shadow-rest ${
              folderFilter === f.id ? "" : "dark:!border-white/15 dark:!bg-white/10 dark:!text-foreground"
            }`}
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
            <button className={`${CHIP_PILL} border-border bg-card text-muted-foreground shadow-rest hover:bg-muted/60`}>
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
        <EmptyShowcase
          variant="unibox"
          className="flex-1"
          title="No tienes mensajes todavía"
          text="Aquí verás todas las respuestas y conversaciones de tus campañas de cold email."
          cta={{ label: "Lanzar tu primera campaña", onClick: () => navigate("/campaigns") }}
          secondary={
            <button type="button" onClick={handleSync} disabled={syncing} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Buscando mensajes…" : "¿Ya tienes cuentas conectadas? Buscar mensajes ahora"}
            </button>
          }
        />
      ) : (
        <>
        <div className="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-md border border-border/60 bg-card shadow-rest">
          {/* ── Message list — fixed width on desktop, full width on mobile ── */}
          <div className="flex w-full flex-col bg-card lg:w-[380px] lg:flex-shrink-0 lg:border-r lg:border-border/60 xl:w-[420px]">
            <div className="border-b border-border/60 bg-card p-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por email, nombre o texto…"
                  className="pl-9 pr-8 h-8 text-sm bg-muted/40 dark:bg-muted/70 border-0 focus-visible:ring-1"
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
              {visibleRows.map((msg) => {
                const isActive = selectedId === msg.id;
                const isUnread = !msg.is_read;
                const category = categoryOf(msg);
                const catCfg = categoryConfig[category];
                const due = isReminderDue(msg.id);
                const hasReminder = !!reminders[msg.id];
                const msgFolder = msg.folder_id ? folders.find((f) => f.id === msg.folder_id) : null;
                const msgCampaignId = msg.campaign_id || campaignMatch.get(msg.id) || null; // los compañeros traen la campaña de su lead
                const msgCampaign = msgCampaignId ? (campaigns.find((c) => c.id === msgCampaignId) || null) : null;
                const campaignName = msgCampaign?.name || null;
                // Responsable de la campaña ("cargo de Samuel") — badge junto al chip de campaña.
                const campaignManager = msgCampaign?.manager_id ? (managers.find((m) => m.id === msgCampaign.manager_id) || null) : null;
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
                    className={`group relative w-full cursor-pointer border-b border-border/30 dark:border-border/70 px-4 py-3.5 text-left transition-all
                      ${isChecked ? "bg-primary/10 border-l-2 border-l-primary" : due ? "bg-amber-100/70 dark:bg-amber-900/20 border-l-2 border-l-amber-500" : isActive ? "bg-primary/8 dark:bg-primary/15 border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent"}
                    `}
                  >
                    <div className="flex items-center gap-3">
                      {/* Select checkbox (bulk delete) */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleBulk(msg.id); }}
                        title="Seleccionar"
                        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[3px] border transition-all sm:h-4 sm:w-4 ${
                          isChecked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/60 sm:opacity-0 sm:group-hover:opacity-100"
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
                          <span className="flex-shrink-0 whitespace-nowrap rounded-md bg-accent px-2 py-[3px] text-[10.5px] font-semibold text-accent-foreground">
                            {shortTimeAgo(msg.received_at)}
                          </span>
                          <span className={`min-w-0 truncate text-[15px] ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/85"}`}>
                            {msg.from_name || msg.from_email?.split("@")[0]}
                          </span>
                        </div>
                        <p className={`text-[13px] truncate mt-0.5 ${isUnread ? "text-foreground/85 font-semibold" : "text-muted-foreground"}`}>
                          {decodeSubject(msg.subject)}
                        </p>
                        <p className="line-clamp-2 text-[13px] leading-[1.5] text-muted-foreground/75 mt-1 dark:text-muted-foreground/90">
                          {cleanBodyText(msg.body_text, true).slice(0, 120)}
                        </p>
                        {/* Bottom row: AI-replied tag REPLACES the intent tag for messages the AI
                            answered (so a contradictory "Fuera / Auto" never shows on an AI reply);
                            otherwise the normal classification mini-tag + campaign tag + folder. */}
                        {(catCfg.label || aiReplied(msg.from_email) || campaignName || msgFolder || msg.is_archived) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {aiReplied(msg.from_email) ? (
                              <span className={`${CHIP_MINI} bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300`} title="La IA respondió automáticamente a este contacto">
                                <Sparkles className="h-3 w-3" /> Respondido con IA
                              </span>
                            ) : catCfg.label && (
                              <span className={`${CHIP_MINI} ${catCfg.bg} ${catCfg.text}`}>
                                {catCfg.label}
                              </span>
                            )}
                            {campaignName && (
                              <span className={`${CHIP_MINI} bg-accent text-accent-foreground`}>
                                <Megaphone className="h-3 w-3" /> {campaignName}
                              </span>
                            )}
                            {campaignManager && (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-md py-0.5 pl-0.5 pr-2 text-[10.5px] font-semibold whitespace-nowrap dark:!border-white/15 dark:!bg-white/10 dark:!text-foreground"
                                style={{ backgroundColor: campaignManager.color + "14", color: campaignManager.color, border: "1px solid " + campaignManager.color + "33" }}
                                title={"Responsable: " + campaignManager.name}
                              >
                                <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: campaignManager.color }}>
                                  {campaignManager.name.charAt(0).toUpperCase()}
                                </span>
                                {campaignManager.name}
                              </span>
                            )}
                            {msgFolder && (
                              <span className={`${CHIP_MINI} dark:!bg-white/10 dark:!text-foreground`} style={{ backgroundColor: `${msgFolder.color}18`, color: msgFolder.color }}>
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: msgFolder.color }} />
                                {msgFolder.name}
                              </span>
                            )}
                            {msg.is_archived && (
                              <>
                                <span className={`${CHIP_MINI} bg-muted text-muted-foreground`} title="Archivada o eliminada desde el Unibox. La campaña la cuenta como respondida.">
                                  <Archive className="h-3 w-3" /> Archivada
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void handleUnarchive(msg.id); }}
                                  className={`${CHIP_MINI} border border-border bg-card text-foreground hover:bg-muted`}
                                  title="Devolverla al Unibox"
                                >
                                  <ArchiveRestore className="h-3 w-3" /> Recuperar
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        {hasReminder && (
                          <Bell className={`h-3.5 w-3.5 ${due ? "text-amber-500" : "text-muted-foreground/40 dark:text-muted-foreground/60"}`} />
                        )}
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length > visibleRows.length && (
                <div ref={listEndRef} className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {filtered.length - visibleRows.length} mensajes más…
                </div>
              )}
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {viewTab === "campaigns" && (campaignItemsLoading || (selectedCampaignId !== "all" && campaignFeedLoading))
                    ? "Cargando las respuestas de campaña…"
                    : viewTab === "campaigns"
                      ? (selectedCampaignId === "all" ? "Aún no hay respuestas de ninguna campaña" : "Esta campaña aún no tiene respuestas")
                      : "No hay mensajes en esta categoría"}
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
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-md bg-primary/10">
                  <MailOpen className="h-8 w-8 text-primary" />
                </div>
                <h3 className="font-display text-lg font-semibold tracking-[-0.03em] text-foreground">Tu bandeja unificada</h3>
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
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { replyDraftSaved.current = replyRef.current?.getSource() ?? replyDraftSaved.current; setSelectedId(null); setReaderExpanded(false); setReplyFiles([]); setShowFullEmail(false); } }}>
        <DialogContent
          className={`p-0 gap-0 flex flex-col overflow-hidden bg-card border-border/60 shadow-modal outline-none focus:outline-none focus-visible:outline-none [&>button.absolute]:hidden ${
            readerExpanded
              ? "w-screen h-screen max-w-none rounded-none border-0"
              : "w-[95vw] max-w-[1400px] h-[92dvh] max-h-[92dvh] rounded-md"
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
                      <h2 className="font-display text-lg md:text-xl font-semibold tracking-[-0.03em] text-foreground leading-tight flex items-center gap-2 flex-wrap">
                        {decodeSubject(selected.subject)}
                        {aiReplied(selected.from_email) ? (
                          <span className={`${CHIP_MINI} bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300`} title="La IA respondió automáticamente a este contacto">
                            <Sparkles className="h-3 w-3" /> Respondido con IA
                          </span>
                        ) : selectedCatConfig?.label && (
                          <span className={`${CHIP_MINI} ${selectedCatConfig.bg} ${selectedCatConfig.text}`}>
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
                        className={`h-8 w-8 ${isImportant(selected) ? "text-warning hover:text-warning/80" : "text-muted-foreground hover:text-warning"}`}
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
                      <div className={`flex items-center justify-between rounded-md px-3 py-2 text-xs ${isReminderDue(selected.id) ? "border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                        <span className="flex items-center gap-1.5">
                          <Bell className="h-3.5 w-3.5" />
                          {isReminderDue(selected.id) ? "Recordatorio vencido — " : "Recordatorio: "}
                          {format(new Date(reminders[selected.id].remind_at), "d MMM yyyy", { locale: es })}
                        </span>
                        <button onClick={() => handleClearReminder(selected.id)} className="hover:opacity-70"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    )}

                    {/* Translate button */}
                    {!translatedBody && (
                      <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/40 px-4 py-2.5 dark:border-border dark:bg-muted/70">
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
                      <div className="flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5">
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
                          <div key={tm.id + "-" + idx} className={`rounded-md border shadow-rest ${isSent ? "border-primary/20 bg-primary/5" : "border-border/60 bg-card"}`}>
                            <div className="flex items-center gap-2.5 border-b border-border/40 dark:border-border/80 px-3 py-3 sm:gap-3 sm:px-5 sm:py-3.5">
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
                                  {isSent && !tm.forwarded_from && !tm.bounced_at && (
                                    <span className={`${CHIP_MINI} bg-accent text-accent-foreground`}>Enviado</span>
                                  )}
                                  {isSent && tm.bounced_at && isAutoResent(tm.error_message) && (
                                    <span className={`${CHIP_MINI} bg-muted text-muted-foreground`} title="El servidor del destinatario rechazó la IP de salida de este envío; se ha reenviado automáticamente desde el mismo buzón">
                                      Reenviado solo
                                    </span>
                                  )}
                                  {isSent && tm.bounced_at && !isAutoResent(tm.error_message) && (
                                    <span className={`${CHIP_MINI} bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300`} title={tm.error_message || "El servidor del destinatario devolvió el correo"}>
                                      No entregado
                                    </span>
                                  )}
                                  {isSent && tm.forwarded_from && (
                                    <span className={`${CHIP_MINI} bg-accent text-accent-foreground`} title={`Reenviado a ${tm.to_email}`}>
                                      Reenviado a {tm.to_email}
                                    </span>
                                  )}
                                  {isSent && accountEmailMap[tm.account_id] && (
                                    <span className="text-xs text-muted-foreground truncate">desde &lt;{accountEmailMap[tm.account_id]}&gt;</span>
                                  )}
                                  {!isSent && (
                                    <span className="text-xs text-muted-foreground truncate">&lt;{tm.from_email}&gt;</span>
                                  )}
                                  {!isSent && <Destinatarios m={tm} cuenta={accountEmailMap[tm.account_id]} />}
                                </div>
                              </div>
                              <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">{dateStr}</span>
                            </div>
                            <div className="px-3 py-4 sm:px-5 sm:py-5 md:px-8 md:py-6">
                              {isSent ? (
                                <div
                                  className={`${MAIL_PAPER} ${MAIL_PROSE}`}
                                  dangerouslySetInnerHTML={{ __html: sentBodyHtml(tm.body) }}
                                />
                              ) : (translatedBody && tm.id === selected.id) ? (
                                // Show the Spanish translation IN PLACE of this message's body.
                                <div className={MAIL_PLAIN}>
                                  {translatedBody}
                                </div>
                              ) : renderableHtml(tm.body_html, showFullEmail) ? (
                                <MailHtml
                                  className={`${MAIL_PAPER} ${MAIL_PROSE}`}
                                  html={renderableHtml(tm.body_html, showFullEmail)}
                                  attachments={tm.attachments}
                                  messageId={tm.id}
                                />
                              ) : (
                                <div className={MAIL_PLAIN}>
                                  {cleanBodyText(tm.body_text, true)}
                                </div>
                              )}
                              {tm._type !== "sent" && <AttachmentChips bodyText={tm.body_text} bodyHtml={tm.body_html} stored={tm.attachments} messageId={tm.id} />}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-md border border-border/50 bg-card dark:border-border">
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedCatConfig?.bg || "bg-muted"} ${selectedCatConfig?.text || "text-muted-foreground"}`}>
                            {getInitials(selected.from_name, selected.from_email)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-sm text-foreground">{selected.from_name || selected.from_email?.split("@")[0]}</span>
                            <span className="text-xs text-muted-foreground ml-2">&lt;{selected.from_email}&gt;</span>
                            <Destinatarios m={selected} cuenta={accountEmailMap[selected.account_id]} />
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(selected.received_at).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <div className="px-6 pb-6 pl-[3.75rem]">
                          {translatedBody ? (
                            // Show the Spanish translation IN PLACE of the original body.
                            <div className={MAIL_PLAIN}>
                              {translatedBody}
                            </div>
                          ) : renderableHtml(selected.body_html, showFullEmail) ? (
                            <MailHtml
                              className={`${MAIL_PAPER} ${MAIL_PROSE}`}
                              html={renderableHtml(selected.body_html, showFullEmail)}
                              attachments={selected.attachments}
                              messageId={selected.id}
                            />
                          ) : (
                            <div className={MAIL_PLAIN}>
                              {cleanBodyText(selected.body_text, true)}
                            </div>
                          )}
                          <AttachmentChips bodyText={selected.body_text} bodyHtml={selected.body_html} stored={selected.attachments} messageId={selected.id} />
                        </div>
                      </div>
                    )}

                    {threadMessages.length > 1 && (
                      <div className="flex items-center justify-center">
                        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-md">
                          {threadMessages.length} mensajes en esta conversación
                        </span>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Reply box */}
                  {/* Reply footer: never taller than the viewport allows. A long reply used to grow
                      this box past the dialog's bottom edge (overflow-hidden) and hide its own end
                      and the "Responder" button. The editor scrolls inside; if drafts/suggestions
                      still push it over, the footer itself scrolls. */}
                  <div className="flex-shrink-0 max-h-[72dvh] overflow-y-auto border-t border-border/60 bg-card px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-4 md:pt-3 md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-[10px] md:text-xs text-muted-foreground">
                      <Send className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">→ {selected.from_name || selected.from_email}</span>
                      {detectedLang && detectedLang !== "es" && (
                          <span className={`${CHIP_MINI} hidden bg-info/15 text-info sm:inline-flex`}>
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

                  {/* Borrador dejado por el agente de respuestas (si lo hay) */}
                  <ReplyDraftPanel
                    messageId={selected.id}
                    onSendDraft={(body) => handleReply(body)}
                    onEditDraft={(body) => {
                      setReplySource(body);
                      setReplyLang(null);
                      setTimeout(() => replyRef.current?.focus(), 0);
                    }}
                  />

                  {/* AI suggestion area */}
                  {aiSuggestion && (
                    <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 p-3">
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
                        onClick={() => { setReplySource(aiSuggestion); setAiSuggestion(""); }}
                      >
                        Usar respuesta
                      </Button>
                    </div>
                  )}

                  {/* Editor que pinta los enlaces (azul, clicables) y guarda por debajo el
                      mismo texto fuente con <a> que ya entienden IA, plantillas y envío. */}
                  <RichReplyEditor
                    ref={replyRef}
                    id="unibox-reply-textarea"
                    placeholder="Escribe tu respuesta…"
                    className={`mb-2.5 min-h-[92px] overflow-y-auto rounded-md border border-border/70 bg-card px-3.5 py-3 text-sm leading-relaxed shadow-rest focus:border-primary/40 focus:ring-2 focus:ring-primary/25 ${readerExpanded ? "max-h-[58dvh]" : "max-h-[42dvh]"}`}
                    defaultValue={replyDraftSaved.current}
                    onEmptyChange={onReplyEmptyChange}
                  />
                  {replyFiles.length > 0 && (
                    <div className="mb-2.5 flex flex-wrap gap-2">
                      {replyFiles.map((f, i) => (
                        <span key={`${f.filename}-${i}`} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 py-1 pl-2 pr-1 text-xs">
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
                  {/* "Para" — recipients as chips, like a normal compose. The person you
                      reply to is always included; add more (they persist on the thread). */}
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Para</span>
                    {selected?.from_email && (
                      <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
                        {(selected.from_email || "").toLowerCase()}
                      </span>
                    )}
                    {ccList.map((e) => (
                      <span key={e} className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 py-0.5 pl-2 pr-1 text-xs font-medium text-primary">
                        {e}
                        <button type="button" onClick={() => removeCc(e)} className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive" title="Quitar">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addCc(); } if (e.key === "Backspace" && !ccInput && ccList.length) { removeCc(ccList[ccList.length - 1]); } }}
                      onBlur={() => { if (ccInput.trim()) addCc(); }}
                      placeholder="Añadir email…"
                      className="min-w-[130px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                  </div>
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
                            replyRef.current?.insertLink(url, text);
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
                        disabled={autoTranslating || sending || replyEmpty}
                        title="Traduce tu respuesta al idioma en el que te escribió el lead"
                      >
                        <Languages className="h-3.5 w-3.5" />
                        {autoTranslating ? "Traduciendo…" : (replyLang ? `En ${langLabels[replyLang] || replyLang}` : "Su idioma")}
                      </Button>
                      <Popover open={tplOpen} onOpenChange={(o) => { setTplOpen(o); if (o) loadTemplates(); }}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" title="Plantillas de respuesta">
                            <FileText className="h-3.5 w-3.5" /> Plantilla
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 space-y-2 p-3" align="start">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold">Plantillas de respuesta</p>
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={saveTemplate}><Star className="h-3.5 w-3.5" /> Guardar la actual</Button>
                          </div>
                          {templates.length === 0 ? (
                            <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Sin plantillas. Escribe una respuesta y pulsa <b className="text-foreground">"Guardar la actual"</b>; luego aplícala con un clic.</p>
                          ) : (
                            <div className="max-h-64 space-y-1 overflow-y-auto">
                              {templates.map((t) => (
                                <div key={t.id} className="group flex items-start justify-between gap-2 rounded-md border border-border p-2 hover:bg-muted/40">
                                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => applyTemplate(t)} title="Aplicar plantilla">
                                    <p className="truncate text-xs font-medium text-foreground">{t.name}</p>
                                    <p className="truncate text-[11px] text-muted-foreground">{(t.body || "").replace(/<[^>]+>/g, " ").slice(0, 60)}</p>
                                  </button>
                                  <button type="button" onClick={() => deleteTemplate(t.id)} className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" title="Borrar plantilla">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Button size="sm" className="gap-2" onClick={() => { void handleReply(); }} disabled={sending || autoTranslating || (replyEmpty && replyFiles.length === 0)}>
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
                className="w-full justify-start gap-3 h-auto py-3 hover:bg-destructive/5 dark:hover:bg-destructive/15 hover:border-destructive/30"
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
                className="w-full justify-start gap-3 h-auto py-3 hover:bg-destructive/5 dark:hover:bg-destructive/15 hover:border-destructive/30"
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
                  <div key={entry.id} className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2">
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${entry.entry_type === "domain" ? "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300" : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300"}`}>
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
            <DialogTitle className="flex items-center gap-2 font-display tracking-[-0.03em]">
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
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(sigHtml) }}
                  />
                ) : (
                  <p className="text-xs italic text-muted-foreground">Escribe tu firma HTML arriba para ver aquí cómo queda.</p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">Deja el HTML <b>vacío</b> y pulsa Aplicar para <b>quitar</b> la firma.</p>
            </div>

            <SavedSignatures currentHtml={sigHtml} onLoad={setSigHtml} />
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
