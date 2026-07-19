import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Daily "hot leads" digest. Runs on a weekday cron at 18:00 Madrid. Looks at TODAY's
// inbox replies labelled Interesado / Pregunta and, ONLY if there are any, emails a
// short summary to the agency. If there's nothing worth flagging, it sends nothing.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const b64utf8 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const mimeWord = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);

async function sendMail(acct: any, to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
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
      `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: base64`, "",
      wrap(b64utf8(text)),
    ].join("\r\n");
    await conn.write(enc.encode(msg + "\r\n.\r\n"));
    const fin = (await readResponse()).trim();
    try { await cmd("QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }
    return /^2/.test(fin) ? { ok: true } : { ok: false, error: `Send: ${fin}` };
  } catch (e) { return { ok: false, error: String((e as any)?.message || e) }; }
}

// Plain, human-written text (no emojis, no HTML) — reads like a person wrote it.
function digestText(rows: any[]): string {
  const interesados = rows.filter((r) => r.interesado);
  const preguntas = rows.filter((r) => r.pregunta && !r.interesado);
  const line = (r: any) => {
    const who = r.from_email || "alguien";
    const camp = r.campaign ? ` (de la campaña ${r.campaign})` : "";
    return `- ${who}${camp}`;
  };
  const bits: string[] = [];
  if (interesados.length) bits.push(`${interesados.length} ${interesados.length === 1 ? "persona interesada" : "personas interesadas"}`);
  if (preguntas.length) bits.push(`${preguntas.length} ${preguntas.length === 1 ? "con una pregunta" : "con preguntas"}`);
  const out: string[] = [
    "Hola,",
    "",
    `Hoy hemos tenido ${bits.join(" y ")} en las campañas. Te las dejo por aquí para que les eches un ojo cuando puedas:`,
  ];
  if (interesados.length) { out.push("", "Interesados:"); interesados.forEach((r) => out.push(line(r))); }
  if (preguntas.length) { out.push("", "Con preguntas:"); preguntas.forEach((r) => out.push(line(r))); }
  out.push("", "Los tienes en el Unibox para contestarles cuando quieras.", "", "Un saludo,", "OnePulso Team");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
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
    const sb: string[] = [];
    if (nInteres) sb.push(`${nInteres} interesado${nInteres === 1 ? "" : "s"}`);
    if (nPreg) sb.push(`${nPreg} con preguntas`);
    const subject = `Resumen de hoy: ${sb.join(" y ")}`;
    const text = digestText(list);
    const r = await sendMail(acct, to, subject, text);
    return json({ ok: r.ok, sent: r.ok, count: list.length, interesados: nInteres, preguntas: nPreg, error: r.error, preview: body.test_days ? { subject, text } : undefined });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
