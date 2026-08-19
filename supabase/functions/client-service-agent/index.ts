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
const DEFAULT_ATENCION = `Eres la atención al cliente de OnePulso (agencia de cold email B2B). Tono humano, cercano, nunca defensivo. Responde en el idioma del cliente. Si piden una reunión, pasa https://calendly.com/onepulso/30min. Si piden un cambio de copy/asunto de su campaña, prepáralo. Dinero, cancelaciones, quejas serias, cambios de base de datos/leads o cualquier cosa dudosa: ESCALAR, nunca resolver por tu cuenta.`;

const domainOf = (email: string) => (email || "").toLowerCase().split("@")[1]?.trim() || "";

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
  const { owner_user_id, account_id, limit, dry_run } = await req.json().catch(() => ({} as any));
  const ownerId = owner_user_id || "b94a0bdf-0120-44cd-8c7d-51126bfc2075";
  const dryRun = !!dry_run; // dry_run: decide but NEVER send emails / edit campaigns / mark read

  // 1) Unprocessed inbound to the owner's connected mailboxes (skip warmup / our own sends).
  let q = admin.from("inbox_messages").select("*").eq("user_id", ownerId).eq("auto_replied", false).eq("is_sent", false).eq("is_warmup", false).order("received_at", { ascending: true }).limit(Math.min(limit || 15, 30));
  if (account_id) q = q.eq("account_id", account_id);
  const { data: msgs } = await q;
  if (!msgs?.length) return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Sending mailbox = the owner's team@ account (to reply/notify from).
  const { data: ownerAccts } = await admin.from("email_accounts").select("id, email, smtp_host, smtp_port, smtp_username, smtp_password, status").eq("user_id", ownerId).eq("status", "connected");
  const teamAcct = (ownerAccts || []).find((a: any) => /team@onepulso/i.test(a.email)) || (ownerAccts || [])[0];

  let processed = 0;
  const results: any[] = [];
  for (const m of msgs) {
    const fromEmail = (m.from_email || "").toLowerCase();
    const dom = domainOf(fromEmail);
    if (!dom || !teamAcct) { if (!dryRun) await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", m.id); continue; }

    // 2) Match the sender to a CLIENT by the domain of the client's own mailboxes.
    const { data: domAccts } = await admin.from("email_accounts").select("user_id, email").ilike("email", `%@${dom}`).neq("user_id", ownerId).limit(1);
    const clientId = (domAccts || [])[0]?.user_id;
    const body = (m.body_text || m.body_html || "").slice(0, 2500);

    if (!clientId) {
      // Not from a known client (newsletter, lead reply, tool notification…) → IGNORE.
      // Only emails whose domain matches a client's own mailboxes are handled.
      if (!dryRun) await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", m.id);
      results.push({ id: m.id, from: m.from_email, action: "skip_unknown" }); continue;
    }

    // Client context: profile + their draft campaigns (+ steps for possible copy edits).
    const { data: prof } = await admin.from("profiles").select("company_name, ai_reply_prompt").eq("user_id", clientId).maybeSingle();
    const { data: camps } = await admin.from("campaigns").select("id, name, status").eq("user_id", clientId).order("created_at", { ascending: false }).limit(3);
    const draft = (camps || []).find((c: any) => c.status === "draft") || (camps || [])[0];
    const { data: steps } = draft ? await admin.from("campaign_steps").select("id, step_order, subject, body").eq("campaign_id", draft.id).order("step_order") : { data: [] as any[] };

    const system = (prof?.ai_reply_prompt || DEFAULT_ATENCION) + `\n\nDevuelve SOLO JSON: {"action":"reply|copy_change|escalate","reply":"texto para el cliente","step_order":<n o null>,"new_subject":"<o null>","new_body":"<o null>","summary":"<qué pide, para el equipo>"}. Usa copy_change SOLO si el cliente pide claramente cambiar el asunto o el cuerpo de un email concreto y sabes exactamente qué poner; si tienes cualquier duda, usa escalate.`;
    const userMsg = `CLIENTE: ${prof?.company_name || dom}\nCAMPAÑA (borrador): ${draft?.name || "ninguna"}\nEMAILS ACTUALES:\n${(steps || []).map((s: any) => `#${s.step_order} asunto="${s.subject}" cuerpo="${(s.body || "").replace(/<[^>]+>/g, " ").slice(0, 300)}"`).join("\n") || "(sin pasos)"}\n\nCORREO DEL CLIENTE:\nDe: ${m.from_email}\nAsunto: ${m.subject}\n${body}`;

    let d: any = {};
    try { d = await decide(dkKey, system, userMsg); } catch { d = { action: "escalate", summary: "fallo IA" }; }

    const base = { id: m.id, client: prof?.company_name || dom, from: m.from_email, subject: m.subject, summary: d.summary || "", reply_preview: (d.reply || "").slice(0, 200) };

    if (d.action === "copy_change" && draft && steps?.length && (d.new_subject || d.new_body) && d.step_order != null) {
      const target = (steps as any[]).find((s: any) => s.step_order === Number(d.step_order));
      if (target) {
        if (!dryRun) {
          const upd: any = {}; if (d.new_subject) upd.subject = String(d.new_subject); if (d.new_body) upd.body = textToHtml(String(d.new_body));
          await admin.from("campaign_steps").update(upd).eq("id", target.id);
          const html = textToHtml(d.reply || `¡Hecho! Los cambios ya están aplicados en tu campaña. Puedes verlos entrando en tu cuenta. Cualquier otra cosa, aquí estamos.`);
          await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, `Re: ${m.subject || "tu campaña"}`, html);
        }
        results.push({ ...base, action: "copy_change", step: d.step_order }); processed++;
      } else { d.action = "escalate"; }
    }
    if (d.action === "reply") {
      if (!dryRun) {
        const html = textToHtml(d.reply || "Gracias por tu mensaje, lo revisamos y te contamos.");
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, `Re: ${m.subject || ""}`.trim(), html);
      }
      results.push({ ...base, action: "reply" }); processed++;
    }
    if (d.action === "escalate" || (!["reply", "copy_change"].includes(d.action))) {
      if (!dryRun) {
        const html = textToHtml(`Atención al cliente — requiere tu decisión.\n\nCliente: ${prof?.company_name || dom}\nDe: ${m.from_email}\nAsunto: ${m.subject}\n\nQué pide: ${d.summary || "(sin resumen)"}\n\nMensaje:\n${body}`);
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", TEAM_EMAIL, `[Atención] ${prof?.company_name || m.from_email}`, html);
      }
      results.push({ ...base, action: "escalate" }); processed++;
    }

    if (!dryRun) await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", m.id);
  }

  return new Response(JSON.stringify({ processed, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
