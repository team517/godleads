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
    // Header-injection guard: strip CR/LF from any value that lands in an email header, so a crafted
    // subject/recipient can never inject extra headers (defense-in-depth; these come from owner rows).
    subject = String(subject || "").replace(/[\r\n]+/g, " ").trim();
    to = String(to || "").replace(/[\r\n]+/g, "").trim();
    from = String(from || "").replace(/[\r\n]+/g, "").trim();
    fromName = fromName ? String(fromName).replace(/[\r\n"]+/g, " ").trim() : fromName;
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

  // ── CANCEL-ON-REPLY ─────────────────────────────────────────────────────────────────────
  // If the contact has REPLIED since a follow-up was scheduled, cancel their remaining scheduled
  // follow-ups — sending more makes no sense once they answered. Runs every tick, so a reply on
  // Tuesday cancels the Wed/Thu follow-ups within ~a minute (already-SENT ones are never touched —
  // only status='scheduled').
  //
  // IMPORTANT (fix): we search the reply across ALL of the owner's mailboxes (user_id), NOT just
  // the mailbox the follow-up is sent FROM (team@). The contact usually replies to the ORIGINAL
  // cold-email mailbox (the maria@/other account that first wrote them), so their answer lands
  // there, not in team@. Scoping the check to the follow-up's account_id missed exactly that case
  // (real bug: a.casado/Idento replied and the follow-up was NOT canceled). `inbox_messages` has
  // user_id, so an owner-wide search catches the reply wherever it arrives. Match is a tolerant
  // contains (from_email is stored lowercased, but this also survives any "Name <email>" wrapping).
  let canceled = 0;
  const repliedSince = async (ownerId: string, contact: string, since: string): Promise<boolean> => {
    if (!ownerId || !contact) return false;
    const c = String(contact).trim().toLowerCase();
    if (!c) return false;
    const { data } = await admin.from("inbox_messages").select("id")
      .eq("user_id", ownerId).eq("is_sent", false).ilike("from_email", `%${c}%`).gt("received_at", since).limit(1);
    return !!(data && (data as any[]).length);
  };
  try {
    const { data: sched } = await admin.from("follow_ups").select("id, owner_id, account_id, contact_email, created_at").eq("status", "scheduled");
    for (const s of (sched || []) as any[]) {
      if (await repliedSince(s.owner_id, s.contact_email, s.created_at)) {
        const { data: c } = await admin.from("follow_ups").update({ status: "canceled", note: "cancelado: el contacto respondió", updated_at: new Date().toISOString() }).eq("id", s.id).eq("status", "scheduled").select("id");
        if (c && (c as any[]).length) canceled++;
      }
    }
  } catch { /* non-fatal */ }

  const { data: due } = await admin.from("follow_ups").select("*").eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).order("scheduled_at", { ascending: true }).limit(limit);
  if (!due?.length) return new Response(JSON.stringify({ sent: 0, canceled }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let sent = 0; const results: any[] = [];
  for (const f of due as any[]) {
    try {
      // Claim atomically so overlapping runs don't double-send.
      const { data: claimed } = await admin.from("follow_ups").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", f.id).eq("status", "scheduled").select("id");
      if (!claimed || !(claimed as any[]).length) continue;
      // CANCEL-WINS guard: the owner may hit "delete" between our claim and the actual SMTP send.
      // The frontend cancel flips scheduled/sending → 'canceled'. Re-read the row here; if it's no
      // longer 'sending' (i.e. it was canceled in this tiny window), abort WITHOUT sending. This is
      // what guarantees "deleted = never sent" for anything canceled before the mail goes out.
      const { data: fresh } = await admin.from("follow_ups").select("status").eq("id", f.id).maybeSingle();
      if ((fresh as any)?.status !== "sending") { results.push({ id: f.id, canceled: true }); continue; }
      // Last-moment guard: if the contact replied since this was scheduled (even a second ago),
      // cancel instead of sending — never message someone who already answered. Owner-wide (any mailbox).
      if (await repliedSince(f.owner_id, f.contact_email, f.created_at)) {
        await admin.from("follow_ups").update({ status: "canceled", note: "cancelado: el contacto respondió", updated_at: new Date().toISOString() }).eq("id", f.id);
        canceled++; results.push({ id: f.id, canceled: true }); continue;
      }
      // Sending mailbox: the follow-up's account_id, else team@, else the owner's first connected.
      const { data: accts } = await admin.from("email_accounts").select("id, email, smtp_host, smtp_port, smtp_username, smtp_password").eq("user_id", f.owner_id).eq("status", "connected");
      const acct = (accts || []).find((a: any) => a.id === f.account_id) || (accts || []).find((a: any) => /team@onepulso|support@onepulso/i.test(a.email)) || (accts || [])[0];
      if (!acct?.smtp_host) { await admin.from("follow_ups").update({ status: "error", note: "sin cuenta de envío" }).eq("id", f.id); results.push({ id: f.id, error: "no account" }); continue; }
      const subject = f.subject && f.subject.trim() ? f.subject : "Seguimiento";
      const r = await sendSmtp(acct.smtp_host, acct.smtp_port, acct.smtp_username, acct.smtp_password, acct.email, "OnePulso", f.contact_email, subject, toHtml(f.body || ""), { inReplyTo: f.in_reply_to || "", references: f.references_hdr || f.in_reply_to || "" });
      // Reset for retry ONLY if it's still 'sending' — never resurrect a follow-up the owner
      // canceled while the send was in flight (.eq status sending guards against that).
      if (!r.ok) { await admin.from("follow_ups").update({ status: "scheduled", note: `reintento: ${r.error || ""}`.slice(0, 200), updated_at: new Date().toISOString() }).eq("id", f.id).eq("status", "sending"); results.push({ id: f.id, error: r.error }); continue; }
      await admin.from("follow_ups").update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", f.id);
      // Record in sent_emails so it appears in the conversation timeline.
      try { await admin.from("sent_emails").insert({ user_id: f.owner_id, account_id: acct.id, to_email: f.contact_email, subject, body: toHtml(f.body || ""), status: "sent", sent_at: new Date().toISOString(), smtp_message_id: r.msgId || null }); } catch { /* non-fatal */ }
      sent++; results.push({ id: f.id, to: f.contact_email, ok: true });
    } catch (e) { try { await admin.from("follow_ups").update({ status: "scheduled", note: String((e as Error).message).slice(0, 200) }).eq("id", f.id).eq("status", "sending"); } catch { /* */ } }
  }
  return new Response(JSON.stringify({ sent, canceled, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
