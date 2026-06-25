import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-api-version",
};

const TIMEOUT_MS = 15000;

function safeBase64(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function readWithTimeout(conn: Deno.Conn, timeoutMs = 5000): Promise<string> {
  const buf = new Uint8Array(4096);
  return withTimeout(
    conn.read(buf).then(n => new TextDecoder().decode(buf.subarray(0, n || 0))),
    timeoutMs,
    "read"
  );
}

async function sendCmd(conn: Deno.Conn, cmd: string): Promise<string> {
  await conn.write(new TextEncoder().encode(cmd + "\r\n"));
  return await readWithTimeout(conn, 5000);
}

async function testSmtp(host: string, port: number, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  let conn: Deno.Conn | null = null;
  try {
    if (port === 465) {
      // Direct TLS connection
      conn = await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "SMTP TLS connect");
    } else {
      conn = await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "SMTP connect");
    }

    // Read greeting
    const greeting = await readWithTimeout(conn, 5000);
    console.log("SMTP greeting:", greeting.trim());

    if (port === 465) {
      // Already TLS, send EHLO + AUTH
      const ehlo = await sendCmd(conn, "EHLO mailreach");
      console.log("SMTP EHLO response:", ehlo.trim());

      const credentials = safeBase64(`\0${username}\0${password}`);
      const authResp = await sendCmd(conn, `AUTH PLAIN ${credentials}`);
      console.log("SMTP AUTH response:", authResp.trim());

      try { await sendCmd(conn, "QUIT"); } catch (_) { /* ignore */ }
      conn.close();

      if (authResp.startsWith("235")) return { ok: true };
      return { ok: false, error: `SMTP auth failed: ${authResp.trim()}` };
    }

    if (port === 587) {
      // STARTTLS flow
      const ehlo1 = await sendCmd(conn, "EHLO mailreach");
      console.log("SMTP EHLO response:", ehlo1.trim());

      if (ehlo1.includes("STARTTLS")) {
        const starttlsResp = await sendCmd(conn, "STARTTLS");
        console.log("STARTTLS response:", starttlsResp.trim());

        if (starttlsResp.startsWith("220")) {
          // Upgrade to TLS
          const tlsConn = await withTimeout(
            Deno.startTls(conn as Deno.TcpConn, { hostname: host }),
            TIMEOUT_MS,
            "STARTTLS upgrade"
          );
          conn = tlsConn;

          await sendCmd(conn, "EHLO mailreach");
          const credentials = safeBase64(`\0${username}\0${password}`);
          const authResp = await sendCmd(conn, `AUTH PLAIN ${credentials}`);
          console.log("SMTP AUTH response:", authResp.trim());

          try { await sendCmd(conn, "QUIT"); } catch (_) { /* ignore */ }
          conn.close();

          if (authResp.startsWith("235")) return { ok: true };
          return { ok: false, error: `SMTP auth failed: ${authResp.trim()}` };
        }
      }

      // Fallback: try AUTH without TLS
      const credentials = safeBase64(`\0${username}\0${password}`);
      const authResp = await sendCmd(conn, `AUTH PLAIN ${credentials}`);
      try { await sendCmd(conn, "QUIT"); } catch (_) { /* ignore */ }
      conn.close();

      if (authResp.startsWith("235")) return { ok: true };
      return { ok: false, error: `SMTP auth failed: ${authResp.trim()}` };
    }

    // Generic port
    await sendCmd(conn, "EHLO mailreach");
    const credentials = safeBase64(`\0${username}\0${password}`);
    const authResp = await sendCmd(conn, `AUTH PLAIN ${credentials}`);
    try { await sendCmd(conn, "QUIT"); } catch (_) { /* ignore */ }
    conn.close();

    if (authResp.startsWith("235")) return { ok: true };
    return { ok: false, error: `SMTP auth failed: ${authResp.trim()}` };
  } catch (e) {
    try { conn?.close(); } catch (_) { /* ignore */ }
    return { ok: false, error: `SMTP error: ${e.message}` };
  }
}

async function testImap(host: string, port: number, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  let conn: Deno.Conn | null = null;
  try {
    if (port === 993) {
      conn = await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "IMAP TLS connect");
    } else {
      conn = await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "IMAP connect");
    }

    // Read greeting
    const greeting = await readWithTimeout(conn, 5000);
    console.log("IMAP greeting:", greeting.trim());

    // Login
    const loginCmd = `A001 LOGIN "${username}" "${password}"`;
    await conn.write(new TextEncoder().encode(loginCmd + "\r\n"));
    
    // Read login response (may come in multiple chunks)
    let response = "";
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const chunk = await readWithTimeout(conn, 5000);
      response += chunk;
      if (response.includes("A001 OK") || response.includes("A001 NO") || response.includes("A001 BAD")) break;
    }
    console.log("IMAP LOGIN response:", response.trim().slice(0, 200));

    if (response.includes("A001 OK")) {
      try {
        await conn.write(new TextEncoder().encode("A002 LOGOUT\r\n"));
        await readWithTimeout(conn, 3000);
      } catch (_) { /* ignore */ }
      conn.close();
      return { ok: true };
    }

    conn.close();
    return { ok: false, error: `IMAP auth failed: ${response.trim().slice(0, 200)}` };
  } catch (e) {
    try { conn?.close(); } catch (_) { /* ignore */ }
    return { ok: false, error: `IMAP error: ${e.message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Backend auth configuration missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (claimsError || !userId) {
      console.error("Auth error:", claimsError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { account_id } = await req.json();
    if (!account_id) {
      return new Response(JSON.stringify({ error: "account_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: account, error: accError } = await adminClient
      .from("email_accounts")
      .select("*")
      .eq("id", account_id)
      .eq("user_id", userId)
      .single();

    if (accError || !account) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Verifying account ${account.email} - SMTP: ${account.smtp_host}:${account.smtp_port}, IMAP: ${account.imap_host}:${account.imap_port}`);

    // Test both with overall timeout
    const overallTimeout = withTimeout(
      Promise.all([
        testSmtp(account.smtp_host, account.smtp_port, account.smtp_username, account.smtp_password),
        testImap(account.imap_host, account.imap_port, account.imap_username, account.imap_password),
      ]),
      25000,
      "Overall verification"
    ).catch((e) => {
      console.error("Overall timeout:", e.message);
      return [
        { ok: false, error: `Timeout: ${e.message}` },
        { ok: false, error: `Timeout: ${e.message}` },
      ] as [{ ok: boolean; error?: string }, { ok: boolean; error?: string }];
    });

    const [smtpResult, imapResult] = await overallTimeout;

    const newStatus = smtpResult.ok && imapResult.ok ? "connected" : "error";

    console.log(`Results - SMTP: ${JSON.stringify(smtpResult)}, IMAP: ${JSON.stringify(imapResult)}, Status: ${newStatus}`);

    await adminClient.from("email_accounts").update({
      status: newStatus,
      last_health_check: new Date().toISOString(),
    }).eq("id", account_id);

    return new Response(JSON.stringify({
      status: newStatus,
      smtp: smtpResult,
      imap: imapResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("verify-email-connection error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
