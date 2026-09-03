import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ParsedAttachment { name: string; mime: string; base64: string; size?: number; oversized?: boolean }

interface ImapMessage {
  from_email: string;
  from_name: string;
  subject: string;
  body_text: string;
  body_html: string;
  message_id: string;
  date: string;
  ref_chain: string;
  attachments: ParsedAttachment[];
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // store the binary up to 25 MB; bigger → name-only chip
const MAX_ATTACHMENTS_PER_MSG = 10;

/** Decode an RFC2231/2047 attachment filename best-effort. */
function decodeAttachmentName(raw: string): string {
  let v = (raw || "").trim().replace(/^"+|"+$/g, "").trim();
  const r2231 = v.match(/^[\w-]+''(.+)$/);
  if (r2231) { try { return decodeURIComponent(r2231[1]).replace(/^"+|"+$/g, "").trim(); } catch { /* keep */ } }
  // Join adjacent encoded-words split by folding, then decode RFC2047 (=?..?=)
  v = v.replace(/\?=\s*=\?/g, "?==?");
  return decodeMimeWords(v).replace(/^"+|"+$/g, "").trim();
}

/** Pull downloadable attachment parts (name + mime + base64) out of the raw MIME
 *  body. Same idea as the frontend parser but runs in the sync so the binary is
 *  captured before it's discarded. */
function extractAttachments(raw: string): ParsedAttachment[] {
  if (!raw || raw.length < 64) return [];
  const out: ParsedAttachment[] = [];
  const bMatch = raw.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  let parts: string[];
  if (bMatch) {
    const esc = bMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    parts = raw.split(new RegExp("--" + esc + "(?:--)?[ \\t]*\\r?\\n", "g"));
  } else {
    parts = raw.split(/\r?\n--[A-Za-z0-9'()+_,\-./:=?]{6,}(?:--)?[ \t]*\r?\n/);
  }
  for (const part of parts) {
    if (out.length >= MAX_ATTACHMENTS_PER_MSG) break;
    if (!/Content-Transfer-Encoding:\s*base64/i.test(part)) continue;
    const sp = part.split(/\r?\n\r?\n/);
    if (sp.length < 2) continue;
    // Unfold the header so a folded/QP filename is captured whole before decoding.
    const header = (sp[0] || "").replace(/=\r?\n[ \t]*/g, "").replace(/\r?\n[ \t]+/g, "");
    const nameM = header.match(/(?:file)?name\*?=\s*(?:"([^"\r\n]+)"|([^\s";\r\n]+))/i);
    if (!nameM) continue;
    const name = decodeAttachmentName(nameM[1] || nameM[2] || "adjunto").slice(0, 200);
    const typeM = header.match(/Content-Type:\s*([^;\r\n]+)/i);
    const mime = (typeM ? typeM[1].trim() : "application/octet-stream").toLowerCase().slice(0, 120);
    const b64 = sp.slice(1).join("\n").replace(/[^A-Za-z0-9+/=]/g, "");
    if (b64.length < 40) continue;
    const size = Math.floor(b64.length * 0.75);
    // Too big to store → still record the NAME + SIZE so the Unibox shows a chip ("un vídeo llegó"),
    // instead of the file silently vanishing. The binary just isn't downloadable from here.
    if (size > MAX_ATTACHMENT_BYTES) { out.push({ name, mime, base64: "", size, oversized: true }); continue; }
    out.push({ name, mime, base64: b64, size });
  }
  return out;
}

// ── Attachment infra bootstrap ────────────────────────────────────────────
// Mirrors migration 20260704120000_inbox_attachments.sql. Runs the DDL from
// inside the function (SUPABASE_DB_URL is a default edge-function secret) so
// the feature works even if the migration hasn't been pushed yet. Idempotent,
// and guarded so it executes at most once per warm isolate — and only does the
// DDL round-trip when the column is actually missing.
let attachmentInfraReady = false;
async function ensureAttachmentInfra(adminClient: ReturnType<typeof createClient>): Promise<boolean> {
  if (attachmentInfraReady) return true;
  try {
    // Fast probe: if the column already exists, only make sure the bucket does too.
    const probe = await adminClient.from("inbox_messages").select("attachments").limit(1);
    if (!probe.error) {
      const { data: bucket } = await adminClient.storage.getBucket("inbox-attachments");
      if (!bucket) await adminClient.storage.createBucket("inbox-attachments", { public: false });
      attachmentInfraReady = true;
      return true;
    }
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) return false;
    const sql = postgres(dbUrl, { prepare: false, max: 1 });
    try {
      await sql.unsafe(`
        alter table public.inbox_messages
          add column if not exists attachments jsonb not null default '[]'::jsonb;
        insert into storage.buckets (id, name, public)
        values ('inbox-attachments', 'inbox-attachments', false)
        on conflict (id) do nothing;
        drop policy if exists "inbox attachments: owner can read" on storage.objects;
        create policy "inbox attachments: owner can read"
          on storage.objects for select to authenticated
          using (bucket_id = 'inbox-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
      `);
    } finally {
      await sql.end({ timeout: 3 });
    }
    attachmentInfraReady = true;
    return true;
  } catch (e) {
    console.error("attachment infra bootstrap failed:", (e as Error).message);
    return false;
  }
}

// Bootstrap the batched domain-resolution RPC (idempotent, fast — CREATE OR REPLACE only; the
// supporting indexes idx_sent_emails_acct_to_email / _to_domain were created CONCURRENTLY out of
// band by migration 20260903200000 and must NOT be built inside a sync tick).
let sentResolveRpcReady = false;
async function ensureSentResolveRpc(): Promise<boolean> {
  if (sentResolveRpcReady) return true;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return false;
  try {
    const sql = postgres(dbUrl, { prepare: false, max: 1 });
    try {
      await sql.unsafe(`
        create or replace function public.resolve_sent_by_domains(p_account uuid, p_domains text[])
        returns table(dom text, lead_id uuid, campaign_id uuid)
        language sql stable security definer set search_path to 'public' as $fn$
          select distinct on (d) d as dom, s.lead_id, s.campaign_id
          from (
            select lower(split_part(to_email,'@',2)) as d, lead_id, campaign_id, sent_at
            from public.sent_emails
            where account_id = p_account
              and lower(split_part(to_email,'@',2)) = any(p_domains)
              and campaign_id is not null and lead_id is not null
          ) s
          order by d, sent_at desc nulls last;
        $fn$;
        grant execute on function public.resolve_sent_by_domains(uuid, text[]) to service_role, authenticated;
        notify pgrst, 'reload schema';
      `);
    } finally {
      await sql.end({ timeout: 3 });
    }
    sentResolveRpcReady = true;
    return true;
  } catch (e) {
    console.error("resolve_sent_by_domains bootstrap failed:", (e as Error).message);
    return false;
  }
}

// Bootstrap the per-account incremental-sync state column (idempotent; once per warm isolate).
// email_accounts.imap_uid_state jsonb = { "<folder>": { v: UIDVALIDITY, u: last synced UID } }.
// Also asks PostgREST to reload its schema cache so `select("*")`/`update` see the column at once.
let uidStateColReady = false;
async function ensureUidStateColumn(): Promise<boolean> {
  if (uidStateColReady) return true;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return false;
  try {
    const sql = postgres(dbUrl, { prepare: false, max: 1 });
    try {
      await sql.unsafe(`
        alter table public.email_accounts add column if not exists imap_uid_state jsonb;
        notify pgrst, 'reload schema';
      `);
    } finally {
      await sql.end({ timeout: 3 });
    }
    uidStateColReady = true;
    return true;
  } catch (e) {
    console.error("imap_uid_state bootstrap failed:", (e as Error).message);
    return false;
  }
}

// Bootstrap the global-suppression RPC (mirrors migration
// 20260705120000_suppress_email_global.sql) so the feature works even before the
// migration is pushed. Idempotent; once per warm isolate.
let suppressFnReady = false;
async function ensureSuppressFn(): Promise<boolean> {
  if (suppressFnReady) return true;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return false;
  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    await sql.unsafe(`
      create or replace function public.suppress_email_global(
        p_user_id uuid, p_email text, p_reason text default 'bounce'
      ) returns integer
      language plpgsql security definer set search_path = public as $fn$
      declare v_email text := lower(trim(p_email)); v_flagged integer := 0;
      begin
        if p_user_id is null or v_email is null
           or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$' then
          return 0;
        end if;
        insert into public.blocklist (user_id, entry_type, value)
        values (p_user_id, 'email', v_email)
        on conflict (user_id, entry_type, value) do nothing;
        update public.leads set status = 'bounced'
        where user_id = p_user_id and lower(email) = v_email
          and coalesce(status, '') <> 'bounced';
        get diagnostics v_flagged = row_count;
        return v_flagged;
      end; $fn$;
      grant execute on function public.suppress_email_global(uuid, text, text) to authenticated, service_role;
    `);
    suppressFnReady = true;
    return true;
  } catch (e) {
    console.error("suppress fn bootstrap failed:", (e as Error).message);
    return false;
  } finally {
    await sql.end({ timeout: 3 });
  }
}

