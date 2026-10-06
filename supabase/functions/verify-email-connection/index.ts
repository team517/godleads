import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { assertPublicMailHost } from "../_shared/host-guard.ts";
import { isCompleteSmtpReply, sanitizeServerText } from "../_shared/smtp-wire.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-api-version",
};

const TIMEOUT_MS = 15000;
// Auditoría 06-10-2026: al cliente sólo llega un motivo corto y limpio (máx. 120 caracteres, sin
// binarios), nunca la respuesta cruda de un servidor que eligió el usuario.
const NO_TLS_MSG = "El servidor no ofrece conexión cifrada (TLS); usa el puerto 465 o 587 con STARTTLS";
const reason = (raw: string) => sanitizeServerText(raw, 120);

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

/** Una respuesta SMTP ENTERA: sólo está completa con CRLF final + línea "NNN " (ver smtp-wire.ts). */
async function readSmtp(conn: Deno.Conn, timeoutMs = 5000): Promise<string> {
  let acc = "";
  const deadline = Date.now() + Math.max(timeoutMs, 5000) * 2;
  while (Date.now() < deadline && acc.length < 64 * 1024) {
    const chunk = await readWithTimeout(conn, timeoutMs);
    if (!chunk) break; // el servidor cerró
    acc += chunk;
    if (isCompleteSmtpReply(acc)) break;
  }
  return acc;
}

async function sendCmd(conn: Deno.Conn, cmd: string): Promise<string> {
  await conn.write(new TextEncoder().encode(cmd + "\r\n"));
  return await readSmtp(conn, 5000);
}

async function testSmtp(host: string, port: number, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  // SSRF: nada de direcciones internas ni puertos que no sean de correo, ANTES de conectar.
  const hostProblem = await assertPublicMailHost(host, port);
  if (hostProblem) return { ok: false, error: hostProblem };
  let conn: Deno.Conn | null = null;
  try {
    if (port === 465) {
      // Direct TLS connection
      conn = await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "SMTP TLS connect");
    } else {
      conn = await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "SMTP connect");
    }

    // Read greeting
    const greeting = await readSmtp(conn, 5000);
    console.log("SMTP greeting:", reason(greeting));

    const ehlo1 = await sendCmd(conn, "EHLO mailreach");
    console.log("SMTP EHLO response:", reason(ehlo1));

    if (port !== 465) {
      // Sin TLS NUNCA se envía AUTH (auditoría 06-10-2026, #11): antes, si el servidor no ofrecía
      // STARTTLS en el 587 (o en cualquier otro puerto), se mandaba usuario y contraseña en claro.
      if (!/STARTTLS/i.test(ehlo1)) {
        try { conn.close(); } catch (_) { /* ignore */ }
        return { ok: false, error: NO_TLS_MSG };
      }
      const starttlsResp = await sendCmd(conn, "STARTTLS");
      console.log("STARTTLS response:", reason(starttlsResp));
      if (!starttlsResp.startsWith("220")) {
        try { conn.close(); } catch (_) { /* ignore */ }
        return { ok: false, error: `SMTP STARTTLS failed: ${reason(starttlsResp)}` };
      }
      // Upgrade to TLS
      conn = await withTimeout(
        Deno.startTls(conn as Deno.TcpConn, { hostname: host }),
        TIMEOUT_MS,
        "STARTTLS upgrade"
      );
      await sendCmd(conn, "EHLO mailreach");
    }

    const credentials = safeBase64(`\0${username}\0${password}`);
    const authResp = await sendCmd(conn, `AUTH PLAIN ${credentials}`);
    console.log("SMTP AUTH response:", reason(authResp));

    try { await sendCmd(conn, "QUIT"); } catch (_) { /* ignore */ }
    conn.close();

    if (authResp.startsWith("235")) return { ok: true };
    return { ok: false, error: `SMTP auth failed: ${reason(authResp)}` };
  } catch (e) {
    try { conn?.close(); } catch (_) { /* ignore */ }
    return { ok: false, error: `SMTP error: ${reason((e as Error)?.message || String(e))}` };
  }
}

