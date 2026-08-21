// client-service-agent — AI customer-service for OnePulso's CLIENTS.
//
// Watches the owner's inbox (the account where clients write, e.g. team@onepulso.online),
// and for each incoming client email:
//   1. Matches the sender to a CLIENT by the domain of the client's own mailboxes
//      (each client owns email_accounts on their company domain → reliable match).
//   2. Asks DeepSeek to decide, following the "Atención" memory:
//        • reply        → answer a question/objection (info, Calendly, how we work)
//        • copy_change  → the client asked to change a COPY/subject of their campaign
//        • escalate     → anything else, delicate, or unclear (DB/leads change, money,
//                         cancellation, legal, complaint, or low confidence)
//   3. Acts:
//        • reply        → sends the answer from the same mailbox
//        • copy_change  → applies the exact change to that step of the client's DRAFT
//                         campaign, then emails the client "los cambios ya están aplicados,
//                         puedes verlos en tu campaña"
//        • escalate     → emails team@onepulso.online a summary + suggested action
//   4. Marks the message processed (auto_replied) so it's handled once.
//
// THREADING: every client-facing email carries Message-ID / In-Reply-To / References built
// from the inbound message (and, for the deferred follow-ups, from the mail we ourselves
// just sent), so the whole exchange stays inside ONE conversation in the client's mailbox
// instead of arriving as a pile of loose emails. See _shared/emailThread.ts.
//
// SAFETY: never activates a campaign; only edits copy of DRAFT campaigns; anything the model
// isn't fully sure about is ESCALATED, never applied. Never answers an auto-responder, a
// bounce, a no-reply address or one of our own mailboxes. Each message is CLAIMED atomically
// before the model runs, so two overlapping cron ticks can't answer the same email twice.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { buildCopyDoc } from "../_shared/report/buildCopyPdf.ts";
import { ONEPULSO_LOGO_WHITE_DATAURL, ONEPULSO_LOGO_RATIO } from "../_shared/report/onepulsoLogoWhite.ts";
import { buildMimeMessage, buildThreadHeaders, newMessageId, replySubject } from "../_shared/emailThread.ts";
import { cleanBody, isAutomatedMessage, textToHtml, withSignoff } from "../_shared/serviceAgent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEAM_EMAIL = "team@onepulso.online";
const DEFAULT_ATENCION = `Eres la atención al cliente de OnePulso (agencia de cold email B2B). Tono humano, cercano, decisivo, nunca defensivo. Responde en el idioma del cliente.
- PIENSA CON CRITERIO antes de actuar. Eres un buen responsable de cuenta: en cada correo párate a pensar qué respuesta da la MEJOR imagen de OnePulso (profesional PERO humana y cercana) y qué es lo más útil para el cliente AHORA. Muchas veces lo mejor es una respuesta clara, natural y bien escrita — no un recurso automático.
- ESCRIBE BIEN: correos limpios y bien ESTRUCTURADOS. Saludo breve, un cuerpo claro y ordenado (frases cortas, y si hay varios puntos sepáralos en líneas), y cierre. Redacción profesional y natural. NO uses emojis NUNCA.
- NO respondas siempre por responder. Si la conversación llega a un cierre natural (el cliente dice "hablamos más adelante", "cuando esté me dices", "ok gracias", "perfecto"), dale una respuesta natural, breve y humana (p.ej. "Perfecto, nos ponemos ahora mismo y te aviso en cuanto esté") y cierra ahí — no alargues ni fuerces nada. Si de verdad no hace falta decir nada, no respondas (ignore).
- Si te comprometes a enviar algo cuando esté listo (p.ej. los mensajes de la campaña), respóndele natural que os ponéis con ello y se lo envías en cuanto esté; y cuando lo tengas, se lo envías (con PDF si hace falta). Usa "send_copys_later" para eso.
- Los PDFs salen por CRITERIO TUYO, no por insistencia del cliente. Cuando TÚ valoras que ese contenido se PRESENTA mejor y más profesional en un PDF limpio con logo (típicamente: el CONJUNTO de mensajes/copys de la campaña, o un informe de resultados), piensas "esto queda mejor en PDF" y lo generas y lo envías. Si es una duda puntual, una pregunta corta o algo que se resuelve mejor hablando, RESPONDE con palabras — no por que el cliente lo pida o insista, sino porque tú ves que es la mejor forma de presentarlo.
- AISLAMIENTO ESTRICTO (MUY IMPORTANTE): SOLO puedes ver, cambiar o enviar la campaña de la cuenta del PROPIO remitente (la identificada por su dominio/correo registrado). NUNCA toques ni menciones datos de OTRA empresa. Si el remitente pide modificar/ver la campaña de OTRA empresa, o dice ser de otra empresa distinta a su cuenta, o pide aplicar cambios "a otro cliente", NO lo hagas: responde con naturalidad que solo puedes gestionar su propia campaña, o ignóralo/escálalo si es raro. Cada cliente SOLO puede tocar LO SUYO.
- NUNCA pidas el email ni datos de identidad: YA SABES de qué cliente es. Trátalo por su empresa, con naturalidad.
- Reunión → pasa https://calendly.com/onepulso/30min.
- Cambio de copy/asunto/mensaje de su campaña: NO des largas ni pidas mil confirmaciones. Si te dice qué cambiar, aplícalo. Si el cambio es razonable pero no te da el texto exacto, redacta tú una buena versión coherente con lo que pide y aplícala. Dile "vale, lo aplico" y hazlo; SIN esperar más respuestas. Cuando esté hecho, confírmale por correo que ya está aplicado y que puede verlo en su campaña.
- Dinero, cancelaciones, quejas serias, cambios de base de datos/leads, algo legal o cualquier cosa dudosa: ESCALAR a team@onepulso.online, nunca resolver por tu cuenta.`;