// Bootstrap the campaign-metrics RPC (mirrors migration
// 20260705140000_campaign_metrics_rpc.sql) so the campaign list can fetch all
// metrics in ONE server-side call instead of downloading thousands of rows.
let metricsFnReady = false;
async function ensureMetricsFn(): Promise<boolean> {
  if (metricsFnReady) return true;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return false;
  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    await sql.unsafe(`
      alter table public.inbox_messages add column if not exists ref_chain text;
      create or replace function public.campaign_metrics_for_user(p_user_id uuid)
      returns table (campaign_id uuid, sent bigint, opened bigint, bounced bigint,
                     replied bigint, sender_bounced bigint, positive bigint, sequences bigint)
      language sql stable security definer set search_path = public as $mfn$
        with c as (
          select id from public.campaigns where user_id = auth.uid()
        ),
        se as (
          select s.campaign_id, lower(coalesce(s.to_email,'')) as email,
                 s.status, s.sent_at, s.opened_at, s.replied_at, s.bounced_at, s.lead_id
          from public.sent_emails s join c on c.id = s.campaign_id
        ),
        okmail as (
          select campaign_id, email, bool_or(sent_at is not null or status in ('sent','bounced')) as ok
          from se group by campaign_id, email
        ),
        failed as (
          select se.campaign_id, count(distinct se.email) as n
          from se join okmail o on o.campaign_id = se.campaign_id and o.email = se.email
          where se.status = 'failed' and o.ok = false and se.email <> '' group by se.campaign_id
        ),
        agg as (
          select campaign_id,
            count(*) filter (where sent_at is not null or status = 'sent') as sent,
            count(*) filter (where opened_at is not null) as opened,
            count(*) filter (where bounced_at is not null) as bounced,
            count(distinct coalesce(lead_id::text, email)) filter (where replied_at is not null) as replied
          from se group by campaign_id
        ),
        pos as (
          select im.campaign_id, count(*) as n from public.inbox_messages im
          join c on c.id = im.campaign_id where im.labels @> array['Interesado']::text[]
          group by im.campaign_id
        ),
        seq as (
          select cs.campaign_id, count(*) as n from public.campaign_steps cs
          join c on c.id = cs.campaign_id group by cs.campaign_id
        )
        select c.id, coalesce(agg.sent,0), coalesce(agg.opened,0), coalesce(agg.bounced,0),
          coalesce(agg.replied,0), coalesce(failed.n,0), coalesce(pos.n,0), coalesce(seq.n,0)
        from c
        left join agg on agg.campaign_id = c.id
        left join failed on failed.campaign_id = c.id
        left join pos on pos.campaign_id = c.id
        left join seq on seq.campaign_id = c.id;
      $mfn$;
      revoke all on function public.campaign_metrics_for_user(uuid) from public;
      grant execute on function public.campaign_metrics_for_user(uuid) to authenticated;
    `);
    metricsFnReady = true;
    return true;
  } catch (e) {
    console.error("metrics fn bootstrap failed:", (e as Error).message);
    return false;
  } finally {
    await sql.end({ timeout: 3 });
  }
}

/** base64 → bytes (Deno-safe). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Remove null bytes and invalid Unicode escape sequences that PostgreSQL rejects */
function sanitizeForPostgres(text: string): string {
  if (!text) return "";
  // Remove null bytes (\u0000)
  let clean = text.replace(/\u0000/g, "");
  // Remove invalid Unicode escape sequences (backslash + u + hex)
  clean = clean.replace(/\\u[0-9a-fA-F]{4}/g, "");
  // Remove other problematic control characters (except newline, tab, carriage return)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return clean;
}

