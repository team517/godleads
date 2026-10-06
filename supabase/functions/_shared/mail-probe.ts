// Probar el acceso SMTP / IMAP de un buzón (la misma prueba que verify-email-connection).
// Sólo inicia sesión y se va: no envía nada. Nunca registra las credenciales.
//
// Auditoría 06-10-2026: el host/puerto lo elige el usuario, así que (SSRF) se rechazan direcciones
// internas y puertos que no son de correo ANTES de conectar; sin TLS nunca se envía AUTH (si el
// servidor no ofrece STARTTLS se falla); y el error devuelto es un motivo corto y limpio.

import { assertPublicMailHost } from "./host-guard.ts";
import { isCompleteSmtpReply, sanitizeServerText } from "./smtp-wire.ts";

const TIMEOUT_MS = 15000;
const NO_TLS_MSG = "El servidor no ofrece conexión cifrada (TLS); usa el puerto 465 o 587 con STARTTLS";
const motivo = (raw: string) => sanitizeServerText(raw, 120);

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

/** Una respuesta SMTP ENTERA: completa sólo con CRLF final + línea "NNN " (un trozo suelto no cuenta). */
async function leerSmtp(conn: Deno.Conn, ms = 5000): Promise<string> {
  let acc = "";
  const hasta = Date.now() + ms * 2;
  while (Date.now() < hasta && acc.length < 64 * 1024) {
    const chunk = await leer(conn, ms);
    if (!chunk) break;
    acc += chunk;
    if (isCompleteSmtpReply(acc)) break;
  }
  return acc;
}

async function orden(conn: Deno.Conn, cmd: string): Promise<string> {
  await conn.write(new TextEncoder().encode(cmd + "\r\n"));
  return await leerSmtp(conn, 5000);
}

export async function probarSmtp(host: string, port: number, usuario: string, clave: string): Promise<{ ok: boolean; error?: string }> {
  const malHost = await assertPublicMailHost(host, port);
  if (malHost) return { ok: false, error: malHost };
  let conn: Deno.Conn | null = null;
  try {
    conn = port === 465
      ? await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "SMTP TLS connect")
      : await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "SMTP connect");
    await leerSmtp(conn, 5000);
    const ehlo = await orden(conn, "EHLO onepulso");
    if (port !== 465) {
      // Sin TLS no se manda AUTH jamás: antes, si no había STARTTLS, usuario y clave viajaban en claro.
      if (!/STARTTLS/i.test(ehlo)) {
        try { conn.close(); } catch { /* da igual */ }
        return { ok: false, error: NO_TLS_MSG };
      }
      const r = await orden(conn, "STARTTLS");
      if (!r.startsWith("220")) {
        try { conn.close(); } catch { /* da igual */ }
        return { ok: false, error: `SMTP STARTTLS failed: ${motivo(r)}` };
      }
      conn = await withTimeout(Deno.startTls(conn as Deno.TcpConn, { hostname: host }), TIMEOUT_MS, "STARTTLS upgrade");
      await orden(conn, "EHLO onepulso");
    }
    const auth = await orden(conn, `AUTH PLAIN ${safeBase64(`\0${usuario}\0${clave}`)}`);
    try { await orden(conn, "QUIT"); } catch { /* da igual */ }
    conn.close();
    return auth.startsWith("235") ? { ok: true } : { ok: false, error: `SMTP auth failed: ${motivo(auth)}` };
  } catch (e) {
    try { conn?.close(); } catch { /* da igual */ }
    return { ok: false, error: `SMTP error: ${motivo((e as Error).message)}` };
  }
}

/** Cadena entre comillas de IMAP; null si lleva CR/LF/NUL (inyección de órdenes). */
function imapQuote(s: string): string | null {
  if (/[\r\n\0]/.test(s)) return null;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function probarImap(host: string, port: number, usuario: string, clave: string): Promise<{ ok: boolean; error?: string }> {
  const malHost = await assertPublicMailHost(host, port);
  if (malHost) return { ok: false, error: malHost };
  const qUser = imapQuote(usuario ?? "");
  const qPass = imapQuote(clave ?? "");
  if (!qUser || !qPass) return { ok: false, error: "IMAP auth failed: usuario o contraseña con caracteres no válidos" };
  let conn: Deno.Conn | null = null;
  try {
    conn = port === 993
      ? await withTimeout(Deno.connectTls({ hostname: host, port }), TIMEOUT_MS, "IMAP TLS connect")
      : await withTimeout(Deno.connect({ hostname: host, port }), TIMEOUT_MS, "IMAP connect");
    await leer(conn, 5000);
    await conn.write(new TextEncoder().encode(`A001 LOGIN ${qUser} ${qPass}\r\n`));
    let resp = "";
    const hasta = Date.now() + 10000;
    while (Date.now() < hasta) {
      resp += await leer(conn, 5000);
      if (/A001 (OK|NO|BAD)/.test(resp)) break;
    }
    const ok = resp.includes("A001 OK");
    try { if (ok) await conn.write(new TextEncoder().encode("A002 LOGOUT\r\n")); } catch { /* da igual */ }
    conn.close();
    return ok ? { ok: true } : { ok: false, error: `IMAP auth failed: ${motivo(resp)}` };
  } catch (e) {
    try { conn?.close(); } catch { /* da igual */ }
    return { ok: false, error: `IMAP error: ${motivo((e as Error).message)}` };
  }
}