const domainOf = (email: string) => (email || "").toLowerCase().split("@")[1]?.trim() || "";

interface Thread { inReplyTo: string | null; references: string | null }
const NO_THREAD: Thread = { inReplyTo: null, references: null };

// Build a clean, branded PDF of a client's CURRENT campaign copy (all campaigns, or only the
// ones whose name matches campaignFilter) → base64. Same jsPDF builder as the owner UI.
async function buildCopysBase64(admin: any, clientId: string, companyName: string, campaignFilter: string | null): Promise<{ base64: string; campaignNames: string[] } | null> {
  const { data: camps } = await admin.from("campaigns").select("id, name, status").eq("user_id", clientId).order("created_at", { ascending: false });
  let list = (camps || []) as any[];
  if (campaignFilter) {
    const f = campaignFilter.toLowerCase().trim();
    const matched = list.filter((c) => (c.name || "").toLowerCase().includes(f));
    if (matched.length) list = matched;
  }
  if (!list.length) return null;
  const campaigns: any[] = [];
  for (const c of list) {
    const { data: steps } = await admin.from("campaign_steps").select("step_order, subject, body, variants, delay_days").eq("campaign_id", c.id).order("step_order");
    campaigns.push({ name: c.name, status: c.status, steps: steps || [] });
  }
  let sampleLead: any = null;
  try { const { data: s } = await admin.from("leads").select("email, custom_fields").eq("user_id", clientId).limit(1); sampleLead = (s || [])[0] || null; } catch { /* optional */ }
  const now = new Date();
  const doc = buildCopyDoc(jsPDF, {
    clientName: companyName || "Cliente",
    generatedAtLabel: now.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }),
    campaigns, sampleLead,
    agencyLogoDataUrl: ONEPULSO_LOGO_WHITE_DATAURL, agencyLogoRatio: ONEPULSO_LOGO_RATIO,
  });
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { base64: btoa(bin), campaignNames: list.map((c) => c.name) };
}

