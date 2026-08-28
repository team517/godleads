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
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { buildCopyDoc } from "../_shared/report/buildCopyPdf.ts";
import { ONEPULSO_LOGO_WHITE_DATAURL, ONEPULSO_LOGO_RATIO } from "../_shared/report/onepulsoLogoWhite.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEAM_EMAIL = "team@onepulso.online";
const CAMPAIGN_FORM_URL = "https://forms.gle/QuZsPwTcwkmB6qoF7"; // OnePulso campaign briefing form
const DEFAULT_ATENCION = `Eres la atención al cliente de OnePulso (agencia de cold email B2B). Tono humano, cercano, decisivo, nunca defensivo. Responde en el idioma del cliente.
- PIENSA CON CRITERIO antes de actuar. Eres un buen responsable de cuenta: en cada correo párate a pensar qué respuesta da la MEJOR imagen de OnePulso (profesional PERO humana y cercana) y qué es lo más útil para el cliente AHORA. Muchas veces lo mejor es una respuesta clara, natural y bien escrita — no un recurso automático.
- ESCRIBE BIEN: correos limpios y bien ESTRUCTURADOS. Saludo breve (por su nombre si lo sabes), un cuerpo claro y ordenado (frases cortas, y si hay varios puntos sepáralos en líneas), y cierre. Redacción profesional y natural. NO uses emojis NUNCA.
- RESPUESTAS INTELIGENTES Y ÚTILES: responde con DATOS REALES del contexto (nº de cuentas de envío, nº de emails de la campaña, nombres/fechas de sus campañas, lo que ya se habló). Sé CONCRETO, nunca genérico ni con relleno vacío: contesta exactamente lo que pregunta y da el dato o el siguiente paso. Si te preguntan algo que sabes (p.ej. "¿cuántos emails tiene mi campaña?", "¿cuántas cuentas tengo?", "¿cómo se llama la campaña?"), respóndelo con el número/nombre exacto. Anticípate: si tras resolver algo hay un paso lógico siguiente, ofrécelo en una frase. Ajusta el tono al del cliente (si es breve, sé breve). Si de verdad no tienes un dato, di con naturalidad qué vas a hacer para tenerlo — nunca inventes cifras ni prometas lo que no puedes.
- NO respondas siempre por responder. Si la conversación llega a un cierre natural (el cliente dice "hablamos más adelante", "cuando esté me dices", "ok gracias", "perfecto"), dale una respuesta natural, breve y humana (p.ej. "Perfecto, nos ponemos ahora mismo y te aviso en cuanto esté") y cierra ahí — no alargues ni fuerces nada. Si de verdad no hace falta decir nada, no respondas (ignore).
- Si te comprometes a enviar algo cuando esté listo (p.ej. los mensajes de la campaña), respóndele natural que os ponéis con ello y se lo envías en cuanto esté; y cuando lo tengas, se lo envías (con PDF si hace falta). Usa "send_copys_later" para eso.
- Los PDFs salen por CRITERIO TUYO, no por insistencia del cliente. Cuando TÚ valoras que ese contenido se PRESENTA mejor y más profesional en un PDF limpio con logo (típicamente: el CONJUNTO de mensajes/copys de la campaña, o un informe de resultados), piensas "esto queda mejor en PDF" y lo generas y lo envías. Si es una duda puntual, una pregunta corta o algo que se resuelve mejor hablando, RESPONDE con palabras — no por que el cliente lo pida o insista, sino porque tú ves que es la mejor forma de presentarlo.
- AISLAMIENTO ESTRICTO (MUY IMPORTANTE): SOLO puedes ver, cambiar o enviar la campaña de la cuenta del PROPIO remitente (la identificada por su dominio/correo registrado). NUNCA toques ni menciones datos de OTRA empresa. Si el remitente pide modificar/ver la campaña de OTRA empresa, o dice ser de otra empresa distinta a su cuenta, o pide aplicar cambios "a otro cliente", NO lo hagas: responde con naturalidad que solo puedes gestionar su propia campaña, o ignóralo/escálalo si es raro. Cada cliente SOLO puede tocar LO SUYO.
- NUNCA pidas el email ni datos de identidad: YA SABES de qué cliente es. Trátalo por su empresa, con naturalidad.
- MÁS CUENTAS DE CORREO / BUZONES: si el cliente pide más cuentas de correo, gestiónalo TÚ por conversación (acción "reply"), NO lo escales todavía. (1) Si NO dice CUÁNTAS, pregúntale amablemente cuántas cuentas necesita. (2) Cuando te diga el número, CALCULA el precio a 2€ por cuenta (p.ej. 3 cuentas = 6€, 10 cuentas = 20€) y díselo claro, y pídele que confirme. (3) Si confirma, dale el correo team@onepulso.online para terminar el trámite, explicándole que es el correo desde el que gestionamos este tipo de altas/acciones, y derívalo allí (que escriba a team@ para completarlo). Usa la CONVERSACIÓN PREVIA para saber en qué punto vais (si ya dio el número, no se lo vuelvas a preguntar; si ya confirmó, dale el correo de team@).
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

// Strip emojis / pictographs — OnePulso emails are clean and professional, no emojis.
function stripEmojis(text: string): string {
  return (text || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Every client-facing message: no emojis + ends with the OnePulso sign-off.
const SIGN = "Un saludo,\nEquipo de OnePulso · OnePulso Team";
function withSignoff(text: string): string {
  const t = stripEmojis(text || "");
  if (/onepulso team|equipo de onepulso/i.test(t)) return t;
  return `${t}\n\n${SIGN}`;
}

// Build the outgoing HTML with the sign-off GLUED to the last paragraph (no blank-line
// boundary before it). Otherwise Gmail sees the identical trailing signature block and hides
// it behind a "…" (trimmed content) toggle. Gluing it to the unique last line keeps it inline.
function signedHtml(text: string): string {
  const clean = withSignoff(text || ""); // strips emojis + ensures the sign-off is present
  const blocks = clean.split(/\n\n+/).map((b) => b.trim().replace(/\n/g, "<br>")).filter(Boolean);
  if (blocks.length >= 2) {
    const sign = blocks.pop() as string;                 // the sign-off block
    blocks[blocks.length - 1] += `<br><br>${sign}`;      // glue it onto the previous paragraph
  }
  return blocks.map((b) => `<p style="margin:0 0 10px">${b}</p>`).join("") || `<p>${clean.replace(/\n/g, "<br>")}</p>`;
}

// Email for a "crear campaña nueva" request: friendly intro + the Google Form link + how it
// works, ending with the sign-off. No onboarding is sent (this is for existing clients).
function newCampaignHtml(intro: string): string {
  const body = stripEmojis(intro && intro.trim() ? intro : "¡Claro que sí! Encantados de prepararos una nueva campaña.");
  return `<p style="margin:0 0 10px">${body.replace(/\n/g, "<br>")}</p>`
    + `<p style="margin:0 0 10px">Para empezar, solo necesitamos que nos contéis los detalles rellenando este formulario:</p>`
    + `<p style="margin:0 0 14px"><a href="${CAMPAIGN_FORM_URL}" style="background:#6e58f1;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;display:inline-block">Rellenar el formulario</a></p>`
    + `<p style="margin:0 0 10px">En cuanto lo tengamos, validamos la información y creamos la campaña. Cualquier duda, aquí estamos.<br><br>${SIGN.replace(/\n/g, "<br>")}</p>`;
}

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
async function sendCopys(admin: any, clientId: string, companyName: string, campaignFilter: string | null, toEmail: string, teamAcct: any, leadMessage: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const built = await buildCopysBase64(admin, clientId, companyName, campaignFilter);
    if (!built) return { ok: false, error: "sin campañas" };
    const message = withSignoff(leadMessage && leadMessage.trim() ? leadMessage : "¡Hola! Aquí tienes los mensajes completos de tu campaña, tal cual están ahora mismo, en un PDF ordenado. Échales un vistazo con calma y me dices cualquier cosa.");
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
      body: JSON.stringify({ mode: "send_copys", secret: Deno.env.get("REPORTS_CRON_SECRET"), to: toEmail, from_account_id: teamAcct.id, subject: "Los mensajes de tu campaña", message, pdf_base64: built.base64 }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.error };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// Send the analytics/results report to the client via send-report (built server-side).
async function sendAnalytics(admin: any, clientId: string, toEmail: string, teamAcct: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
      body: JSON.stringify({ mode: "manual", secret: Deno.env.get("REPORTS_CRON_SECRET"), client_user_id: clientId, kind: "48h", test_to: toEmail, from_account_id: teamAcct.id }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.error };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// OnePulso campaign copy structure (same as CAMPAIGN_SKILLS in the frontend) — used to
// generate a NEW campaign from the client's form answers, server-side, via DeepSeek.
const CAMPAIGN_STRUCTURE = `Eres el copywriter de OnePulso (cold email B2B). Escribes la secuencia de EMAILS que la EMPRESA CLIENTE enviará a SUS leads. ESTRUCTURA del email inicial: 1) 'Hola {{first_name}},'. 2) Presentación personal: 'Soy [nombre] de [empresa que envía]'. 3) Gancho personalizado: 'Estuve viendo {{company_name}} y cómo trabajáis dentro de {{industry}}, y quería compartirte algo que creo que os puede encajar'. 4) Qué hacéis, claro y breve. 5) Cómo funciona / qué incluye. 6) Qué CONSIGUEN ellos (beneficios concretos y tangibles). 7) 'La idea es que {{company_name}} [beneficio] sin [dolor]'. 8) 'He preparado un ejemplo pensado específicamente para vuestra empresa'. 9) CTA suave: '¿Te vendría bien verlo en 10 minutos esta semana?'. 10) Firma: nombre + empresa. ENFOCA TODO EN BENEFICIOS (lo que CONSEGUIRÁN). Habla de ELLOS ({{company_name}}) más que de la industria; usa mucho {{first_name}} {{company_name}} {{industry}} {{city}} para que parezca muy personalizado aunque sea general. SIN emojis, voz cercana y directa, bien estructurado. LONGITUD: inicial 150-170 palabras; follow-ups 100-135. Follow-ups a 1-2 días, misma voz, referenciando el anterior y rematando con el beneficio. Cada step con 1 variante de ángulo distinto (p.ej. una de ventas/cliente ideal y otra creativa).`;

// Generate a 3-step campaign (each with 1 variant) from a briefing, via DeepSeek.
async function genCampaignSteps(apiKey: string, briefing: string, company: string, language: string): Promise<any[]> {
  const system = `${CAMPAIGN_STRUCTURE}\n\nIdioma: ${language}. Empresa que envía (el cliente): ${company || "(el cliente)"}. Devuelve SOLO JSON con esta forma EXACTA: {"steps":[{"subject":"...","body":"<p>...</p><p>...</p>","variants":[{"subject":"...","body":"<p>...</p><p>...</p>"}]},{"subject":"...","body":"...","variants":[{"subject":"...","body":"..."}]},{"subject":"...","body":"...","variants":[{"subject":"...","body":"..."}]}]}. OBLIGATORIO: EXACTAMENTE 3 steps (1 inicial + 2 follow-ups) y CADA step DEBE llevar su array "variants" con EXACTAMENTE 1 variante NO vacía (mismo mensaje con otro ángulo). NUNCA dejes "variants" vacío. "subject" y "body" son texto; "body" en HTML con <p>...</p>.`;
  const user = `BRIEFING DEL CLIENTE (respuestas de su formulario):\n${briefing || "(sin briefing)"}\n\nGenera la campaña.`;
  const d = await decide(apiKey, system, user);
  const raw = Array.isArray(d?.steps) ? d.steps : [];
  return raw.slice(0, 3).map((s: any, i: number) => ({
    subject: String(s?.subject || "").trim(),
    body: s?.body || "",
    delay_days: i === 0 ? 0 : 2,
    variants: Array.isArray(s?.variants) ? s.variants.filter((v: any) => v && (v.subject || v.body)).map((v: any) => ({ subject: String(v.subject || "").trim(), body: v.body || "" })) : [],
  })).filter((s: any) => s.subject || s.body);
}

// Phase 2 of "crear campaña nueva": for each awaiting_form request, if a matching form
// response has arrived, generate the DRAFT campaign, notify team@ (pending approval), and
// mark the request pending_approval. Runs each tick (like the pending processor).
async function processNewCampaigns(admin: any, ownerId: string, dkKey: string, teamAcct: any): Promise<number> {
  // Recover requests stuck in "generating" (crash mid-run): if a campaign was ALREADY created,
  // finalize to pending_approval (avoid creating a 2nd one); otherwise retry from awaiting_form.
  await admin.from("new_campaign_requests").update({ status: "pending_approval", updated_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("status", "generating").not("campaign_id", "is", null).lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  await admin.from("new_campaign_requests").update({ status: "awaiting_form" }).eq("owner_id", ownerId).eq("status", "generating").is("campaign_id", null).lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  const { data: reqs } = await admin.from("new_campaign_requests").select("*").eq("owner_id", ownerId).eq("status", "awaiting_form").order("requested_at", { ascending: true }).limit(5);
  let generated = 0;
  for (const r of (reqs as any[]) || []) {
    try {
      const { data: resps } = await admin.from("form_responses").select("id, respondent_email, answers, received_at").eq("owner_id", ownerId).gt("received_at", r.requested_at).order("received_at", { ascending: false }).limit(50);
      const fromDom = (r.from_email || "").toLowerCase().split("@")[1] || "";
      const comp = (r.company_name || "").toLowerCase().trim();
      const match = (resps as any[] || []).find((x) => {
        const re = (x.respondent_email || "").toLowerCase();
        if (re && re === (r.from_email || "").toLowerCase()) return true;             // exact email
        if (re && fromDom && re.split("@")[1] === fromDom) return true;                // same domain
        if (comp && comp.length >= 3) { const t = JSON.stringify(x.answers || {}).toLowerCase(); if (t.includes(comp)) return true; } // company in answers
        return false;
      });
      if (!match) continue; // still waiting for the form
      // ATOMIC CLAIM: awaiting_form → generating (conditional). If another run claimed it, skip.
      const { data: claimed } = await admin.from("new_campaign_requests").update({ status: "generating", form_response_id: match.id, updated_at: new Date().toISOString() }).eq("id", r.id).eq("status", "awaiting_form").select("id");
      if (!claimed || !(claimed as any[]).length) continue; // another run is handling it
      // Safety: if this request somehow already has a campaign, don't create a second one.
      if (r.campaign_id) { await admin.from("new_campaign_requests").update({ status: "pending_approval" }).eq("id", r.id); continue; }
      const briefing = Object.entries(match.answers || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("\n");
      let steps: any[] = [];
      for (let a = 0; a < 2 && steps.length === 0; a++) { try { steps = await genCampaignSteps(dkKey, briefing, r.company_name || "", "castellano de España"); } catch { /* retry */ } }
      if (!steps.length) { await admin.from("new_campaign_requests").update({ status: "error", note: "la IA no generó la campaña" }).eq("id", r.id); continue; }
      const name = `Campaña · ${r.company_name || r.from_email}`;
      const { data: camp } = await admin.from("campaigns").insert({ user_id: r.client_user_id, name, status: "draft", timezone: "Europe/Madrid", send_days: ["mon", "tue", "wed", "thu", "fri"], ab_test_enabled: true, stop_on_reply: true, text_only_emails: true, first_email_text_only: true, unsubscribe_all: true, send_start_hour: 9, send_end_hour: 18 }).select("id").single();
      const cid = (camp as any)?.id;
      if (!cid) { await admin.from("new_campaign_requests").update({ status: "error", note: "no se pudo crear la campaña" }).eq("id", r.id); continue; }
      for (let i = 0; i < steps.length; i++) { const s = steps[i]; await admin.from("campaign_steps").insert({ campaign_id: cid, step_order: i, subject: s.subject, body: s.body, delay_days: s.delay_days, variants: s.variants }); }
      const html = textToHtml(`Nueva campaña generada y PENDIENTE DE TU APROBACIÓN.\n\nCliente: ${r.company_name || r.from_email}\nCampaña (borrador): ${name}\nEmails: ${steps.length} (con variantes).\n\nEntra en la plataforma → Automatización → "Clientes en el flujo" para revisarla y aprobarla. Al aprobar, se le envían los copys al cliente.`);
      await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", TEAM_EMAIL, `[Nueva campaña] ${r.company_name || r.from_email} pendiente de aprobar`, html);
      await admin.from("new_campaign_requests").update({ status: "pending_approval", campaign_id: cid, campaign_name: name, form_response_id: match.id, updated_at: new Date().toISOString() }).eq("id", r.id);
      generated++;
    } catch (e) { try { await admin.from("new_campaign_requests").update({ status: "error", note: String((e as Error).message).slice(0, 300) }).eq("id", r.id); } catch { /* */ } }
  }
  return generated;
}

// Normalize a Message-ID to <...> form for headers.
const wrapId = (id: string) => { const t = (id || "").trim(); return !t ? "" : (t.startsWith("<") ? t : `<${t}>`); };

// ── SMTP send (same flow as process-auto-replies) ──────────────────────────────
// opts.inReplyTo / opts.references thread the reply to the ORIGINAL message by Message-ID
// (In-Reply-To + References). Without them, clients thread by SUBJECT — and since many clients
// share the same subject ("Re: Empezamos con tu campaña"), the reply could land in the wrong
// conversation. Message-ID threading pins it to the exact original thread.
async function sendSmtp(host: string, port: number, username: string, password: string, from: string, fromName: string | null, to: string, subject: string, bodyHtml: string, opts?: { inReplyTo?: string; references?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    port = Number(port) || 587; // coerce (a string port would skip the TLS/STARTTLS branches)
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
async function decide(apiKey: string, system: string, user: string, temp = 0.3): Promise<any> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "deepseek-chat", temperature: temp, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
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

  // ── FOLLOWUP: propone SOLO el cuerpo de un email de seguimiento, limpio (para Seguimiento) ──
  if (input.action === "followup") {
    const name = String(input.contact_name || "").split(/[ @]/)[0].trim();
    const hist = Array.isArray(input.history) ? input.history.map((h: any) => `${h.role === "user" ? "ELLOS" : "NOSOTROS"}: ${h.text}`).join("\n") : "";
    const system = `Eres un comercial de OnePulso escribiendo un email de SEGUIMIENTO a un contacto con el que YA hay una conversación. Devuelve EXCLUSIVAMENTE el CUERPO del email, listo para enviarse tal cual.
