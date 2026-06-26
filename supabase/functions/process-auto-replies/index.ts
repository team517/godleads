import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function linkifyText(text: string): string {
  // Convert URLs to clickable HTML links
  return text.replace(
    /(https?:\/\/[^\s<>"')\]]+)/gi,
    '<a href="$1" style="color:#2563eb;text-decoration:underline;" target="_blank">$1</a>'
  );
}

function textToHtml(text: string): string {
  if (/<(p|div|br)\b/i.test(text)) {
    // Already HTML, but still linkify plain URLs
    return linkifyText(text);
  }
  return text
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${linkifyText(p.replace(/\n/g, '<br>'))}</p>`)
    .join('');
}

async function sendSmtpReply(
  host: string, port: number, username: string, password: string,
  from: string, to: string, subject: string, body: string,
  inReplyTo: string | null, references: string | null,
  fromName: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    let conn: Deno.Conn;
    if (port === 465) {
      conn = await Deno.connectTls({ hostname: host, port });
    } else {
      conn = await Deno.connect({ hostname: host, port });
    }

    const read = async () => {
      const buf = new Uint8Array(4096);
      const n = await conn.read(buf);
      return new TextDecoder().decode(buf.subarray(0, n || 0));
    };

    const send = async (cmd: string) => {
      await conn.write(new TextEncoder().encode(cmd + "\r\n"));
      return await read();
    };

    await read(); // greeting

    const buildMessage = () => {
      const fromHeader = fromName ? `"${fromName}" <${from}>` : from;
      let headers = `From: ${fromHeader}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0`;
      if (inReplyTo) headers += `\r\nIn-Reply-To: <${inReplyTo}>`;
      if (references) headers += `\r\nReferences: <${references}>`;
      return `${headers}\r\n\r\n${body}\r\n.\r\n`;
    };

    if (port === 587) {
      let resp = await send("EHLO mailreach");
      if (resp.includes("STARTTLS")) {
        await conn.write(new TextEncoder().encode("STARTTLS\r\n"));
        await read();
        conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });

        const sendTls = async (cmd: string) => {
          await conn.write(new TextEncoder().encode(cmd + "\r\n"));
          const buf = new Uint8Array(4096);
          const n = await conn.read(buf);
          return new TextDecoder().decode(buf.subarray(0, n || 0));
        };

        await sendTls("EHLO mailreach");
        const creds = btoa(`\0${username}\0${password}`);
        const authResp = await sendTls(`AUTH PLAIN ${creds}`);
        if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

        await sendTls(`MAIL FROM:<${from}>`);
        await sendTls(`RCPT TO:<${to}>`);
        await sendTls("DATA");
        const dataResp = await sendTls(buildMessage());
        await sendTls("QUIT");
        conn.close();
        return dataResp.includes("250") ? { ok: true } : { ok: false, error: `Send failed: ${dataResp}` };
      }
    }

    // Standard flow (465 or fallback)
    await send("EHLO mailreach");
    const creds = btoa(`\0${username}\0${password}`);
    const authResp = await send(`AUTH PLAIN ${creds}`);
    if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

    await send(`MAIL FROM:<${from}>`);
    await send(`RCPT TO:<${to}>`);
    await send("DATA");
    const dataResp = await send(buildMessage());
    await send("QUIT");
    conn.close();
    return dataResp.includes("250") ? { ok: true } : { ok: false, error: `Send failed: ${dataResp}` };
  } catch (e) {
    return { ok: false, error: `SMTP error: ${e.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get all active rules
    const { data: rules, error: rulesErr } = await admin
      .from("auto_reply_rules")
      .select("*")
      .eq("is_active", true);

    if (rulesErr || !rules || rules.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No active rules" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalProcessed = 0;

    for (const rule of rules) {
      // 2. Get matching accounts (by tags or IDs) — only connected accounts
      let accountIds: string[] = [];

      if (rule.account_ids && rule.account_ids.length > 0) {
        // Verify these accounts are actually connected
        const { data: validAccounts } = await admin
          .from("email_accounts")
          .select("id")
          .in("id", rule.account_ids)
          .eq("status", "connected")
          .eq("user_id", rule.user_id);
        if (validAccounts) {
          accountIds = validAccounts.map((a: any) => a.id);
        }
      }

      if (rule.account_tags && rule.account_tags.length > 0) {
        const { data: tagAccounts } = await admin
          .from("email_accounts")
          .select("id, tags")
          .eq("user_id", rule.user_id)
          .eq("status", "connected");

        if (tagAccounts) {
          for (const acc of tagAccounts) {
            if (acc.tags && acc.tags.some((t: string) => rule.account_tags.includes(t))) {
              if (!accountIds.includes(acc.id)) accountIds.push(acc.id);
            }
          }
        }
      }

      if (accountIds.length === 0) continue;

      // 3. Find messages ready for auto-reply (only today's messages)
      const delayThreshold = new Date(Date.now() - rule.delay_minutes * 60 * 1000).toISOString();
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayStartISO = todayStart.toISOString();

      // Fetch messages labeled "Interesado" OR "Pregunta"
      const { data: interestedMsgs } = await admin
        .from("inbox_messages")
        .select("*")
        .eq("auto_replied", false)
        .eq("user_id", rule.user_id)
        .in("account_id", accountIds)
        .contains("labels", ["Interesado"])
        .gte("received_at", todayStartISO)
        .lte("received_at", delayThreshold)
        .order("received_at", { ascending: true })
        .limit(50);

      const { data: questionMsgs } = await admin
        .from("inbox_messages")
        .select("*")
        .eq("auto_replied", false)
        .eq("user_id", rule.user_id)
        .in("account_id", accountIds)
        .contains("labels", ["Pregunta"])
        .gte("received_at", todayStartISO)
        .lte("received_at", delayThreshold)
        .order("received_at", { ascending: true })
        .limit(50);

      // Merge and deduplicate
      const seenIds = new Set<string>();
      const messages: typeof interestedMsgs = [];
      for (const msg of [...(interestedMsgs || []), ...(questionMsgs || [])]) {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          messages.push(msg);
        }
      }

      if (!messages || messages.length === 0) continue;

      // 3.5 Filter out auto-replies, out-of-office, and negative/unsubscribe messages
      const skipPatterns = [
        /out\s*of\s*(the\s*)?office/i,
        /fuera\s*de\s*(la\s*)?oficina/i,
        /auto[\s-]?reply/i,
        /auto[\s-]?respuesta/i,
        /automatic\s*reply/i,
        /respuesta\s*autom[áa]tica/i,
        /do\s*not\s*reply/i,
        /no[\s-]?reply/i,
        /noreply/i,
        /mailer[\s-]?daemon/i,
        /undelivered/i,
        /delivery\s*(status|failure|failed)/i,
        /vacation\s*(reply|response|auto)/i,
        /currently\s*(unavailable|away|out)/i,
        /actualmente\s*(no\s*disponible|ausente|fuera)/i,
        /will\s*be\s*(back|returning|out)/i,
        /estar[ée]\s*(de\s*vuelta|fuera|ausente)/i,
        // Only skip CLEAR, UNAMBIGUOUS rejections — not "no sé si me interesa"
        /\bno\s+me\s+interesa\b/i,
        /\bno\s+nos\s+interesa\b/i,
        /\bnot\s+interested\b/i,
        /remove\s*me/i,
        /unsubscribe/i,
        /darse\s*de\s*baja/i,
        /stop\s*(emailing|contacting|sending)/i,
        /deja\s*de\s*(enviar|escribir|contactar)/i,
        /no\s*(me\s*)?(contacte|escriba|envie)\b/i,
      ];

      const filteredMessages: typeof messages = [];
      const skippedIds: string[] = [];

      for (const msg of messages) {
        const body = (msg.body_text || msg.body_html || "").toLowerCase().slice(0, 500);
        const fromEmail = (msg.from_email || "").toLowerCase();
        const combined = `${body} ${fromEmail}`;

        let skip = false;
        for (const pattern of skipPatterns) {
          if (pattern.test(combined)) {
            console.log(`Skipping message ${msg.id} - matched skip pattern: ${pattern}`);
            skippedIds.push(msg.id);
            skip = true;
            break;
          }
        }
        if (!skip) filteredMessages.push(msg);
      }

      // Mark all skipped messages as auto_replied in one batch
      for (const skippedId of skippedIds) {
        await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", skippedId);
      }

      if (filteredMessages.length === 0) continue;

      // 4. Process each message independently
      const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
      if (!DEEPSEEK_API_KEY) {
        console.error("DEEPSEEK_API_KEY not configured");
        continue;
      }

      for (const msg of filteredMessages) {
        try {
          // Generate AI response
          const systemPrompt = `Eres un asistente de email profesional. Tu trabajo es generar respuestas de email.

INFORMACIÓN DE LA EMPRESA:
${rule.company_info}

INSTRUCCIONES:
${rule.prompt}

REGLAS:
- Responde SOLO con el cuerpo del email, sin incluir "Asunto:", "De:", ni encabezados.
- Mantén un tono profesional y natural.
- Responde en el mismo idioma que el mensaje recibido.
- Si incluyes enlaces o URLs, escríbelos completos (ej: https://ejemplo.com/pagina).
- No inventes datos. Sé conciso y directo.
- Esta es una respuesta automática, debe parecer natural como si la escribiera una persona.

IMPORTANTE - NO RESPONDAS si detectas alguno de estos casos:
- Respuestas automáticas (out of office, vacation reply, auto-reply)
- Mensajes de "fuera de oficina" o "no disponible"
- Respuestas claramente negativas ("no me interesa", "no me contactes", "darse de baja")
- Mensajes de sistema (mailer-daemon, delivery failure, undelivered)
- Solicitudes de baja o unsubscribe

Si detectas cualquiera de estos casos, responde EXACTAMENTE con: __SKIP__`;


          const userMessage = `Genera una respuesta para este email:

De: ${msg.from_name || ""} <${msg.from_email}>
Asunto: ${msg.subject || "(sin asunto)"}
Cuerpo:
${msg.body_text || msg.body_html || "(vacío)"}`;

          const aiResp = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "deepseek-chat",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
            }),
          });

          if (!aiResp.ok) {
            const errText = await aiResp.text();
            console.error(`AI error for message ${msg.id}:`, aiResp.status, errText);
            
            await admin.from("auto_reply_log").insert({
              user_id: rule.user_id,
              rule_id: rule.id,
              inbox_message_id: msg.id,
              to_email: msg.from_email,
              subject: msg.subject || "",
              ai_response: "",
              status: "failed",
              error_message: `AI error: ${aiResp.status}`,
            });
            await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", msg.id);
            continue;
          }

          const aiData = await aiResp.json();
          const aiResponseText = aiData.choices?.[0]?.message?.content || "";

          // AI detected this is an out-of-office, negative, or auto-reply → skip
          if (aiResponseText.trim() === "__SKIP__" || aiResponseText.includes("__SKIP__")) {
            console.log(`AI flagged message ${msg.id} as skip-worthy (OOO/negative/auto-reply)`);
            await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", msg.id);
            continue;
          }

          if (!aiResponseText) {
            await admin.from("auto_reply_log").insert({
              user_id: rule.user_id,
              rule_id: rule.id,
              inbox_message_id: msg.id,
              to_email: msg.from_email,
              subject: msg.subject || "",
              ai_response: "",
              status: "failed",
              error_message: "AI returned empty response",
            });
            await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", msg.id);
            continue;
          }

          // Get email account SMTP credentials
          const { data: account } = await admin
            .from("email_accounts")
            .select("*")
            .eq("id", msg.account_id)
            .single();

          if (!account) {
            await admin.from("auto_reply_log").insert({
              user_id: rule.user_id,
              rule_id: rule.id,
              inbox_message_id: msg.id,
              to_email: msg.from_email,
              subject: msg.subject || "",
              ai_response: aiResponseText,
              status: "failed",
              error_message: "Email account not found",
            });
            await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", msg.id);
            continue;
          }

      // Build reply subject
      const originalSubject = msg.subject || "";
      const replySubject = originalSubject.toLowerCase().startsWith("re:") 
        ? originalSubject 
        : `Re: ${originalSubject}`;

      // Send as SMTP reply with In-Reply-To and References headers
      const htmlBody = textToHtml(aiResponseText);
      const senderName = [account.first_name, account.last_name].filter(Boolean).join(" ") || null;
      
      // Strip angle brackets from message_id to avoid double-wrapping
      const cleanMsgId = msg.message_id ? msg.message_id.replace(/^<|>$/g, '') : null;
      
      const result = await sendSmtpReply(
        account.smtp_host, account.smtp_port,
        account.smtp_username, account.smtp_password,
        account.email, msg.from_email,
        replySubject, htmlBody,
        cleanMsgId, cleanMsgId,
        senderName
      );

          const now = new Date().toISOString();

          await admin.from("auto_reply_log").insert({
            user_id: rule.user_id,
            rule_id: rule.id,
            inbox_message_id: msg.id,
            to_email: msg.from_email,
            subject: replySubject,
            ai_response: aiResponseText,
            status: result.ok ? "sent" : "failed",
            error_message: result.error || null,
            sent_at: result.ok ? now : null,
          });

          // Mark message as auto-replied
          await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", msg.id);

          if (result.ok) {
            // Also log in sent_emails for consistency
            await admin.from("sent_emails").insert({
              user_id: rule.user_id,
              account_id: msg.account_id,
              to_email: msg.from_email,
              subject: replySubject,
              body: htmlBody,
              status: "sent",
              sent_at: now,
            });

            // Increment sent_today
            await admin.from("email_accounts").update({
              sent_today: account.sent_today + 1,
            }).eq("id", account.id);
          }

          totalProcessed++;
        } catch (msgError) {
          console.error(`Error processing message ${msg.id}:`, msgError);
          await admin.from("auto_reply_log").insert({
            user_id: rule.user_id,
            rule_id: rule.id,
            inbox_message_id: msg.id,
            to_email: msg.from_email,
            subject: msg.subject || "",
            ai_response: "",
            status: "failed",
            error_message: msgError instanceof Error ? msgError.message : "Unknown error",
          });
          await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", msg.id);
        }
      }
    }

    return new Response(JSON.stringify({ processed: totalProcessed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-auto-replies error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
