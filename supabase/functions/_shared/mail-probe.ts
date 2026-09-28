// Probar el acceso SMTP / IMAP de un buzón (la misma prueba que verify-email-connection).
// Sólo inicia sesión y se va: no envía nada. Nunca registra las credenciales.

const TIMEOUT_MS = 15000;

function safeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function leer(conn: Deno.Conn, ms = 5000): Promise<string> {
  const buf = new Uint8Array(4096);
  return withTimeout(conn.read(buf).then((n) => new TextDecoder().decode(buf.subarray(0, n || 0))), ms, "read");
}

async function orden(conn: Deno.Conn, cmd: string): Promise<string> {
  await conn.write(new TextEncoder().encode(cmd + "\r\n"));
  return await leer(conn, 5000);
}

export async function probarSmtp(host: string, port: number, usuario: string, clave: string): Promise<{ ok: boolean; error?: string }> {
  let conn: Deno.Conn | null = null;
  try {
    conn = port === 465
      ? await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "SMTP TLS connect")
      : await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "SMTP connect");
    await leer(conn, 5000);
    const ehlo = await orden(conn, "EHLO onepulso");
    if (port !== 465 && ehlo.includes("STARTTLS")) {
      const r = await orden(conn, "STARTTLS");
      if (r.startsWith("220")) {
        conn = await withTimeout(Deno.startTls(conn as Deno.TcpConn, { hostname: host }), TIMEOUT_MS, "STARTTLS upgrade");
        await orden(conn, "EHLO onepulso");
      }
    }
    const auth = await orden(conn, `AUTH PLAIN ${safeBase64(`\0${usuario}\0${clave}`)}`);
    try { await orden(conn, "QUIT"); } catch { /* da igual */ }
    conn.close();
    return auth.startsWith("235") ? { ok: true } : { ok: false, error: `SMTP auth failed: ${auth.trim().slice(0, 160)}` };
  } catch (e) {
    try { conn?.close(); } catch { /* da igual */ }
    return { ok: false, error: `SMTP error: ${(e as Error).message}` };
  }
}

export async function probarImap(host: string, port: number, usuario: string, clave: string): Promise<{ ok: boolean; error?: string }> {
  let conn: Deno.Conn | null = null;
  try {
    conn = port === 993
      ? await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "IMAP TLS connect")
      : await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "IMAP connect");
    await leer(conn, 5000);
    await conn.write(new TextEncoder().encode(`A001 LOGIN "${usuario}" "${clave}"\r\n`));
    let resp = "";
    const hasta = Date.now() + 10000;
    while (Date.now() < hasta) {
      resp += await leer(conn, 5000);
      if (/A001 (OK|NO|BAD)/.test(resp)) break;
    }
    const ok = resp.includes("A001 OK");
    try { if (ok) await conn.write(new TextEncoder().encode("A002 LOGOUT\r\n")); } catch { /* da igual */ }
    conn.close();
    return ok ? { ok: true } : { ok: false, error: `IMAP auth failed: ${resp.trim().slice(0, 160)}` };
  } catch (e) {
    try { conn?.close(); } catch { /* da igual */ }
    return { ok: false, error: `IMAP error: ${(e as Error).message}` };
  }
}
