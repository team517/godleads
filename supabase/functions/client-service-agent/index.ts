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
// SAFETY: never activates a campaign; only edits copy of DRAFT campaigns; anything the model
// isn't fully sure about is ESCALATED, never applied. NOT scheduled by default — deploy and
// TEST before enabling any cron. Reuses the proven SMTP + DeepSeek patterns of the platform.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEAM_EMAIL = "team@onepulso.online";
const DEFAULT_ATENCION = `Eres la atención al cliente de OnePulso (agencia de cold email B2B). Tono humano, cercano, decisivo, nunca defensivo. Responde en el idioma del cliente.
- NUNCA pidas el email ni datos de identidad: YA SABES de qué cliente es (lo identificamos por su dominio). Trátalo por su empresa, con naturalidad.
- Reunión → pasa https://calendly.com/onepulso/30min.
- Cambio de copy/asunto/mensaje de su campaña: NO des largas ni pidas mil confirmaciones. Si te dice qué cambiar, aplícalo. Si el cambio es razonable pero no te da el texto exacto, redacta tú una buena versión coherente con lo que pide y aplícala. Dile "vale, lo aplico" y hazlo; SIN esperar más respuestas. Cuando esté hecho, confírmale por correo que ya está aplicado y que puede verlo en su campaña.
- Dinero, cancelaciones, quejas serias, cambios de base de datos/leads, algo legal o cualquier cosa dudosa: ESCALAR a team@onepulso.online, nunca resolver por tu cuenta.`;

const domainOf = (email: string) => (email || "").toLowerCase().split("@")[1]?.trim() || "";

