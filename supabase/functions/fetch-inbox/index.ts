import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cronOrServiceAuthorised, unauthorized } from "../_shared/cron-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { hasWarmupSubjectTag, isWarmupMessage, refersToOwnDomain } from "../_shared/inbox-filters.ts";
import {
  BOUNCE_CLOCK_SLACK_MS, BOUNCE_LOOKBACK_MS, bounceDismissal, chooseBouncedSend, decideBounce, parentRef, repliedToSend,
  type BounceCandidate, type BounceMatch, type BouncedSend,
} from "../_shared/bounce-match.ts";
import { bounceRetryable, resentNote } from "../_shared/reply-retry.ts";
import { extractAttachments, looksInline } from "../_shared/mail-attachments.ts";
import {
  INBOUND_FETCH_ITEMS, addressOf, autoSignal, decodeMimeWords, headerValue, imapCompleted, parseInboundItem, pickFolders, refIds, splitFetchItems,
  type FetchItem, type InboundMessage,
} from "../_shared/imap-parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ParsedAttachment { name: string; mime: string; base64: string; size?: number; oversized?: boolean }

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // store the binary up to 25 MB; bigger → name-only chip
const MAX_ATTACHMENTS_PER_MSG = 10;



/** Pull downloadable attachment parts (name + mime + base64) out of the raw MIME
 *  body. Same idea as the frontend parser but runs in the sync so the binary is
 *  captured before it's discarded. */
/* El lector de adjuntos vive en _shared/mail-attachments.ts: el de aqui cortaba el MIME por la
   PRIMERA frontera que encontraba, y en un correo anidado (mixed → alternative → archivo) esa es
   la de dentro, asi que el archivo se quedaba fuera y el mensaje se guardaba sin nada.
   El compartido corta por cualquier linea de frontera. */


// ── Attachment infra bootstrap ────────────────────────────────────────────
// Mirrors migration 20260704120000_inbox_attachments.sql. Runs the DDL from
// inside the function (SUPABASE_DB_URL is a default edge-function secret) so
// the feature works even if the migration hasn't been pushed yet. Idempotent,
// and guarded so it executes at most once per warm isolate — and only does the
// DDL round-trip when the column is actually missing.
// ── ONE read-only catalog probe instead of DDL on every invocation ────────────────────
// Edge isolates do NOT keep module state between requests, so the "once per warm isolate"
// guards below ran their ALTER TABLE / CREATE OR REPLACE FUNCTION / NOTIFY pgrst on EVERY tick
// (measured: ~12-20 DDL/min). Each DDL takes an ACCESS EXCLUSIVE lock and forces PostgREST to
// re-introspect the whole schema (~130 ms of DB CPU each) — a large share of DB CPU.
// This probe is a single ~1 ms SELECT over the catalogs; when everything is present (always,
// after the first deploy) it flips all the flags and NO DDL/NOTIFY runs at all. The ensure*
// functions are kept only as the rare self-healing path for a fresh project.
let infraProbed = false;
async function probeInfra(): Promise<void> {
  if (infraProbed) return;
  infraProbed = true;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return;
  try {
    const sql = postgres(dbUrl, { prepare: false, max: 1 });
    try {
      const r = await sql`
        select
          exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_accounts' and column_name='imap_uid_state') as col_uid,
          exists(select 1 from information_schema.columns where table_schema='public' and table_name='inbox_messages' and column_name='ref_chain') as col_ref,
          exists(select 1 from information_schema.columns where table_schema='public' and table_name='inbox_messages' and column_name='attachments') as col_att,
          exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_sent_by_domains') as fn_resolve,
          exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='suppress_email_global') as fn_suppress,
          exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='campaign_metrics_for_user') as fn_metrics,
          exists(select 1 from storage.buckets where id='inbox-attachments') as bucket_att,
          exists(select 1 from information_schema.columns where table_schema='public' and table_name='inbox_messages' and column_name='auto_signal') as col_auto,
          exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_accounts' and column_name='imap_rescan') as col_rescan,
          exists(select 1 from information_schema.tables where table_schema='public' and table_name='inbox_ingest_log') as tbl_log,
          exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='inbox_rescan_judge') as fn_judge`;
      const x = (r as any[])[0] || {};
      if (x.col_uid) uidStateColReady = true;
      if (x.fn_resolve) sentResolveRpcReady = true;
      if (x.fn_suppress) suppressFnReady = true;
      if (x.col_ref && x.fn_metrics) metricsFnReady = true;
      if (x.col_att && x.bucket_att) attachmentInfraReady = true;
      if (x.col_auto && x.col_rescan && x.tbl_log && x.fn_judge) ingestInfraReady = true;
    } finally {
      await sql.end({ timeout: 3 });
    }
  } catch (e) {
    console.error("infra probe failed (falling back to ensure* DDL path):", (e as Error).message);
  }
}

// Migración 20261002140000 (registro de entrada, repaso, señal de respuesta automática). Si aún
// no está aplicada, la sincronización sigue como antes y simplemente no usa nada de eso.
let ingestInfraReady = false;

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
        revoke all on function public.resolve_sent_by_domains(uuid, text[]) from public, anon, authenticated;
        grant execute on function public.resolve_sent_by_domains(uuid, text[]) to service_role;
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
      revoke all on function public.suppress_email_global(uuid, text, text) from public, anon, authenticated;
      grant execute on function public.suppress_email_global(uuid, text, text) to service_role;
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

/** Un mensaje leído, con el sitio exacto del buzón del que salió. */
type FetchedMessage = InboundMessage & { folder: string; uidv: number; recovered?: boolean };
/** Dónde se cortó la lectura de un buzón (06-10-2026): carpeta y marca de UID, para dejarlo anotado. */
type CutAt = { folder: string; uidv: number; uid: number; why: "cortado" | "ilegible" };

