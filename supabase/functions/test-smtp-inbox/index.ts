// Test end-to-end SMTP send to team@onepulso.online using a REAL campaign step
// Usage: POST { account_id?: string, campaign_id?: string, step_order?: number }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET = "team@onepulso.online";

function randomString(length: number): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < length; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function formatSmtpDate(d: Date): string {
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function dotStuff(content: string): string {
  return content.replace(/\r\n\./g, "\r\n..");
}

function quotedPrintableEncode(input: string): string {
  const bytes = new TextEncoder().encode(input.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  let out = "";
  let lineLen = 0;
  const flush = (chunk: string) => {
    if (lineLen + chunk.length > 75) {
      out += "=\r\n";
      lineLen = 0;
    }
    out += chunk;
    lineLen += chunk.length;
  };
  for (const b of bytes) {
    if (b === 0x0a) { out += "\r\n"; lineLen = 0; continue; }
    if (b === 0x09 || (b >= 0x20 && b <= 0x7e && b !== 0x3d)) flush(String.fromCharCode(b));
    else flush("=" + b.toString(16).toUpperCase().padStart(2, "0"));
  }
  return out.replace(/[ \t]+(\r\n|$)/g, (m) => {
    const ws = m.replace(/\r\n$/, "");
    const enc = Array.from(ws).map((c) => "=" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("");
    return enc + (m.endsWith("\r\n") ? "\r\n" : "");
  });
}

function renderVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => vars[k.toLowerCase()] ?? vars[k] ?? "");
}

function textToHtml(body: string): string {
  // Preserve <b> tags, escape rest, convert newlines to <br>
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;b&gt;/g, "<b>")
    .replace(/&lt;\/b&gt;/g, "</b>");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5;white-space:pre-wrap">${escaped}</div>`;
}

function htmlToPlain(body: string): string {
  return body.replace(/<\/?b>/gi, "").replace(/<br\s*\/?>(?!\n)/gi, "\n").replace(/<[^>]+>/g, "");
}