// Send the copys PDF to the client via send-report (uploads it + emails a clean link).
// The thread headers travel with it so the PDF email lands inside the conversation.
async function sendCopys(admin: any, clientId: string, companyName: string, campaignFilter: string | null, toEmail: string, teamAcct: any, leadMessage: string, thread: Thread, subject: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const built = await buildCopysBase64(admin, clientId, companyName, campaignFilter);
    if (!built) return { ok: false, error: "sin campañas" };
    const message = withSignoff(leadMessage && leadMessage.trim() ? leadMessage : "¡Hola! Aquí tienes los mensajes completos de tu campaña, tal cual están ahora mismo, en un PDF ordenado. Échales un vistazo con calma y me dices cualquier cosa.");
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
      body: JSON.stringify({ mode: "send_copys", secret: Deno.env.get("REPORTS_CRON_SECRET"), to: toEmail, from_account_id: teamAcct.id, subject, message, pdf_base64: built.base64, in_reply_to: thread.inReplyTo, references: thread.references }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.error };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// Send the analytics/results report to the client via send-report (built server-side).
async function sendAnalytics(admin: any, clientId: string, toEmail: string, teamAcct: any, thread: Thread): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
      body: JSON.stringify({ mode: "manual", secret: Deno.env.get("REPORTS_CRON_SECRET"), client_user_id: clientId, kind: "48h", test_to: toEmail, from_account_id: teamAcct.id, in_reply_to: thread.inReplyTo, references: thread.references }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.error };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ── SMTP send ───────────────────────────────────────────────────────────────────
// Multi-line-safe reads (a single read() can return a partial or a doubled response,
// which silently desyncs the session), a full RFC 5322 header block (Date, Message-ID,
// In-Reply-To, References, encoded Subject) and a base64 body.
async function sendSmtp(
  host: string, port: number, username: string, password: string,
  from: string, fromName: string | null, to: string, subject: string, bodyHtml: string,
  thread: Thread = NO_THREAD,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const messageId = newMessageId(from);
  try {
    let conn: Deno.Conn = port === 465 ? await Deno.connectTls({ hostname: host, port }) : await Deno.connect({ hostname: host, port });
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const readResponse = async (): Promise<string> => {
      let result = "";
      while (true) {
        const b = new Uint8Array(4096);
        const n = await conn.read(b);
        if (!n) break;
        result += dec.decode(b.subarray(0, n));
        const lines = result.split("\r\n").filter((l) => l.length > 0);
        if (/^\d{3} /.test(lines[lines.length - 1] || "")) break;
      }
      return result;
    };
    const cmd = async (c: string) => { await conn.write(enc.encode(c + "\r\n")); return (await readResponse()).trim(); };
    const code2 = (r: string) => /^2\d\d/.test(r);

    await readResponse(); // greeting
    if (port !== 465) {
      const ehlo = await cmd("EHLO onepulso");
      if (/STARTTLS/i.test(ehlo)) {
        await conn.write(enc.encode("STARTTLS\r\n")); await readResponse();
        conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
      } else { try { conn.close(); } catch { /* */ } return { ok: false, error: "el servidor SMTP no ofrece STARTTLS" }; }
    }
    await cmd("EHLO onepulso");
    const auth = await cmd(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `auth: ${auth.slice(0, 60)}` }; }
    const mf = await cmd(`MAIL FROM:<${from}>`);
    if (!code2(mf)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `MAIL FROM: ${mf.slice(0, 60)}` }; }
    const rc = await cmd(`RCPT TO:<${to}>`);
    if (!code2(rc)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `RCPT: ${rc.slice(0, 60)}` }; }
    const dt = await cmd("DATA");
    if (!/^3\d\d/.test(dt)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `DATA: ${dt.slice(0, 60)}` }; }

    const msg = buildMimeMessage({
      from, fromName, to, subject, html: bodyHtml, date: new Date(), messageId,
      inReplyTo: thread.inReplyTo, references: thread.references,
    });
    await conn.write(enc.encode(`${msg}\r\n.\r\n`));
    const fin = (await readResponse()).trim();
    try { await cmd("QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }
    return code2(fin) ? { ok: true, messageId } : { ok: false, error: `send: ${fin.slice(0, 60)}` };
  } catch (e) { return { ok: false, error: `smtp: ${(e as Error).message}` }; }
}

