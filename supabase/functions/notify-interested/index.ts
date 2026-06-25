import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendSmtpEmail(
  host: string, port: number, username: string, password: string,
  from: string, to: string, subject: string, body: string
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

    await read();

    if (port === 587) {
      const resp = await send("EHLO notify");
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

        await sendTls("EHLO notify");
        const creds = btoa(`\0${username}\0${password}`);
        const authResp = await sendTls(`AUTH PLAIN ${creds}`);
        if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

        await sendTls(`MAIL FROM:<${from}>`);
        await sendTls(`RCPT TO:<${to}>`);
        await sendTls("DATA");

        const msg = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${body}\r\n.\r\n`;
        const dataResp = await sendTls(msg);
        await sendTls("QUIT");
        conn.close();
        return dataResp.includes("250") ? { ok: true } : { ok: false, error: `Send failed: ${dataResp}` };
      }
    }

    await send("EHLO notify");
    const creds = btoa(`\0${username}\0${password}`);
    const authResp = await send(`AUTH PLAIN ${creds}`);
    if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

    await send(`MAIL FROM:<${from}>`);
    await send(`RCPT TO:<${to}>`);
    await send("DATA");

    const msg = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${body}\r\n.\r\n`;
    const dataResp = await send(msg);
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
    const { user_id, from_email, from_name, subject } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user profile to check notification preference
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("notify_interested, full_name")
      .eq("user_id", user_id)
      .single();

    if (profileErr || !profile) {
      console.error("Profile not found:", profileErr);
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile.notify_interested) {
      return new Response(JSON.stringify({ skipped: true, reason: "Notifications disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the user's auth email (the one they signed up with)
    const { data: { user: authUser }, error: authErr } = await adminClient.auth.admin.getUserById(user_id);

    if (authErr || !authUser?.email) {
      console.error("Auth user not found:", authErr);
      return new Response(JSON.stringify({ skipped: true, reason: "No auth email found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientEmail = authUser.email;

    // Get first active SMTP account to send the notification
    const { data: account, error: accErr } = await adminClient
      .from("email_accounts")
      .select("*")
      .eq("user_id", user_id)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (accErr || !account) {
      console.error("No active email account found:", accErr);
      return new Response(JSON.stringify({ skipped: true, reason: "No active SMTP account" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build notification email
    const notifSubject = `🔔 Lead interesado: ${from_name || from_email}`;
    const notifBody = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #10b981; margin-bottom: 8px;">✅ Lead Interesado</h2>
        <p style="color: #666; margin-bottom: 16px;">Has recibido una respuesta de un lead interesado en tu campaña.</p>
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <p style="margin: 4px 0;"><strong>De:</strong> ${from_name || from_email}</p>
          <p style="margin: 4px 0;"><strong>Email:</strong> ${from_email}</p>
          <p style="margin: 4px 0;"><strong>Asunto:</strong> ${subject}</p>
        </div>
        <p style="color: #999; font-size: 12px;">— GodLeads Notificaciones</p>
      </div>
    `;

    const result = await sendSmtpEmail(
      account.smtp_host, account.smtp_port,
      account.smtp_username, account.smtp_password,
      account.email, recipientEmail,
      notifSubject, notifBody
    );

    if (!result.ok) {
      console.error("Failed to send notification:", result.error);
    }

    return new Response(JSON.stringify({ success: result.ok, error: result.error }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("notify-interested error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