/** Asunto de respuesta: "Re:", "RE:", "AW:" (alemán), "SV:" (nórdico). */
const REPLY_SUBJECT = /^\s*(?:re|aw|sv)\s*:/i;
const normReplySubject = (s: string | null | undefined) =>
  String(s || "").replace(/^\s*(?:(?:re|aw|sv|antw|rv|wg|fwd?|tr)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
/** ¿Es "Re: <uno de nuestros asuntos>"? (06-10-2026) */
function repliesToOurSubject(subject: string | null | undefined, sentSubjects: string[] | undefined): boolean {
  if (!REPLY_SUBJECT.test(subject || "")) return false;
  const core = normReplySubject(subject);
  return !!core && (sentSubjects || []).some((s) => normReplySubject(s) === core);
}
/** Asuntos con los que un remitente automático (noreply@…) SÍ contesta: se guarda aunque no se pueda atar a nada. */
const KEEP_AUTOMATED_SUBJECT = /^\s*(?:(?:re|aw|sv)\s*:|out[- ]of[- ](?:the[- ])?office|respuesta autom[aá]tica|automatic reply|mensaje detectado como spam)/i;
/** Clave de un correo entrante para casar lo insertado con lo construido (Message-ID, o remitente + fecha). */
const inboundKey = (mid: string | null | undefined, from: string | null | undefined, at: string | null | undefined) =>
  mid ? `m:${mid}` : `f:${String(from || "").toLowerCase()}|${Date.parse(at || "")}`;
/** Un mensaje que NO se guarda como correo entrante, con el motivo (se anota, no se tira). */
type Skip = { folder: string; uidv: number; uid: number; reason: string; from: string; subject: string; message_id: string; date: string };

/** Lo mínimo de un correo (sólo cabeceras) para decidir, en un repaso, si hay que traerlo entero. */
interface RescanItem { uid: number; mid: string; from: string; refs: string[]; auto: boolean; daemon: boolean }
/**
 * Repaso de los últimos N días (02-10-2026). Recorre lo que YA quedó por debajo de la marca de
 * UID —lo que la sincronización normal no vuelve a mirar— leyendo sólo cabeceras, pregunta a la
 * base de datos cuáles faltan y son nuestros (judge) y trae enteros sólo ésos. No borra, no mueve
 * ni marca nada (BODY.PEEK), y lo recuperado pasa por la misma inserción sin duplicados.
 */
interface RescanPlan {
  days: number;
  since: string;                      // ISO: fijo durante todo el repaso, aunque dure varias pasadas
  cur: Record<string, number>;        // carpeta → último UID ya repasado
  maxFetch: number;                   // tope de correos enteros por pasada
  judge: (items: RescanItem[]) => Promise<number[]>;
}
interface RescanResult { cur: Record<string, number>; checked: number; wanted: number; fetched: number; done: boolean; folders: string[] }

const IMAP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const imapDay = (d: Date) => `${d.getUTCDate()}-${IMAP_MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
/** Cadena entre comillas de IMAP: la barra y las comillas van escapadas (una contraseña con `"` rompía el LOGIN). */
const imapQuote = (s: string) => '"' + String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
async function fetchImapMessages(
  host: string, port: number, username: string, password: string, accountEmail: string, imapUsername: string, fetchLimit = 50,
  uidState: UidState | null = null, budgetMs = 45_000, rescan: RescanPlan | null = null
): Promise<{ ok: boolean; messages: FetchedMessage[]; skips: Skip[]; bouncedRecipients?: string[]; error?: string; uidState?: UidState; unchangedFolders?: string[]; firstSync?: string[]; truncated?: boolean; unparsed?: boolean; folders?: string[]; rescan?: RescanResult; cutAt?: CutAt | null }> {
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

    // Lee hasta la línea ETIQUETADA del comando ("A012 OK ..."), con tope de reloj y de tamaño.
    // `done` dice si esa línea llegó: si no (corte del servidor, tiempo agotado, socket cerrado) lo
    // leído es SÓLO UNA PARTE y quien llama no puede dar el rango por leído. Antes no se
    // comprobaba, y una respuesta cortada dejaba avanzar la marca de UID por encima de correos
    // que nunca se llegaron a leer: se perdían para siempre (auditoría 02-10-2026).
    // La etiqueta se busca sólo en la cola de la respuesta: el cuerpo de un correo puede contener
    // el texto "A012 OK" y antes eso daba el comando por terminado a mitad.
    const sendC = async (tag: string, cmd: string, maxMs = 30000): Promise<{ text: string; done: "OK" | "NO" | "BAD" | null }> => {
      await conn.write(encoder.encode(`${tag} ${cmd}\r\n`));
      let response = "";
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        let chunk: string;
        try { chunk = await read(); } catch { break; } // read timeout / socket dropped → return what we have
        if (!chunk) break; // EOF (socket closed)
        response += chunk;
        const done = imapCompleted(response.slice(-400), tag);
        if (done) return { text: response, done };
        if (response.length > 10_000_000) break; // hard safety cap (far above any real fetch window)
      }
      return { text: response, done: null };
    };
    const send = async (tag: string, cmd: string): Promise<string> => (await sendC(tag, cmd)).text;

    await read(); // Server greeting

    const loginResp = await send("A001", `LOGIN ${imapQuote(username)} ${imapQuote(password)}`);
    if (!loginResp.includes("A001 OK")) {
      conn.close();
      return { ok: false, messages: [], skips: [], bouncedRecipients: [], error: `IMAP login failed` };
    }

    // Tag generator for the variable number of IMAP commands below.
    let tagN = 1;
    const nextTag = () => "A" + String(++tagN).padStart(3, "0");

    // Discover folders so we also scan Spam/Junk — cold-email replies and warmup
    // very often land there on fresh mailboxes, and INBOX-only sync misses them.
    let spamFolder: string | null = null;
    let extraFolders: string[] = [];
    let allFolders: string[] = [];
    try {
      const listResp = await send(nextTag(), `LIST "" "*"`);
      const picked = pickFolders(listResp);
      spamFolder = picked.spam; extraFolders = picked.extra; allFolders = picked.all;
    } catch { /* LIST unsupported — fall back to INBOX only */ }

    const targets = ["INBOX", ...(spamFolder ? [spamFolder] : []), ...extraFolders];
    const messages: FetchedMessage[] = [];
    const skips: Skip[] = [];
    const bouncedRecipients = new Set<string>();
    const seenIds = new Set<string>();
    const limit = Math.max(50, Math.min(fetchLimit, 1000));
    const ctx = { accountEmail, imapUsername };

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
    const firstSync: string[] = [];
    let maxUidSeen = 0; // reset per folder; the highest UID actually parsed
    const mailboxStart = Date.now();
    const overBudget = () => Date.now() - mailboxStart > budgetMs;
    // Respuesta cortada: el socket queda descuadrado (lo que falte por llegar se mezclaría con el
    // comando siguiente), así que se deja de usar esta conexión. Lo ya leído ENTERO vale.
    let broken = false;
    let unparsed = false;
    let cutAt: CutAt | null = null;
    const rs: RescanResult | null = rescan ? { cur: { ...(rescan.cur || {}) }, checked: 0, wanted: 0, fetched: 0, done: true, folders: allFolders } : null;

    /** Un elemento de FETCH ya troceado → a `messages` o a `skips`. */
    const take = (item: FetchItem, folder: string, uidv: number, recovered = false) => {
      // Un aviso suelto del servidor ("* 7 FETCH (FLAGS (\Seen))") no trae correo: no es un mensaje.
      if (!item.header && !item.text) return;
      const parsed = parseInboundItem(item, ctx);
      for (const r of parsed.suppress) bouncedRecipients.add(r);
      if (parsed.status === "skipped") {
        // La copia de un envío nuestro no es correo entrante: no se anota (serían miles).
        if (parsed.reason !== "own_copy") skips.push({ folder, uidv, uid: parsed.uid, reason: parsed.reason, from: parsed.from, subject: parsed.subject, message_id: parsed.message_id, date: parsed.date });
        return;
      }
      const msg = parsed.msg;
      // Dedupe across folders (same message can appear in INBOX + a copy)
      if (msg.message_id && seenIds.has(msg.message_id)) return;
      if (msg.message_id) seenIds.add(msg.message_id);
      messages.push({ ...msg, folder, uidv, ...(recovered ? { recovered: true } : {}) });
    };

    for (const folder of targets) {
      if (overBudget() || broken) { if (rs) rs.done = false; break; }
      const selTag = nextTag();
      const selectResp = await send(selTag, `SELECT ${imapQuote(folder)}`);
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
      const tickUids = new Set<number>(); // lo leído en ESTA pasada (aún sin guardar): el repaso no lo vuelve a pedir

      if (totalMessages === 0) {
        if (uidValidity && uidNext) uidStateOut[folder] = { v: uidValidity, u: uidNext - 1 };
        continue;
      }
      // Fast path: nothing new since last sync → skip the FETCH altogether.
      const nothingNew = canIncremental && uidNext - 1 <= prev.u;
      if (nothingNew) {
        unchangedFolders.push(folder);
        uidStateOut[folder] = { v: uidValidity, u: prev.u };
      } else {
        // Primera vez en esta carpeta (o el servidor la reconstruyó: UIDVALIDITY nuevo): sólo se
        // traen los últimos N. Se avisa para que el buzón pida un repaso de los últimos días.
        if (!canIncremental && uidValidity && uidNext) firstSync.push(folder);
        // Una carpeta PROPIA del buzón que se mira por primera vez puede guardar correo de hace
        // meses: no se importa en bloque (entraría como recién llegado). Se empieza desde ahora y
        // lo de los últimos días lo trae el repaso, que sólo recoge lo que es nuestro y falta.
        if (!canIncremental && extraFolders.includes(folder)) {
          if (uidValidity && uidNext) uidStateOut[folder] = { v: uidValidity, u: uidNext - 1 };
        } else {
        // Incremental sync ALWAYS walks UID ranges from the last watermark UPWARD (oldest-first),
        // capped at `limit` messages per tick. A backlog bigger than the limit is then DRAINED
        // across ticks instead of skipped: the old code fell back to a sequence "last N" fetch and
        // still advanced the watermark to UIDNEXT-1, so the oldest (newCount-limit) messages were
        // lost forever (e.g. after an auth_failed pause or a cron outage). Only a first sync (no
        // prior state) uses the sequence "last N" path.
        const useUid = canIncremental;
        const start = Math.max(1, totalMessages - limit + 1);
        // BODY.PEEK keeps messages unread on the server. PARTIAL fetch `<0.262144>` caps each message
        // body at the first 256KB (a huge quoted thread could be MEGABYTES and blew the worker memory).
        // ROBUSTNESS: fetch in SMALL BATCHES (10 per command) so each IMAP response stays tiny and is
        // ALWAYS read to completion — this is what guarantees the newest mail is never truncated.
        const CHUNK = 10;
        const ranges: string[] = [];
        // Cap this tick's window to the OLDEST `limit` new UIDs so a huge backlog is drained a
        // slice per tick (never truncated-and-skipped). When the backlog fits, this equals
        // (uidNext-1) → identical to the previous behaviour.
        const uidHi = Math.min(uidNext - 1, (prev?.u || 0) + limit);
        const drainedFull = useUid && uidHi >= uidNext - 1; // reached the end of the new range this tick
        if (useUid) {
          for (let lo = prev!.u + 1; lo <= uidHi; lo += CHUNK) ranges.push(`UID FETCH ${lo}:${Math.min(lo + CHUNK - 1, uidHi)}`);
        } else {
          for (let lo = start; lo <= totalMessages; lo += CHUNK) ranges.push(`FETCH ${lo}:${Math.min(lo + CHUNK - 1, totalMessages)}`);
        }
        for (const rangeCmd of ranges) {
          if (overBudget()) { cut = true; break; }
          // `UID` and INTERNALDATE are requested explicitly; the items are split by their IMAP
          // literals, so the order in which the server returns them does not matter.
          const fr = await sendC(nextTag(), `${rangeCmd} ${INBOUND_FETCH_ITEMS}`);
          const { items, truncated } = splitFetchItems(fr.text);
          // Red de seguridad: si el servidor contestó con correos pero no se ha entendido ninguno
          // (o alguno llega sin UID), NO se da el rango por leído. Mejor un buzón parado y visible
          // que una marca que avanza por encima de correos sin leer.
          const usable = items.filter((it) => it.complete && (it.header || it.text));
          if ((usable.length === 0 && /BODY\[/i.test(fr.text)) || usable.some((it) => !it.uid)) {
            unparsed = true; cut = true;
            cutAt = cutAt || { folder, uidv: uidValidity, uid: maxUidSeen || prev?.u || 0, why: "ilegible" };
            break;
          }
          for (const item of items) {
            if (!item.complete) continue;                    // a medias: se relee en la pasada siguiente
            if (overBudget()) { cut = true; break; }         // un cuerpo patológico no puede comerse la pasada
            take(item, folder, uidValidity);
            if (item.uid) { maxUidSeen = Math.max(maxUidSeen, item.uid); tickUids.add(item.uid); }
          }
          if (fr.done !== "OK" || truncated) {
            cut = true; broken = true;
            cutAt = cutAt || { folder, uidv: uidValidity, uid: maxUidSeen || prev?.u || 0, why: "cortado" };
            break;
          }
          if (cut) break;
        }
        // Persist the folder's high-water mark. Advance ONLY to the highest UID we ACTUALLY parsed
        // whenever we did not cleanly drain the whole new range this tick — a budget cut (`cut`), a
        // capped backlog, or a truncated FETCH — so the unread tail resumes next tick instead of
        // being skipped forever. Jump straight to UIDNEXT-1 only on a fully-drained incremental tick
        // (covers trailing UIDs with no stored message, e.g. our own sent copies) or a first sync.
        if (uidValidity && uidNext) {
          let advanceTo: number;
          if (!canIncremental) {
            advanceTo = cut ? Math.max(prev?.u || 0, maxUidSeen) : (uidNext - 1);
          } else if (!cut && drainedFull) {
            advanceTo = uidNext - 1;
          } else {
            advanceTo = Math.max(prev?.u || 0, maxUidSeen);
          }
          if (advanceTo > 0) uidStateOut[folder] = { v: uidValidity, u: advanceTo };
        }
        if (cut && rs) rs.done = false;
        }
      }

      // ── Repaso de los últimos días en esta carpeta (sólo cabeceras + lo que falte) ──
      if (rescan && rs && !broken && !cut && uidValidity) {
        const mark = uidStateOut[folder]?.u || 0;       // por encima de la marca manda la pasada normal
        const sr = await sendC(nextTag(), `UID SEARCH SINCE ${imapDay(new Date(rescan.since))}`);
        if (sr.done !== "OK") { rs.done = false; broken = sr.done === null; continue; }
        const from = rs.cur[folder] || 0;
        const uids = (sr.text.match(/\* SEARCH([^\r\n]*)/)?.[1] || "").trim().split(/\s+/).filter(Boolean).map(Number)
          .filter((u) => u > from && u <= mark && !tickUids.has(u)).sort((a, b) => a - b);
        const pending = new Set(uids);
        for (let i = 0; i < uids.length; i += 200) {
          if (overBudget() || rs.fetched >= rescan.maxFetch) { rs.done = false; break; }
          const ch = uids.slice(i, i + 200);
          const hr = await sendC(nextTag(), `UID FETCH ${ch[0]}:${ch[ch.length - 1]} (UID BODY.PEEK[HEADER.FIELDS (FROM MESSAGE-ID IN-REPLY-TO REFERENCES AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND CONTENT-TYPE X-FAILED-RECIPIENTS)])`);
          const split = splitFetchItems(hr.text);
          if (hr.done !== "OK" || split.truncated) { rs.done = false; broken = true; cutAt = cutAt || { folder, uidv: uidValidity, uid: ch[0], why: "cortado" }; break; }
          const heads: RescanItem[] = [];
          for (const it of split.items) {
            if (!it.uid || !pending.has(it.uid)) continue;
            const frm = addressOf(headerValue(it.header, "From")) || addressOf(decodeMimeWords(headerValue(it.header, "From")));
            if (!frm || frm === accountEmail.toLowerCase().trim() || frm === imapUsername.toLowerCase().trim()) continue;
            const midRaw = headerValue(it.header, "Message-ID");
            const mid = (midRaw.match(/<([^<>\s]+)>/)?.[1] || midRaw.match(/([^\s<>]+@[^\s<>]+)/)?.[1] || "").trim();
            heads.push({
              uid: it.uid, mid, from: frm,
              refs: refIds(`${headerValue(it.header, "References")} ${headerValue(it.header, "In-Reply-To")}`).slice(0, 20),
              auto: !!autoSignal(it.header),
              daemon: /^(mailer-daemon|postmaster)@/.test(frm) || /multipart\/report/i.test(headerValue(it.header, "Content-Type")) || !!headerValue(it.header, "X-Failed-Recipients"),
            });
          }
          rs.checked += heads.length;
          let want: number[] = [];
          try { want = (await rescan.judge(heads)).filter((u) => pending.has(u)).sort((a, b) => a - b); }
          catch { rs.done = false; break; } // sin veredicto no se da el tramo por repasado
          rs.wanted += want.length;
          let stoppedAt = 0;
          for (let k = 0; k < want.length; k += 10) {
            if (overBudget() || rs.fetched >= rescan.maxFetch) { stoppedAt = want[k]; break; }
            const group = want.slice(k, k + 10);
            const fr = await sendC(nextTag(), `UID FETCH ${group.join(",")} ${INBOUND_FETCH_ITEMS}`);
            const got = splitFetchItems(fr.text);
            for (const item of got.items) { if (item.complete) { take(item, folder, uidValidity, true); rs.fetched++; } }
            if (fr.done !== "OK" || got.truncated) { stoppedAt = group[0]; broken = true; cutAt = cutAt || { folder, uidv: uidValidity, uid: group[0], why: "cortado" }; break; }
          }
          if (stoppedAt) { rs.cur[folder] = Math.max(from, stoppedAt - 1); rs.done = false; break; }
          rs.cur[folder] = ch[ch.length - 1];
        }
      }
    }

    if (!broken) { try { await send(nextTag(), "LOGOUT"); } catch { /* da igual */ } }
    try { conn.close(); } catch { /* ya cerrada */ }

    return { ok: true, messages, skips, bouncedRecipients: Array.from(bouncedRecipients), uidState: uidStateOut, unchangedFolders, firstSync, truncated: broken, unparsed, folders: targets, rescan: rs || undefined, cutAt };
  } catch (e) {
    return { ok: false, messages: [], skips: [], bouncedRecipients: [], error: `IMAP error: ${e.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read-only catalog probe FIRST (≈1 ms): flips every *Ready flag when the objects exist, so
    // none of the ensure* calls below touch DDL / NOTIFY pgrst on a normal tick.
    await probeInfra();
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

    // Rama cron (todas las cuentas): sólo con el secreto compartido o service_role. Antes valía
    // la clave pública anon o ninguna cabecera: cualquiera podía sincronizar un buzón ajeno por
    // su id y enumerar los correos de todos los buzones a través de la respuesta.
    const cronAuthorised = cronOrServiceAuthorised(req, body);
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

    if (targetUserId === null && !cronAuthorised) return unauthorized(corsHeaders);

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

    // Repaso de los últimos N días, pedido en la llamada (botón o servidor): { account_id, rescan_days }.
    const requestedRescanDays = Number.isFinite(Number(body.rescan_days)) && Number(body.rescan_days) > 0
      ? Math.max(1, Math.min(60, Math.floor(Number(body.rescan_days)))) : 0;

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
    // Repasos por pasada: cada uno puede gastar el presupuesto entero de su buzón, así que se
    // reparten entre pasadas en vez de frenar la sincronización normal.
    // En horario de envío (lunes a viernes, 9-18 h de Madrid) NO se hacen repasos en bloque:
    // medido el 02-10-2026, 12 por pasada bajaron el ritmo del motor de envío un 40% mientras
    // duraron (sesiones IMAP largas contra el mismo proveedor que envía), y con 2 por pasada
    // seguía notándose. Los pendientes esperan y se reanudan solos a las 18 h. El repaso de UN
    // buzón pedido a mano sí se hace en el momento.
    const madrid = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    const sendingHours = madrid.getDay() >= 1 && madrid.getDay() <= 5 && madrid.getHours() >= 9 && madrid.getHours() < 18;
    const MAX_RESCANS_PER_TICK = (sendingHours && !requestedRescanDays) ? 0 : 12;
    let rescansThisTick = 0;
    const ingest = { logged: 0, bounces: 0, recovered: 0, truncated: 0, unparsed: 0, db_failed: 0, rescans_done: 0, stored: 0, auto: 0, by_thread: 0 };
    const validIso = (d?: string | null) => { const t = Date.parse(d || ""); return Number.isFinite(t) && t > 86400_000 ? new Date(t).toISOString() : null; };

    // Process account: fetch IMAP + insert messages (relies on dedupe_hash unique constraint to skip duplicates)
    async function processAccount(account: any): Promise<number> {
      let newCount = 0;
      const t0 = Date.now();
      try {
        // Repaso pendiente de este buzón: pedido en esta llamada, a mano (imap_rescan) o tras una
        // primera sincronización. Se hace por tramos; `cur` recuerda por dónde iba cada carpeta.
        if (requestedRescanDays && ingestInfraReady && (specificAccountId || body.account_id)) {
          account.imap_rescan = { days: requestedRescanDays, requested_at: new Date().toISOString(), why: "pedido" };
        }
        const rescanReq = ingestInfraReady ? ((account.imap_rescan as Record<string, any> | null) || null) : null;
        let plan: RescanPlan | null = null;
        if (rescanReq && !rescanReq.done_at && Number(rescanReq.days) > 0 && rescansThisTick < MAX_RESCANS_PER_TICK) {
          rescansThisTick++;
          const days = Math.max(1, Math.min(60, Number(rescanReq.days)));
          plan = {
            days,
            since: validIso(rescanReq.since) || new Date(Date.now() - days * 86400_000).toISOString(),
            cur: (rescanReq.cur as Record<string, number>) || {},
            maxFetch: 80,
            judge: async (items) => {
              if (items.length === 0) return [];
              const { data, error } = await adminClient.rpc("inbox_rescan_judge", { p_user: account.user_id, p_account: account.id, p_items: items });
              if (error) throw new Error(error.message);
              return ((data || []) as { uid: number }[]).map((r) => Number(r.uid));
            },
          };
        }
        const result = await fetchImapMessages(
          account.imap_host, account.imap_port,
          account.imap_username, account.imap_password,
          account.email || account.imap_username,
          account.imap_username,
          requestedFetchLimit,
          // Incremental UID state (per folder) — only when the column is confirmed to exist.
          uidStateReady ? ((account.imap_uid_state as UidState) || null) : null,
          45_000, // per-mailbox time budget: one slow mailbox can never hog a whole wave
          plan
        );
        if (result.ok && result.unparsed) {
          ingest.unparsed++;
          errors.push(`${account.id}: respuesta IMAP que no se ha podido leer; la marca no avanza`);
        }
        if (result.ok && result.truncated) {
          ingest.truncated++;
          console.warn(`${account.id}: respuesta IMAP cortada; lo no leído se retoma en la próxima pasada`);
        }
        timings.push({
          // El correo del buzón sólo se enseña a su dueño; al cron le vale el id.
          email: targetUserId ? account.email : account.id, ms: Date.now() - t0, ok: result.ok,
          msgs: result.ok ? result.messages.length : undefined,
          unchanged: result.unchangedFolders?.length, err: result.ok ? undefined : result.error,
        });
        parsedThisTick += result.ok ? result.messages.length : 0;
        // Phase clocks for the DB post-processing (resolution queries / attachments / insert).
        const tFetch = Date.now();
        let tResolve = 0, tAtt = 0;

        if (!result.ok) {
          console.error(`IMAP fetch failed for ${account.email}:`, result.error);
          errors.push(`${targetUserId ? account.email : account.id}: ${result.error}`);
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
        // Skip the write when it would change nothing: same UID state, no mail fetched, and
        // last_sync refreshed < 3 min ago. Mailboxes are visited every ~2 min, so this halves
        // ~500 no-op UPDATEs/min (WAL + logical decoding for Realtime + autovacuum churn) while
        // last_sync still stays within a few minutes (>15 min old = a real problem, unchanged).
        const uidChanged = !!mergedUid && JSON.stringify(mergedUid) !== JSON.stringify((account.imap_uid_state as UidState) || {});
        const lastSyncAgeMs = Date.now() - (Date.parse(account.last_sync || "") || 0);
        const mustWrite = uidChanged || result.messages.length > 0 || lastSyncAgeMs > 180_000;
        // The UID high-water mark is advanced ONLY once the fetched messages are safely in the
        // DB. It used to be persisted here, BEFORE the upsert below — so if the isolate died in
        // between (wave timeout, WORKER_RESOURCE_LIMIT/546, an upsert error) the next tick started
        // past those UIDs and that mail was lost for good. With no messages there is nothing to
        // insert, so the state can be written now; otherwise it is written after the upsert.
        const deferUidWrite = !!mergedUid && (result.messages.length > 0 || (result.skips?.length || 0) > 0);
        if (mustWrite) {
          const { error: syncUpdErr } = await adminClient.from("email_accounts")
            .update(mergedUid && !deferUidWrite ? { last_sync: nowIso, imap_uid_state: mergedUid } : { last_sync: nowIso })
            .eq("id", account.id);
          if (syncUpdErr && mergedUid && !deferUidWrite) {
            await adminClient.from("email_accounts").update({ last_sync: nowIso }).eq("id", account.id);
          }
        }

        // ── Async bounce suppression ──────────────────────────────────────
        // mailer-daemon DSNs caught during this fetch → suppress the failed
        // recipient GLOBALLY (blocklist + remove from every list) so we stop
        // emailing dead mailboxes and protect the client's sending reputation.
        let bounced = result.bouncedRecipients || [];
        if (bounced.length > 0) {
          // Somebody who has WRITTEN to us demonstrably exists, whatever a DSN claims. Their
          // bounce is a delivery problem on our side (policy block, full mailbox, a bad
          // follow-up address), never a reason to suppress and bury the conversation.
          const { data: known } = await adminClient
            .from("inbox_messages").select("from_email")
            .eq("user_id", account.user_id).eq("is_warmup", false)
            .in("from_email", bounced);
          const answered = new Set((known || []).map((r: { from_email: string }) => (r.from_email || "").toLowerCase()));
          if (answered.size > 0) {
            console.log(`Not suppressing ${[...answered].join(",")}: they replied to us`);
            bounced = bounced.filter((e) => !answered.has(e.toLowerCase()));
          }
        }
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
        // ── Lo que llega al buzón y NO es una respuesta: se anota, nunca se tira en silencio ──
        const logRows: Record<string, unknown>[] = [];
        const logRow = (m: { folder: string; uidv: number; uid: number; message_id?: string; from_email?: string; subject?: string; date?: string }, extra: Record<string, unknown>) => ({
          user_id: account.user_id, account_id: account.id, folder: m.folder || "INBOX", uid_validity: m.uidv || 0, uid: m.uid || 0,
          message_id: m.message_id || null, from_email: m.from_email || null, subject: (m.subject || "").slice(0, 300) || null,
          received_at: validIso(m.date), to_email: null, kind: "human", result: "ignorado", reason: null, bounce_code: null,
          bounce_class: null, detail: null, sent_email_id: null, lead_id: null, campaign_id: null, ...extra,
        });
        for (const sk of result.skips || []) {
          logRows.push(logRow({ ...sk, from_email: sk.from }, { reason: sk.reason === "no_from" ? "sin_remitente" : sk.reason }));
        }
        // Lectura cortada o ilegible (06-10-2026): antes sólo salía en el log de la función y nadie lo
        // veía. Una fila por buzón y HORA (uid = hora; el índice único descarta las repetidas) para
        // que el monitor de salud pueda contarlas. La carpeta y la marca de UID van en el detalle.
        if ((result.truncated || result.unparsed) && result.cutAt) {
          const c = result.cutAt;
          logRows.push(logRow({ folder: "(sincronizacion)", uidv: 0, uid: Math.floor(Date.now() / 3600_000), date: nowIso }, {
            kind: "sync", result: "cortado", reason: result.unparsed ? "ilegible" : c.why,
            detail: `carpeta ${c.folder} · marca UID ${c.uid} · UIDVALIDITY ${c.uidv}`.slice(0, 300),
          }));
        }
        // Rebotes (avisos de entrega fallida): no son una respuesta, así que no van al Unibox ni
        // marcan al lead como "respondido". Se anotan con su código y su clase, y si son
        // definitivos el envío queda marcado como rebotado (antes sólo se marcaba cuando el
        // servidor rechazaba el correo en el momento; los rebotes que llegan después no contaban).
        const bounceMsgs = result.messages.filter((m) => m.kind === "bounce");
        const matchTally: Record<string, number> = {};
        for (const b of bounceMsgs) {
          const info = b.bounce!;
          const bounceAt = validIso(b.date) || new Date().toISOString();
          // Qué envío rebotó: por el Message-ID del correo devuelto (exacto) y, si el aviso no lo
          // trae, por destinatario SÓLO cuando hay un único envío anterior posible (bounce-match.ts).
          // Antes se cogía "el último a ese destinatario": un rebote tardío (IONOS avisó 2 h después)
          // se colgó de una respuesta posterior que SÍ había llegado y el dueño recibió un
          // "No entregado" falso (03-10-2026). Con dudas no se marca ni se avisa: queda anotado.
          const mid = (info.original?.message_id || "").toLowerCase();
          const mids = mid ? Array.from(new Set([mid, mid.replace(/^<|>$/g, "")])) : [];
          const recipients = info.recipients.slice(0, 5).map((r) => r.toLowerCase());
          let match: BounceMatch = { hit: null, how: "ninguno", candidates: 0 };
          if (mids.length > 0 || recipients.length > 0) {
            const t = Date.parse(bounceAt);
            const { data: cands, error: candErr } = await adminClient.rpc("bounce_candidates", {
              p_user: account.user_id, p_account: account.id, p_mids: mids, p_recipients: recipients,
              p_after: new Date(t - BOUNCE_LOOKBACK_MS).toISOString(), p_before: new Date(t + BOUNCE_CLOCK_SLACK_MS).toISOString(),
            });
            if (candErr) console.error("bounce_candidates:", candErr.message);
            match = chooseBouncedSend((cands || []) as BounceCandidate[], bounceAt, info.original);
          }
          matchTally[match.how] = (matchTally[match.how] || 0) + 1;
          const hit = match.hit;
          // Una respuesta MANUAL que el destinatario ya contestó (su correo cita ESE envío como el
          // que contesta) llegó, diga lo que diga el aviso: no se marca (06-10-2026).
          let repliedToIt = false;
          if (hit && !hit.campaign_id && info.permanent && !hit.bounced_at && hit.to_email) {
            try {
              const { data: se } = await adminClient.from("sent_emails").select("smtp_message_id").eq("id", hit.id).maybeSingle();
              const mid0 = (se as { smtp_message_id?: string | null } | null)?.smtp_message_id || "";
              if (mid0) {
                const { data: later } = await adminClient.from("inbox_messages").select("ref_chain")
                  .eq("user_id", account.user_id).gte("received_at", hit.created_at)
                  .ilike("from_email", hit.to_email).not("ref_chain", "is", null).limit(50);
                repliedToIt = repliedToSend(mid0, ((later || []) as { ref_chain: string | null }[]).map((r) => r.ref_chain));
              }
            } catch { /* sin la comprobación se decide como antes */ }
          }
          const decision = decideBounce(info, match, bounceAt, repliedToIt);
          if (hit && decision.mark) {
            // El motivo queda en error_message: el hilo del Unibox enseña "No entregado" y por qué.
            const motivo = `Rebote ${info.code || ""}: ${info.diag || "el servidor del destinatario devolvió el correo"}`.replace(/\s+/g, " ").trim().slice(0, 500);
            const { data: marked } = await adminClient.from("sent_emails")
              .update({ bounced_at: bounceAt, error_message: motivo })
              .eq("id", hit.id).is("bounced_at", null).select("id");
            // Una respuesta MANUAL (sin campaña) que rebota (06-10-2026): ya NO se avisa al móvil. Si el
            // rechazo es por la IP de salida de IONOS (Spamhaus, reputación) o pasajero, se reenvía sola
            // desde el mismo buzón (send-email guarda lo que se envió; máximo 3 envíos en total). El
            // resto (dirección que no existe, política del destinatario) queda como "No entregado" en
            // su hilo del Unibox. decision.push = respuesta manual con rebote 5.x.x casado con certeza.
            if (marked && marked.length > 0 && decision.push && bounceRetryable(info)) {
              try {
                await adminClient.from("sent_emails").update({ error_message: resentNote(motivo) }).eq("id", hit.id);
                const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
                const resend = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
                  body: JSON.stringify({ retry_of: hit.id }),
                }).then(async (r) => {
                  if (!r.ok) console.warn(`Reenvío automático ${hit.id}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
                  else console.log(`Reenvío automático de la respuesta ${hit.id} a ${hit.to_email}`);
                }).catch((e) => console.warn(`Reenvío automático ${hit.id}: ${(e as Error).message}`));
                // El envío tarda hasta ~1 min: que no frene la sincronización, pero que no se corte.
                const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
                if (rt?.waitUntil) rt.waitUntil(resend); else await resend;
              } catch { /* el rebote ya queda registrado en su hilo */ }
            }
          }
          ingest.bounces++;
          const sinEnvio = match.how === "ambiguo" ? `sin envío claro (${match.candidates} candidatos)` : "";
          // Casado con un envío pero sin marcarlo: queda el porqué (otro destinatario, ya contestó…).
          const noMarca = hit && !decision.mark && decision.why !== "ya_marcado" ? `no marcado: ${decision.why}` : "";
          logRows.push(logRow(b, {
            to_email: info.recipients.join(", ") || null, kind: "bounce", result: "registrado", reason: info.cls,
            bounce_code: info.code || null, bounce_class: info.cls,
            detail: [info.diag || "", sinEnvio, noMarca, hit ? `casado por ${match.how}` : ""].filter(Boolean).join(" · ").slice(0, 600) || null,
            sent_email_id: hit?.id || null, lead_id: hit?.lead_id || null, campaign_id: hit?.campaign_id || null,
          }));
        }
        if (bounceMsgs.length > 0) console.log(`Rebotes ${account.email}: ${JSON.stringify(matchTally)}`);
        result.messages = result.messages.filter((m) => m.kind !== "bounce");

        // Cierre del buzón en esta pasada: anotaciones, marca de UID y estado del repaso. La marca
        // sólo avanza si TODO lo leído quedó guardado o anotado; si no, se relee la próxima vez.
        let insertFailed = false;
        let recoveredNew = 0;
        const finish = async () => {
          if (logRows.length > 0 && ingestInfraReady) {
            for (let i = 0; i < logRows.length; i += 100) {
              const { error: logErr } = await adminClient.from("inbox_ingest_log")
                .upsert(logRows.slice(i, i + 100), { onConflict: "account_id,folder,uid_validity,uid,result", ignoreDuplicates: true });
              if (logErr) { insertFailed = true; errors.push(`${account.id}: registro de entrada: ${logErr.message}`); }
              else ingest.logged += Math.min(100, logRows.length - i);
            }
          }
          // Messages are in the DB → NOW advance the UID high-water mark (see deferUidWrite above).
          // On any failure before this line the state stays put and the same UIDs are re-fetched
          // next tick; the dedupe_hash upsert makes that re-read free.
          if (deferUidWrite && !insertFailed) {
            await adminClient.from("email_accounts").update({ imap_uid_state: mergedUid }).eq("id", account.id);
          }
          if (!ingestInfraReady) return;
          if (plan && result.rescan) {
            const before = rescanReq || {};
            const totals = {
              checked: (Number(before.checked) || 0) + result.rescan.checked,
              wanted: (Number(before.wanted) || 0) + result.rescan.wanted,
              fetched: (Number(before.fetched) || 0) + result.rescan.fetched,
              recovered: (Number(before.recovered) || 0) + recoveredNew,
            };
            const done = result.rescan.done && !insertFailed;
            const next = done
              ? { done_at: nowIso, days: plan.days, since: plan.since, folders: result.rescan.folders, read: result.folders, ...totals }
              : { days: plan.days, since: plan.since, cur: insertFailed ? (before.cur || {}) : result.rescan.cur, requested_at: before.requested_at || nowIso, why: before.why || null, ...totals };
            if (done) ingest.rescans_done++;
            await adminClient.from("email_accounts").update({ imap_rescan: next }).eq("id", account.id);
          } else if ((result.firstSync?.length || 0) > 0 && (!rescanReq || (rescanReq.done_at && Date.parse(rescanReq.done_at) < Date.now() - 6 * 3600_000))) {
            // Primera sincronización de una carpeta (buzón nuevo, carpeta propia o el servidor la
            // reconstruyó): sólo se trajeron los últimos mensajes. Se pide un repaso de 30 días.
            await adminClient.from("email_accounts").update({ imap_rescan: { days: 30, requested_at: nowIso, why: "primera_sincronizacion" } }).eq("id", account.id);
          }
        };

        if (result.messages.length === 0) { await finish(); return 0; }

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
          // Lo que no escribió ESTE buzón quizá lo escribió OTRO buzón del mismo usuario (el lead
          // contesta al buzón que tiene a mano): se enlaza igual, con el envío más reciente.
          const missing = fromEmails.filter((e) => !emailSent.has(e));
          if (missing.length > 0) {
            const { data: seUser } = await adminClient
              .from("sent_emails")
              .select("to_email, lead_id, campaign_id, sent_at, created_at")
              .eq("user_id", account.user_id)
              .not("campaign_id", "is", null)
              .not("lead_id", "is", null)
              .in("to_email", missing)
              .order("sent_at", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false });
            for (const r of seUser || []) {
              const k = (r.to_email || "").toLowerCase();
              if (k && !emailSent.has(k)) emailSent.set(k, { lead_id: r.lead_id, campaign_id: r.campaign_id });
            }
          }
        }
        // Warm-up: mail coming from one of OUR OWN mailboxes is warm-up network traffic (agency
        // addresses excluded so a real team@/support@ test still lands normally).
        const ownMailboxes = new Set<string>();
        if (fromEmails.length > 0) {
          const { data: ownRows } = await adminClient.from("email_accounts").select("email").in("email", fromEmails);
          for (const r of ownRows || []) {
            const e = (r.email || "").toLowerCase();
            if (e && !/^(team|support|hello|equipo)@onepulso\./.test(e)) ownMailboxes.add(e);
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
        // Un lead conocido al que alguna campaña del usuario YA escribió (aunque la dirección del
        // envío no coincida letra a letra): su respuesta es de esa campaña, no "un lead suelto".
        const leadCampaign = new Map<string, string>();
        {
          const pendingLeadIds = [...new Set([...leadsMap.entries()].filter(([e]) => !emailSent.has(e)).map(([, id]) => id))];
          if (pendingLeadIds.length > 0) {
            const { data: lc } = await adminClient
              .from("sent_emails")
              .select("lead_id, campaign_id, sent_at")
              .eq("user_id", account.user_id)
              .not("campaign_id", "is", null)
              .in("lead_id", pendingLeadIds.slice(0, 200))
              .order("sent_at", { ascending: false, nullsFirst: false });
            for (const r of lc || []) if (r.lead_id && r.campaign_id && !leadCampaign.has(r.lead_id)) leadCampaign.set(r.lead_id, r.campaign_id);
          }
        }

        // (hilo) In-Reply-To / References → el envío EXACTO al que contesta. Es el enlace más
        // fiable y no depende de quién firme la respuesta: un fuera de oficina que sale de un alias
        // o de otro dominio (escribimos a info@acme.com y contesta juan@acme-group.com) no casaba
        // con nadie, se quedaba sin lead ni campaña y a veces se marcaba como warm-up.
        const refSent = new Map<string, { lead_id: string; campaign_id: string }>();
        if (ingestInfraReady) {
          const allRefs = [...new Set(result.messages.flatMap((m) => refIds(m.ref_chain)))].slice(0, 600);
          for (let i = 0; i < allRefs.length; i += 200) {
            try {
              const { data: rr } = await adminClient.rpc("resolve_sent_by_refs", { p_user: account.user_id, p_refs: allRefs.slice(i, i + 200) });
              for (const r of (rr || []) as { ref: string; lead_id: string; campaign_id: string }[]) {
                if (r?.ref && r.lead_id && r.campaign_id) refSent.set(r.ref, { lead_id: r.lead_id, campaign_id: r.campaign_id });
              }
            } catch { /* sin esto se enlaza como antes, por remitente */ }
          }
        }
        const threadOf = (refChain: string) => {
          const ids = refIds(refChain);
          for (let i = ids.length - 1; i >= 0; i--) { const h = refSent.get(ids[i]); if (h) return h; }
          return null;
        };

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

        // Compañero de un lead escrito desde OTRO buzón del usuario: mismo dominio, cualquier buzón.
        const stillUnresolved = unresolvedDomains.filter((d) => !domainSent.has(d));
        if (stillUnresolved.length > 0) {
          try {
            const { data: rows } = await adminClient
              .rpc("resolve_sent_by_domains_user", { p_user: account.user_id, p_domains: stillUnresolved });
            for (const r of (rows || []) as { dom: string; lead_id: string; campaign_id: string }[]) {
              if (r?.dom && r.lead_id && r.campaign_id && !domainSent.has(r.dom)) domainSent.set(r.dom, { lead_id: r.lead_id, campaign_id: r.campaign_id });
            }
          } catch { /* non-fatal */ }
        }
        // Dominios (no genéricos) con algún lead del usuario: un correo de la empresa de un lead es
        // una respuesta de un compañero, nunca warm-up, aunque no se pueda atar a un envío.
        const leadDomainHit = new Set<string>();
        {
          const candidates = fromDomains.filter((d) => d && !GENERIC_DOMAINS.test(d));
          if (candidates.length > 0) {
            try {
              const { data: hits } = await adminClient.rpc("lead_domains_hit", { p_user: account.user_id, p_domains: candidates });
              for (const h of (hits || []) as { dom: string }[]) if (h?.dom) leadDomainHit.add(h.dom);
            } catch { /* non-fatal */ }
          }
        }
        // Empresa de un lead de CAMPAÑA sin envío que la ate (22-09-2026): mismo dominio aunque aún
        // no le hayamos escrito, o mismo nombre con otra terminación (acme.fr ↔ acme.com). Se ata a
        // la campaña de ese lead → sale en Campaigns y en Global y avisa si es de interés/pregunta.
        // Sólo la campaña: ningún lead pasa a "respondido" por esto. Último recurso: nunca pisa un
        // enlace exacto (envío o lead) ni el de un compañero al que sí escribimos.
        const companyCampaign = new Map<string, { id: string; created: number }>();
        {
          const candidates = [...new Set(fromDomains)]
            .filter((d) => d && !GENERIC_DOMAINS.test(d) && !domainSent.has(d))
            .slice(0, 50);
          if (candidates.length > 0) {
            try {
              const { data: rows } = await adminClient.rpc("resolve_lead_company_user", { p_user: account.user_id, p_domains: candidates });
              for (const r of (rows || []) as { dom: string; campaign_id: string; campaign_created_at: string }[]) {
                if (!r?.dom || !r.campaign_id) continue;
                const created = Date.parse(r.campaign_created_at || "");
                companyCampaign.set(r.dom, { id: r.campaign_id, created: Number.isFinite(created) ? created : 0 });
              }
            } catch { /* non-fatal: sin esto el correo entra igual (Global por empresa del lead) */ }
          }
        }

        // Remitente automático (noreply@…) que contesta a algo NUESTRO (06-10-2026): si su cadena de
        // hilo cita un Message-ID de un dominio de los buzones del usuario, es respuesta a un envío
        // nuestro (de godleads o de otro sistema) y no se tira. Dominios: el de este buzón y los de
        // los demás buzones del usuario que aparezcan citados (una consulta, sólo si hace falta).
        const ownDomains = new Set<string>([String(account.email || "").split("@")[1]?.toLowerCase().trim() || ""].filter(Boolean));
        {
          const refDoms = [...new Set(result.messages.filter((m) => m.automated_sender && m.ref_chain)
            .flatMap((m) => refIds(m.ref_chain).map((r) => (r.replace(/>$/, "").split("@")[1] || "").trim())))]
            .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !ownDomains.has(d)).slice(0, 20);
          if (refDoms.length > 0) {
            try {
              const { data: acc } = await adminClient.from("email_accounts").select("email").eq("user_id", account.user_id)
                .or(refDoms.map((d) => `email.ilike.*@${d}`).join(",")).limit(200);
              for (const r of (acc || []) as { email: string }[]) { const d = String(r.email || "").split("@")[1]?.toLowerCase(); if (d) ownDomains.add(d); }
            } catch { /* sin esto sólo cuenta el dominio de este buzón */ }
          }
        }
        const citesOwnDomain = (rc: string) => !!rc && [...ownDomains].some((d) => refersToOwnDomain(rc, `x@${d}`));

        // Enlace SÓLO por dominio (un compañero del lead): asuntos que le mandamos, para saber si su
        // correo es una respuesta ("RE: <nuestro asunto>") o un aviso cualquiera de esa empresa
        // ("Email Domain Migrated from…") que no debe dejar al lead como "respondido" (06-10-2026).
        const domLeadSubjects = new Map<string, string[]>();
        {
          const leadIds = [...new Set(result.messages.map((m) => {
            const fe = m.from_email.toLowerCase();
            const d = fe.split("@")[1] || "";
            if (emailSent.has(fe) || leadsMap.has(fe) || threadOf(m.ref_chain) || !REPLY_SUBJECT.test(m.subject || "")) return "";
            return domainSent.get(d)?.lead_id || "";
          }).filter(Boolean))].slice(0, 100);
          if (leadIds.length > 0) {
            try {
              const { data: ss } = await adminClient.from("sent_emails").select("lead_id, subject")
                .eq("user_id", account.user_id).in("lead_id", leadIds).limit(1000);
              for (const r of (ss || []) as { lead_id: string; subject: string | null }[]) {
                if (!r.lead_id || !r.subject) continue;
                const arr = domLeadSubjects.get(r.lead_id) || [];
                arr.push(r.subject);
                domLeadSubjects.set(r.lead_id, arr);
              }
            } catch { /* sin asuntos: el correo se enlaza igual, sin marcar "respondido" */ }
          }
        }
        // Correos que se guardan enlazados pero NO marcan al lead/campaña como respondido.
        const noMarkKeys = new Set<string>();

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
            const stored: { name: string; mime: string; size: number; path: string; oversized?: boolean; inline?: boolean; cid?: string }[] = [];
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
                if (!upErr) stored.push({ name: att.name, mime: att.mime, size: bytes.length, path, ...(att.inline ? { inline: true } : {}), ...(att.cid ? { cid: att.cid } : {}) });
              } catch (_e) { /* skip this attachment */ }
            }
            (msg as unknown as { _stored: unknown[] })._stored = stored;
          }
        }

        tAtt = Date.now();
        Object.assign(timings[timings.length - 1], { resolve_ms: tResolve - tFetch, att_ms: tAtt - tResolve });
        // Build batch insert payload (dedupe_hash trigger + unique constraint will reject duplicates)
        const built = result.messages.map(msg => {
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
          // El hilo dice a QUÉ envío contesta: manda para la campaña (un lead puede estar en dos) y
          // da el lead cuando quien contesta no es nadie a quien hayamos escrito con esa dirección.
          const threadHit = threadOf(msg.ref_chain);
          const domHit = (!exactSent && !exactLead && !threadHit && dom) ? (domainSent.get(dom) || null) : null;
          // La etiqueta del warm-up en el asunto ("| 36P2ARY 0396QKE"): es warm-up y NO se ata a nada.
          // Antes se ataba a la campaña por la empresa del remitente (misma marca con otra
          // terminación) y, ya "enlazado", el detector no lo miraba: salía en Primary y avisaba.
          const warmupTagged = hasWarmupSubjectTag(msg.subject);
          const leadId = warmupTagged ? null : (exactSent?.lead_id || exactLead || threadHit?.lead_id || domHit?.lead_id || null);
          const campaignId = warmupTagged ? null : (threadHit?.campaign_id || exactSent?.campaign_id || domHit?.campaign_id || (exactLead ? leadCampaign.get(exactLead) : null)
            // Una respuesta NUNCA es de una campaña creada DESPUÉS de que llegara (23-09-2026).
            || (() => {
              const hit = dom ? companyCampaign.get(dom) : null;
              if (!hit) return null;
              const when = Date.parse(parsedDate);
              return (Number.isFinite(when) && hit.created > when) ? null : hit.id;
            })() || null);
          const related = !warmupTagged && !!(threadHit || exactSent || exactLead || domHit || leadDomainHit.has(dom) || (dom && companyCampaign.has(dom)));
          // noreply@ / no-reply@ / postmaster@… que no es un rebote: un acuse automático de la
          // empresa de un lead SÍ es una respuesta (antes se tiraba). Sin relación con nada
          // nuestro (un boletín, un aviso del proveedor) no entra en el Unibox, pero se anota.
          // 06-10-2026: tampoco se tira si cita un Message-ID de nuestros dominios, si es un contestador
          // (fuera de oficina) o si el asunto es de respuesta ("Re:", "Mensaje detectado como spam"…)
          // y trae texto. Sólo el boletín / aviso sin relación sigue fuera, anotado.
          const keepAutomated = msg.kind === "auto_reply" || citesOwnDomain(msg.ref_chain)
            || (KEEP_AUTOMATED_SUBJECT.test(msg.subject || "") && (msg.body_text || "").trim().length > 0);
          if (msg.automated_sender && !related && !keepAutomated) {
            logRows.push(logRow(msg, { kind: msg.kind, reason: "remitente_automatico_sin_relacion" }));
            return null;
          }
          // Enlazado SÓLO por dominio: se ata a la campaña (y al lead, para enseñarlo) pero no lo deja
          // como "respondido" salvo que conteste a uno de nuestros asuntos (06-10-2026).
          if (domHit && !warmupTagged && !repliesToOurSubject(msg.subject, domLeadSubjects.get(domHit.lead_id))) {
            noMarkKeys.add(inboundKey(msg.message_id || null, msg.from_email, parsedDate));
          }
          const row = {
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
            // EXCEPT a reply inside a real thread (In-Reply-To / References, or tied to a lead
            // or campaign): blocking means "stop emailing them", never "erase the answer they
            // already gave us". Cold spam carries no thread headers, so it is still hidden.
            is_archived: isBlockedSender(msg.from_email) && !(msg.ref_chain || leadId || campaignId),
            // Warm-up network traffic (own mailboxes, nonsense word pairs, generic office subjects,
            // base64 blobs, uppercase codes). Flagged at sync so NO consumer — Unibox labels, AI
            // agents, digest, reports, "replied" stats — ever counts it as a prospect reply.
            // NOTE: "References points at our own domain" is NOT a link: warm-up pool threads are
            // started by our own seed mailboxes, so they reference our domain too. Only a real
            // lead/campaign link may exempt a message from the warm-up detector.
            // senderKnown: ¿sabemos algo de quien escribe? (lead exacto, envío nuestro a esa
            // dirección o a su dominio, empresa de un lead). Si NO, un asunto con forma de hilo
            // de pool ("RE: Yoga Class") es warm-up aunque no lleve palabra de oficina.
            // Una respuesta AUTOMÁTICA con su cabecera (Auto-Submitted…) de alguien relacionado con
            // lo nuestro no es warm-up: el pool de calentamiento escribe como una persona, sin esa cabecera.
            is_warmup: (msg.auto_signal && related && !ownMailboxes.has(fe)) ? false : isWarmupMessage({
              subject: msg.subject, body: msg.body_text, fromEmail: msg.from_email, ownMailboxes,
              linked: !!(leadId || campaignId) || leadDomainHit.has(dom),
              senderKnown: related,
            }),
            ...(ingestInfraReady ? { auto_signal: msg.auto_signal || null } : {}),
            // Only reference these columns when their bootstrap confirmed they
            // exist — otherwise the whole insert would fail and break the sync.
            ...(attInfraOk ? { attachments: (msg as unknown as { _stored?: unknown[] })._stored || [] } : {}),
            // ref_chain (References + In-Reply-To of the incoming mail) is ALWAYS stored — the
            // column is created by migration, so it never depends on the metrics bootstrap. This
            // is what lets replies carry the FULL thread chain in References, so they land in the
            // right conversation even when the sender keeps changing the subject.
            ref_chain: msg.ref_chain || null,
            // A quién más iba el correo: sin esto, una respuesta que suma a un compañero en el
            // "Para" parecía dirigida sólo a nuestro buzón (24-09-2026).
            to_emails: msg.to_emails || null,
            cc_emails: msg.cc_emails || null,
          };
          return { msg, row };
        });
        const pairs = built.filter((x): x is NonNullable<typeof x> => !!x);
        const rows = pairs.map((x) => x.row);
        const recoveredIds = new Map<string, FetchedMessage>();
        for (const x of pairs) if (x.msg.recovered && x.msg.message_id) recoveredIds.set(x.msg.message_id, x.msg);

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
            .select("id, lead_id, campaign_id, received_at, message_id, from_email");

          if (insertError) {
            // If batch fails (likely due to dedupe), fall back to individual inserts
            for (let k = 0; k < chunk.length; k++) {
              const row = chunk[k];
              let { data: ins, error: e } = await adminClient
                .from("inbox_messages")
                .insert(row)
                .select("id")
                .single();
              // El lead o la campaña se borraron entre la consulta y el guardado: el correo se
              // guarda igual, sin enlazar. Antes se perdía.
              if (e && e.code === "23503") {
                ({ data: ins, error: e } = await adminClient.from("inbox_messages")
                  .insert({ ...row, lead_id: null, campaign_id: null }).select("id").single());
              }
              // Un duplicado (23505) es lo normal al releer. Cualquier otro fallo se tragaba en
              // silencio y la marca de UID avanzaba igual: el correo desaparecía. Ahora un fallo
              // propio de ESA fila (dato inválido) se anota con el motivo, y un fallo general
              // (base de datos caída, tiempo agotado) frena la marca para releer en la próxima pasada.
              if (e && e.code !== "23505") {
                ingest.db_failed++;
                console.error(`${account.id}: no se pudo guardar un correo (${e.code || "?"}): ${e.message}`);
                if (/^2[23]/.test(String(e.code || ""))) {
                  logRows.push(logRow(pairs[i + k].msg, { kind: pairs[i + k].msg.kind, result: "fallo_bd", reason: String(e.code), detail: String(e.message || "").slice(0, 300) }));
                } else {
                  insertFailed = true;
                  errors.push(`${account.id}: guardar correo: ${e.message}`);
                }
              }
              if (!e && ins) {
                newCount++;
                if (row.lead_id && !(row as any).is_warmup && !noMarkKeys.has(inboundKey(row.message_id, row.from_email, row.received_at))) {
                  const esAuto = !!(row as any).auto_signal; // fuera de oficina: cuenta, pero no para la secuencia
                  if (!esAuto) await adminClient.from("leads").update({ status: "replied" }).eq("id", row.lead_id);
                  await adminClient.from("sent_emails").update({ replied_at: row.received_at })
                    .eq("lead_id", row.lead_id).eq("user_id", account.user_id).is("replied_at", null);
                  if (row.campaign_id && !esAuto) {
                    await adminClient.from("campaign_leads")
                      .update({ status: "replied" })
                      .eq("lead_id", row.lead_id).eq("campaign_id", row.campaign_id);
                  }
                }
              }
            }
          } else if (inserted) {
            newCount += inserted.length;
            // Lo que ha traído un repaso y de verdad no estaba: queda anotado como recuperado.
            for (const r of inserted) {
              const rec = (r as { message_id?: string }).message_id ? recoveredIds.get((r as { message_id: string }).message_id) : null;
              if (!rec) continue;
              recoveredNew++; ingest.recovered++;
              logRows.push(logRow(rec, { kind: rec.kind, result: "recuperado", reason: "repaso", lead_id: r.lead_id || null, campaign_id: r.campaign_id || null }));
            }
            // Mark replied for leads that produced a new message
            const warmIds = new Set(rows.filter((r: any) => r.is_warmup).map((r: any) => r.message_id).filter(Boolean));
            // Enlazado sólo por dominio y sin ser respuesta a un asunto nuestro: no marca nada (06-10-2026).
            if (noMarkKeys.size > 0) {
              for (const r of inserted as any[]) if (noMarkKeys.has(inboundKey(r.message_id, r.from_email, r.received_at))) r.lead_id = null;
            }
            // Un fuera de oficina (correo con cabecera de respuesta automática) cuenta en las
            // estadísticas de respuestas, como siempre, pero NO deja al lead como "respondido" ni
            // para su secuencia: no ha dicho ni que sí ni que no. Si el contestador da otro
            // contacto o pide la baja, lo marca después el etiquetado (push-interested).
            const autoIds = new Set(rows.filter((r: any) => r.auto_signal).map((r: any) => r.message_id).filter(Boolean));
            const repliedLeadIds = inserted.filter(r => r.lead_id && !warmIds.has((r as any).message_id)).map(r => r.lead_id);
            const humanLeadIds = inserted.filter(r => r.lead_id && !warmIds.has((r as any).message_id) && !autoIds.has((r as any).message_id)).map(r => r.lead_id);
            if (repliedLeadIds.length > 0) {
              if (humanLeadIds.length > 0) await adminClient.from("leads").update({ status: "replied" }).in("id", humanLeadIds);
              // Marca "respondido" SOLO en la campaña a la que contesta (y con la fecha real de la
              // respuesta): antes una respuesta a la campaña B subía también el contador de la A.
              for (const r of inserted) {
                if (!r.lead_id || warmIds.has((r as any).message_id)) continue;
                let q = adminClient.from("sent_emails").update({ replied_at: (r as any).received_at || new Date().toISOString() })
                  .eq("lead_id", r.lead_id).eq("user_id", account.user_id).is("replied_at", null);
                if (r.campaign_id) q = q.eq("campaign_id", r.campaign_id);
                await q;
              }
              const campaignPairs = inserted.filter(r => r.lead_id && r.campaign_id && !warmIds.has((r as any).message_id) && !autoIds.has((r as any).message_id));
              for (const cp of campaignPairs) {
                await adminClient.from("campaign_leads")
                  .update({ status: "replied" })
                  .eq("lead_id", cp.lead_id).eq("campaign_id", cp.campaign_id);
              }
            }
          }
        }
        // Rebote desmentido (06-10-2026): una respuesta MANUAL quedó como "No entregado" y ahora el
        // destinatario contesta a ESE correo (su In-Reply-To es nuestro Message-ID): llegó. Se quita
        // la marca y el motivo queda como "Rebote descartado: respondió · …". Por el Message-ID del
        // correo al que contesta (índice lower(smtp_message_id)); sin esa función, por este buzón.
        try {
          const replies = pairs.filter((p) => !(p.row as { is_warmup?: boolean }).is_warmup && parentRef(p.msg.ref_chain));
          if (replies.length > 0) {
            const parents = [...new Set(replies.map((p) => parentRef(p.msg.ref_chain)))].slice(0, 200);
            let sends: BouncedSend[] = [];
            const { data: viaRpc, error: rpcErr } = await adminClient.rpc("bounced_sends_by_refs", { p_user: account.user_id, p_refs: parents });
            if (!rpcErr) sends = (viaRpc || []) as BouncedSend[];
            else {
              const froms = [...new Set(replies.map((p) => p.msg.from_email.toLowerCase()))].slice(0, 100);
              const { data: viaAcct } = await adminClient.from("sent_emails")
                .select("id, to_email, smtp_message_id, bounced_at, campaign_id, error_message, created_at")
                .eq("account_id", account.id).in("to_email", froms).is("campaign_id", null).not("bounced_at", "is", null)
                .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()).limit(200);
              sends = (viaAcct || []) as BouncedSend[];
            }
            for (const s of sends) {
              for (const p of replies) {
                const motivo = bounceDismissal(s, { from_email: p.msg.from_email, ref_chain: p.msg.ref_chain, received_at: (p.row as { received_at: string }).received_at });
                if (!motivo) continue;
                const { data: cleared } = await adminClient.from("sent_emails").update({ bounced_at: null, error_message: motivo })
                  .eq("id", s.id).not("bounced_at", "is", null).select("id");
                if (cleared && cleared.length > 0) console.log(`Rebote descartado ${s.id}: el destinatario contestó a ese correo`);
                break;
              }
            }
          }
        } catch (e) { console.error("rebote descartado:", (e as Error).message); }
        await finish();
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
      // Auditoría de entrada: anotaciones escritas, rebotes, recuperados por repaso, respuestas
      // IMAP cortadas, fallos al guardar y repasos terminados en esta pasada.
      ingest,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("fetch-inbox error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