async function sendRawSmtp(
  host: string, port: number, username: string, password: string,
  from: string, fromName: string, to: string, subject: string,
  textBody: string, htmlBody: string,
): Promise<{ ok: boolean; transcript: string[]; error?: string; messageId?: string }> {
  const transcript: string[] = [];
  const log = (s: string) => { transcript.push(s.slice(0, 500)); };
  try {
    const fromDomain = from.split("@")[1];
    const msgId = `<${Date.now()}.${randomString(10)}@${fromDomain}>`;
    const dateHeader = formatSmtpDate(new Date());

    const subjectEncoded = /[^\x20-\x7E]/.test(subject) ? `=?UTF-8?B?${toBase64Utf8(subject)}?=` : subject;
    const fromHeader = fromName ? `"${fromName}" <${from}>` : from;

    const headers = [
      `MIME-Version: 1.0`,
      `Date: ${dateHeader}`,
      `Message-ID: ${msgId}`,
      `Subject: ${subjectEncoded}`,
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: quoted-printable`,
    ];

    const message = dotStuff(headers.join("\r\n") + "\r\n\r\n" + quotedPrintableEncode(textBody)) + "\r\n.\r\n";

    let conn: Deno.Conn;
    if (port === 465) {
      conn = await Deno.connectTls({ hostname: host, port });
    } else {
      conn = await Deno.connect({ hostname: host, port });
    }
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const readResp = async (): Promise<string> => {
      let r = "";
      while (true) {
        const buf = new Uint8Array(4096);
        const n = await conn.read(buf);
        if (!n) break;
        r += dec.decode(buf.subarray(0, n));
        const lines = r.split("\r\n").filter(l => l.length > 0);
        if (lines.length === 0) continue;
        const last = lines[lines.length - 1];
        if (/^\d{3}[ ]/.test(last) || /^\d{3}$/.test(last)) break;
      }
      return r;
    };
    const send = async (cmd: string, display = cmd): Promise<string> => {
      log(`> ${display}`);
      await conn.write(enc.encode(cmd + "\r\n"));
      const r = await readResp();
      log(`< ${r.trim()}`);
      return r;
    };

    log(`< ${(await readResp()).trim()}`);
    await send(`EHLO ${host}`);
    if (port !== 465) {
      const tls = await send("STARTTLS");
      if (!tls.startsWith("220")) return { ok: false, transcript, error: `STARTTLS: ${tls}` };
      conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
      await send(`EHLO ${host}`);
    }
    const authStart = await send("AUTH LOGIN");
    if (!authStart.startsWith("334")) return { ok: false, transcript, error: `AUTH LOGIN: ${authStart}` };
    const authUser = await send(toBase64Utf8(username), "[username hidden]");
    if (!authUser.startsWith("334")) return { ok: false, transcript, error: `AUTH USER: ${authUser}` };
    const auth = await send(toBase64Utf8(password), "[password hidden]");
    if (!auth.startsWith("235")) return { ok: false, transcript, error: `AUTH: ${auth}` };
    const mf = await send(`MAIL FROM:<${from}>`);
    if (!mf.startsWith("250")) return { ok: false, transcript, error: `MAIL FROM: ${mf}` };
    const rc = await send(`RCPT TO:<${to}>`);
    if (!rc.startsWith("250")) return { ok: false, transcript, error: `RCPT: ${rc}` };
    const dt = await send("DATA");
    if (!dt.startsWith("354")) return { ok: false, transcript, error: `DATA: ${dt}` };
    log(`> [message ${message.length} bytes]`);
    await conn.write(enc.encode(message));
    const final = await readResp();
    log(`< ${final.trim()}`);
    try { await send("QUIT"); } catch {}
    try { conn.close(); } catch {}
    if (!final.includes("250")) return { ok: false, transcript, error: `Send: ${final}` };
    return { ok: true, transcript, messageId: msgId };
  } catch (e: any) {
    return { ok: false, transcript, error: e?.message || String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id;
    const campaignId = body.campaign_id || "6857f32a-af7c-414e-8116-fb0287efb0fc";
    const stepOrder = body.step_order || 1;

    // Fetch campaign step
    const { data: steps, error: stepErr } = await admin
      .from("campaign_steps")
      .select("subject, body")
      .eq("campaign_id", campaignId)
      .eq("step_order", stepOrder)
      .limit(1);
    if (stepErr || !steps || steps.length === 0) {
      return new Response(JSON.stringify({ error: "Campaign step not found", details: stepErr }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const step = steps[0];

    // Fetch account
    let q = admin.from("email_accounts").select("*").eq("status", "connected").limit(1);
    if (accountId) q = admin.from("email_accounts").select("*").eq("id", accountId).limit(1);
    const { data: accounts, error } = await q;
    if (error || !accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ error: "No connected account found", details: error }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const acc = accounts[0];
    const fromName = [acc.first_name, acc.last_name].filter(Boolean).join(" ") || "";

    // Render variables (recipient is team@onepulso.online -> use defaults)
    const vars: Record<string, string> = {
      first_name: "Team",
      last_name: "Onepulso",
      company_name: "Onepulso",
      email: TARGET,
    };
    const subject = renderVars(step.subject || "", vars).trim();
    const rendered = renderVars(step.body || "", vars);
    const textBody = htmlToPlain(rendered);
    const htmlBody = textToHtml(rendered);

    const result = await sendRawSmtp(
      acc.smtp_host, acc.smtp_port, acc.smtp_username, acc.smtp_password,
      acc.email, fromName, TARGET, subject, textBody, htmlBody,
    );

    return new Response(JSON.stringify({
      from: acc.email, from_name: fromName, to: TARGET,
      campaign_id: campaignId, step_order: stepOrder,
      subject,
      smtp_host: acc.smtp_host, smtp_port: acc.smtp_port,
      ok: result.ok, error: result.error, messageId: result.messageId,
      transcript: result.transcript,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
