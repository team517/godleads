// send-followups — sends the follow-ups the owner scheduled in Seguimiento, at their time.
// Runs from a cron every 1-2 min: picks follow_ups with status='scheduled' and scheduled_at<=now,
// sends from the chosen mailbox (team@) THREADED to the conversation, marks them sent, and records
// the message in sent_emails so it shows in the conversation timeline.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const wrapId = (id: string) => { const t = (id || "").trim(); return !t ? "" : (t.startsWith("<") ? t : `<${t}>`); };
function toHtml(text: string): string {
  if (/<(p|div|br|a)\b/i.test(text)) return text;
  return text.split(/\n\n+/).filter((p) => p.trim()).map((p) => `<p style="margin:0 0 10px">${p.replace(/\n/g, "<br>")}</p>`).join("") || `<p>${(text || "").replace(/\n/g, "<br>")}</p>`;
}
async function sendSmtp(host: string, port: number, username: string, password: string, from: string, fromName: string | null, to: string, subject: string, bodyHtml: string, opts?: { inReplyTo?: string; references?: string }): Promise<{ ok: boolean; error?: string; msgId?: string }> {
  try {
    port = Number(port) || 587;
    let conn: Deno.Conn = port === 465 ? await Deno.connectTls({ hostname: host, port }) : await Deno.connect({ hostname: host, port });
    const read = async () => { const b = new Uint8Array(4096); const n = await conn.read(b); return new TextDecoder().decode(b.subarray(0, n || 0)); };
    const send = async (cmd: string) => { await conn.write(new TextEncoder().encode(cmd + "\r\n")); return await read(); };
    const inReplyTo = wrapId(opts?.inReplyTo || "");
    const refs = (opts?.references || opts?.inReplyTo || "").trim();
    const referencesHdr = refs ? refs.split(/\s+/).map(wrapId).filter(Boolean).join(" ") : "";
    const threadHdrs = inReplyTo ? `In-Reply-To: ${inReplyTo}\r\nReferences: ${referencesHdr || inReplyTo}\r\n` : "";
    const ourId = `<${crypto.randomUUID()}@onepulso.online>`;
    const msg = () => `From: ${fromName ? `"${fromName}" <${from}>` : from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: ${ourId}\r\n${threadHdrs}Content-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${bodyHtml}\r\n.\r\n`;
    await read();
    if (port === 587) { const ehlo = await send("EHLO onepulso"); if (ehlo.includes("STARTTLS")) { await conn.write(new TextEncoder().encode("STARTTLS\r\n")); await read(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); } }
    await send("EHLO onepulso");
    const auth = await send(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `auth: ${auth.trim().slice(0, 60)}` }; }
    await send(`MAIL FROM:<${from}>`); await send(`RCPT TO:<${to}>`); await send("DATA");
    const data = await send(msg()); await send("QUIT"); conn.close();
    return data.includes("250") ? { ok: true, msgId: ourId } : { ok: false, error: `send: ${data.trim().slice(0, 60)}` };
  } catch (e) { return { ok: false, error: `smtp: ${(e as Error).message}` }; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const input = await req.json().catch(() => ({} as any));
  const limit = Math.min(Number(input.limit) || 15, 40);

  const { data: due } = await admin.from("follow_ups").select("*").eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).order("scheduled_at", { ascending: true }).limit(limit);
  if (!due?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let sent = 0; const results: any[] = [];
  for (const f of due as any[]) {
    try {
      // Claim atomically so overlapping runs don't double-send.
      const { data: claimed } = await admin.from("follow_ups").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", f.id).eq("status", "scheduled").select("id");
      if (!claimed || !(claimed as any[]).length) continue;
      // Sending mailbox: the follow-up's account_id, else team@, else the owner's first connected.
      const { data: accts } = await admin.from("email_accounts").select("id, email, smtp_host, smtp_port, smtp_username, smtp_password").eq("user_id", f.owner_id).eq("status", "connected");
      const acct = (accts || []).find((a: any) => a.id === f.account_id) || (accts || []).find((a: any) => /team@onepulso|support@onepulso/i.test(a.email)) || (accts || [])[0];
      if (!acct?.smtp_host) { await admin.from("follow_ups").update({ status: "error", note: "sin cuenta de envío" }).eq("id", f.id); results.push({ id: f.id, error: "no account" }); continue; }
      const subject = f.subject && f.subject.trim() ? f.subject : "Seguimiento";
      const r = await sendSmtp(acct.smtp_host, acct.smtp_port, acct.smtp_username, acct.smtp_password, acct.email, "OnePulso", f.contact_email, subject, toHtml(f.body || ""), { inReplyTo: f.in_reply_to || "", references: f.references_hdr || f.in_reply_to || "" });
      if (!r.ok) { await admin.from("follow_ups").update({ status: "scheduled", note: `reintento: ${r.error || ""}`.slice(0, 200), updated_at: new Date().toISOString() }).eq("id", f.id); results.push({ id: f.id, error: r.error }); continue; }
      await admin.from("follow_ups").update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", f.id);
      // Record in sent_emails so it appears in the conversation timeline.
      try { await admin.from("sent_emails").insert({ user_id: f.owner_id, account_id: acct.id, to_email: f.contact_email, subject, body: toHtml(f.body || ""), status: "sent", sent_at: new Date().toISOString(), smtp_message_id: r.msgId || null }); } catch { /* non-fatal */ }
      sent++; results.push({ id: f.id, to: f.contact_email, ok: true });
    } catch (e) { try { await admin.from("follow_ups").update({ status: "scheduled", note: String((e as Error).message).slice(0, 200) }).eq("id", f.id); } catch { /* */ } }
  }
  return new Response(JSON.stringify({ sent, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
