import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function replaceVariables(text: string, fields: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key] || `{{${key}}}`);
}

function textToHtml(text: string): string {
  if (/<(p|div|br)\b/i.test(text)) return text;
  return text
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function randomString(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";
  for (let i = 0; i < length; i++) output += alphabet[Math.floor(Math.random() * alphabet.length)];
  return output;
}

// Unsubscribe token (HMAC-signed, same scheme as process-campaign-queue / unsubscribe fn).
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

// Quoted-Printable encoder (RFC 2045) — used by Gmail/Outlook/Apple Mail.
// Universal compatibility, less spam-flagging than 8bit.
function quotedPrintableEncode(input: string): string {
  const bytes = new TextEncoder().encode(input.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  let out = "";
  let lineLen = 0;
  const flush = (chunk: string) => {
    if (lineLen + chunk.length > 75) { out += "=\r\n"; lineLen = 0; }
    out += chunk; lineLen += chunk.length;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a) { out += "\r\n"; lineLen = 0; continue; }
    if (b === 0x09 || (b >= 0x20 && b <= 0x7e && b !== 0x3d)) {
      flush(String.fromCharCode(b));
    } else {
      flush("=" + b.toString(16).toUpperCase().padStart(2, "0"));
    }
  }
  return out.replace(/[ \t]+(\r\n|$)/g, (m) => {
    const ws = m.replace(/\r\n$/, "");
    const enc = Array.from(ws).map((c) => "=" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("");
    return enc + (m.endsWith("\r\n") ? "\r\n" : "");
  });
}


function formatSmtpDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function normalizeSmtpEndpoint(host: string, port: number): { host: string; port: number } {
  const normalizedHost = host.trim().toLowerCase();
  if (/(^|\.)smtp\.gmail\.com$|(^|\.)gmail\.com$|googlemail/.test(normalizedHost)) return { host: "smtp.gmail.com", port: port === 465 ? 465 : 587 };
  if (/office365|outlook|hotmail|live\.com|microsoft/.test(normalizedHost)) return { host: "smtp.office365.com", port: 587 };
  return { host: host.trim(), port };
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

function sanitizeHtmlForDelivery(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|video|audio|canvas)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(img|picture|source)[^>]*>/gi, "")
    .replace(/\s(?:class|id|style|data-[\w-]+|width|height|role|dir)=("[^"]*"|'[^']*')/gi, "")
    .replace(/<a[^>]*href=("[^"]*"|'[^']*')[^>]*>([\s\S]*?)<\/a>/gi, "<a href=$1>$2</a>")
    .replace(/<(\/?)div\b/gi, "<$1p")
    .trim();
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_m, href, text) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      return label ? `${label} (${href})` : href;
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

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
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
  return /[^\x20-\x7E]/.test(normalized) ? `=?UTF-8?B?${toBase64Utf8(normalized)}?=` : normalized;
}

function formatMailbox(name: string | undefined, email: string): string {
  if (!name?.trim()) return email;
  const normalized = name.replace(/\r?\n/g, " ").trim();
  return `${/[^0-\x7E]/.test(normalized) ? encodeMimeHeader(normalized) : `"${normalized.replace(/(["\\])/g, "\\$1")}"`} <${email}>`;
}

function generateMessageId(domain: string): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${(now.getUTCMonth() + 1).toString().padStart(2, "0")}${now.getUTCDate().toString().padStart(2, "0")}.${now.getUTCHours().toString().padStart(2, "0")}${now.getUTCMinutes().toString().padStart(2, "0")}${now.getUTCSeconds().toString().padStart(2, "0")}`;
  return `<${stamp}.${randomString(10)}.${randomString(6)}@${domain}>`;
}

function campaignMessageId(campaignId: string, leadId: string, stepIndex: number, domain: string): string {
  const raw = `${campaignId}:${leadId}:${stepIndex}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `<camp.${hex}.s${stepIndex}@${domain}>`;
}

