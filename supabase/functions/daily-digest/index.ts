import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Daily "hot leads" digest. Runs on a weekday cron at 18:00 Madrid. Looks at TODAY's
// inbox replies labelled Interesado / Pregunta and, ONLY if there are any, emails a
// short summary to the agency. If there's nothing worth flagging, it sends nothing.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const esc = (s: string) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const b64utf8 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const mimeWord = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);

async function sendHtml(acct: any, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const host = acct.smtp_host, port = acct.smtp_port || 465, user = acct.smtp_username, pass = acct.smtp_password, from = acct.email;
  try {
    let conn: Deno.Conn = port === 465 ? await Deno.connectTls({ hostname: host, port }) : await Deno.connect({ hostname: host, port });
    const enc = new TextEncoder(), dec = new TextDecoder();
    const readResponse = async (): Promise<string> => {
      let res = "";
      while (true) {
        const b = new Uint8Array(4096); const n = await conn.read(b); if (!n) break;
        res += dec.decode(b.subarray(0, n));
        const lines = res.split("\r\n").filter((l) => l.length > 0); const last = lines[lines.length - 1] || "";
        if (/^\d{3} /.test(last)) break;
      }
      return res;
    };
    const cmd = async (c: string) => { await conn.write(enc.encode(c + "\r\n")); return (await readResponse()).trim(); };
    await readResponse();
    if (port !== 465) {
      const e = await cmd("EHLO onepulso");
      if (/STARTTLS/i.test(e)) { await conn.write(enc.encode("STARTTLS\r\n")); await readResponse(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); }
      else { try { conn.close(); } catch { /* */ } return { ok: false, error: "El servidor no ofrece STARTTLS" }; }
    }
    await cmd("EHLO onepulso");
    const a = await cmd(`AUTH PLAIN ${btoa(`\0${user}\0${pass}`)}`);
    if (!a.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `Auth: ${a}` }; }
    await cmd(`MAIL FROM:<${from}>`); await cmd(`RCPT TO:<${to}>`);
    const d = await cmd("DATA"); if (!/^3/.test(d)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `DATA: ${d}` }; }
    const dom = from.split("@")[1] || "localhost";
    const wrap = (s: string) => (s.match(/.{1,76}/g) || []).join("\r\n");
    const msg = [
      `From: OnePulso <${from}>`, `To: ${to}`, `Subject: ${mimeWord(subject)}`,
      `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${Math.random().toString(36).slice(2)}${Date.now().toString(36)}@${dom}>`,
      `MIME-Version: 1.0`, `Content-Type: text/html; charset=utf-8`, `Content-Transfer-Encoding: base64`, "",
      wrap(b64utf8(html)),
    ].join("\r\n");
    await conn.write(enc.encode(msg + "\r\n.\r\n"));
    const fin = (await readResponse()).trim();
    try { await cmd("QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }
    return /^2/.test(fin) ? { ok: true } : { ok: false, error: `Send: ${fin}` };
  } catch (e) { return { ok: false, error: String((e as any)?.message || e) }; }
}

function digestHtml(rows: any[]): string {
  const interesados = rows.filter((r) => r.interesado);
  const preguntas = rows.filter((r) => r.pregunta && !r.interesado);
  const item = (r: any) => `<li style="margin:8px 0;padding:9px 11px;border:1px solid #eef;border-radius:8px;list-style:none">
    <b>${esc(r.from_email || "—")}</b>${r.campaign ? ` · <span style="color:#667085">${esc(r.campaign)}</span>` : ""}
    ${r.subject ? `<div style="font-size:13px;color:#333;margin-top:2px">${esc(r.subject)}</div>` : ""}
    ${r.snippet ? `<div style="font-size:12px;color:#999;margin-top:2px">${esc(r.snippet)}</div>` : ""}
  </li>`;
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1e1e26">
    <h2 style="margin:0 0 4px">🔥 Resumen de hoy — leads calientes</h2>
    <p style="color:#667085;font-size:14px;margin:0 0 14px">Hoy has tenido <b>${interesados.length}</b> interesado(s) y <b>${preguntas.length}</b> con preguntas. Échales un ojo cuanto antes:</p>
    ${interesados.length ? `<h3 style="color:#16a34a;font-size:15px;margin:14px 0 4px">✅ Interesados (${interesados.length})</h3><ul style="padding:0;margin:0">${interesados.map(item).join("")}</ul>` : ""}
    ${preguntas.length ? `<h3 style="color:#2563eb;font-size:15px;margin:16px 0 4px">❓ Con preguntas / dudas (${preguntas.length})</h3><ul style="padding:0;margin:0">${preguntas.map(item).join("")}</ul>` : ""}
    <p style="color:#98a2b3;font-size:11px;margin-top:22px">Resumen automático de OnePulso · cada día laborable a las 18:00 · solo se envía cuando hay leads calientes.</p>
  </div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.secret || body.secret !== Deno.env.get("REPORTS_CRON_SECRET")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    // body.test_days > 0 → widen to the last N days (only for verifying the email).
    const { data: rows, error } = await admin.rpc("hot_leads_today", { p_days: Number(body.test_days) || 0 });
    if (error) return json({ ok: false, error: error.message }, 500);
    const list: any[] = rows || [];
    if (list.length === 0) return json({ ok: true, sent: false, reason: "nada caliente hoy" });

    const to = Deno.env.get("ALERT_EMAIL") || "team@onepulso.online";
    const { data: accts } = await admin.from("email_accounts")
      .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
      .eq("status", "connected").not("smtp_host", "is", null);
    // Prefer the Google-hosted team@ account (best deliverability), else any connected.
    const acct = (accts || []).find((a: any) => a.email === "team@onepulso.online") || (accts || [])[0];
    if (!acct?.smtp_host) return json({ ok: false, error: "No hay cuenta conectada para enviar el resumen" }, 500);

    const nInteres = list.filter((r) => r.interesado).length;
    const nPreg = list.filter((r) => r.pregunta && !r.interesado).length;
    const subject = `🔥 Hoy: ${nInteres} interesado(s)${nPreg ? ` y ${nPreg} con preguntas` : ""}`;
    const r = await sendHtml(acct, to, subject, digestHtml(list));
    return json({ ok: r.ok, sent: r.ok, count: list.length, interesados: nInteres, preguntas: nPreg, error: r.error });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
