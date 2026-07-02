import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ImapMessage {
  from_email: string;
  from_name: string;
  subject: string;
  body_text: string;
  body_html: string;
  message_id: string;
  date: string;
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

async function fetchImapMessages(
  host: string, port: number, username: string, password: string, accountEmail: string, imapUsername: string, fetchLimit = 50
): Promise<{ ok: boolean; messages: ImapMessage[]; error?: string }> {
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

    if (port === 993) {
      conn = await withTimeout(Deno.connectTls({ hostname: host, port }), 12000, "connect");
    } else {
      conn = await withTimeout(Deno.connect({ hostname: host, port }), 12000, "connect");
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
      let attempts = 0;
      while (attempts < 120) {
        const chunk = await read();
        response += chunk;
        if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) break;
        attempts++;
      }
      return response;
    };

    await read(); // Server greeting

    const loginResp = await send("A001", `LOGIN "${username}" "${password}"`);
    if (!loginResp.includes("A001 OK")) {
      conn.close();
      return { ok: false, messages: [], error: `IMAP login failed` };
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
    const seenIds = new Set<string>();
    const limit = Math.max(50, Math.min(fetchLimit, 1000));

    for (const folder of targets) {
      const selTag = nextTag();
      const selectResp = await send(selTag, `SELECT "${folder}"`);
      if (!selectResp.includes(`${selTag} OK`)) continue; // folder missing / not selectable
      const existsMatch = selectResp.match(/\* (\d+) EXISTS/);
      const totalMessages = existsMatch ? parseInt(existsMatch[1]) : 0;
      if (totalMessages === 0) continue;

      const start = Math.max(1, totalMessages - limit + 1);
      // BODY.PEEK keeps messages unread on the server.
      const fetchResp = await send(nextTag(), `FETCH ${start}:${totalMessages} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] BODY.PEEK[TEXT])`);

      const parts = fetchResp.split(/\* \d+ FETCH/);
      for (const part of parts) {
        if (!part.trim()) continue;

        const fromMatch = part.match(/From:\s*(.+?)(?:\r?\n)/i);
        const subjectMatch = part.match(/Subject:\s*(.+?)(?:\r?\n)/i);
        const dateMatch = part.match(/Date:\s*(.+?)(?:\r?\n)/i);
        const msgIdMatch = part.match(/Message-ID:\s*<?(.+?)>?(?:\r?\n)/i);

        let fromEmail = "";
        let fromName = "";
        if (fromMatch) {
          const fromStr = fromMatch[1].trim();
          const emailMatch = fromStr.match(/<(.+?)>/);
          fromEmail = emailMatch ? emailMatch[1] : fromStr;
          const nameMatch = fromStr.match(/^"?([^"<]+)"?\s*</);
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
        let rawBody = bodyParts.length > 1 ? bodyParts.slice(1).join("\n") : "";
        rawBody = rawBody
          .replace(/(\r?\n)?[A-Za-z0-9]{1,8} (OK|NO|BAD)[^\n]*\s*$/, "")
          .replace(/(\r?\n)?\)\s*$/, "")
          .trim();

        if (fromEmail) {
          const decodedSubject = decodeMimeWords(subjectMatch ? subjectMatch[1].trim() : "");
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
          });
        }
      }
    }

    await send(nextTag(), "LOGOUT");
    conn.close();

    return { ok: true, messages };
  } catch (e) {
    return { ok: false, messages: [], error: `IMAP error: ${e.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
    const requestedBatchSize = Number.isFinite(Number(body.batch_size)) ? Math.max(1, Math.min(150, Number(body.batch_size))) : (targetUserId ? 30 : 10);
    // Cron default raised 50→120: if a mailbox was disconnected for a while and
    // reconnects with a backlog, a bigger window drains more of it per pass so real
    // replies below the old cutoff aren't stranded forever.
    const requestedFetchLimit = Number.isFinite(Number(body.fetch_limit)) ? Math.max(50, Math.min(1000, Number(body.fetch_limit))) : (targetUserId ? 120 : 120);

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
            .eq("status", "connected")
            .order("id", { ascending: true })
            .range(requestedOffset, requestedOffset + requestedBatchSize - 1),
          adminClient
            .from("email_accounts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", targetUserId)
            .eq("status", "connected"),
        ]);
        accounts = data || [];
        totalAccounts = count || 0;
      }
    } else {
      // Cron path: count first, then process a small window starting at the given
      // offset (0 for the cron tick). After finishing, this invocation chains to the
      // NEXT window (see "self-chaining" below) so ALL accounts get synced every tick
      // without any single call exceeding the edge worker's compute budget.
      const { count } = await adminClient
        .from("email_accounts")
        .select("id", { count: "exact", head: true })
        .eq("status", "connected");
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
        const windows = Math.max(1, Math.ceil(totalAccounts / requestedBatchSize));
        const minuteIndex = Math.floor(Date.now() / 60000);
        usedOffset = (minuteIndex % windows) * requestedBatchSize;
      }
      const { data } = await adminClient
        .from("email_accounts")
        .select("*")
        .eq("status", "connected")
        .order("id", { ascending: true })
        .range(usedOffset, usedOffset + requestedBatchSize - 1);
      accounts = data || [];
    }

    let totalNew = 0;
    const errors: string[] = [];

    // Process account: fetch IMAP + insert messages (relies on dedupe_hash unique constraint to skip duplicates)
    async function processAccount(account: any): Promise<number> {
      let newCount = 0;
      try {
        const result = await fetchImapMessages(
          account.imap_host, account.imap_port,
          account.imap_username, account.imap_password,
          account.email || account.imap_username,
          account.imap_username,
          requestedFetchLimit
        );

        if (!result.ok) {
          console.error(`IMAP fetch failed for ${account.email}:`, result.error);
          errors.push(`${account.email}: ${result.error}`);
          return 0;
        }

        console.log(`Fetched ${result.messages.length} messages from ${account.email}`);

        // Record that this mailbox was checked — makes sync health visible
        // (last_sync was previously never written, so coverage bugs were invisible).
        await adminClient.from("email_accounts")
          .update({ last_sync: new Date().toISOString() })
          .eq("id", account.id);

        // STORE EVERY LANGUAGE. The old server-side ES/CA filter dropped real
        // replies before they ever reached the DB (e.g. a Spanish "buenas que tal"
        // quoting the English/Italian original counted as foreign → discarded).
        // Language/warm-up hiding is now done in the frontend (code detector),
        // where it is reversible — never destructive here.
        if (result.messages.length === 0) return 0;

        // Batch lead lookup: get all unique from_emails at once
        const fromEmails = [...new Set(result.messages.map(m => m.from_email.toLowerCase()))];
        let leadsMap = new Map<string, string>();
        if (fromEmails.length > 0) {
          const { data: leads } = await adminClient
            .from("leads")
            .select("id, email")
            .eq("user_id", account.user_id)
            .in("email", fromEmails);
          for (const l of leads || []) leadsMap.set(l.email.toLowerCase(), l.id);
        }

        // Batch campaign lookup. Prefer the campaign where this exact inbox account
        // is the assigned sender; otherwise fall back to the latest sent email from
        // this same account. This prevents replies from being attached to another
        // campaign when the same lead exists in multiple campaigns.
        const leadIds = [...leadsMap.values()];
        const campaignsMap = new Map<string, string>();
        if (leadIds.length > 0) {
          const { data: assignedCampaigns } = await adminClient
            .from("campaign_leads")
            .select("lead_id, campaign_id, assigned_account_id")
            .in("lead_id", leadIds)
            .eq("assigned_account_id", account.id);
          for (const c of assignedCampaigns || []) {
            if (!campaignsMap.has(c.lead_id)) campaignsMap.set(c.lead_id, c.campaign_id);
          }

          const unresolvedLeadIds = leadIds.filter((id) => !campaignsMap.has(id));
          if (unresolvedLeadIds.length > 0) {
            const { data: sentCampaigns } = await adminClient
              .from("sent_emails")
              .select("lead_id, campaign_id, sent_at, created_at")
              .in("lead_id", unresolvedLeadIds)
              .eq("account_id", account.id)
              .not("campaign_id", "is", null)
              .order("sent_at", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false });
            for (const c of sentCampaigns || []) {
              if (c.lead_id && c.campaign_id && !campaignsMap.has(c.lead_id)) campaignsMap.set(c.lead_id, c.campaign_id);
            }
          }
        }

        // Build batch insert payload (dedupe_hash trigger + unique constraint will reject duplicates)
        const rows = result.messages.map(msg => {
          let parsedDate: string;
          try { parsedDate = new Date(msg.date).toISOString(); } catch { parsedDate = new Date().toISOString(); }
          const leadId = leadsMap.get(msg.from_email.toLowerCase()) || null;
          const campaignId = leadId ? (campaignsMap.get(leadId) || null) : null;
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
          };
        });

        // Insert one by one but only counts errors as duplicates - upsert with ignore via insert
        // Use chunks of 50 for batch insert
        const chunkSize = 50;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const { data: inserted, error: insertError } = await adminClient
            .from("inbox_messages")
            .insert(chunk)
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
    for (let i = 0; i < accounts.length; i += CONCURRENCY) {
      const batch = accounts.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(a => processAccount(a)));
      totalNew += results.reduce((a, b) => a + b, 0);
    }

    const nextOffset = specificAccountId ? null : usedOffset + accounts.length;
    const hasMore = specificAccountId ? false : (nextOffset as number) < totalAccounts;

    console.log(`fetch-inbox complete: ${accounts.length}/${totalAccounts} accounts (offset ${usedOffset}), ${totalNew} new messages, next=${nextOffset}`);

    // NOTE: the old cron self-chaining was removed. It silently died on the first
    // failed link and, because the cron always restarted at offset 0, accounts past
    // the break NEVER synced. Coverage is now guaranteed by the minute-based
    // rotating window above — every connected account is checked every
    // ~⌈total/batch⌉ minutes without any chain that can break.

    return new Response(JSON.stringify({
      success: true,
      accounts_checked: accounts.length,
      accounts_total: totalAccounts,
      new_messages: totalNew,
      next_offset: hasMore ? nextOffset : null,
      has_more: hasMore,
      errors: errors.length > 0 ? errors : undefined,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("fetch-inbox error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