// Dot-stuff message content per RFC 5321 §4.5.2
function dotStuff(content: string): string {
  return content.replace(/\r\n\./g, '\r\n..');
}

async function sendSmtpEmail(
  host: string,
  port: number,
  username: string,
  password: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  opts?: { inReplyTo?: string; references?: string; fromName?: string; messageId?: string }
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  try {
    const endpoint = normalizeSmtpEndpoint(host, port);
    let conn: Deno.Conn;

    if (endpoint.port === 465) {
      conn = await Deno.connectTls({ hostname: endpoint.host, port: endpoint.port });
    } else {
      conn = await Deno.connect({ hostname: endpoint.host, port: endpoint.port });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Read a complete SMTP response, handling multi-line responses
    const readResponse = async (): Promise<string> => {
      let result = '';
      while (true) {
        const buf = new Uint8Array(4096);
        const n = await conn.read(buf);
        if (!n) break;
        result += decoder.decode(buf.subarray(0, n));
        // SMTP multi-line responses use "NNN-" continuation; final line is "NNN "
        const lines = result.split('\r\n').filter(l => l.length > 0);
        if (lines.length === 0) continue;
        const last = lines[lines.length - 1];
        if (/^\d{3}[ ]/.test(last) || /^\d{3}$/.test(last)) break;
      }
      return result;
    };

    const send = async (cmd: string) => {
      await conn.write(encoder.encode(cmd + "\r\n"));
      return await readResponse();
    };

    const writeRaw = async (data: string) => {
      // Write all data
      const encoded = encoder.encode(data);
      let written = 0;
      while (written < encoded.length) {
        const n = await conn.write(encoded.subarray(written));
        written += n;
      }
      return await readResponse();
    };

    await readResponse(); // greeting

    const fromDomain = from.split("@")[1] || "localhost";
    const fromHeader = formatMailbox(opts?.fromName, from);
    const messageId = opts?.messageId || generateMessageId(fromDomain);

    const buildMessage = () => {
      const normalizedHtml = sanitizeHtmlForDelivery(body);
      const plainText = removeUrlsAndTracking(htmlToPlainText(normalizedHtml));
      // Human-style boundary, not bot fingerprint
      const boundary = `--==_mimepart_${randomString(16)}_${randomString(12)}`;
      const isReply = !!opts?.inReplyTo;

      const headers = [
        `MIME-Version: 1.0`,
        `Date: ${formatSmtpDate(new Date())}`,
        `Message-ID: ${messageId}`,
        `Subject: ${encodeMimeHeader(subject)}`,
        `From: ${fromHeader}`,
        `To: ${to}`,
        `Reply-To: <${from}>`,
      ];

      if (opts?.inReplyTo) {
        const refId = opts.inReplyTo.includes("<") ? opts.inReplyTo : `<${opts.inReplyTo}>`;
        headers.push(`In-Reply-To: ${refId}`);

        const refs = opts.references
          ? opts.references
              .split(/\s+/)
              .filter(Boolean)
              .map((id) => (id.includes("<") ? id : `<${id}>`))
              .join(" ")
          : refId;
        headers.push(`References: ${refs}`);
      }

      // Unsubscribe: when the campaign enabled opt-out, use the REAL one-click URL
      // (handled by the /unsubscribe function). Otherwise keep the mailto fallback.
      const unsubUrl = opts?.unsubscribeUrl;
      if (unsubUrl) {
        headers.push(`List-Unsubscribe: <${unsubUrl}>`);
        headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
      } else if (!isReply) {
        const unsubAddr = `unsubscribe+${randomString(20)}@${fromDomain}`;
        headers.push(`List-Unsubscribe: <mailto:${from}?subject=unsubscribe>, <mailto:${unsubAddr}>`);
        headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
      }
      headers.push(`Auto-Submitted: no`);

      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

      // Visible opt-out link at the bottom (added after URL stripping so it survives).
      const plainTextFinal = unsubUrl
        ? `${plainText}\n\nSi no deseas recibir más correos, date de baja aquí: ${unsubUrl}`
        : plainText;
      const htmlFinal = unsubUrl
        ? `${normalizedHtml}<p style="font-size:12px;color:#888;margin-top:16px">Si no deseas recibir más correos, <a href="${unsubUrl}">date de baja aquí</a>.</p>`
        : normalizedHtml;

      const qpText = quotedPrintableEncode(normalizeMimeText(plainTextFinal));
      const qpHtml = quotedPrintableEncode(normalizeMimeText(htmlFinal));

      const msgLines = [
        headers.join("\r\n"),
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        qpText,
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        qpHtml,
        `--${boundary}--`,
      ];
      // Dot-stuff content, then append DATA terminator
      const content = msgLines.join("\r\n");
      return dotStuff(content) + "\r\n.\r\n";
    };

    if (endpoint.port !== 465) {
      const resp = await send(`EHLO ${fromDomain}`);
      if (!/STARTTLS/i.test(resp)) {
        try { await send("QUIT"); } catch {}
        try { conn.close(); } catch {}
        return { ok: false, error: `Server does not advertise STARTTLS: ${resp}` };
      }
        await conn.write(encoder.encode("STARTTLS\r\n"));
        const startTlsResp = await readResponse();
        if (!startTlsResp.startsWith("220")) {
          try { conn.close(); } catch {}
          return { ok: false, error: `STARTTLS failed: ${startTlsResp}` };
        }
        conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: endpoint.host });

        // Recreate helpers for TLS connection
        const readTls = async (): Promise<string> => {
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

        const sendTls = async (cmd: string) => {
          await conn.write(encoder.encode(cmd + "\r\n"));
          return await readTls();
        };

        const writeRawTls = async (data: string) => {
          const encoded = encoder.encode(data);
          let written = 0;
          while (written < encoded.length) {
            const n = await conn.write(encoded.subarray(written));
            written += n;
          }
          return await readTls();
        };

        const tlsEhloResp = await sendTls(`EHLO ${fromDomain}`);
        if (!tlsEhloResp.startsWith("250")) return { ok: false, error: `EHLO after STARTTLS failed: ${tlsEhloResp}` };
        const creds = btoa(`\0${username}\0${password}`);
        const authResp = await sendTls(`AUTH PLAIN ${creds}`);
        if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

        await sendTls(`MAIL FROM:<${from}>`);
        await sendTls(`RCPT TO:<${to}>`);
        await sendTls("DATA");
        const dataResp = await writeRawTls(buildMessage());
        const sent = dataResp.includes("250");
        try { await sendTls("QUIT"); } catch {}
        try { conn.close(); } catch {}
        return sent ? { ok: true, messageId } : { ok: false, error: `Send failed: ${dataResp}`, messageId };
    }

    await send(`EHLO ${from.split("@")[1] || "localhost"}`);
    const creds = btoa(`\0${username}\0${password}`);
    const authResp = await send(`AUTH PLAIN ${creds}`);
    if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

    await send(`MAIL FROM:<${from}>`);
    await send(`RCPT TO:<${to}>`);
    await send("DATA");
    const dataResp = await writeRaw(buildMessage());
    const sent = dataResp.includes("250");
    try { await send("QUIT"); } catch {}
    try { conn.close(); } catch {}
    return sent ? { ok: true, messageId } : { ok: false, error: `Send failed: ${dataResp}`, messageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `SMTP error: ${message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = user.id;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      campaign_id,
      campaign_step_id,
      account_id,
      to_email,
      subject,
      body,
      lead_id,
      custom_fields,
      is_test,
      in_reply_to,
      references,
      include_unsubscribe,
    } = await req.json();

    let resolvedAccountId = account_id as string;
    let resolvedInReplyTo = in_reply_to as string | undefined;
    let resolvedReferences = references as string | undefined;
    let resolvedMessageId: string | undefined;
    let forcedThreadSubject: string | null = null;

    if (campaign_id && lead_id && campaign_step_id) {
      const { data: campaignSteps } = await adminClient
        .from("campaign_steps")
        .select("id")
        .eq("campaign_id", campaign_id)
        .order("step_order", { ascending: true });

      const currentStepIndex = campaignSteps?.findIndex((step) => step.id === campaign_step_id) ?? -1;

      if (currentStepIndex > 0) {
        const { data: previousSent } = await adminClient
          .from("sent_emails")
          .select("account_id, smtp_message_id, subject")
          .eq("campaign_id", campaign_id)
          .eq("lead_id", lead_id)
          .eq("status", "sent")
          .order("sent_at", { ascending: true });

        if (previousSent?.length) {
          resolvedAccountId = previousSent[0].account_id || resolvedAccountId;

          if (!resolvedInReplyTo) {
            const lastSentWithMessageId = [...previousSent].reverse().find((sent: any) => sent.smtp_message_id);
            if (lastSentWithMessageId?.smtp_message_id) {
              resolvedInReplyTo = lastSentWithMessageId.smtp_message_id;
            }
          }

          if (!resolvedReferences) {
            const refs = previousSent
              .map((sent: any) => sent.smtp_message_id)
              .filter(Boolean);
            if (refs.length) {
              resolvedReferences = refs.join(" ");
            }
          }

          const firstSubject = previousSent[0].subject || subject || "";
          const baseSubject = firstSubject.replace(/^(Re:\s*)+/i, "").trim();
          forcedThreadSubject = baseSubject ? `Re: ${baseSubject}` : subject;
        }
      }
    }

    const { data: account, error: accError } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", resolvedAccountId)
      .eq("user_id", userId)
      .single();

    if (accError || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (account.sent_today >= account.daily_limit) {
      return new Response(JSON.stringify({ error: "Daily sending limit reached for this account" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fields = custom_fields || {};
    let finalSubject = replaceVariables(subject, fields);
    if (forcedThreadSubject) {
      finalSubject = replaceVariables(forcedThreadSubject, fields);
    }
    const finalBody = textToHtml(replaceVariables(body, fields).trim());
    const senderName = [account.first_name, account.last_name].filter(Boolean).join(" ") || undefined;

    if (campaign_id && lead_id && campaign_step_id) {
      const fromDomain = account.email.split("@")[1] || "localhost";
      resolvedMessageId = generateMessageId(fromDomain);
    }

    // When the caller (campaign send / test) explicitly enables opt-out, always add it
    // (even on threaded follow-ups). Unibox replies simply don't pass the flag.
    let unsubscribeUrl: string | undefined;
    if (include_unsubscribe) {
      const token = await makeUnsubToken(userId, to_email, Deno.env.get("UNSUB_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      unsubscribeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/unsubscribe?t=${token}`;
    }

    const result = await sendSmtpEmail(
      account.smtp_host,
      account.smtp_port,
      account.smtp_username,
      account.smtp_password,
      account.email,
      to_email,
      finalSubject,
      finalBody,
      {
        inReplyTo: resolvedInReplyTo,
        references: resolvedReferences,
        fromName: senderName,
        messageId: resolvedMessageId,
        unsubscribeUrl,
      }
    );

    if (!is_test) {
      await adminClient.from("sent_emails").insert({
        user_id: userId,
        campaign_id: campaign_id || null,
        campaign_step_id: campaign_step_id || null,
        account_id: resolvedAccountId,
        lead_id: lead_id || null,
        to_email,
        subject: finalSubject,
        body: finalBody,
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date().toISOString() : null,
        error_message: result.error || null,
        smtp_message_id: result.messageId || resolvedMessageId || null,
      });

      if (result.ok) {
        await adminClient.from("email_accounts").update({
          sent_today: account.sent_today + 1,
        }).eq("id", resolvedAccountId);
      }
    }

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, message: "Email sent successfully", messageId: result.messageId || resolvedMessageId || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("send-email error:", e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