// ── DeepSeek JSON decision ──────────────────────────────────────────────────────
async function decide(apiKey: string, system: string, user: string): Promise<any> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "deepseek-chat", temperature: 0.3, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(content); } catch { return {}; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const dkKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
  if (!dkKey) return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // The owner (agency) whose inbox we watch. Passed in, or default to the known owner.
  const input = await req.json().catch(() => ({} as any));

  // ── CHAT: test a conversation with the agent (no email / campaign side effects) ──
  if (input.action === "chat") {
    const system = (input.prompt || DEFAULT_ATENCION) + `\n\nEres el asistente de atención de OnePulso hablando directamente con un cliente por chat. Responde de forma natural, humana y conversacional, en su idioma. Ten en cuenta TODA la conversación de arriba y NO repitas respuestas anteriores: si el cliente insiste en algo ya tratado, gestiónalo de forma DIFERENTE. Devuelve SOLO JSON: {"reply":"tu respuesta"}.`;
    const hist = Array.isArray(input.history) ? input.history.map((h: any) => `${h.role === "user" ? "Cliente" : "Tú"}: ${h.text}`).join("\n") : "";
    const user = `${input.company ? `Empresa del cliente: ${input.company}\n` : ""}${hist ? hist + "\n" : ""}Cliente: ${input.message || ""}`;
    let d: any = {};
    try { d = await decide(dkKey, system, user); } catch { /* */ }
    return new Response(JSON.stringify({ reply: d.reply || "Perdona, ¿me lo repites?" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { owner_user_id, account_id, limit, dry_run } = input;
  const ownerId = owner_user_id || "b94a0bdf-0120-44cd-8c7d-51126bfc2075";
  const dryRun = !!dry_run; // dry_run: decide but NEVER send emails / edit campaigns / mark read

  // Sending mailbox = the configured service inbox (account_id) if given, else team@/support@.
  const { data: ownerAccts } = await admin.from("email_accounts").select("id, email, smtp_host, smtp_port, smtp_username, smtp_password, status").eq("user_id", ownerId).eq("status", "connected");
  const teamAcct = (account_id ? (ownerAccts || []).find((a: any) => a.id === account_id) : null)
    || (ownerAccts || []).find((a: any) => /team@onepulso|support@onepulso/i.test(a.email)) || (ownerAccts || [])[0];
  // No mailbox to answer from → stop. (Marking the inbox processed here would silently
  // burn every pending client email without anyone ever reading it.)
  if (!teamAcct) return new Response(JSON.stringify({ error: "El propietario no tiene ninguna cuenta de correo conectada para responder" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  // Our own mailboxes — never answer a mail that came from one of them (reply loop).
  const ownMailboxes = new Set((ownerAccts || []).map((a: any) => (a.email || "").toLowerCase()).filter(Boolean));
  ownMailboxes.add(TEAM_EMAIL.toLowerCase());

  const sendToClient = (to: string, subject: string, text: string, thread: Thread) =>
    sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", to, subject, textToHtml(withSignoff(text)), thread);

  // ── Deferred deliveries (later runs) ────────────────────────────────────────────────
  //  • "confirm"       → the "ya está aplicado" note after a copy_change ack (2-step, no two
  //                      emails at once). Gate 2 min → lands 2-3 min after the ack.
  //  • "deliver_copys" → after a "send_copys_later" commit ("te lo envío cuando esté"), builds
  //                      and sends the copys PDF once it's ready. Retries until ready (≤24h).
  // Both thread onto the mail we already sent (thread_msg_id/thread_refs), so the follow-up
  // continues the same conversation. Each row is CLAIMED first: a claim older than 5 min is
  // considered stale and retried, so a crash mid-send never loses a delivery.
  let confirmed = 0;
  if (!dryRun) {
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: pend } = await admin.from("client_service_log")
      .select("id, client_user_id, from_email, subject, action, reply, campaign, thread_msg_id, thread_refs")
      .eq("owner_id", ownerId).eq("pending", true)
      .lt("created_at", new Date(Date.now() - 120 * 1000).toISOString())
      .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: true }).limit(10);
    for (const p of (pend as any[]) || []) {
      // Atomic claim — only one concurrent run may take this row.
      const { data: taken } = await admin.from("client_service_log")
        .update({ claimed_at: nowIso })
        .eq("id", p.id).eq("pending", true)
        .or(`claimed_at.is.null,claimed_at.lt.${staleIso}`)
        .select("id");
      if (!taken?.length) continue;

      const thread = buildThreadHeaders({ messageId: p.thread_msg_id, refChain: p.thread_refs });
      const subject = replySubject(p.subject, "tu campaña");
      try {
        if (p.action === "deliver_copys") {
          const { data: pr } = await admin.from("profiles").select("company_name").eq("user_id", p.client_user_id).maybeSingle();
          const res = await sendCopys(admin, p.client_user_id, (pr as any)?.company_name || "", p.campaign || null, p.from_email, teamAcct, "", thread, subject);
          if (!res.ok) continue; // not ready yet → stays pending, retried once the claim goes stale
        } else {
          const res = await sendToClient(p.from_email, subject, p.reply || "Ya hemos aplicado los cambios en tu campaña, puedes ver los mensajes. Cualquier cosa, nos dices.", thread);
          if (!res.ok) continue; // SMTP hiccup → retried once the claim goes stale
        }
      } catch { continue; /* keep pending, retry next run */ }
      await admin.from("client_service_log").update({ pending: false }).eq("id", p.id);
      confirmed++;
    }
  }

  // 1) Unprocessed inbound to the owner's connected mailboxes (skip warmup / our own sends).
  let q = admin.from("inbox_messages").select("*").eq("user_id", ownerId).eq("auto_replied", false).eq("is_sent", false).eq("is_warmup", false).order("received_at", { ascending: true }).limit(Math.min(limit || 15, 30));
  if (account_id) q = q.eq("account_id", account_id);
  // Human-like delay: only reply to emails that arrived ≥5 min ago (skipped in dry_run so you
  // can test immediately). Combined with the cron cadence, the reply goes out ~5 min later.
  if (!dryRun) q = q.lte("received_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  const { data: msgs } = await q;
  if (!msgs?.length) return new Response(JSON.stringify({ processed: 0, confirmed, skipped: 0, results: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let processed = 0;
  let skipped = 0;
  const results: any[] = [];
  for (const m of msgs) {
   try {
    const fromEmail = (m.from_email || "").toLowerCase();
    const dom = domainOf(fromEmail);
    const body = cleanBody(m.body_text, m.body_html);

    // 2) Silence guards — BEFORE spending a model call or writing anything. Answering an
    //    out-of-office, a bounce, a no-reply address or one of our own mailboxes is how an
    //    auto-responder ends up in a loop with another auto-responder.
    const mute = !dom ? "sin remitente"
      : ownMailboxes.has(fromEmail) ? "cuenta propia"
      : isAutomatedMessage({ fromEmail, subject: m.subject, body }) ? "automático/bounce"
      : null;
    if (mute) {
      if (!dryRun) await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", m.id);
      results.push({ id: m.id, from: m.from_email, subject: m.subject, action: "ignore", summary: `silenciado: ${mute}` });
      skipped++;
      continue;
    }

    // 3) CLAIM the message before the model runs. The cron fires every minute while a run
    //    with 10 messages takes longer than that, so without this the next tick picks up the
    //    same emails and the client receives every answer twice.
    if (!dryRun) {
      const { data: claimed } = await admin.from("inbox_messages")
        .update({ auto_replied: true })
        .eq("id", m.id).eq("auto_replied", false)
        .select("id");
      if (!claimed?.length) { skipped++; continue; } // another run got there first
    }

    // 4) Match the sender to a CLIENT. A client may write from a personal address (gmail…),
    //    so try, in order: (a) their registered account/login email; (b) their profile contact
    //    email; (c) the domain of their own mailboxes. First hit wins.
    let clientId: string | null = null;
    try { const { data: byMail } = await admin.rpc("automation_client_by_email", { p_email: fromEmail }); if (byMail) clientId = byMail as any; } catch { /* rpc optional */ }
    if (!clientId) { const { data: byContact } = await admin.from("profiles").select("user_id").ilike("contact_email", fromEmail).neq("user_id", ownerId).limit(1); clientId = (byContact || [])[0]?.user_id || null; }
    if (!clientId && dom) { const { data: domAccts } = await admin.from("email_accounts").select("user_id").ilike("email", `%@${dom}`).neq("user_id", ownerId).limit(1); clientId = (domAccts || [])[0]?.user_id || null; }
    const known = !!clientId;

    // Client context: profile + their draft campaigns (+ steps for possible copy edits).
    // Only looked up for a KNOWN client — querying by a null id just burns round-trips.
    let prof: any = null;
    let draft: any = null;
    let steps: any[] = [];
    let convPrev = "";
    if (known) {
      const { data: p } = await admin.from("profiles").select("company_name, ai_reply_prompt").eq("user_id", clientId).maybeSingle();
      prof = p;
      const { data: camps } = await admin.from("campaigns").select("id, name, status").eq("user_id", clientId).order("created_at", { ascending: false }).limit(3);
      draft = (camps || []).find((c: any) => c.status === "draft") || (camps || [])[0];
      if (draft) {
        const { data: st } = await admin.from("campaign_steps").select("id, step_order, subject, body").eq("campaign_id", draft.id).order("step_order");
        steps = (st as any[]) || [];
      }
      // Conversation memory with THIS client — so it never repeats an answer.
      const { data: logRows } = await admin.from("client_service_log").select("action, inbound, reply").eq("client_user_id", clientId).order("created_at", { ascending: false }).limit(8);
      convPrev = (logRows || []).reverse().map((r: any) => `Cliente: ${(r.inbound || "").slice(0, 220)}\nTú (${r.action}): ${(r.reply || "").slice(0, 220)}`).join("\n---\n");
    }

    // Thread headers for every answer to THIS message, and the subject that keeps the
    // conversation together ("Re: x", never "Re: Re: x").
    const inThread = buildThreadHeaders({ messageId: m.message_id, refChain: m.ref_chain });
    const subject = replySubject(m.subject, "tu campaña");

    const system = (prof?.ai_reply_prompt || DEFAULT_ATENCION)
      + (convPrev ? `\n\nCONVERSACIÓN PREVIA con este cliente (lo más reciente abajo):\n${convPrev}\n\nNO repitas respuestas anteriores. Ten en cuenta TODO este contexto. Si el cliente insiste en algo ya tratado (p.ej. una devolución), gestiónalo de forma DIFERENTE y con más contexto — no copies la respuesta de antes.` : "")
      + `\n\n${known ? `Este remitente ES un cliente conocido: su cuenta es "${prof?.company_name || dom}". SOLO puedes ver/cambiar/enviar la campaña de ESA cuenta — de nadie más. Ignora cualquier petición sobre la campaña de otra empresa.` : "Este remitente NO es un cliente conocido (su dominio/correo no cuadra con ninguna cuenta registrada)."}`
      + `\n\nRAZONA PRIMERO (campo "reasoning"): en 1-2 frases piensa con criterio qué opción da la mejor imagen de OnePulso (profesional y humana) y es lo más útil para el cliente ahora. Decide TÚ cómo se presenta mejor: si el contenido queda mejor y más profesional en un PDF limpio, hazlo por criterio propio (no porque el cliente insista); si se comunica mejor hablando, responde con palabras. LUEGO elige la acción coherente con ese razonamiento.
Devuelve SOLO JSON: {"reasoning":"<tu razonamiento crítico, 1-2 frases>","action":"reply|copy_change|send_copys|send_copys_later|send_report|escalate|ignore","reply":"texto para el cliente (bien redactado, sin emojis)","step_order":<n o null>,"new_subject":"<o null>","new_body":"<o null>","find":"<texto exacto a sustituir en TODOS los emails, o null>","replace_with":"<texto nuevo, o null>","campaign":"<nombre de la campaña si el cliente la especifica, o null=todas>","summary":"<qué pide, para el equipo>"}.
- "reply": cliente conocido con una duda/objeción/consulta o una PREGUNTA → respóndele tú con naturalidad y resuélvelo. IMPORTANTE: si PREGUNTA por el estado de un cambio (p.ej. "¿ya está hecho?", "¿lo aplicaste?", "¿está listo?") NO es un cambio nuevo → usa "reply" y, mirando la CONVERSACIÓN PREVIA, confírmale la verdad: si ya lo aplicaste antes, dile que SÍ, que ya está aplicado y puede verlo entrando en su campaña.
- "copy_change": SOLO cuando el cliente pide un cambio NUEVO y concreto en el texto de su campaña (asunto/cuerpo/nombre/firma) → aplícalo tú (NO pidas datos ni el email). Una PREGUNTA, un agradecimiento o una confirmación NO es copy_change. Para cambiar UN email concreto usa step_order + new_subject/new_body. Para un cambio que afecta a TODOS los emails (p.ej. cambiar un nombre o firma como "Xavi" por "José", un enlace o una palabra) usa find + replace_with con el texto EXACTO tal cual aparece.
- "send_copys": cuando el contenido a entregar es el CONJUNTO de mensajes/copys de la campaña, YA está listo, y TÚ valoras que se presenta mejor y más profesional como un PDF limpio con logo (que pegarlo como texto). Es tu criterio de presentación, NO que el cliente insista. Genera el PDF con los mensajes ACTUALES. En "reply" una frase corta de acompañamiento. Si nombra una campaña, ponla en "campaign"; si no, null = todas. Si solo pregunta por UN email o un detalle, NO uses send_copys → responde con "reply".
- "send_copys_later": cuando te COMPROMETES a enviar los mensajes/copys pero el momento natural es "os ponéis y se lo enviáis cuando esté" (aún no toca soltarlo de golpe). En "reply" das una respuesta natural comprometiéndote ("Perfecto, nos ponemos ahora mismo y te envío los mensajes en cuanto estén listos."). El PDF se enviará solo un poco después, cuando esté preparado. Úsalo cuando encaje ese flujo conversacional en vez de soltar el PDF inmediatamente.
- "send_report": cuando el contenido son RESULTADOS/ANALÍTICAS/un informe de la campaña y TÚ valoras que queda mejor y más profesional presentado como un PDF con métricas. Para un "¿cómo va?" informal, si crees que una respuesta humana breve comunica mejor, usa "reply".
- "escalate": SOLO cosas ESENCIALES que necesitan a una persona del equipo: una REUNIÓN/llamada, una DEVOLUCIÓN o reembolso, dinero/pagos, una cancelación, un tema legal o una queja seria. Solo esto se avisa a team@onepulso.online.
- "ignore": todo lo demás NO esencial — ruido, newsletters, agradecimientos, confirmaciones, o un remitente desconocido sin nada importante. NO se avisa a nadie.
REGLA CLAVE: por defecto RESPONDE con palabras (reply) bien escritas y humanas. Los PDFs (send_copys/send_report) salen por CRITERIO TUYO de presentación — cuando piensas "esto queda mejor y da mejor imagen en un PDF" — NO porque el cliente lo pida o insista, ni por cualquier mención. NO avises al equipo por cada correo: "escalate" ÚNICAMENTE para lo esencial. Si el remitente NO es un cliente conocido, usa SOLO "escalate" (si es esencial) o "ignore".`;
    const userMsg = (known
      ? `CLIENTE: ${prof?.company_name || dom}\nCAMPAÑA (borrador): ${draft?.name || "ninguna"}\nEMAILS ACTUALES:\n${steps.map((s: any) => `#${s.step_order} asunto="${s.subject}" cuerpo="${(s.body || "").replace(/<[^>]+>/g, " ").slice(0, 300)}"`).join("\n") || "(sin pasos)"}\n\n`
      : `REMITENTE DESCONOCIDO (no es un cliente registrado).\n\n`)
      + `CORREO RECIBIDO:\nDe: ${m.from_email}\nAsunto: ${m.subject}\n${body}`;

    let d: any = {};
    try { d = await decide(dkKey, system, userMsg); } catch { d = { action: "ignore", summary: "fallo IA" }; }
    // A non-client can only be escalated (if essential) or ignored — never auto-replied,
    // copy-edited, or sent copys/reports.
    if (!known && ["reply", "copy_change", "send_copys", "send_copys_later", "send_report"].includes(d.action)) d.action = "ignore";

    const base = { id: m.id, client: prof?.company_name || dom, from: m.from_email, subject: m.subject, reasoning: d.reasoning || "", summary: d.summary || "", reply_preview: (d.reply || "").slice(0, 200) };
    // Message-ID of the mail we send for this message — the deferred follow-up threads onto it.
    let sentId: string | null = null;

    let handled = false;
    if (d.action === "copy_change" && known) {
      // Apply the change to the client's DRAFT campaign. Two shapes: a global find/replace
      // across ALL steps (name/signature/word), or a specific step's subject/body.
      let applied = false;
      if (steps.length) {
        const doGlobal = d.find && d.replace_with != null;
        const doStep = d.step_order != null && (d.new_subject || d.new_body);
        if (dryRun) {
          applied = !!(doGlobal || doStep);
        } else if (doGlobal) {
          const find = String(d.find);
          for (const s of steps) {
            const ns = String(s.subject || "").split(find).join(String(d.replace_with));
            const nb = String(s.body || "").split(find).join(String(d.replace_with));
            if (ns !== s.subject || nb !== s.body) { await admin.from("campaign_steps").update({ subject: ns, body: nb }).eq("id", s.id); applied = true; }
          }
        } else if (doStep) {
          const target = steps.find((s: any) => s.step_order === Number(d.step_order));
          if (target) { const upd: any = {}; if (d.new_subject) upd.subject = String(d.new_subject); if (d.new_body) upd.body = textToHtml(String(d.new_body)); await admin.from("campaign_steps").update(upd).eq("id", target.id); applied = true; }
        }
      }
      // TWO-STEP so the client never gets two emails at once:
      //  1) now → a short ack ("vale, perfecto, aplicamos los cambios");
      //  2) queued (pending) → sent on a LATER run: "ya está aplicado, puedes verlo".
      if (applied) {
        const ack = "Perfecto. Aplicamos los cambios en tu campaña ahora mismo y en un momento te confirmo.";
        const confirm = "Te queremos comentar que ya hemos aplicado los cambios dentro de tu campaña — puedes ver los mensajes entrando en tu cuenta. Cualquier cosa, nos dices.";
        if (!dryRun) {
          const res = await sendToClient(m.from_email, subject, ack, inThread);
          sentId = res.messageId || null;
          // The confirmation replies to OUR ack, so both stay in the client's thread.
          const next = buildThreadHeaders({ messageId: sentId, refChain: inThread.references });
          await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: "confirm", subject: m.subject, reply: withSignoff(confirm), pending: true, thread_msg_id: sentId, thread_refs: next.references });
        }
        d.reply = ack;
      } else {
        // Couldn't apply (no draft yet) → a single, honest acknowledgement, no false "done".
        const ack = "¡Gracias! Tomo nota del cambio y lo dejo aplicado en tu campaña. Si quieres afinar algo más, dímelo por aquí.";
        if (!dryRun) sentId = (await sendToClient(m.from_email, subject, ack, inThread)).messageId || null;
        d.reply = ack;
      }
      results.push({ ...base, action: "copy_change", applied }); processed++; handled = true;
    }
    if (!handled && d.action === "send_copys" && known) {
      // Send a clean, branded PDF of the CURRENT campaign copy (all, or the named one) — never
      // paste the messages as text. Falls back to a normal reply if the PDF can't be built.
      if (!dryRun) {
        const res = await sendCopys(admin, clientId as string, prof?.company_name || dom, d.campaign || null, m.from_email, teamAcct, d.reply || "", inThread, subject);
        if (!res.ok) sentId = (await sendToClient(m.from_email, subject, d.reply || "¡Hola! Enseguida te preparo los mensajes y te los paso.", inThread)).messageId || null;
      }
      results.push({ ...base, action: "send_copys" }); processed++; handled = true;
    }
    if (!handled && d.action === "send_copys_later" && known) {
      // Commit now with a natural reply, and QUEUE the copys PDF to be delivered on a later run
      // (once it's ready) — "okey, nos ponemos y te lo envío en cuanto esté".
      if (!dryRun) {
        const res = await sendToClient(m.from_email, subject, d.reply || "Perfecto, nos ponemos ahora mismo y te envío los mensajes en cuanto estén listos.", inThread);
        sentId = res.messageId || null;
        const next = buildThreadHeaders({ messageId: sentId, refChain: inThread.references });
        await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: "deliver_copys", subject: m.subject, campaign: d.campaign || null, pending: true, thread_msg_id: sentId, thread_refs: next.references });
      }
      results.push({ ...base, action: "send_copys_later" }); processed++; handled = true;
    }
    if (!handled && d.action === "send_report" && known) {
      // Send the analytics/results report PDF. If there's no data yet, fall back to a reply.
      if (!dryRun) {
        const res = await sendAnalytics(admin, clientId as string, m.from_email, teamAcct, inThread);
        if (!res.ok) sentId = (await sendToClient(m.from_email, subject, d.reply || "¡Hola! En cuanto la campaña acumule datos suficientes te preparo el informe con los resultados y te lo envío.", inThread)).messageId || null;
      }
      results.push({ ...base, action: "send_report" }); processed++; handled = true;
    }
    if (!handled && d.action === "reply" && known) {
      if (!dryRun) sentId = (await sendToClient(m.from_email, subject, d.reply || "Gracias por tu mensaje, lo revisamos y te contamos.", inThread)).messageId || null;
      results.push({ ...base, action: "reply" }); processed++; handled = true;
    }
    if (!handled && d.action === "escalate") {
      // ESSENTIAL only (meeting/refund/money/cancellation/legal/serious complaint) → notify team@.
      // A NEW thread for the team, not a reply to the client's — hence no thread headers.
      if (!dryRun) {
        const html = textToHtml(`Atención al cliente — ESENCIAL, requiere tu decisión.\n\n${known ? `Cliente: ${prof?.company_name || dom}` : `Remitente (no es cliente): ${m.from_email}`}\nDe: ${m.from_email}\nAsunto: ${m.subject}\n\nQué pide: ${d.summary || "(sin resumen)"}\n\nMensaje:\n${body}`);
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", TEAM_EMAIL, `[Atención · esencial] ${prof?.company_name || m.from_email}`, html);
      }
      results.push({ ...base, action: "escalate" }); processed++; handled = true;
    }
    if (!handled) {
      // Non-essential / noise → do nothing, notify nobody. Just mark it processed.
      d.action = "ignore";
      results.push({ ...base, action: "ignore" });
    }

    if (!dryRun) {
      const t = buildThreadHeaders({ messageId: sentId || m.message_id, refChain: sentId ? inThread.references : m.ref_chain });
      await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: d.action || "ignore", inbound: body.slice(0, 1200), reply: (d.reply || "").slice(0, 1200), subject: m.subject, thread_msg_id: sentId, thread_refs: t.references });
    }
   } catch (e) {
     // Error is logged for the owner (visible in Automatización) — the client is told nothing.
     // The message was already claimed, so it is not retried forever: a permanently broken
     // email would otherwise re-fail on every tick and block the queue.
     if (!dryRun) { try { await admin.from("client_service_log").insert({ owner_id: ownerId, from_email: m.from_email, action: "error", subject: m.subject, reply: String((e as Error).message).slice(0, 500) }); } catch { /* */ } }
     results.push({ id: m.id, from: m.from_email, action: "error", error: String((e as Error).message) });
   }
  }

  return new Response(JSON.stringify({ processed, confirmed, skipped, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