// Strip quoted history + MIME/header noise so the model reads ONLY the client's new message.
function cleanBody(raw: string): string {
  let t = (raw || "").replace(/\r/g, "");
  const markers = [/\nOn .+ wrote:/i, /\nEl .+ escribi[oó]:/i, /\n-{2,}\s*Forwarded/i, /\n_{5,}/, /\nDe: .+\nEnviado:/i, /\nFrom: .+\nSent:/i];
  for (const rx of markers) { const mm = t.match(rx); if (mm && mm.index != null && mm.index > 20) t = t.slice(0, mm.index); }
  t = t.split("\n")
    .filter((l) => !/^--[0-9a-f]{8,}/i.test(l) && !/^BODY\[/i.test(l) && !/^Content-(Type|Transfer|Disposition)/i.test(l) && !/^>+/.test(l.trim()))
    .join("\n");
  return t.trim().slice(0, 2500);
}

function textToHtml(text: string): string {
  if (/<(p|div|br)\b/i.test(text)) return text;
  return text.split(/\n\n+/).filter((p) => p.trim()).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

// ── SMTP send (same flow as process-auto-replies) ──────────────────────────────
async function sendSmtp(host: string, port: number, username: string, password: string, from: string, fromName: string | null, to: string, subject: string, bodyHtml: string): Promise<{ ok: boolean; error?: string }> {
  try {
    let conn: Deno.Conn = port === 465 ? await Deno.connectTls({ hostname: host, port }) : await Deno.connect({ hostname: host, port });
    const read = async () => { const b = new Uint8Array(4096); const n = await conn.read(b); return new TextDecoder().decode(b.subarray(0, n || 0)); };
    const send = async (cmd: string) => { await conn.write(new TextEncoder().encode(cmd + "\r\n")); return await read(); };
    const msg = () => `From: ${fromName ? `"${fromName}" <${from}>` : from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${bodyHtml}\r\n.\r\n`;
    await read();
    if (port === 587) {
      const ehlo = await send("EHLO onepulso");
      if (ehlo.includes("STARTTLS")) {
        await conn.write(new TextEncoder().encode("STARTTLS\r\n")); await read();
        conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
      }
    }
    await send("EHLO onepulso");
    const auth = await send(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `auth: ${auth.trim().slice(0, 60)}` }; }
    await send(`MAIL FROM:<${from}>`); await send(`RCPT TO:<${to}>`); await send("DATA");
    const data = await send(msg()); await send("QUIT"); conn.close();
    return data.includes("250") ? { ok: true } : { ok: false, error: `send: ${data.trim().slice(0, 60)}` };
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

  // ── Step 2 of a copy change: send the queued "ya está aplicado" confirmation ────────
  // A copy_change first sends a quick "vale, lo aplicamos" ack and queues the confirmation
  // (pending=true). Here, on a LATER run (≥90s after), we send that confirmation — so the
  // client gets two natural, separated emails instead of two at once.
  let confirmed = 0;
  if (!dryRun && teamAcct) {
    const { data: pend } = await admin.from("client_service_log")
      .select("id, from_email, subject, reply")
      .eq("owner_id", ownerId).eq("pending", true)
      .lt("created_at", new Date(Date.now() - 90 * 1000).toISOString())
      .order("created_at", { ascending: true }).limit(10);
    for (const p of (pend as any[]) || []) {
      try {
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", p.from_email, `Re: ${p.subject || "tu campaña"}`, textToHtml(p.reply || "Ya hemos aplicado los cambios en tu campaña, puedes ver los mensajes. Cualquier cosa, nos dices."));
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
  if (!msgs?.length) return new Response(JSON.stringify({ processed: 0, confirmed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let processed = 0;
  const results: any[] = [];
  for (const m of msgs) {
   try {
    const fromEmail = (m.from_email || "").toLowerCase();
    const dom = domainOf(fromEmail);
    if (!dom || !teamAcct) { if (!dryRun) await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", m.id); continue; }

    // 2) Match the sender to a CLIENT. A client may write from a personal address (gmail…),
    //    so try, in order: (a) their registered account/login email; (b) their profile contact
    //    email; (c) the domain of their own mailboxes. First hit wins.
    let clientId: string | null = null;
    try { const { data: byMail } = await admin.rpc("automation_client_by_email", { p_email: fromEmail }); if (byMail) clientId = byMail as any; } catch { /* rpc optional */ }
    if (!clientId) { const { data: byContact } = await admin.from("profiles").select("user_id").ilike("contact_email", fromEmail).neq("user_id", ownerId).limit(1); clientId = (byContact || [])[0]?.user_id || null; }
    if (!clientId && dom) { const { data: domAccts } = await admin.from("email_accounts").select("user_id").ilike("email", `%@${dom}`).neq("user_id", ownerId).limit(1); clientId = (domAccts || [])[0]?.user_id || null; }
    const known = !!clientId;
    const body = cleanBody(m.body_text || m.body_html || "");

    // Client context: profile + their draft campaigns (+ steps for possible copy edits).
    const { data: prof } = await admin.from("profiles").select("company_name, ai_reply_prompt").eq("user_id", clientId).maybeSingle();
    const { data: camps } = await admin.from("campaigns").select("id, name, status").eq("user_id", clientId).order("created_at", { ascending: false }).limit(3);
    const draft = (camps || []).find((c: any) => c.status === "draft") || (camps || [])[0];
    const { data: steps } = draft ? await admin.from("campaign_steps").select("id, step_order, subject, body").eq("campaign_id", draft.id).order("step_order") : { data: [] as any[] };

    // Conversation memory with THIS client — so it never repeats an answer.
    const { data: logRows } = await admin.from("client_service_log").select("action, inbound, reply").eq("client_user_id", clientId).order("created_at", { ascending: false }).limit(8);
    const convPrev = (logRows || []).reverse().map((r: any) => `Cliente: ${(r.inbound || "").slice(0, 220)}\nTú (${r.action}): ${(r.reply || "").slice(0, 220)}`).join("\n---\n");

    const system = (prof?.ai_reply_prompt || DEFAULT_ATENCION)
      + (convPrev ? `\n\nCONVERSACIÓN PREVIA con este cliente (lo más reciente abajo):\n${convPrev}\n\nNO repitas respuestas anteriores. Ten en cuenta TODO este contexto. Si el cliente insiste en algo ya tratado (p.ej. una devolución), gestiónalo de forma DIFERENTE y con más contexto — no copies la respuesta de antes.` : "")
      + `\n\n${known ? "Este remitente ES un cliente conocido (su dominio cuadra con una cuenta registrada)." : "Este remitente NO es un cliente conocido (su dominio no cuadra con ninguna cuenta registrada)."}`
      + `\n\nDevuelve SOLO JSON: {"action":"reply|copy_change|escalate|ignore","reply":"texto para el cliente","step_order":<n o null>,"new_subject":"<o null>","new_body":"<o null>","find":"<texto exacto a sustituir en TODOS los emails, o null>","replace_with":"<texto nuevo, o null>","summary":"<qué pide, para el equipo>"}.
- "reply": SOLO si es un cliente conocido con una duda/objeción/consulta rutinaria → respóndele tú con naturalidad y resuélvelo.
- "copy_change": cliente conocido pide cambiar el asunto/cuerpo/nombre/firma de su campaña → aplícalo tú (NO pidas datos ni el email). Para cambiar UN email concreto usa step_order + new_subject/new_body. Para un cambio que afecta a TODOS los emails (p.ej. cambiar un nombre o firma como "Xavi" por "José", un enlace o una palabra) usa find + replace_with con el texto EXACTO tal cual aparece. En "reply" confirma que YA está aplicado.
- "escalate": SOLO cosas ESENCIALES que necesitan a una persona del equipo: una REUNIÓN/llamada, una DEVOLUCIÓN o reembolso, dinero/pagos, una cancelación, un tema legal o una queja seria. Solo esto se avisa a team@onepulso.online.
- "ignore": todo lo demás NO esencial — ruido, newsletters, agradecimientos, confirmaciones, o un remitente desconocido sin nada importante. NO se avisa a nadie.
REGLA CLAVE: NO avises al equipo por cada correo. Usa "escalate" ÚNICAMENTE para lo esencial (reunión/devolución/dinero/cancelación/legal/queja seria). Si el remitente NO es un cliente conocido, usa SOLO "escalate" (si es esencial) o "ignore" — nunca "reply" ni "copy_change".`;
    const userMsg = (known
      ? `CLIENTE: ${prof?.company_name || dom}\nCAMPAÑA (borrador): ${draft?.name || "ninguna"}\nEMAILS ACTUALES:\n${(steps || []).map((s: any) => `#${s.step_order} asunto="${s.subject}" cuerpo="${(s.body || "").replace(/<[^>]+>/g, " ").slice(0, 300)}"`).join("\n") || "(sin pasos)"}\n\n`
      : `REMITENTE DESCONOCIDO (no es un cliente registrado).\n\n`)
      + `CORREO RECIBIDO:\nDe: ${m.from_email}\nAsunto: ${m.subject}\n${body}`;

    let d: any = {};
    try { d = await decide(dkKey, system, userMsg); } catch { d = { action: "ignore", summary: "fallo IA" }; }
    // A non-client can only be escalated (if essential) or ignored — never auto-replied or copy-edited.
    if (!known && (d.action === "reply" || d.action === "copy_change")) d.action = "ignore";

    const base = { id: m.id, client: prof?.company_name || dom, from: m.from_email, subject: m.subject, summary: d.summary || "", reply_preview: (d.reply || "").slice(0, 200) };

    let handled = false;
    if (d.action === "copy_change" && known) {
      // Apply the change to the client's DRAFT campaign. Two shapes: a global find/replace
      // across ALL steps (name/signature/word), or a specific step's subject/body.
      let applied = false;
      if (steps?.length) {
        const doGlobal = d.find && d.replace_with != null;
        const doStep = d.step_order != null && (d.new_subject || d.new_body);
        if (dryRun) {
          applied = !!(doGlobal || doStep);
        } else if (doGlobal) {
          const find = String(d.find);
          for (const s of steps as any[]) {
            const ns = String(s.subject || "").split(find).join(String(d.replace_with));
            const nb = String(s.body || "").split(find).join(String(d.replace_with));
            if (ns !== s.subject || nb !== s.body) { await admin.from("campaign_steps").update({ subject: ns, body: nb }).eq("id", s.id); applied = true; }
          }
        } else if (doStep) {
          const target = (steps as any[]).find((s: any) => s.step_order === Number(d.step_order));
          if (target) { const upd: any = {}; if (d.new_subject) upd.subject = String(d.new_subject); if (d.new_body) upd.body = textToHtml(String(d.new_body)); await admin.from("campaign_steps").update(upd).eq("id", target.id); applied = true; }
        }
      }
      // TWO-STEP so the client never gets two emails at once:
      //  1) now → a short ack ("vale, perfecto, aplicamos los cambios");
      //  2) queued (pending) → sent on a LATER run: "ya está aplicado, puedes verlo".
      if (applied) {
        const ack = "¡Vale, perfecto! Aplicamos los cambios en tu campaña ahora mismo. En un momento te confirmo. 👍";
        const confirm = "Te queremos comentar que ya hemos aplicado los cambios dentro de tu campaña — puedes ver los mensajes entrando en tu cuenta. Cualquier cosa, nos dices.";
        if (!dryRun) {
          await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, `Re: ${m.subject || "tu campaña"}`, textToHtml(ack));
          await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: "confirm", subject: m.subject, reply: confirm, pending: true });
        }
        d.reply = ack;
      } else {
        // Couldn't apply (no draft yet) → a single, honest acknowledgement, no false "done".
        const ack = "¡Gracias! Tomo nota del cambio y lo dejo aplicado en tu campaña. Si quieres afinar algo más, dímelo por aquí.";
        if (!dryRun) await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, `Re: ${m.subject || "tu campaña"}`, textToHtml(ack));
        d.reply = ack;
      }
      results.push({ ...base, action: "copy_change", applied }); processed++; handled = true;
    }
    if (!handled && d.action === "reply" && known) {
      if (!dryRun) {
        const html = textToHtml(d.reply || "Gracias por tu mensaje, lo revisamos y te contamos.");
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, `Re: ${m.subject || ""}`.trim(), html);
      }
      results.push({ ...base, action: "reply" }); processed++; handled = true;
    }
    if (!handled && d.action === "escalate") {
      // ESSENTIAL only (meeting/refund/money/cancellation/legal/serious complaint) → notify team@.
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
      await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: d.action || "ignore", inbound: body.slice(0, 1200), reply: (d.reply || "").slice(0, 1200) });
      await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", m.id);
    }
   } catch (e) {
     // Error is logged for the owner (visible in Automatización) — the client is told nothing.
     if (!dryRun) { try { await admin.from("client_service_log").insert({ owner_id: ownerId, from_email: m.from_email, action: "error", reply: String((e as Error).message).slice(0, 500) }); } catch { /* */ } }
     results.push({ id: m.id, from: m.from_email, action: "error", error: String((e as Error).message) });
   }
  }

  return new Response(JSON.stringify({ processed, confirmed, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