/** Normalize a charset label to one accepted by TextDecoder. */
function normalizeCharset(cs?: string | null): string {
  if (!cs) return "utf-8";
  const c = cs.toLowerCase().trim().replace(/['"]/g, "").replace(/\s+/g, "");
  // Common aliases
  if (c === "utf8" || c === "utf-8" || c === "unicode-1-1-utf-8") return "utf-8";
  if (c === "us-ascii" || c === "ascii") return "utf-8"; // ASCII is UTF-8 compatible
  if (c === "latin1" || c === "latin-1") return "iso-8859-1";
  if (c === "cp1252" || c === "cp-1252") return "windows-1252";
  if (c.startsWith("iso8859")) return "iso-8859" + c.slice(7);
  if (c.startsWith("windows1") && !c.includes("-")) return "windows-" + c.slice(7);
  return c;
}

/** Safely decode bytes with a charset, falling back if the charset is unknown. */
function safeDecode(bytes: Uint8Array, charset?: string | null): string {
  const cs = normalizeCharset(charset);
  try {
    return new TextDecoder(cs, { fatal: false }).decode(bytes);
  } catch {
    // Fallback chain: windows-1252 (superset of latin1, handles most western mail)
    try { return new TextDecoder("windows-1252", { fatal: false }).decode(bytes); }
    catch {
      try { return new TextDecoder("iso-8859-1", { fatal: false }).decode(bytes); }
      catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
    }
  }
}

/** Decode a sequence of quoted-printable hex bytes using the declared charset. */
function decodeQPBytes(text: string, charset?: string): string {
  const withSpaces = text.replace(/_/g, " ");
  const byteChunks: number[] = [];
  let i = 0;
  while (i < withSpaces.length) {
    if (withSpaces[i] === "=" && i + 2 < withSpaces.length && /[0-9A-Fa-f]{2}/.test(withSpaces.substring(i + 1, i + 3))) {
      byteChunks.push(parseInt(withSpaces.substring(i + 1, i + 3), 16));
      i += 3;
    } else {
      byteChunks.push(withSpaces.charCodeAt(i) & 0xff);
      i++;
    }
  }
  return safeDecode(new Uint8Array(byteChunks), charset);
}

/** Decode MIME encoded-words like =?UTF-8?Q?...?= or =?ISO-8859-1?B?...?= */
function decodeMimeWords(raw: string): string {
  if (!raw) return "";
  // Collapse whitespace between adjacent encoded-words first (RFC 2047)
  const collapsed = raw.replace(/\?=\s+=\?/g, "?==?");
  return collapsed.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, text) => {
    if (encoding.toUpperCase() === "Q") {
      return decodeQPBytes(text, charset);
    }
    try {
      const binary = atob(text.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return safeDecode(bytes, charset);
    } catch { return text; }
  }).trim();
}

/** Detect the charset declared in a MIME header block (Content-Type: ...; charset=...) */
function detectCharset(raw: string): string {
  if (!raw) return "utf-8";
  const m = raw.match(/charset\s*=\s*"?([A-Za-z0-9_\-:.+]+)"?/i);
  return normalizeCharset(m ? m[1] : "utf-8");
}

/** Detect the Content-Transfer-Encoding (quoted-printable, base64, 7bit, 8bit, binary) */
function detectTransferEncoding(raw: string): string {
  const m = raw.match(/Content-Transfer-Encoding\s*:\s*([^\r\n;]+)/i);
  return (m ? m[1].trim().toLowerCase() : "7bit");
}

/** Re-decode a string that was wrongly read as UTF-8 from raw bytes,
 *  by mapping each char back to its original byte and decoding with the right charset. */
function reinterpretBytes(text: string, charset: string): string {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return safeDecode(bytes, charset);
}

/** Clean raw IMAP body_text into readable plain text (charset-aware) */
function cleanBody(raw: string, defaultCharset = "utf-8"): string {
  if (!raw) return "";
  // The charset declared in the part header (if present) overrides the default
  const charset = detectCharset(raw) || defaultCharset;
  const transferEnc = detectTransferEncoding(raw);

  let text = raw;
  text = text.replace(/^BODY\[TEXT\]\s*\{\d+\}\s*/i, "");
  // Outlook/Exchange multipart preamble + the boundary token right after it (with or
  // without its leading "--") — otherwise "This is a multi-part message in MIME format."
  // and a bare boundary line leak into the stored body.
  text = text.replace(
    /^[ \t]*This is a multi-?part message in MIME format\.?[ \t]*\r?\n+(?:[ \t]*(?:--)?[A-Za-z0-9'()+_,./:=?-]{10,}[ \t]*\r?\n)?/gim,
    "",
  );
  text = text.replace(/----_[^\r\n]+/g, "");
  text = text.replace(/--[a-zA-Z0-9_=-]+--?\s*/g, "");
  text = text.replace(/Content-Type:[^\n]+/gi, "");
  text = text.replace(/Content-Transfer-Encoding:[^\n]+/gi, "");
  text = text.replace(/Content-Disposition:[^\n]+/gi, "");
  text = text.replace(/charset="?[^"\s;]+"?/gi, "");
  text = text.replace(/<meta[^>]*>/gi, "");
  text = text.replace(/=\r?\n/g, "");

  if (transferEnc === "base64") {
    // The whole body is base64 — decode bytes with the declared charset
    try {
      const cleaned = text.replace(/\s+/g, "");
      const binary = atob(cleaned);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      text = safeDecode(bytes, charset);
    } catch { /* fall through */ }
  } else {
    // Quoted-printable: decode each =XX run with the declared charset
    text = text.replace(/(?:=[0-9A-Fa-f]{2})+/g, (match) => {
      const bytes: number[] = [];
      for (let i = 0; i < match.length; i += 3) bytes.push(parseInt(match.substring(i + 1, i + 3), 16));
      return safeDecode(new Uint8Array(bytes), charset);
    });
    // If the part is NOT quoted-printable but still has high-bit chars that arrived
    // as latin1 bytes (because we read the whole IMAP stream as latin1), reinterpret.
    if (charset !== "utf-8" && /[\x80-\xFF]/.test(text)) {
      text = reinterpretBytes(text, charset);
    }
  }

  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"');
  // Strip any U+FFFD that might still leak (last resort cleanup)
  text = text.replace(/\uFFFD/g, "");
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n /g, "\n").replace(/ \n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const lines = text.split("\n");
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    if (normalized.length > 10 && seen.has(normalized)) continue;
    if (normalized.length > 10) seen.add(normalized);
    deduped.push(line);
  }
  return deduped.join("\n").trim();
}

/** Extract HTML body from raw IMAP text (charset-aware) */
function extractHtml(raw: string): string {
  if (!raw) return "";
  // Look for text/html content between MIME boundaries
  const htmlMatch = raw.match(/(Content-Type:\s*text\/html[\s\S]*?)(?:\r?\n\r?\n)([\s\S]*?)(?=--[a-zA-Z0-9_=-]+|$)/i);
  if (htmlMatch && htmlMatch[2]) {
    const headerBlock = htmlMatch[1] || "";
    const charset = detectCharset(headerBlock) || "utf-8";
    const transferEnc = detectTransferEncoding(headerBlock);
    let html = htmlMatch[2].trim();

    if (transferEnc === "base64") {
      try {
        const cleaned = html.replace(/\s+/g, "");
        const binary = atob(cleaned);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        html = safeDecode(bytes, charset);
      } catch { /* fall through */ }
    } else {
      html = html.replace(/=\r?\n/g, "");
      html = html.replace(/(?:=[0-9A-Fa-f]{2})+/g, (match) => {
        const bytes: number[] = [];
        for (let i = 0; i < match.length; i += 3) bytes.push(parseInt(match.substring(i + 1, i + 3), 16));
        return safeDecode(new Uint8Array(bytes), charset);
      });
      if (charset !== "utf-8" && /[\x80-\xFF]/.test(html)) {
        html = reinterpretBytes(html, charset);
      }
    }
    // Strip stray U+FFFD
    html = html.replace(/\uFFFD/g, "");
    return html;
  }
  return "";
}


/** Check if a sender is automated/spam */
function isAutomatedSender(email: string): boolean {
  const patterns = [/noreply@/i, /no-reply@/i, /mailer-daemon@/i, /postmaster@/i, /bounce@/i];
  return patterns.some(p => p.test(email));
}

/**
 * Detect an async bounce (mailer-daemon DSN / NDR) and return the PERMANENTLY
 * failed recipient addresses. Only permanent (5.x.x / 55x) failures are returned
 * so a temporary greylist (4.x.x) never suppresses a good lead.
 */
function extractPermanentBounceRecipients(fromEmail: string, subject: string, rawBody: string): string[] {
  const from = (fromEmail || "").toLowerCase();
  const looksLikeDaemon = /mailer-daemon@|postmaster@|@.*mail.*daemon/i.test(from);
  const subjBounce = /undeliverable|undelivered|delivery status|returned mail|returned to sender|mail delivery (failed|subsystem)|failure notice|delivery has failed|no se pudo entregar|correo no entregado|delivery incomplete/i.test(subject || "");
  const bodyDsn = /Content-Type:\s*message\/delivery-status|Diagnostic-Code:|Final-Recipient:|This is the mail system at host|delivery to the following recipient|could not be delivered/i.test(rawBody || "");
  if (!looksLikeDaemon && !subjBounce && !bodyDsn) return [];

  // Only act on PERMANENT failures. Look for a 5.x.x status or a 55x SMTP code.
  const permanent =
    /Status:\s*5\.\d+\.\d+/i.test(rawBody) ||
    /Diagnostic-Code:[^\n]*\b(5\d\d|5\.\d+\.\d+)\b/i.test(rawBody) ||
    /\b55[0-9]\b[^\n]*(unknown|does not exist|no such user|not found|invalid|rejected|disabled|unavailable)/i.test(rawBody);
  const temporary = /Status:\s*4\.\d+\.\d+/i.test(rawBody);
  if (!permanent || temporary) return [];

  const emails = new Set<string>();
  const push = (e?: string | null) => {
    const v = (e || "").trim().toLowerCase().replace(/^<|>$/g, "");
    if (/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(v) && !isAutomatedSender(v)) emails.add(v);
  };
  // DSN standard fields (most reliable)
  for (const m of rawBody.matchAll(/(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi)) push(m[1]);
  for (const m of rawBody.matchAll(/X-Failed-Recipients:\s*<?([^\s<>;,]+@[^\s<>;,]+)>?/gi)) push(m[1]);
  return Array.from(emails);
}

// Only store Spanish/Catalan messages — drop English/other warm-up at import time
// so the inbox doesn't fill with 10k+ foreign warm-up emails.
const LANG_ES_CA = /\b(el|la|los|las|del|que|qué|por|para|con|como|pero|porque|cuando|donde|gracias|hola|saludos|cordial|atentamente|estimad[oa]s?|señor|empresa|reunión|información|interesa|interesad[oa]s?|necesito|necesitamos|quiero|queremos|podemos|tenemos|estamos|somos|también|según|sólo|solo|vale|claro|perfecto|encantad[oa]|amb|per|què|gràcies|salutacions|atentament|nosaltres|aquest[a]?|també|molt|més|sense|fins|bon\s?dia|d'acord)\b/gi;
const LANG_EN = /\b(the|and|you|your|for|with|this|that|have|has|are|was|will|would|could|should|is|of|to|in|on|at|as|be|by|from|but|not|can|just|get|know|thanks|thank|regards|best|hi|hello|hey|dear|please|we|our|company|meeting|interested|need|want|team|cheers|sincerely|looking|forward|kind)\b/gi;
function isForeignMessage(subject: string, body: string): boolean {
  const t = `${subject} ${body}`.toLowerCase();
  const wordCount = (t.match(/[a-záéíóúñçüàèòï]{2,}/gi) || []).length;
  if (wordCount < 5) return false;                   // too short to judge → keep
  const es = (t.match(LANG_ES_CA) || []).length;
  const en = (t.match(LANG_EN) || []).length;
  const esChars = /[ñ¿¡]|·l|ç/.test(t) || /[áéíóú]/.test(t) ? 1 : 0;
  const esScore = es + esChars * 2;
  if (esScore > 0 && esScore >= en) return false;    // Spanish/Catalan → keep
  if (en > 0) return true;                            // clearly English → drop
  return false;                                      // ambiguous → keep
}

// Per-folder UID high-water mark, persisted in email_accounts.imap_uid_state as
// { "INBOX": { v: <UIDVALIDITY>, u: <last UID synced> }, "Spam": {...} }.
type UidState = Record<string, { v: number; u: number }>;

async function fetchImapMessages(
  host: string, port: number, username: string, password: string, accountEmail: string, imapUsername: string, fetchLimit = 50,
  uidState: UidState | null = null, budgetMs = 45_000
): Promise<{ ok: boolean; messages: ImapMessage[]; bouncedRecipients?: string[]; error?: string; uidState?: UidState; unchangedFolders?: string[] }> {
  // Deadline wrapper: a hung IMAP peer (tarpit/greylist/firewall) must never
  // block the whole rotating window forever. On timeout the socket is dropped
  // and the account fails cleanly (recorded in errors[] + last_sync stays old).
  const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`IMAP timeout (${what})`)), ms)),
    ]);

  try {
    let conn: Deno.Conn;

    // Connect cap 12s→7s: a healthy IMAP handshake is <2s, so 7s still clears slow-but-alive
    // servers while making an unreachable mailbox fail fast instead of stalling its whole wave
    // (a stuck connect was the main reason a wave dragged toward the worker's 150s wall).
    if (port === 993) {
      conn = await withTimeout(Deno.connectTls({ hostname: host, port }), 7000, "connect");
    } else {
      conn = await withTimeout(Deno.connect({ hostname: host, port }), 7000, "connect");
    }

    // Read the IMAP socket as windows-1252 — preserves every byte 1:1 (no U+FFFD replacement).
    // The actual charset of each MIME body part is detected later from its Content-Type header
    // and re-decoded properly. This avoids destroying Latin-1/Windows-1252 mail before we know its charset.
    const decoder = new TextDecoder("windows-1252", { fatal: false });
    const encoder = new TextEncoder();

    const read = async (): Promise<string> => {
      const buf = new Uint8Array(131072); // 128KB buffer
      const n = await withTimeout(conn.read(buf), 15000, "read");
      return decoder.decode(buf.subarray(0, n || 0));
    };

    const send = async (tag: string, cmd: string): Promise<string> => {
      await conn.write(encoder.encode(`${tag} ${cmd}\r\n`));
      let response = "";
      // Read until the TAGGED completion (`<tag> OK/NO/BAD`) appears, bounded by a WALL-CLOCK
      // deadline + a byte cap — NOT a fixed iteration count. A large FETCH (many/large bodies with
      // quoted threads) streams in many small TLS chunks; the old `attempts < 120` cap bailed
      // mid-response on such mailboxes, silently dropping the TAIL of the stream — i.e. the NEWEST
      // messages (highest sequence numbers) — so new mail never synced (support@ symptom). Each
      // read() already has its own 15s timeout; here we keep reading until the response is complete.
      // Cap at 30s per command (was 60s): each FETCH now streams a 10-message chunk (≤~2.5MB), which
      // completes in well under 30s — the cap only guillotines a pathological stall so one slow
      // mailbox can't push a whole sync tick over the edge worker's 150s wall. A truncated mailbox
      // just finishes on the next tick (dedupe makes re-reads free).
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        let chunk: string;
        try { chunk = await read(); } catch { break; } // read timeout / socket dropped → return what we have
        if (!chunk) break; // EOF (socket closed)
        response += chunk;
        if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) break;
        if (response.length > 10_000_000) break; // hard safety cap (far above any real fetch window)
      }
      return response;
    };

    await read(); // Server greeting

    const loginResp = await send("A001", `LOGIN "${username}" "${password}"`);
    if (!loginResp.includes("A001 OK")) {
      conn.close();
      return { ok: false, messages: [], bouncedRecipients: [], error: `IMAP login failed` };
    }

    // Tag generator for the variable number of IMAP commands below.
    let tagN = 1;
    const nextTag = () => "A" + String(++tagN).padStart(3, "0");

    // Discover folders so we also scan Spam/Junk — cold-email replies and warmup
    // very often land there on fresh mailboxes, and INBOX-only sync misses them.
    let spamFolder: string | null = null;
    try {
      const listResp = await send(nextTag(), `LIST "" "*"`);
      const names: string[] = [];
      for (const m of listResp.matchAll(/\* LIST \([^)]*\)\s+(?:"[^"]*"|\S+)\s+(?:"([^"]+)"|(\S+))\r?\n/gi)) {
        names.push((m[1] || m[2] || "").trim());
      }
      spamFolder = names.find((f) => /(^|[./])spam$|junk|deseado|unwanted|bulk/i.test(f)) || null;
    } catch { /* LIST unsupported — fall back to INBOX only */ }

    const targets = ["INBOX", ...(spamFolder ? [spamFolder] : [])];
    const messages: ImapMessage[] = [];
    const bouncedRecipients = new Set<string>();
    const seenIds = new Set<string>();
    const limit = Math.max(50, Math.min(fetchLimit, 1000));

    // ── INCREMENTAL (UID) SYNC ────────────────────────────────────────────────
    // This is what makes the Unibox near-realtime with 1k+ mailboxes. Every SELECT returns
    // [UIDVALIDITY n] and [UIDNEXT n]. We remember, per folder, the last UID we synced. If
    // UIDNEXT hasn't moved → NO new mail → skip the FETCH entirely (the whole mailbox costs
    // connect+login+SELECT ≈ 0.3-1s instead of 5-10s re-downloading the last 50 messages).
    // If it moved, `UID FETCH last+1:*` pulls ONLY the new messages. First sync / UIDVALIDITY
    // change / too-big backlog → fall back to the proven sequence-based "last N" path. A
    // per-mailbox time budget guarantees one pathological mailbox can never hog a wave.
    const uidStateOut: UidState = {};
    const unchangedFolders: string[] = [];
    let maxUidSeen = 0; // reset per folder; the highest UID actually parsed
    const mailboxStart = Date.now();
    const overBudget = () => Date.now() - mailboxStart > budgetMs;

    for (const folder of targets) {
      if (overBudget()) break;
      const selTag = nextTag();
      const selectResp = await send(selTag, `SELECT "${folder}"`);
      if (!selectResp.includes(`${selTag} OK`)) continue; // folder missing / not selectable
      const existsMatch = selectResp.match(/\* (\d+) EXISTS/);
      const totalMessages = existsMatch ? parseInt(existsMatch[1]) : 0;
      const uvM = selectResp.match(/\[UIDVALIDITY (\d+)\]/i);
      const unM = selectResp.match(/\[UIDNEXT (\d+)\]/i);
      const uidValidity = uvM ? parseInt(uvM[1]) : 0;
      const uidNext = unM ? parseInt(unM[1]) : 0;
      const prev = uidState?.[folder];
      const canIncremental = uidValidity > 0 && uidNext > 0 && !!prev && prev.v === uidValidity && prev.u > 0;
      maxUidSeen = canIncremental ? prev.u : 0;
      let cut = false; // set when the time budget stops this folder before all ranges were read

      if (totalMessages === 0) {
        if (uidValidity && uidNext) uidStateOut[folder] = { v: uidValidity, u: uidNext - 1 };
        continue;
      }
      // Fast path: nothing new since last sync → skip the FETCH altogether.
      if (canIncremental && uidNext - 1 <= prev.u) {
        unchangedFolders.push(folder);
        uidStateOut[folder] = { v: uidValidity, u: prev.u };
        continue;
      }

      const newCount = canIncremental ? (uidNext - 1 - prev.u) : Infinity;
      const useUid = canIncremental && newCount <= limit; // bigger backlog → sequence "last N"
      const start = Math.max(1, totalMessages - limit + 1);
      // BODY.PEEK keeps messages unread on the server. PARTIAL fetch `<0.262144>` caps each message
      // body at the first 256KB (a huge quoted thread could be MEGABYTES and blew the worker memory).
      // ROBUSTNESS: fetch in SMALL BATCHES (10 per command) so each IMAP response stays tiny and is
      // ALWAYS read to completion — this is what guarantees the newest mail is never truncated.
      const CHUNK = 10;
      const ranges: string[] = [];
      if (useUid) {
        for (let lo = prev!.u + 1; lo <= uidNext - 1; lo += CHUNK) ranges.push(`UID FETCH ${lo}:${Math.min(lo + CHUNK - 1, uidNext - 1)}`);
      } else {
        for (let lo = start; lo <= totalMessages; lo += CHUNK) ranges.push(`FETCH ${lo}:${Math.min(lo + CHUNK - 1, totalMessages)}`);
      }
      for (const rangeCmd of ranges) {
      if (overBudget()) { cut = true; break; }
      // `UID` is requested explicitly so BOTH paths report each message's UID → high-water mark.
      const fetchResp = await send(nextTag(), `${rangeCmd} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)] BODY.PEEK[TEXT]<0.262144>)`);

      const parts = fetchResp.split(/\* \d+ FETCH/);
      for (const part of parts) {
        if (!part.trim()) continue;
        // High-water mark: the item's UID comes first in the FETCH response (" (UID 4567 BODY[...").
        const uidM = part.match(/^\s*\(?\s*UID (\d+)/);
        if (uidM) maxUidSeen = Math.max(maxUidSeen, parseInt(uidM[1]));

        // Capture header value INCLUDING folded continuation lines (RFC 5322: a
        // header can wrap onto following lines that start with space/tab). The old
        // regex stopped at the first newline, so a long display name pushed the
        // <email> onto line 2 and we stored the NAME as the address — which then
        // made replies fail ("RCPT TO:<ignacio garcia cuadrado>" → SMTP 500).
        const headerVal = (re: RegExp) => {
          const m = part.match(re);
          return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
        };
        const fromStr = headerVal(/From:\s*(.+(?:\r?\n[ \t]+.+)*)/i);
        // Subject uses [ \t]* (NOT \s*): with an EMPTY "Subject:" header, \s* swallowed the
        // newline + the leading space of the next IMAP line (" BODY[TEXT]<0> {262}") and stored
        // that section marker as the subject — a real reply then went out as
        // "Re: BODY[TEXT]<0> {262}". Horizontal whitespace only means an empty subject stays
        // empty ("(sin asunto)"). The guard below also rejects any leaked IMAP framing.
        // Scope the Subject lookup to the HEADER block only (before the first blank line) and
        // anchor it to a line start — otherwise an EMPTY "Subject:" let the unanchored regex run
        // on into the body and pick up a QUOTED "> Subject: …" from the original mail.
        const headerBlockForSubject = part.split(/\r?\n\r?\n/)[0] || "";
        const subjM = headerBlockForSubject.match(/^Subject:[ \t]*(.*(?:\r?\n[ \t]+.+)*)/im);
        let subjectStr = subjM ? subjM[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
        if (/^\s*(BODY\[|BODY\.PEEK\[|\{\d+\}\s*$)/i.test(subjectStr)) subjectStr = "";
        const dateMatch = part.match(/Date:\s*(.+?)(?:\r?\n)/i);
        // Message-ID — folded-aware, and pull the <id@host> reliably (a missing/
        // mangled Message-ID is what makes a reply land as a NEW message instead of
        // threading). Prefer the value inside <…>; else the bare token.
        const msgIdRaw = headerVal(/Message-ID:\s*(.+(?:\r?\n[ \t]+.+)*)/i);
        const msgIdInner = msgIdRaw.match(/<([^<>\s]+)>/) || msgIdRaw.match(/([^\s<>]+@[^\s<>]+)/);
        const msgIdMatch: RegExpMatchArray | null = msgIdInner ? ([msgIdInner[0], msgIdInner[1]] as unknown as RegExpMatchArray) : null;
        // Thread chain: References + In-Reply-To of the received message, so a
        // reply can carry the FULL chain and thread perfectly in every client.
        const referencesStr = headerVal(/References:\s*(<[^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*)/i);
        const inReplyToStr = headerVal(/In-Reply-To:\s*(<[^\r\n>]+>)/i);
        const refChain = Array.from(new Set(
          `${referencesStr} ${inReplyToStr}`.match(/<[^<>\s]+>/g) || []
        )).join(" ").slice(0, 3000);

        let fromEmail = "";
        let fromName = "";
        if (fromStr) {
          // Prefer <email>; else the first bare addr token anywhere in the value.
          // NEVER fall back to the whole string (that's how a name became the address).
          const emailMatch = fromStr.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/) || fromStr.match(/([^\s<>"@]+@[^\s<>"@]+\.[^\s<>"@]+)/);
          fromEmail = emailMatch ? emailMatch[1] : "";
          const nameMatch = fromStr.match(/^"?([^"<]+?)"?\s*</);
          fromName = nameMatch ? nameMatch[1].trim() : "";
        }

        // Skip messages sent by the account itself (sent copies in the folder)
        const fromLower = fromEmail.toLowerCase().trim();
        const accountLower = accountEmail.toLowerCase().trim();
        const imapLower = imapUsername.toLowerCase().trim();
        if (fromLower && (fromLower === accountLower || fromLower === imapLower)) continue;

        const bodyParts = part.split(/\r?\n\r?\n/);
        // Strip ONLY the trailing IMAP framing that follows the body — the tagged
        // completion line ("A005 OK …") and the closing ")" on its own line.
        // The old code `.replace(/\)[\s\S]*$/,"")` cut at the FIRST ")" anywhere,
        // destroying every reply containing a paren ("(VG)", "recipient(s)", etc.).
        // Rejoin the body with "\n\n" (NOT "\n"): the split was on blank lines, so joining with a
        // single "\n" flattened every paragraph break → the message showed as one cramped blob in
        // the Unibox. "\n\n" preserves the blank lines between paragraphs (cleanBody caps runs at 2).
        let rawBody = bodyParts.length > 1 ? bodyParts.slice(1).join("\n\n") : "";
        rawBody = rawBody
          .replace(/(\r?\n)?[A-Za-z0-9]{1,8} (OK|NO|BAD)[^\n]*\s*$/, "")
          .replace(/(\r?\n)?\)\s*$/, "")
          .trim();

        if (fromEmail) {
          const decodedSubject = decodeMimeWords(subjectStr);
          // Async bounce (mailer-daemon DSN): capture the failed recipient(s) so
          // the handler can suppress them globally, THEN skip storing the bounce.
          for (const r of extractPermanentBounceRecipients(fromEmail, decodedSubject, rawBody)) bouncedRecipients.add(r);
          if (isAutomatedSender(fromEmail)) continue;

          // Dedupe across folders (same message can appear in INBOX + a copy)
          const msgId = msgIdMatch ? msgIdMatch[1].trim() : "";
          if (msgId && seenIds.has(msgId)) continue;
          if (msgId) seenIds.add(msgId);

          const bodyText = sanitizeForPostgres(cleanBody(rawBody).slice(0, 5000));
          const bodyHtml = sanitizeForPostgres(extractHtml(rawBody).slice(0, 50000));

          messages.push({
            from_email: fromEmail.toLowerCase().trim(),
            from_name: sanitizeForPostgres(decodeMimeWords(fromName)),
            subject: sanitizeForPostgres(decodedSubject || "(sin asunto)"),
            body_text: bodyText,
            body_html: bodyHtml,
            message_id: msgId,
            date: dateMatch ? dateMatch[1].trim() : new Date().toISOString(),
            ref_chain: sanitizeForPostgres(refChain),
            attachments: extractAttachments(rawBody),
          });
        }
      }
      } // end batch loop (10 messages per FETCH)
      // Persist the folder's high-water mark. If the time budget cut this folder short, only
      // advance to the highest UID we ACTUALLY parsed (never to UIDNEXT-1) so the unread tail is
      // picked up next tick instead of being skipped forever.
      if (uidValidity && uidNext) {
        const advanceTo = cut ? Math.max(prev?.u || 0, maxUidSeen) : (uidNext - 1);
        if (advanceTo > 0) uidStateOut[folder] = { v: uidValidity, u: advanceTo };
      }
    }

    await send(nextTag(), "LOGOUT");
    conn.close();

    return { ok: true, messages, bouncedRecipients: Array.from(bouncedRecipients), uidState: uidStateOut, unchangedFolders };
  } catch (e) {
    return { ok: false, messages: [], bouncedRecipients: [], error: `IMAP error: ${e.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Make sure the global-suppression + campaign-metrics RPCs exist (once per
    // warm isolate) so the sending queue, bounce path and campaign list can use them.
    const suppressReady = await ensureSuppressFn();
    const metricsReady = await ensureMetricsFn();
    // Incremental (UID) sync state column — enables the "nothing new → skip FETCH" fast path.
    const uidStateReady = await ensureUidStateColumn();
    // Batched domain-resolution RPC (1 indexed query per mailbox instead of 25 seq-scans).
    await ensureSentResolveRpc();

    let targetUserId: string | null = null;
    let specificAccountId: string | null = null;

    const authHeader = req.headers.get("Authorization");

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
      if (token === anonKey) {
        targetUserId = null;
      } else {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: userData } = await userClient.auth.getUser();
        if (userData?.user) {
          targetUserId = userData.user.id;
          specificAccountId = body.account_id || null;
        }
      }
    }

    const offsetProvided = Number.isFinite(Number(body.offset));
    const requestedOffset = offsetProvided ? Math.max(0, Number(body.offset)) : 0;
    // Cron (anon, no user) self-chains through all accounts in small windows (each
    // window stays under the edge worker's CPU/memory budget). Keep the default small.
    // Cron window size (anon path) raised 10→60: with ~1.1k connected mailboxes a window of 10
    // meant the rotating cover took ~⌈1156/10⌉≈116 min, so ~40% of inboxes were >1h stale. 60
    // processed 4-at-a-time (see CONCURRENCY) is ~15 waves ≈ 75s per tick — well under budget —
    // and cuts the full-cover cycle to ~⌈1156/60⌉≈20 min. Peak load is UNCHANGED (still 4 IMAP at
    // once); only the number of sequential waves per tick grows. A wall-clock guard below caps the
    // tick so a big window can never time out.
    // Cron window raised to 150 once the incremental UID sync + indexed resolution landed: a
    // mailbox now costs ~0.25s (nothing new → SELECT only) to ~1s (new mail), so 150 at
    // concurrency 4 is ~15-40s per tick — far inside the 70s guard. With 4 staggered crons
    // (phase_ratio 0 / .25 / .5 / .75) that's 600 mailboxes/min → the whole fleet every ~2 min.
    // 150 per tick is safe ONLY because MAX_MSGS_PER_TICK (below) caps the CPU-heavy MIME parsing:
    // a tick of 150 first-sync mailboxes once blew the worker's CPU budget (HTTP 546, ~7k messages).
    // In steady state a mailbox on the UID fast path costs ~0.12s and parses nothing, so 150 ≈ 15-20s.
    // With 4 staggered crons that's 600 mailboxes/min → the whole fleet (~1.2k) every ~2 min.
    const requestedBatchSize = Number.isFinite(Number(body.batch_size)) ? Math.max(1, Math.min(150, Number(body.batch_size))) : (targetUserId ? 30 : 150);
    // Per-mailbox fetch depth. The CRON path uses 50 (was 120): re-reading the last 120 messages
    // every tick meant ~12 IMAP round-trips per mailbox (chunks of 10), which is what made a window
    // of backlogged inboxes crawl. 50 recent messages (~5 round-trips) is far more than the new
    // mail any mailbox gets between ticks, and dedupe skips the rest — so replies still sync while
    // each mailbox finishes ~2.4× faster, letting more accounts sync per tick. Manual/user syncs
    // keep 120 for a deeper one-off backfill.
    const requestedFetchLimit = Number.isFinite(Number(body.fetch_limit)) ? Math.max(40, Math.min(1000, Number(body.fetch_limit))) : (targetUserId ? 120 : 50);

    let accounts: any[] = [];
    let totalAccounts = 0;
    let usedOffset = requestedOffset;
    if (targetUserId) {
      if (specificAccountId) {
        const { data } = await adminClient.from("email_accounts").select("*").eq("id", specificAccountId).eq("user_id", targetUserId);
        accounts = data || [];
        totalAccounts = accounts.length;
      } else {
        const [{ data }, { count }] = await Promise.all([
          adminClient
            .from("email_accounts")
            .select("*")
            .eq("user_id", targetUserId)
            .in("status", ["connected", "auth_failed"])
            .order("id", { ascending: true })
            .range(requestedOffset, requestedOffset + requestedBatchSize - 1),
          adminClient
            .from("email_accounts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", targetUserId)
            .in("status", ["connected", "auth_failed"]),
        ]);
        accounts = data || [];
        totalAccounts = count || 0;
      }
    } else if (body.account_id) {
      // Priority single-mailbox sync (anon cron, no user auth). The customer-service inbox
      // (support@) gets its OWN 1-min cron so its replies land in inbox_messages instantly —
      // for the AI agent to answer and for the Automatización Unibox — instead of waiting for
      // the rotating window (~13-18 min with 120+ mailboxes).
      const { data } = await adminClient.from("email_accounts").select("*").eq("id", body.account_id).in("status", ["connected", "auth_failed"]).limit(1);
      accounts = data || [];
      totalAccounts = accounts.length;
    } else {
      // Cron path: count first, then process a small window starting at the given
      // offset (0 for the cron tick). After finishing, this invocation chains to the
      // NEXT window (see "self-chaining" below) so ALL accounts get synced every tick
      // without any single call exceeding the edge worker's compute budget.
      const { count } = await adminClient
        .from("email_accounts")
        .select("id", { count: "exact", head: true })
        .in("status", ["connected", "auth_failed"]);
      totalAccounts = count || 0;
      // ROTATING WINDOW: the old design always started at offset 0 and relied on a
      // fragile self-chain to reach the rest — when any link died (resource limit,
      // timeout) accounts beyond it NEVER synced (bug: only 10/124 got checked).
      // Now each cron tick deterministically processes a DIFFERENT window based on
      // the current minute, so every account is covered every ~⌈total/batch⌉ minutes
      // with no state and no chain to break.
      if (offsetProvided) {
        usedOffset = requestedOffset;
      } else {
        // `phase` lets several staggered cron jobs cover DIFFERENT windows in the same minute so
        // total coverage scales with the number of crons (2 crons at phase 0 and ⌊windows/2⌋ →
        // 2 windows/min → half the cover time) WITHOUT raising per-invocation concurrency. Each
        // cron still only opens CONCURRENCY(=4) IMAP sockets, so IONOS load stays modest.
        const windows = Math.max(1, Math.ceil(totalAccounts / requestedBatchSize));
        const minuteIndex = Math.floor(Date.now() / 60000);
        // Prefer a RELATIVE phase (`phase_ratio` 0..1 → floor(windows*ratio)) so the stagger stays
        // "the opposite half" as the account count (and thus `windows`) changes. An absolute
        // `phase` is still accepted, but a value that is ≡ 0 mod windows (e.g. 17 when windows=17,
        // or anything when windows=1) would make both crons hit the SAME window every minute —
        // doubling IMAP load on the same mailboxes for zero extra coverage — so it is remapped to
        // half a rotation. Falls back to 0 (the main cron) when nothing is given.
        const ratio = Number(body.phase_ratio);
        let phase = Number.isFinite(ratio) && ratio > 0 && ratio < 1
          ? Math.floor(windows * ratio)
          : (Number.isFinite(Number(body.phase)) ? Math.floor(Number(body.phase)) : 0);
        if (phase !== 0 && windows > 1 && phase % windows === 0) phase = Math.floor(windows / 2);
        if (windows === 1) phase = 0;
        usedOffset = ((minuteIndex + phase) % windows) * requestedBatchSize;
      }
      const { data } = await adminClient
        .from("email_accounts")
        .select("*")
        .in("status", ["connected", "auth_failed"])
        .order("id", { ascending: true })
        .range(usedOffset, usedOffset + requestedBatchSize - 1);
      accounts = data || [];
    }

    let totalNew = 0;
    const errors: string[] = [];
    // Per-mailbox timings surfaced in the response (`slowest`) so sync latency is diagnosable
    // from the outside without digging through logs.
    const timings: { email: string; ms: number; ok: boolean; msgs?: number; unchanged?: number; err?: string }[] = [];
    // CPU guard: the edge worker's compute budget is per request, and MIME parsing is what burns
    // it. Cap the messages PARSED per tick; mailboxes on the UID fast path parse 0 so they are
    // effectively free — only first-syncs / big backlogs count, and those get deferred instead
    // of taking the whole tick down with HTTP 546 (WORKER_RESOURCE_LIMIT).
    // 1500 ≈ 25 first-sync mailboxes per tick — still 4-5× below the ~7k that produced HTTP 546.
    const MAX_MSGS_PER_TICK = 1500;
    let parsedThisTick = 0;

    // Process account: fetch IMAP + insert messages (relies on dedupe_hash unique constraint to skip duplicates)
    async function processAccount(account: any): Promise<number> {
      let newCount = 0;
      const t0 = Date.now();
      try {
        const result = await fetchImapMessages(
          account.imap_host, account.imap_port,
          account.imap_username, account.imap_password,
          account.email || account.imap_username,
          account.imap_username,
          requestedFetchLimit,
          // Incremental UID state (per folder) — only when the column is confirmed to exist.
          uidStateReady ? ((account.imap_uid_state as UidState) || null) : null,
          45_000 // per-mailbox time budget: one slow mailbox can never hog a whole wave
        );
        timings.push({
          email: account.email, ms: Date.now() - t0, ok: result.ok,
          msgs: result.ok ? result.messages.length : undefined,
          unchanged: result.unchangedFolders?.length, err: result.ok ? undefined : result.error,
        });
        parsedThisTick += result.ok ? result.messages.length : 0;
        // Phase clocks for the DB post-processing (resolution queries / attachments / insert).
        const tFetch = Date.now();
        let tResolve = 0, tAtt = 0;

        if (!result.ok) {
          console.error(`IMAP fetch failed for ${account.email}:`, result.error);
          errors.push(`${account.email}: ${result.error}`);
          return 0;
        }

        console.log(`Fetched ${result.messages.length} messages from ${account.email}`);

        // Record that this mailbox was checked — makes sync health visible
        // (last_sync was previously never written, so coverage bugs were invisible).
        // Also persist the per-folder UID high-water mark so the NEXT tick can skip the FETCH
        // when nothing is new (merged over the stored state so folders we didn't touch keep
        // theirs). If the update is rejected (PostgREST schema cache not yet aware of the new
        // column) fall back to writing last_sync only — the sync itself must never fail on this.
        if (result.unchangedFolders?.length) console.log(`${account.email}: unchanged ${result.unchangedFolders.join(",")}`);
        const nowIso = new Date().toISOString();
        const mergedUid = uidStateReady && result.uidState
          ? { ...((account.imap_uid_state as UidState) || {}), ...result.uidState }
          : null;
        const { error: syncUpdErr } = await adminClient.from("email_accounts")
          .update(mergedUid ? { last_sync: nowIso, imap_uid_state: mergedUid } : { last_sync: nowIso })
          .eq("id", account.id);
        if (syncUpdErr && mergedUid) {
          await adminClient.from("email_accounts").update({ last_sync: nowIso }).eq("id", account.id);
        }

        // ── Async bounce suppression ──────────────────────────────────────
        // mailer-daemon DSNs caught during this fetch → suppress the failed
        // recipient GLOBALLY (blocklist + remove from every list) so we stop
        // emailing dead mailboxes and protect the client's sending reputation.
        const bounced = result.bouncedRecipients || [];
        if (bounced.length > 0 && await ensureSuppressFn()) {
          for (const email of bounced) {
            try {
              await adminClient.rpc("suppress_email_global", {
                p_user_id: account.user_id, p_email: email, p_reason: "async_bounce",
              });
            } catch (e) { console.error("suppress_email_global (async) failed:", (e as Error).message); }
          }
        }
        if (bounced.length > 0) console.log(`Suppressed ${bounced.length} async-bounced recipient(s) via ${account.email}`);

        // STORE EVERY LANGUAGE. The old server-side ES/CA filter dropped real
        // replies before they ever reached the DB (e.g. a Spanish "buenas que tal"
        // quoting the English/Italian original counted as foreign → discarded).
        // Language/warm-up hiding is now done in the frontend (code detector),
        // where it is reversible — never destructive here.
        if (result.messages.length === 0) return 0;

        // Resolve each inbound reply to the lead + campaign we ACTUALLY emailed — using sent_emails
        // as the source of truth (that's what the "replied" stat and campaign membership are keyed
        // on). This makes real replies count in two cases they previously didn't:
        //   (a) DUPLICATE lead rows for the same email → the reply used to attach to a copy we never
        //       emailed (no sent_emails row → replied_at never set, campaign_id null).
        //   (b) a COLLEAGUE at the lead's company replies from a different address (same domain).
        const fromEmails = [...new Set(result.messages.map(m => m.from_email.toLowerCase()))];

        // (a/exact) sent_emails whose recipient == the sender → the EMAILED lead + its campaign.
        const emailSent = new Map<string, { lead_id: string; campaign_id: string }>();
        if (fromEmails.length > 0) {
          const { data: se } = await adminClient
            .from("sent_emails")
            .select("to_email, lead_id, campaign_id, sent_at, created_at")
            .eq("account_id", account.id)
            .not("campaign_id", "is", null)
            .not("lead_id", "is", null)
            .in("to_email", fromEmails)
            .order("sent_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false });
          for (const r of se || []) {
            const k = (r.to_email || "").toLowerCase();
            if (k && !emailSent.has(k)) emailSent.set(k, { lead_id: r.lead_id, campaign_id: r.campaign_id });
          }
        }
        // leads-table exact match — fallback for lead_id ONLY (inbound we never campaign-emailed,
        // e.g. a manually added lead), so the Unibox still associates the message with a lead.
        const leadsMap = new Map<string, string>();
        if (fromEmails.length > 0) {
          const { data: leads } = await adminClient
            .from("leads")
            .select("id, email")
            .eq("user_id", account.user_id)
            .in("email", fromEmails);
          for (const l of leads || []) if (!leadsMap.has(l.email.toLowerCase())) leadsMap.set(l.email.toLowerCase(), l.id);
        }

        // Blocklist check — import blocked senders' mail but mark is_archived so it never
        // shows in the Unibox (and never inflates reply stats). Only look up THIS batch's
        // senders/domains, so it stays fast even with thousands of blocklist entries.
        const fromDomains = [...new Set(fromEmails.map(e => e.split("@")[1]).filter(Boolean))];
        const blockedEmailSet = new Set<string>();
        const blockedDomainSet = new Set<string>();
        {
          const [emailBlk, domBlk] = await Promise.all([
            adminClient.from("blocklist").select("value").eq("user_id", account.user_id).eq("entry_type", "email").in("value", fromEmails),
            fromDomains.length > 0
              ? adminClient.from("blocklist").select("value").eq("user_id", account.user_id).eq("entry_type", "domain").in("value", fromDomains)
              : Promise.resolve({ data: [] as { value: string }[] }),
          ]);
          for (const r of emailBlk.data || []) blockedEmailSet.add(String(r.value).toLowerCase());
          for (const r of (domBlk as { data?: { value: string }[] }).data || []) blockedDomainSet.add(String(r.value).toLowerCase());
        }
        const isBlockedSender = (email: string) => {
          const e = email.toLowerCase();
          if (blockedEmailSet.has(e)) return true;
          const d = e.split("@")[1] || "";
          return d ? blockedDomainSet.has(d) : false;
        };

        // (b/domain) for domains with NO exact-email send, find the lead + campaign we emailed at
        // that SAME domain (a colleague reply — e.g. ivan.romera@adwake.ai when we emailed a
        // different person @adwake.ai). Capped for speed. Also keyed on sent_emails so the reply
        // both lands in the campaign AND gets counted.
        const domainSent = new Map<string, { lead_id: string; campaign_id: string }>();
        // NEVER domain-match on shared/free-mail providers: "random@gmail.com" is NOT a colleague of
        // "pepe@gmail.com" — matching there would mark Pepe as replied on ANY unrelated gmail mail.
        const GENERIC_DOMAINS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|protonmail|proton|gmx|mail|zoho|yandex|hey|fastmail|tutanota|qq|163|126|web|t-online|orange|wanadoo|free|libero|virgilio|telefonica|movistar|terra|ono)\.[a-z.]+$/i;
        // Domains already resolved EXACTLY (by a send or by a known lead) never take the domain path.
        const resolvedDomains = new Set([...emailSent.keys(), ...leadsMap.keys()].map((e) => e.split("@")[1]).filter(Boolean));
        const unresolvedDomains = fromDomains.filter((d) => d && !resolvedDomains.has(d) && !GENERIC_DOMAINS.test(d)).slice(0, 25);
        // ONE indexed RPC for all domains (was up to 25 sequential `ilike '%@d'` scans per mailbox —
        // measured at 63 s for a 55-message first sync; now ~1 ms). Falls back to a small capped
        // loop only if the RPC isn't callable yet (PostgREST schema cache still warming up).
        if (unresolvedDomains.length > 0) {
          let resolvedViaRpc = false;
          try {
            const { data: rows, error: rpcErr } = await adminClient
              .rpc("resolve_sent_by_domains", { p_account: account.id, p_domains: unresolvedDomains });
            if (!rpcErr && Array.isArray(rows)) {
              resolvedViaRpc = true;
              for (const r of rows as { dom: string; lead_id: string; campaign_id: string }[]) {
                if (r?.dom && r.lead_id && r.campaign_id) domainSent.set(r.dom, { lead_id: r.lead_id, campaign_id: r.campaign_id });
              }
            }
          } catch { /* fall through */ }
          if (!resolvedViaRpc) {
            for (const d of unresolvedDomains.slice(0, 5)) {
              try {
                const { data: se } = await adminClient
                  .from("sent_emails")
                  .select("lead_id, campaign_id")
                  .eq("account_id", account.id)
                  .not("campaign_id", "is", null)
                  .not("lead_id", "is", null)
                  .ilike("to_email", `%@${d}`)
                  .order("sent_at", { ascending: false, nullsFirst: false })
                  .limit(1);
                if (se && se[0]?.lead_id) domainSent.set(d, { lead_id: se[0].lead_id, campaign_id: se[0].campaign_id });
              } catch { /* non-fatal */ }
            }
          }
        }

        tResolve = Date.now();
        // ── Attachments → Storage ──────────────────────────────────────────
        // Bootstrap the column/bucket/policy if missing. If it fails, sync
        // continues WITHOUT attachments (rows must not reference the column).
        const attInfraOk = await ensureAttachmentInfra(adminClient);
        // Skip messages already in the DB (their row + attachments already exist)
        // so we don't re-upload the same PDF on every sync.
        const withAtt = attInfraOk ? result.messages.filter((m) => (m.attachments?.length || 0) > 0) : [];
        if (withAtt.length > 0) {
          const attMsgIds = withAtt.map((m) => m.message_id).filter(Boolean);
          const alreadyStored = new Set<string>();
          if (attMsgIds.length > 0) {
            const { data: existRows } = await adminClient
              .from("inbox_messages")
              .select("message_id")
              .eq("user_id", account.user_id)
              .in("message_id", attMsgIds);
            for (const r of existRows || []) if (r.message_id) alreadyStored.add(r.message_id);
          }
          for (const msg of withAtt) {
            if (msg.message_id && alreadyStored.has(msg.message_id)) { (msg as unknown as { _stored: unknown[] })._stored = []; continue; }
            const stored: { name: string; mime: string; size: number; path: string; oversized?: boolean }[] = [];
            const msgKey = (msg.message_id || `${msg.from_email}-${msg.date}`).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 90) || "msg";
            const nameCount: Record<string, number> = {};
            for (const att of msg.attachments) {
              try {
                // Too big to store → keep just the metadata so the Unibox shows a name/size chip.
                if (att.oversized || !att.base64) {
                  stored.push({ name: att.name, mime: att.mime, size: att.size || 0, path: "", oversized: true });
                  continue;
                }
                const bytes = base64ToBytes(att.base64);
                let safeName = att.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "adjunto";
                // De-dupe identical filenames within one message
                if (nameCount[safeName] != null) { nameCount[safeName]++; safeName = `${nameCount[safeName]}_${safeName}`; }
                else nameCount[safeName] = 0;
                const path = `${account.user_id}/${msgKey}/${safeName}`;
                const { error: upErr } = await adminClient.storage
                  .from("inbox-attachments")
                  .upload(path, bytes, { contentType: att.mime, upsert: true });
                if (!upErr) stored.push({ name: att.name, mime: att.mime, size: bytes.length, path });
              } catch (_e) { /* skip this attachment */ }
            }
            (msg as unknown as { _stored: unknown[] })._stored = stored;
          }
        }

        tAtt = Date.now();
        Object.assign(timings[timings.length - 1], { resolve_ms: tResolve - tFetch, att_ms: tAtt - tResolve });
        // Build batch insert payload (dedupe_hash trigger + unique constraint will reject duplicates)
        const rows = result.messages.map(msg => {
          let parsedDate: string;
          try { parsedDate = new Date(msg.date).toISOString(); } catch { parsedDate = new Date().toISOString(); }
          // Prefer the lead + campaign we ACTUALLY emailed (exact recipient), else a colleague at
          // the same domain, else a plain leads-table match (no campaign). This makes replies from
          // duplicate lead rows AND from colleagues land in the campaign and count as a reply.
          const fe = msg.from_email.toLowerCase();
          const dom = (fe.split("@")[1] || "").toLowerCase();
          // Priority is EXACT first: (1) the lead we actually emailed at this exact address,
          // (2) an exact leads-table match, and only then (3) a colleague at the same domain.
          // Domain must never override an exact identity (that mis-attributed replies and
          // flipped the wrong lead to "replied"). Generic providers are already excluded above.
          const exactSent = emailSent.get(fe) || null;
          const exactLead = leadsMap.get(fe) || null;
          const domHit = (!exactSent && !exactLead && dom) ? (domainSent.get(dom) || null) : null;
          const leadId = exactSent?.lead_id || exactLead || domHit?.lead_id || null;
          const campaignId = exactSent?.campaign_id || domHit?.campaign_id || null;
          return {
            user_id: account.user_id,
            account_id: account.id,
            lead_id: leadId,
            campaign_id: campaignId,
            message_id: msg.message_id || null,
            from_email: msg.from_email,
            from_name: msg.from_name,
            subject: msg.subject || "(sin asunto)",
            body_text: msg.body_text,
            body_html: msg.body_html || null,
            received_at: parsedDate,
            // Blocked sender → import (keeps threading/dedupe intact) but pre-archived so it
            // never appears in the Unibox nor counts as a reply.
            is_archived: isBlockedSender(msg.from_email),
            // Only reference these columns when their bootstrap confirmed they
            // exist — otherwise the whole insert would fail and break the sync.
            ...(attInfraOk ? { attachments: (msg as unknown as { _stored?: unknown[] })._stored || [] } : {}),
            // ref_chain (References + In-Reply-To of the incoming mail) is ALWAYS stored — the
            // column is created by migration, so it never depends on the metrics bootstrap. This
            // is what lets replies carry the FULL thread chain in References, so they land in the
            // right conversation even when the sender keeps changing the subject.
            ref_chain: msg.ref_chain || null,
          };
        });

        // Insert one by one but only counts errors as duplicates - upsert with ignore via insert
        // Use chunks of 50 for batch insert
        const chunkSize = 50;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          // UPSERT with ignoreDuplicates → duplicates (already-synced messages) are skipped
          // SILENTLY (ON CONFLICT DO NOTHING) instead of erroring. Before this, every re-read
          // duplicate raised a Postgres error + rollback — millions/day (the "10% success
          // rate"). `.select()` returns ONLY the newly-inserted rows, so the reply-marking
          // below still runs exactly for genuinely new messages. Needs the full unique index
          // `inbox_messages_user_dedupe_full`; if that's missing the upsert errors and we fall
          // back to the old per-row path (sync never breaks — just no improvement yet).
          const { data: inserted, error: insertError } = await adminClient
            .from("inbox_messages")
            .upsert(chunk, { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
            .select("id, lead_id, campaign_id, received_at");

          if (insertError) {
            // If batch fails (likely due to dedupe), fall back to individual inserts
            for (const row of chunk) {
              const { data: ins, error: e } = await adminClient
                .from("inbox_messages")
                .insert(row)
                .select("id")
                .single();
              if (!e && ins) {
                newCount++;
                if (row.lead_id) {
                  await adminClient.from("leads").update({ status: "replied" }).eq("id", row.lead_id);
                  await adminClient.from("sent_emails").update({ replied_at: row.received_at })
                    .eq("lead_id", row.lead_id).eq("user_id", account.user_id).is("replied_at", null);
                  if (row.campaign_id) {
                    await adminClient.from("campaign_leads")
                      .update({ status: "replied" })
                      .eq("lead_id", row.lead_id).eq("campaign_id", row.campaign_id);
                  }
                }
              }
            }
          } else if (inserted) {
            newCount += inserted.length;
            // Mark replied for leads that produced a new message
            const repliedLeadIds = inserted.filter(r => r.lead_id).map(r => r.lead_id);
            if (repliedLeadIds.length > 0) {
              await adminClient.from("leads").update({ status: "replied" }).in("id", repliedLeadIds);
              await adminClient.from("sent_emails").update({ replied_at: new Date().toISOString() })
                .in("lead_id", repliedLeadIds).eq("user_id", account.user_id).is("replied_at", null);
              const campaignPairs = inserted.filter(r => r.lead_id && r.campaign_id);
              for (const cp of campaignPairs) {
                await adminClient.from("campaign_leads")
                  .update({ status: "replied" })
                  .eq("lead_id", cp.lead_id).eq("campaign_id", cp.campaign_id);
              }
            }
          }
        }
      } catch (accountErr) {
        console.error(`Error processing account ${account.email}:`, accountErr);
        errors.push(`${account.email}: ${accountErr.message}`);
      }
      return newCount;
    }

    // Process accounts in small parallel waves. Concurrency MUST stay low (≈4):
    // processing many IMAP connections + heavy MIME parsing at once exceeds the
    // edge function's compute budget and returns WORKER_RESOURCE_LIMIT (the sync
    // error). 4 keeps each wave safely under the limit.
    const CONCURRENCY = 4;
    // Wall-clock guard: never let a tick run long enough to hit the edge worker's
    // hard timeout. If we're within reach of the limit, stop starting new waves and
    // leave the rest for the next rotating-window tick (they are NOT lost — the
    // window keeps advancing, so unprocessed accounts are picked up next cycle).
    // 70s so that even the wave in flight (bounded below) finishes well inside the 150s wall.
    const TICK_DEADLINE_MS = 70_000;
    const tickStart = Date.now();
    let stoppedEarly = 0;
    // Shuffle the window so the time-guard doesn't ALWAYS defer the same tail accounts. Windows are
    // deterministic (offset by id), so without this a window full of slow IONOS mailboxes would
    // process its first ~15 every visit and STARVE the rest forever. Shuffling makes the deferred
    // subset rotate → every account is covered within a few cycles even in a slow window.
    for (let s = accounts.length - 1; s > 0; s--) { const j = Math.floor(Math.random() * (s + 1)); [accounts[s], accounts[j]] = [accounts[j], accounts[s]]; }
    for (let i = 0; i < accounts.length; i += CONCURRENCY) {
      const elapsed = Date.now() - tickStart;
      if (elapsed > TICK_DEADLINE_MS) { stoppedEarly = accounts.length - i; break; }
      if (parsedThisTick >= MAX_MSGS_PER_TICK) {
        stoppedEarly = accounts.length - i;
        console.warn(`fetch-inbox tick hit CPU guard (${parsedThisTick} messages parsed): ${stoppedEarly} account(s) deferred`);
        break;
      }
      const batch = accounts.slice(i, i + CONCURRENCY);
      // The wave itself is ALSO bounded: a wave started late can't run past the tick deadline
      // (+ a small grace for the slowest account to close). Without this, a wave launched at
      // second 69 with one stuck mailbox could still blow through the worker's hard timeout and
      // lose the whole tick (no response, no deferred count). Race = the wave keeps running in
      // the background of this isolate but we stop WAITING and return cleanly.
      const remaining = Math.max(5_000, TICK_DEADLINE_MS - elapsed + 20_000);
      const results = await Promise.race([
        Promise.all(batch.map(a => processAccount(a))),
        new Promise<number[]>((res) => setTimeout(() => res([]), remaining)),
      ]);
      totalNew += results.reduce((a, b) => a + b, 0);
      if (results.length === 0) { stoppedEarly = accounts.length - i - batch.length; console.warn(`fetch-inbox wave timed out (${batch.length} account(s) still in flight)`); break; }
    }
    if (stoppedEarly > 0) console.warn(`fetch-inbox tick hit time guard: ${stoppedEarly} account(s) deferred to next window`);

    const nextOffset = specificAccountId ? null : usedOffset + accounts.length;
    const hasMore = specificAccountId ? false : (nextOffset as number) < totalAccounts;

    console.log(`fetch-inbox complete: ${accounts.length}/${totalAccounts} accounts (offset ${usedOffset}), ${totalNew} new messages, next=${nextOffset}`);

    // NOTE: the old cron self-chaining was removed. It silently died on the first
    // failed link and, because the cron always restarted at offset 0, accounts past
    // the break NEVER synced. Coverage is now guaranteed by the minute-based
    // rotating window above — every connected account is checked every
    // ~⌈total/batch⌉ minutes without any chain that can break.

    // Surface attachment-infra state so deploys can be verified externally.
    const attachmentsReady = await ensureAttachmentInfra(adminClient);

    return new Response(JSON.stringify({
      success: true,
      accounts_checked: accounts.length - stoppedEarly,
      accounts_deferred: stoppedEarly,
      accounts_total: totalAccounts,
      new_messages: totalNew,
      next_offset: hasMore ? nextOffset : null,
      has_more: hasMore,
      attachments_ready: attachmentsReady,
      suppress_ready: suppressReady,
      metrics_ready: metricsReady,
      errors: errors.length > 0 ? errors : undefined,
      // Diagnostics: the slowest mailboxes of this tick (ms, ok, msgs fetched, folders skipped as
      // unchanged, error). Lets latency be understood from outside without reading logs.
      slowest: timings.sort((a, b) => b.ms - a.ms).slice(0, 8),
      unchanged_fast_path: timings.filter((t) => (t.unchanged || 0) > 0).length,
      parsed_messages: parsedThisTick,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("fetch-inbox error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