REGLAS ESTRICTAS:
- Empieza con "Hola ${name || "[nombre]"},".
- NADA de meta-comentarios (nada de "te propongo", "aquí tienes una opción", "¿te encaja?", "puedo adaptarlo"). Solo el email.
- NO escribas "Asunto:" ni ninguna línea de asunto. NO uses corchetes ni placeholders ([Nombre], [Tu nombre], [empresa]).
- Retoma el hilo con naturalidad según la conversación previa. Breve: 3-6 líneas. Frases cortas, bien estructurado, párrafos separados por una línea en blanco.
- Un solo CTA claro (una llamada corta o una respuesta). SIN emojis.
- Termina exactamente con:\nUn saludo,\nEquipo de OnePulso
Devuelve solo el texto del email, sin comillas ni markdown.`;
    const user = `${hist ? "CONVERSACIÓN PREVIA (lo más reciente abajo):\n" + hist + "\n\n" : ""}${input.hint ? "Indicación del usuario: " + input.hint + "\n\n" : ""}Escribe el email de seguimiento para ${input.contact_name || "el contacto"}.`;
    let text = "";
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${dkKey}` },
        body: JSON.stringify({ model: "deepseek-chat", temperature: 0.4, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      const j = await res.json();
      text = j?.choices?.[0]?.message?.content || "";
    } catch { /* */ }
    // Saneado: quita comillas envolventes, markdown, líneas "Asunto:", separadores y placeholders sobrantes.
    text = stripEmojis(text).replace(/^\s*["'`]+|["'`]+\s*$/g, "").replace(/\*\*/g, "").replace(/^\s*-{3,}\s*$/gm, "")
      .replace(/^\s*asunto\s*:.*$/gim, "").replace(/\[tu nombre\]/gi, "Equipo de OnePulso").replace(/\n{3,}/g, "\n\n").trim();
    return new Response(JSON.stringify({ reply: text || "Hola, retomo el hilo por si te viene bien que lo veamos. ¿Te va bien una llamada corta esta semana?\n\nUn saludo,\nEquipo de OnePulso" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

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
  // prospect_only: process ONLY the prospect auto-reply path (interested→calendar / else nothing)
  // and skip all the client-service machinery. Used for the cold-email accounts of an enabled user.
  const prospectOnly = !!input.prospect_only;

  // Sending mailbox = the configured service inbox (account_id) if given, else team@/support@.
  const { data: ownerAccts } = await admin.from("email_accounts").select("id, email, smtp_host, smtp_port, smtp_username, smtp_password, status").eq("user_id", ownerId).eq("status", "connected");
  const teamAcct = (account_id ? (ownerAccts || []).find((a: any) => a.id === account_id) : null)
    || (ownerAccts || []).find((a: any) => /team@onepulso|support@onepulso/i.test(a.email)) || (ownerAccts || [])[0];

  // Owner-level AI auto-reply config for PROSPECTS (cold-email replies on this mailbox).
  // Gated on both the toggle AND a calendar link → nothing auto-sends until both are set.
  const { data: ownerProf } = await admin.from("profiles").select("ai_reply_enabled, ai_reply_prompt, ai_reply_calendar_url, ai_reply_mode").eq("user_id", ownerId).maybeSingle();
  let prospectCal = String((ownerProf as any)?.ai_reply_calendar_url || "").trim();
  let prospectActive = !!((ownerProf as any)?.ai_reply_enabled && prospectCal);
  let prospectExtra = String((ownerProf as any)?.ai_reply_prompt || "").trim();
  let prospectMode = String((ownerProf as any)?.ai_reply_mode || "rules");
  let prospectScopeIds: string[] | null = null;
  let prospectSince: string | null = null; // only answer replies received AFTER the rule was (re)activated

  // Prospect auto-reply is driven by the "Respuesta Automática" rules (auto_reply_rules) the
  // owner manages in the Asistente IA page. In a prospect-only run we load THIS rule and take its
  // prompt + the calendar link embedded in it + the accounts (by id and/or tag) it targets.
  if (prospectOnly && (input as any).rule_id) {
    const { data: rl } = await admin.from("auto_reply_rules").select("*").eq("id", (input as any).rule_id).maybeSingle();
    if (rl && (rl as any).is_active) {
      const text = `${(rl as any).company_info || ""}\n${(rl as any).prompt || ""}`;
      prospectCal = ((text.match(/https?:\/\/[^\s<>"')\]]+/i) || [])[0] || "").trim();
      prospectActive = !!prospectCal; // a rule with NO calendar link stays inactive (safe)
      prospectExtra = text.trim();
      prospectMode = "rules";
      prospectSince = String((rl as any).updated_at || "") || null; // "from now on" = since activation
      const ids = new Set<string>(((rl as any).account_ids || []) as string[]);
      if (((rl as any).account_tags || []).length) {
        const { data: tagged } = await admin.from("email_accounts").select("id, tags").eq("user_id", ownerId).eq("status", "connected");
        for (const a of (tagged || []) as any[]) if ((a.tags || []).some((t: string) => (rl as any).account_tags.includes(t))) ids.add(a.id);
      }
      prospectScopeIds = Array.from(ids);
    } else { prospectActive = false; }
  }

  // FAN-OUT: on each real cron tick (the support@ customer-service run), kick a PROSPECT-ONLY pass
  // for EVERY active auto_reply_rules rule (Asistente IA → Respuesta Automática). That is how e.g.
  // the support@ USER's 119 cold-email mailboxes get answered without a separate cron.
  // Fire-and-forget; the prospect-only runs never re-fan.
  if (!prospectOnly && !dryRun) {
    try {
      const { data: rules } = await admin.from("auto_reply_rules").select("id, user_id").eq("is_active", true);
      for (const r of (rules || []) as any[]) {
        if (!r.user_id || r.user_id === ownerId) continue;
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/client-service-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
          body: JSON.stringify({ owner_user_id: r.user_id, prospect_only: true, rule_id: r.id, limit: 30 }),
        }).catch(() => {});
      }
    } catch { /* */ }
  }

  // ── Deferred deliveries (later runs) ────────────────────────────────────────────────
  //  • "confirm"       → the "ya está aplicado" note after a copy_change ack (2-step, no two
  //                      emails at once). Gate 2 min → lands 2-3 min after the ack.
  //  • "deliver_copys" → after a "send_copys_later" commit ("te lo envío cuando esté"), builds
  //                      and sends the copys PDF once it's ready. Retries until ready (≤24h).
  let confirmed = 0;
  if (!dryRun && !prospectOnly && teamAcct) {
    const { data: pend } = await admin.from("client_service_log")
      .select("id, client_user_id, from_email, subject, action, reply, campaign, in_reply_to, references_hdr")
      .eq("owner_id", ownerId).eq("pending", true)
      .lt("created_at", new Date(Date.now() - 120 * 1000).toISOString())
      .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: true }).limit(10);
    for (const p of (pend as any[]) || []) {
      try {
        if (p.action === "deliver_copys") {
          const { data: pr } = await admin.from("profiles").select("company_name").eq("user_id", p.client_user_id).maybeSingle();
          const res = await sendCopys(admin, p.client_user_id, (pr as any)?.company_name || "", p.campaign || null, p.from_email, teamAcct, "");
          if (!res.ok) continue; // not ready yet → keep pending, retry next run
        } else {
          const pSubject = "Re: " + String(p.subject || "tu campaña").replace(/^\s*((re|rv|fwd)\s*:\s*)+/i, "").trim();
          const cres = await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", p.from_email, pSubject, signedHtml(p.reply || "Ya hemos aplicado los cambios en tu campaña, puedes ver los mensajes. Cualquier cosa, nos dices."), { inReplyTo: p.in_reply_to || "", references: p.references_hdr || p.in_reply_to || "" });
          if (!cres.ok) continue; // send failed → keep pending, retry next run (don't lose the confirmation)
        }
      } catch { continue; /* keep pending, retry next run */ }
      await admin.from("client_service_log").update({ pending: false }).eq("id", p.id);
      confirmed++;
    }
  }

  // "Crear campaña nueva" phase 2: form response arrived → generate the draft + notify team@.
  let newCampaigns = 0;
  if (!dryRun && !prospectOnly && teamAcct) { try { newCampaigns = await processNewCampaigns(admin, ownerId, dkKey, teamAcct); } catch { /* */ } }

  // 1) Unprocessed inbound to the owner's connected mailboxes (skip warmup / our own sends).
  let q = admin.from("inbox_messages").select("*").eq("user_id", ownerId).eq("auto_replied", false).eq("is_sent", false).eq("is_warmup", false).order("received_at", { ascending: true }).limit(Math.min(limit || 15, 30));
  if (account_id) q = q.eq("account_id", account_id);
  if (prospectOnly && prospectScopeIds && prospectScopeIds.length) q = q.in("account_id", prospectScopeIds);
  // "From now on" guard: prospect auto-reply only answers replies received AFTER the rule was
  // (re)activated (rule.updated_at) — so activating never blasts the existing backlog. Falls back
  // to a 2-day window if no timestamp is available.
  if (prospectOnly) q = q.gte("received_at", prospectSince || new Date(Date.now() - 2 * 86400000).toISOString());
  // Human-like delay: only reply to emails that arrived ≥5 min ago (skipped in dry_run so you
  // can test immediately). Combined with the cron cadence, the reply goes out ~5 min later.
  if (!dryRun) q = q.lte("received_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  const { data: msgs } = await q;
  if (!msgs?.length) return new Response(JSON.stringify({ processed: 0, confirmed, newCampaigns }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let processed = 0;
  const results: any[] = [];
  for (const m of msgs) {
   try {
    // ATOMIC CLAIM: mark this message processed FIRST (conditional on it still being unprocessed).
    // If another concurrent run (cron + "Ejecutar ahora") already claimed it, skip — no double reply.
    if (!dryRun) {
      const { data: claimed } = await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", m.id).eq("auto_replied", false).select("id");
      if (!claimed || !(claimed as any[]).length) continue; // someone else took it
    }
    const fromEmail = (m.from_email || "").toLowerCase();
    const dom = domainOf(fromEmail);
    if (!dom || !teamAcct) continue; // already claimed above

    // 2) Match the sender to a CLIENT. A client may write from a personal address (gmail…),
    //    so try, in order: (a) their registered account/login email; (b) their profile contact
    //    email; (c) the domain of their own mailboxes. First hit wins.
    let clientId: string | null = null;
    try { const { data: byMail } = await admin.rpc("automation_client_by_email", { p_email: fromEmail }); if (byMail) clientId = byMail as any; } catch { /* rpc optional */ }
    if (!clientId) { const { data: byContact } = await admin.from("profiles").select("user_id").ilike("contact_email", fromEmail).neq("user_id", ownerId).limit(1); clientId = (byContact || [])[0]?.user_id || null; }
    if (!clientId && dom) { const { data: domAccts } = await admin.from("email_accounts").select("user_id").ilike("email", `%@${dom}`).neq("user_id", ownerId).limit(1); clientId = (domAccts || [])[0]?.user_id || null; }
    const known = !!clientId;
    const body = cleanBody(m.body_text || m.body_html || "");
    // Thread the reply to THIS exact message by Message-ID (avoids landing in the wrong
    // conversation when several clients share the same subject).
    const thread = { inReplyTo: m.message_id || "", references: [m.ref_chain, m.message_id].filter(Boolean).join(" ") };
    const reSubject = "Re: " + String(m.subject || "tu campaña").replace(/^\s*((re|rv|fwd)\s*:\s*)+/i, "").trim();

    // ── PROSPECT auto-reply (cold-email replies) ─────────────────────────────────────────
    // Interested / question → short reply + the calendar link to book a meeting.
    // Not interested / negative / OOO / bounce / noise → do NOTHING (reply to no one, notify no one).
    // In a prospect-only run we answer ANY external sender (the "known-client" domain match must
    // NOT skip a real prospect whose address happens to match a platform domain, e.g. a test from
    // team@onepulso.online). Only our OWN mailboxes are skipped, to avoid self-reply loops. In the
    // normal owner run we still keep it to unknown senders only.
    const isOwnMailbox = (ownerAccts || []).some((a: any) => String(a.email || "").toLowerCase() === fromEmail);
    if (prospectActive && !isOwnMailbox && (prospectOnly || !known)) {
      const recvAcct = (ownerAccts || []).find((a: any) => a.id === m.account_id) || teamAcct;
      // Persona = the receiving mailbox's name (maria@… → "Maria"). The model signs the reply with
      // it, in the prospect's own language, so there's no hardcoded Spanish sign-off.
      const persona = String(recvAcct?.email || "").split("@")[0].split(/[._-]/)[0];
      const personaName = persona ? persona.charAt(0).toUpperCase() + persona.slice(1) : "OnePulso";
      const extra = prospectExtra;
      const psys = `Eres el asistente comercial de OnePulso que atiende las RESPUESTAS de prospectos a nuestros emails en frío. Con los interesados tu único objetivo es conseguir una reunión.

CLASIFICA el correo del prospecto:
- POSITIVO (SOLO estos) = muestra interés REAL en lo que ofrecemos, pide información/precio/detalles, quiere saber más, pide que le llamen o se lo expliquen, propone hablar, o hace una PREGUNTA sobre NUESTRO servicio o propuesta.
- NEGATIVO/NEUTRO (NO respondas) = no le interesa ("no me interesa", "no gracias", "ahora no"); pide BAJA o que le quiten ("bájame de la base de datos", "dar de baja", "quítame", "no me escribáis más", "unsubscribe", "remove me"); te DERIVA a otra persona o dice que no es él ("contacta con X", "habla con Y", "no soy la persona adecuada", "escribe a otro departamento"); responde molesto o cortante; fuera de oficina; respuesta automática; rebote (mailer-daemon/undelivered); o cualquier ruido sin intención comercial clara.

ANTE LA DUDA, o si NO hay un interés o una pregunta CLARA sobre nuestro servicio, clasifícalo como NEGATIVO/NEUTRO y NO respondas. Mejor no responder que responder a quien no toca.

REGLAS:
- Si es POSITIVO: PRIMERO detecta el idioma EXACTO del correo del prospecto y escribe TODA tu respuesta ÍNTEGRAMENTE en ESE idioma — el saludo, el cuerpo, la invitación a agendar y la despedida (inglés→inglés, francés→francés, italiano→italiano, alemán→alemán, portugués→portugués, catalán→catalán, etc.; ante la duda, usa el idioma en que está escrito el correo). Respuesta BREVE y humana (2-4 frases) que resuelva por encima su duda e invite a agendar una reunión. Incluye el enlace del calendario TAL CUAL, completo: ${prospectCal}. Termina SIEMPRE con una despedida natural EN ESE MISMO IDIOMA y firma con el nombre "${personaName}" (p. ej. inglés "Best regards, ${personaName}", francés "Cordialement, ${personaName}", español "Un saludo, ${personaName}"). Sin emojis. No inventes datos ni des precios cerrados por email.
- Si es NEGATIVO/NEUTRO: NO respondas. Deja "reply" vacío.${extra ? "\n\nCONOCIMIENTO E INSTRUCCIONES DEL DUEÑO (respétalas por encima de todo):\n" + extra : ""}

Devuelve SOLO JSON: {"interested": true|false, "reply": "<cuerpo del email si es interested; vacío si no>"}`;
      const pmsg = `CORREO DEL PROSPECTO:\nDe: ${m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}\nAsunto: ${m.subject}\n${body}\n\nPERSONALIZA: si sabes el nombre (${m.from_name || "desconocido"}), empieza con "Hola ${(m.from_name || "").split(" ")[0] || ""},". Si no lo sabes, usa un saludo natural sin inventar nombre.`;
      let pd: any = {};
      // temp 0 → the interested/not-interested classification is DETERMINISTIC and reliable
      // (at 0.3 the same clear "me interesa, ¿cómo funciona?" flip-flopped between runs).
      try { pd = await decide(dkKey, psys, pmsg, 0); } catch { pd = { interested: false }; }
      const mode = prospectMode;
      if (pd.interested && String(pd.reply || "").trim()) {
        let replyText = String(pd.reply).trim();
        // Safety net only: if the model forgot the calendar link, append it BARE (no words → stays
        // language-neutral). The greeting, calendar invite and sign-off are now written by the model
        // in the prospect's OWN language, so we no longer bolt on a Spanish "Un saludo".
        if (prospectCal && !replyText.includes(prospectCal)) replyText += `\n\n${prospectCal}`;
        const signed = stripEmojis(replyText);
        const blk = signed.split(/\n\n+/).map((x) => x.trim().replace(/\n/g, "<br>")).filter(Boolean);
        if (blk.length >= 2) { const s = blk.pop() as string; blk[blk.length - 1] += `<br><br>${s}`; }
        const htmlBody = blk.map((x) => `<p style="margin:0 0 10px">${x}</p>`).join("") || `<p>${signed.replace(/\n/g, "<br>")}</p>`;
        if (!dryRun && mode !== "draft" && recvAcct) {
          const sres = await sendSmtp(recvAcct.smtp_host, recvAcct.smtp_port, recvAcct.smtp_username, recvAcct.smtp_password, recvAcct.email, personaName, m.from_email, reSubject, htmlBody, thread);
          // Record the AI reply as a SENT email so it shows in the Unibox conversation thread
          // (loadThread merges sent_emails by account_id + to_email) → the owner sees what the IA
          // answered, "como si lo hubiera enviado yo". Non-fatal.
          if (sres?.ok) {
            try { await admin.from("sent_emails").insert({ user_id: ownerId, account_id: recvAcct.id, to_email: m.from_email, subject: reSubject, body: htmlBody, status: "sent", sent_at: new Date().toISOString() }); } catch { /* non-fatal */ }
            // Also log it in auto_reply_log → the "Asistente IA → Respuestas automáticas" panel reads
            // THAT table (the running prospect agent only wrote client_service_log, so the panel showed
            // "Sin respuestas registradas"). Realtime on auto_reply_log picks this up instantly.
            try { await admin.from("auto_reply_log").insert({ user_id: ownerId, rule_id: (input as any).rule_id || null, inbox_message_id: m.id, to_email: m.from_email, subject: reSubject, ai_response: replyText.slice(0, 4000), status: "sent", sent_at: new Date().toISOString() }); } catch { /* non-fatal */ }
          }
        }
        if (!dryRun) await admin.from("client_service_log").insert({ owner_id: ownerId, from_email: m.from_email, action: mode === "draft" ? "prospect_draft" : "prospect_reply", inbound: body.slice(0, 1200), reply: replyText.slice(0, 1200) });
        results.push({ id: m.id, from: m.from_email, action: mode === "draft" ? "prospect_draft" : "prospect_reply", reply_preview: replyText.slice(0, 200) }); processed++;
      } else {
        if (!dryRun) await admin.from("client_service_log").insert({ owner_id: ownerId, from_email: m.from_email, action: "ignore", inbound: body.slice(0, 600), reply: "" });
        results.push({ id: m.id, from: m.from_email, action: "ignore_prospect" });
      }
      continue; // prospect path handled — skip the client-service decision flow
    }

    // In prospect-only mode we do NOT run the client-service flow: a known client or an
    // inactive-config sender simply gets nothing (mark processed, notify no one).
    if (prospectOnly) { if (!dryRun) { try { await admin.from("client_service_log").insert({ owner_id: ownerId, from_email: m.from_email, action: "ignore", inbound: body.slice(0, 400), reply: "" }); } catch { /* */ } } results.push({ id: m.id, from: m.from_email, action: "ignore_prospect" }); continue; }

    // Client context: profile + ALL their campaigns (newest first, with dates) so the bot can
    // reason about "la última / la nueva / la de la semana pasada" and target the right one.
    const { data: prof } = await admin.from("profiles").select("company_name, ai_reply_prompt").eq("user_id", clientId).maybeSingle();
    const { data: camps } = await admin.from("campaigns").select("id, name, status, created_at").eq("user_id", clientId).order("created_at", { ascending: false }).limit(8);
    const allCamps = (camps || []) as any[];
    const draft = allCamps.find((c: any) => c.status === "draft") || allCamps[0];
    const { data: steps } = draft ? await admin.from("campaign_steps").select("id, step_order, subject, body, variants").eq("campaign_id", draft.id).order("step_order") : { data: [] as any[] };
    const relTime = (iso: string) => { const dd = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return dd <= 0 ? "hoy" : dd === 1 ? "ayer" : `hace ${dd} días`; };
    const campList = allCamps.length ? allCamps.map((c: any, i: number) => `${i + 1}. "${c.name}" (${c.status === "draft" ? "borrador" : c.status}) — creada ${relTime(c.created_at)}${i === 0 ? " [LA MÁS NUEVA]" : ""}${draft && c.id === draft.id ? " [la que edito por defecto]" : ""}`).join("\n") : "(sin campañas)";

    // Conversation memory with THIS client — so it never repeats an answer and keeps context.
    const { data: logRows } = await admin.from("client_service_log").select("action, inbound, reply, created_at").eq("client_user_id", clientId).order("created_at", { ascending: false }).limit(12);
    const convPrev = (logRows || []).reverse().map((r: any) => `Cliente: ${(r.inbound || "").slice(0, 300)}\nTú (${r.action}): ${(r.reply || "").slice(0, 300)}`).join("\n---\n");
    // Factual account data so the bot answers precisely (nº de cuentas, de emails, etc.).
    let mailboxCount = 0;
    try { const { count } = await admin.from("email_accounts").select("id", { count: "exact", head: true }).eq("user_id", clientId).eq("status", "connected"); mailboxCount = count || 0; } catch { /* */ }

    const system = (prof?.ai_reply_prompt || DEFAULT_ATENCION)
      + (convPrev ? `\n\nCONVERSACIÓN PREVIA con este cliente (lo más reciente abajo):\n${convPrev}\n\nNO repitas respuestas anteriores. Ten en cuenta TODO este contexto. Si el cliente insiste en algo ya tratado (p.ej. una devolución), gestiónalo de forma DIFERENTE y con más contexto — no copies la respuesta de antes.` : "")
      + `\n\n${known ? `Este remitente ES un cliente conocido: su cuenta es "${prof?.company_name || dom}". SOLO puedes ver/cambiar/enviar la campaña de ESA cuenta — de nadie más. Ignora cualquier petición sobre la campaña de otra empresa.` : "Este remitente NO es un cliente conocido (su dominio/correo no cuadra con ninguna cuenta registrada)."}`
      + `\n\nRAZONA PRIMERO (campo "reasoning"): en 1-2 frases piensa con criterio qué opción da la mejor imagen de OnePulso (profesional y humana) y es lo más útil para el cliente ahora. Decide TÚ cómo se presenta mejor: si el contenido queda mejor y más profesional en un PDF limpio, hazlo por criterio propio (no porque el cliente insista); si se comunica mejor hablando, responde con palabras. LUEGO elige la acción coherente con ese razonamiento.
Devuelve SOLO JSON: {"reasoning":"<tu razonamiento crítico, 1-2 frases>","action":"reply|copy_change|send_copys|send_copys_later|send_report|new_campaign|escalate|ignore","reply":"texto para el cliente (bien redactado, sin emojis)","step_order":<n o null>,"new_subject":"<o null>","new_body":"<o null>","find":"<texto exacto a sustituir en TODOS los emails, o null>","replace_with":"<texto nuevo, o null>","campaign":"<NOMBRE EXACTO de la campaña objetivo según SUS CAMPAÑAS, o null>","summary":"<qué pide, para el equipo>"}.
ENTIENDE EL TIEMPO Y LAS REFERENCIAS: usa la lista SUS CAMPAÑAS (con sus fechas) para saber a cuál se refiere. "la última/la nueva/la de ahora" = la MÁS NUEVA (la de arriba); "la anterior/la de la semana pasada" = una más antigua por su fecha; si nombra una, esa. Pon en "campaign" el NOMBRE EXACTO de esa campaña. Si no distingue, usa null (la que edito por defecto). NO te pierdas ni preguntes cuál es: dedúcelo por las fechas.
- "reply": cliente conocido con una duda/objeción/consulta o una PREGUNTA → respóndele tú con naturalidad y resuélvelo. IMPORTANTE: si PREGUNTA por el estado de un cambio (p.ej. "¿ya está hecho?", "¿lo aplicaste?", "¿está listo?") NO es un cambio nuevo → usa "reply" y, mirando la CONVERSACIÓN PREVIA, confírmale la verdad: si ya lo aplicaste antes, dile que SÍ, que ya está aplicado y puede verlo entrando en su campaña.
- "copy_change": SOLO cuando el cliente pide un cambio NUEVO y concreto en el texto de su campaña (asunto/cuerpo/nombre/firma) → aplícalo tú (NO pidas datos ni el email). Una PREGUNTA, un agradecimiento o una confirmación NO es copy_change. Para cambiar UN email concreto usa step_order + new_subject/new_body. Para un cambio que afecta a TODOS los emails (p.ej. cambiar un nombre o firma, un enlace o una palabra) usa find + replace_with con el texto EXACTO tal cual aparece en EMAILS ACTUALES. ENTIENDE la intención sin preguntar: si dice "donde pone el nombre di que soy José", "que me llame José", "cambia el nombre por José", "pon mi nombre, José" → se refiere al NOMBRE DEL REMITENTE que aparece en el copy (p.ej. "Soy Carlos de..." o la firma). Busca ese nombre actual en EMAILS ACTUALES y ponlo en find, y "José" en replace_with. NUNCA le preguntes a qué nombre se refiere.
- "send_copys": cuando el contenido a entregar es el CONJUNTO de mensajes/copys de la campaña, YA está listo, y TÚ valoras que se presenta mejor y más profesional como un PDF limpio con logo (que pegarlo como texto). Es tu criterio de presentación, NO que el cliente insista. Genera el PDF con los mensajes ACTUALES. En "reply" una frase corta de acompañamiento. Si nombra una campaña, ponla en "campaign"; si no, null = todas. Si solo pregunta por UN email o un detalle, NO uses send_copys → responde con "reply".
- "send_copys_later": cuando te COMPROMETES a enviar los mensajes/copys pero el momento natural es "os ponéis y se lo enviáis cuando esté" (aún no toca soltarlo de golpe). En "reply" das una respuesta natural comprometiéndote ("Perfecto, nos ponemos ahora mismo y te envío los mensajes en cuanto estén listos."). El PDF se enviará solo un poco después, cuando esté preparado. Úsalo cuando encaje ese flujo conversacional en vez de soltar el PDF inmediatamente.
- "send_report": cuando el contenido son RESULTADOS/ANALÍTICAS/un informe de la campaña y TÚ valoras que queda mejor y más profesional presentado como un PDF con métricas. Para un "¿cómo va?" informal, si crees que una respuesta humana breve comunica mejor, usa "reply".
- "new_campaign": cuando el cliente pide CREAR UNA CAMPAÑA NUEVA u otra campaña ("queremos crear una campaña", "podéis hacernos otra campaña", "quiero una nueva campaña", "hacemos una campaña nueva"). Respóndele que SÍ, encantados de prepararle una nueva campaña; el sistema le enviará el formulario para que os cuente los detalles y, en cuanto lo rellene, la validáis y la creáis. En "reply" pon SOLO una frase cálida de acogida (sin el enlace ni la firma, el sistema los añade). NO es un cambio de copy ni pedir los mensajes; es empezar una campaña nueva.
- "escalate": SOLO cosas ESENCIALES que necesitan a una persona del equipo: una REUNIÓN/llamada, una DEVOLUCIÓN o reembolso, dinero/pagos, una cancelación, un tema legal o una queja seria. Solo esto se avisa a team@onepulso.online. EXCEPCIÓN: si piden MÁS CUENTAS DE CORREO, NO escales — gestiónalo tú por "reply" (pregunta cuántas → precio a 2€/cuenta → si confirman, derívalos a team@onepulso.online).
- "ignore": todo lo demás NO esencial — ruido, newsletters, agradecimientos, confirmaciones, o un remitente desconocido sin nada importante. NO se avisa a nadie.
REGLA CLAVE: por defecto RESPONDE con palabras (reply) bien escritas y humanas. Los PDFs (send_copys/send_report) salen por CRITERIO TUYO de presentación — cuando piensas "esto queda mejor y da mejor imagen en un PDF" — NO porque el cliente lo pida o insista, ni por cualquier mención. NO avises al equipo por cada correo: "escalate" ÚNICAMENTE para lo esencial. Si el remitente NO es un cliente REGISTRADO (su correo/dominio no cuadra con ningún usuario ni cuenta de la plataforma), usa SIEMPRE "ignore": no le respondas ni avises a nadie. Solo atiendes a clientes registrados.`;
    const userMsg = (known
      ? `CLIENTE: ${prof?.company_name || dom}\nDATOS DE CUENTA: ${mailboxCount} cuenta(s) de envío conectada(s); ${allCamps.length} campaña(s) en total.\nSUS CAMPAÑAS (de más NUEVA a más antigua):\n${campList}\n\nEMAILS ACTUALES de "${draft?.name || "ninguna"}" (la que edito por defecto, ${(steps || []).length} email(s)):\n${(steps || []).map((s: any) => `#${s.step_order} asunto="${s.subject}" cuerpo="${(s.body || "").replace(/<[^>]+>/g, " ").slice(0, 300)}"`).join("\n") || "(sin pasos)"}\n\n`
      : `REMITENTE DESCONOCIDO (no es un cliente registrado).\n\n`)
      + `CORREO RECIBIDO:\nDe: ${m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}\nAsunto: ${m.subject}\n${body}`
      + `\n\nPERSONALIZA: si sabes el nombre de la persona (aquí: ${m.from_name || "desconocido"}), empieza la respuesta con "Hola ${(m.from_name || "").split(" ")[0] || "[nombre]"},". Si no lo sabes, usa un saludo natural sin inventar nombres.`;

    let d: any = {};
    try { d = await decide(dkKey, system, userMsg); } catch { d = { action: "ignore", summary: "fallo IA" }; }
    // The support@ customer-service agent ONLY engages REGISTERED senders (their address/domain
    // matches a platform user, their contact email, or one of their mailboxes). Anyone else — an
    // unknown person or domain not registered — is ignored ENTIRELY: no reply, no escalate, no
    // notification. (Cold-email prospects are handled separately by the prospect_only path above.)
    if (!known) d.action = "ignore";

    const base = { id: m.id, client: prof?.company_name || dom, from: m.from_email, subject: m.subject, reasoning: d.reasoning || "", summary: d.summary || "", reply_preview: (d.reply || "").slice(0, 200) };

    let handled = false;
    if (d.action === "copy_change" && known) {
      // Resolve WHICH campaign to edit: the one the client referred to (name / "la última"
      // resolved to a name by the model), else the default draft. Load that one's steps.
      let targetCamp = draft;
      if (d.campaign) {
        const f = String(d.campaign).toLowerCase().trim();
        // Exact name first (allCamps is newest-first, so ties resolve to the newest); then a
        // strong-ish partial (>=4 chars) to avoid matching the wrong campaign on a vague value.
        const m2 = allCamps.find((c: any) => (c.name || "").toLowerCase() === f)
          || (f.length >= 4 ? allCamps.find((c: any) => { const n = (c.name || "").toLowerCase(); return n && (n.includes(f) || f.includes(n)); }) : null);
        if (m2) targetCamp = m2;
      }
      let tSteps: any[] = (steps as any[]) || [];
      if (targetCamp && (!draft || targetCamp.id !== draft.id)) { const { data: ts } = await admin.from("campaign_steps").select("id, step_order, subject, body, variants").eq("campaign_id", targetCamp.id).order("step_order"); tSteps = ts || []; }
      // Two shapes: a global find/replace across ALL steps, or a specific step's subject/body.
      let applied = false;
      if (tSteps?.length) {
        const doGlobal = d.find && d.replace_with != null;
        const doStep = d.step_order != null && (d.new_subject || d.new_body);
        if (dryRun) {
          applied = !!(doGlobal || doStep);
        } else if (doGlobal) {
          const find = String(d.find);
          const rep = (t: any) => String(t ?? "").split(find).join(String(d.replace_with));
          for (const s of tSteps as any[]) {
            let changed = false;
            const ns = rep(s.subject); if (ns !== (s.subject ?? "")) changed = true;
            const nb = rep(s.body); if (nb !== (s.body ?? "")) changed = true;
            // Also replace inside EVERY variant (subject + body), not just the principal.
            const nv = Array.isArray(s.variants) ? s.variants.map((v: any) => {
              const out = { ...v };
              if (typeof v?.subject === "string") { const x = rep(v.subject); if (x !== v.subject) { out.subject = x; changed = true; } }
              if (typeof v?.body === "string") { const x = rep(v.body); if (x !== v.body) { out.body = x; changed = true; } }
              return out;
            }) : s.variants;
            if (changed) { await admin.from("campaign_steps").update({ subject: ns, body: nb, variants: nv }).eq("id", s.id); applied = true; }
          }
        } else if (doStep) {
          const target = (tSteps as any[]).find((s: any) => s.step_order === Number(d.step_order));
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
          await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, reSubject, signedHtml(ack), thread);
          await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: "confirm", subject: m.subject, reply: withSignoff(confirm), pending: true, in_reply_to: thread.inReplyTo, references_hdr: thread.references });
        }
        d.reply = ack;
      } else {
        // Couldn't apply it automatically → be HONEST (never say "done") and escalate to the
        // team so a human applies it. The change is not lost.
        const ack = "¡Gracias! Tomamos nota de tu cambio; lo estamos ajustando y te confirmamos en cuanto esté aplicado.";
        if (!dryRun) {
          await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, reSubject, signedHtml(ack), thread);
          const esc = textToHtml(`Cambio de copy que el bot NO pudo aplicar solo — aplícalo tú.\n\nCliente: ${prof?.company_name || dom}\nDe: ${m.from_email}\nCampaña objetivo: ${targetCamp?.name || draft?.name || "(la más reciente)"}\n\nQué pide:\n${body}\n\n(La IA propuso: find="${d.find || ""}" → "${d.replace_with || ""}"${d.step_order != null ? `, step ${d.step_order}` : ""}. Aplícalo en la campaña del cliente.)`);
          await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", TEAM_EMAIL, `[Cambio de copy] ${prof?.company_name || m.from_email} — aplicar a mano`, esc);
        }
        d.reply = ack;
        results.push({ ...base, action: "copy_change", applied: false, escalated: true }); processed++; handled = true;
      }
      if (applied) { results.push({ ...base, action: "copy_change", applied }); processed++; handled = true; }
    }
    if (!handled && d.action === "send_copys" && known) {
      // Send a clean, branded PDF of the CURRENT campaign copy (all, or the named one) — never
      // paste the messages as text. Falls back to a normal reply if the PDF can't be built.
      if (!dryRun) {
        const res = await sendCopys(admin, clientId as string, prof?.company_name || dom, d.campaign || null, m.from_email, teamAcct, d.reply || "");
        if (!res.ok) {
          await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, reSubject, signedHtml(d.reply || "¡Hola! Enseguida te preparo los mensajes y te los paso."), thread);
        }
      }
      results.push({ ...base, action: "send_copys" }); processed++; handled = true;
    }
    if (!handled && d.action === "send_copys_later" && known) {
      // Commit now with a natural reply, and QUEUE the copys PDF to be delivered on a later run
      // (once it's ready) — "okey, nos ponemos y te lo envío en cuanto esté".
      if (!dryRun) {
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, reSubject, signedHtml(d.reply || "Perfecto, nos ponemos ahora mismo y te envío los mensajes en cuanto estén listos."), thread);
        await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: "deliver_copys", subject: m.subject, campaign: d.campaign || null, pending: true, in_reply_to: thread.inReplyTo, references_hdr: thread.references });
      }
      results.push({ ...base, action: "send_copys_later" }); processed++; handled = true;
    }
    if (!handled && d.action === "new_campaign" && known) {
      // Client wants a NEW campaign → reply + send the Google Form (NO onboarding for existing
      // clients) and record the request so a form response later auto-generates the campaign.
      if (!dryRun) {
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, reSubject, newCampaignHtml(d.reply || ""), thread);
        // Supersede any older awaiting_form request from this client, then record the new one.
        await admin.from("new_campaign_requests").update({ status: "error", note: "reemplazada por nueva petición" }).eq("client_user_id", clientId).eq("status", "awaiting_form");
        await admin.from("new_campaign_requests").insert({ owner_id: ownerId, client_user_id: clientId, company_name: prof?.company_name || dom, from_email: m.from_email, subject: m.subject, in_reply_to: thread.inReplyTo, references_hdr: thread.references, status: "awaiting_form" });
      }
      results.push({ ...base, action: "new_campaign" }); processed++; handled = true;
    }
    if (!handled && d.action === "send_report" && known) {
      // Send the analytics/results report PDF. If there's no data yet, fall back to a reply.
      if (!dryRun) {
        const res = await sendAnalytics(admin, clientId as string, m.from_email, teamAcct);
        if (!res.ok) {
          await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, reSubject, signedHtml(d.reply || "¡Hola! En cuanto la campaña acumule datos suficientes te preparo el informe con los resultados y te lo envío."), thread);
        }
      }
      results.push({ ...base, action: "send_report" }); processed++; handled = true;
    }
    if (!handled && d.action === "reply" && known) {
      if (!dryRun) {
        const html = signedHtml(d.reply || "Gracias por tu mensaje, lo revisamos y te contamos.");
        await sendSmtp(teamAcct.smtp_host, teamAcct.smtp_port, teamAcct.smtp_username, teamAcct.smtp_password, teamAcct.email, "OnePulso", m.from_email, reSubject, html, thread);
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
      // (message already claimed as auto_replied at the top of the loop — just log the action)
      await admin.from("client_service_log").insert({ owner_id: ownerId, client_user_id: clientId, from_email: m.from_email, action: d.action || "ignore", inbound: body.slice(0, 1200), reply: (d.reply || "").slice(0, 1200) });
    }
   } catch (e) {
     // Error is logged for the owner (visible in Automatización) — the client is told nothing.
     if (!dryRun) { try { await admin.from("client_service_log").insert({ owner_id: ownerId, from_email: m.from_email, action: "error", reply: String((e as Error).message).slice(0, 500) }); } catch { /* */ } }
     results.push({ id: m.id, from: m.from_email, action: "error", error: String((e as Error).message) });
   }
  }

  return new Response(JSON.stringify({ processed, confirmed, newCampaigns, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