/** Cadena entre comillas de IMAP (RFC 3501 §4.3). Sin CR/LF: un usuario o clave con salto de línea inyectaba órdenes. */
function imapQuote(s: string): string | null {
  if (/[\r\n\0]/.test(s)) return null;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function testImap(host: string, port: number, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const hostProblem = await assertPublicMailHost(host, port);
  if (hostProblem) return { ok: false, error: hostProblem };
  const qUser = imapQuote(username ?? "");
  const qPass = imapQuote(password ?? "");
  if (!qUser || !qPass) return { ok: false, error: "IMAP auth failed: usuario o contraseña con caracteres no válidos" };
  let conn: Deno.Conn | null = null;
  try {
    if (port === 993) {
      conn = await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "IMAP TLS connect");
    } else {
      conn = await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "IMAP connect");
    }

    // Read greeting
    const greeting = await readWithTimeout(conn, 5000);
    console.log("IMAP greeting:", reason(greeting));

    // Login
    const loginCmd = `A001 LOGIN ${qUser} ${qPass}`;
    await conn.write(new TextEncoder().encode(loginCmd + "\r\n"));

    // Read login response (may come in multiple chunks)
    let response = "";
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const chunk = await readWithTimeout(conn, 5000);
      response += chunk;
      if (response.includes("A001 OK") || response.includes("A001 NO") || response.includes("A001 BAD")) break;
    }
    console.log("IMAP LOGIN response:", reason(response));

    if (response.includes("A001 OK")) {
      try {
        await conn.write(new TextEncoder().encode("A002 LOGOUT\r\n"));
        await readWithTimeout(conn, 3000);
      } catch (_) { /* ignore */ }
      conn.close();
      return { ok: true };
    }

    conn.close();
    return { ok: false, error: `IMAP auth failed: ${reason(response)}` };
  } catch (e) {
    try { conn?.close(); } catch (_) { /* ignore */ }
    return { ok: false, error: `IMAP error: ${reason((e as Error)?.message || String(e))}` };
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
      console.error("Overall timeout:", (e as Error).message);
      return [
        { ok: false, error: `Timeout: ${(e as Error).message}` },
        { ok: false, error: `Timeout: ${(e as Error).message}` },
      ] as [{ ok: boolean; error?: string }, { ok: boolean; error?: string }];
    });

    const [smtpResult, imapResult] = await overallTimeout;

    // A TIMEOUT (or a network blip) is NOT a verdict on the mailbox — it only means we could not
    // finish asking. Writing status="error" on it silently knocked healthy mailboxes out of the
    // sending pool (the engine only uses status='connected'), which is why accounts drifted to
    // "IMAP sin conexión" and stopped sending until something re-verified them.
    const TRANSIENT_RE = /timeout|timed?\s*out|econnreset|connection reset|network|temporar|try again|\b(421|451|503)\b|abort/i;
    const isTransient = (r: { ok: boolean; error?: string }) => !r.ok && TRANSIENT_RE.test(r.error || "");
    const bothOk = smtpResult.ok && imapResult.ok;
    const transient = !bothOk && (isTransient(smtpResult) || isTransient(imapResult));

    console.log(`Results - SMTP: ${JSON.stringify(smtpResult)}, IMAP: ${JSON.stringify(imapResult)}, transient: ${transient}`);

    let newStatus: string;
    if (bothOk) {
      newStatus = "connected";
      await adminClient.from("email_accounts").update({
        status: "connected", last_health_check: new Date().toISOString(),
      }).eq("id", account_id);
    } else if (transient) {
      // Keep whatever the account already is. Do NOT touch last_health_check either, so the
      // health monitor retries it soon instead of trusting a check that never completed.
      newStatus = account.status;
    } else {
      // A definitive refusal (bad credentials, unknown host, connection refused) → record it.
      newStatus = "error";
      await adminClient.from("email_accounts").update({
        status: "error", last_health_check: new Date().toISOString(),
      }).eq("id", account_id);
    }

    return new Response(JSON.stringify({
      status: newStatus,
      transient,
      smtp: { ...smtpResult, transient: isTransient(smtpResult) },
      imap: { ...imapResult, transient: isTransient(imapResult) },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("verify-email-connection error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
