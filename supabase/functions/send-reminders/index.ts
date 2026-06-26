import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSmtpReply, textToHtml } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BODY =
  "Hola, solo quería retomar mi mensaje anterior por si lo habías pasado por alto. ¿Te encaja comentarlo? Un saludo.";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Due reminders that are still pending. (Replies flip them to cancelled_by_reply
    // in fetch-inbox, so anything still 'pending' here genuinely needs a nudge.)
    const nowIso = new Date().toISOString();
    const { data: due, error } = await admin
      .from("message_reminders")
      .select("*")
      .eq("status", "pending")
      .lte("remind_at", nowIso)
      .order("remind_at", { ascending: true })
      .limit(100);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0, failed = 0;

    for (const r of (due || [])) {
      try {
        // Resolve the originating inbox message (for account + recipient fallback).
        const { data: msg } = await admin
          .from("inbox_messages")
          .select("account_id, from_email, message_id, ref_chain, subject")
          .eq("id", r.message_id)
          .maybeSingle();

        const recipient = (r.recipient || msg?.from_email || "").trim();
        const accountId = msg?.account_id || null;
        if (!recipient || !accountId) {
          await admin.from("message_reminders")
            .update({ status: "failed", error: "Missing recipient or account" })
            .eq("id", r.id);
          failed++;
          continue;
        }

        const { data: account } = await admin
          .from("email_accounts")
          .select("*")
          .eq("id", accountId)
          .maybeSingle();

        if (!account) {
          await admin.from("message_reminders")
            .update({ status: "failed", error: "Email account not found" })
            .eq("id", r.id);
          failed++;
          continue;
        }

        const originalSubject = r.original_subject || msg?.subject || "";
        const replySubject = originalSubject.toLowerCase().startsWith("re:")
          ? originalSubject
          : `Re: ${originalSubject}`;

        const bodyText = (r.reminder_body && r.reminder_body.trim()) ? r.reminder_body : DEFAULT_BODY;
        const htmlBody = textToHtml(bodyText);
        const senderName = [account.first_name, account.last_name].filter(Boolean).join(" ") || null;

        const inReplyTo = (r.original_message_id || msg?.message_id || "").replace(/^<|>$/g, "") || null;
        const references = (r.original_references || r.original_message_id || msg?.ref_chain || msg?.message_id || "")
          .replace(/^<|>$/g, "") || null;

        const result = await sendSmtpReply(
          account.smtp_host, account.smtp_port,
          account.smtp_username, account.smtp_password,
          account.email, recipient,
          replySubject, htmlBody,
          inReplyTo, references,
          senderName
        );

        const now = new Date().toISOString();
        if (result.ok) {
          await admin.from("message_reminders")
            .update({ status: "sent", sent_at: now, is_done: true, error: null })
            .eq("id", r.id);
          await admin.from("sent_emails").insert({
            user_id: r.user_id,
            account_id: accountId,
            to_email: recipient,
            subject: replySubject,
            body: htmlBody,
            status: "sent",
            sent_at: now,
          });
          sent++;
        } else {
          await admin.from("message_reminders")
            .update({ status: "failed", error: result.error || "send failed" })
            .eq("id", r.id);
          failed++;
        }
      } catch (e) {
        await admin.from("message_reminders")
          .update({ status: "failed", error: e instanceof Error ? e.message : "Unknown error" })
          .eq("id", r.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: (due || []).length, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-reminders error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
