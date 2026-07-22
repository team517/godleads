import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE WATCHDOG
// A tiny, independent safety net for the sending engine. Runs on a short cron
// (every ~15 min). It NEVER sends prospect email and NEVER touches the engine —
// it only READS recent send activity and, if it looks broken, emails ONE alert
// to the agency so a systemic outage is caught in minutes instead of a whole day.
//
// It fires on either symptom of the class of failure that took the engine down
// (IONOS returning "503 bad sequence" in a storm):
//   • HIGH FAILURE RATE — lots of failed sends but almost none succeeding, OR
//   • TOTAL SILENCE      — zero successful sends for 30 min while a campaign
//                          window is open and there are active campaigns.
// Anti-spam: at most one alert per hour (a 1h lock via acquire_job_lock).
// Secret-gated exactly like the report/digest crons.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const b64utf8 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const mimeWord = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);

// Minimal, robust plain-text SMTP sender (same shape as daily-digest).
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
    const mf = await cmd(`MAIL FROM:<${from}>`);
    if (!mf.startsWith("250")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `MAIL FROM: ${mf}` }; }
    await cmd(`RCPT TO:<${to}>`);
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

const countSince = async (admin: any, minutes: number, filter: (q: any) => any): Promise<number> => {
  const sinceIso = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count } = await filter(admin.from("sent_emails").select("id", { count: "exact", head: true }).gte("created_at", sinceIso));
  return count || 0;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.secret || body.secret !== Deno.env.get("REPORTS_CRON_SECRET")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ── Read recent send health (platform-wide) ──
    const [ok20, fail20, ok30, activeCampaigns] = await Promise.all([
      countSince(admin, 20, (q) => q.eq("status", "sent")),
      countSince(admin, 20, (q) => q.in("status", ["failed", "bounced"])),
      countSince(admin, 30, (q) => q.eq("status", "sent")),
      admin.from("campaigns").select("id", { count: "exact", head: true }).eq("status", "active").then((r: any) => r.count || 0),
    ]);

    // Most common recent error, to make the alert actionable.
    let topError = "";
    if (fail20 > 0) {
      const sinceIso = new Date(Date.now() - 20 * 60_000).toISOString();
      const { data: errs } = await admin.from("sent_emails")
        .select("error_message").in("status", ["failed", "bounced"]).gte("created_at", sinceIso)
        .not("error_message", "is", null).limit(200);
      const freq: Record<string, number> = {};
      for (const e of errs || []) { const k = (e.error_message || "").slice(0, 80); freq[k] = (freq[k] || 0) + 1; }
      topError = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    }

    // ── (C) A single BROKEN account: many failures with ZERO successes in the last
    // 30 min (e.g. a sending domain with a dead MX/DNS record, or bad credentials).
    // The sender-stage fix means these no longer burn leads, but the mailbox is dead
    // weight until fixed — so flag it by email instead of the owner having to notice.
    // Read-only. Bounded: pull failing account_ids, then one exact count per account
    // that crosses the threshold (few, if any).
    const since30 = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: failRows } = await admin.from("sent_emails")
      .select("account_id").in("status", ["failed", "bounced"]).gte("created_at", since30)
      .not("account_id", "is", null).limit(3000);
    const failByAcct: Record<string, number> = {};
    for (const r of failRows || []) failByAcct[(r as any).account_id] = (failByAcct[(r as any).account_id] || 0) + 1;
    const brokenAccounts: string[] = [];
    for (const [accId, n] of Object.entries(failByAcct)) {
      if (n < 15) continue; // needs a real streak, not a couple of ordinary bounces
      const { count: okCount } = await admin.from("sent_emails")
        .select("id", { count: "exact", head: true }).eq("account_id", accId).eq("status", "sent").gte("created_at", since30);
      if ((okCount || 0) === 0) {
        const { data: a } = await admin.from("email_accounts").select("email").eq("id", accId).maybeSingle();
        if (a?.email) brokenAccounts.push(`${a.email} (${n} fallos, 0 envios en 30 min)`);
      }
    }

    // ── Decide if something is wrong ──
    // (A) Storm: real failure volume with almost no successes getting through.
    const highFailure = fail20 >= 25 && ok20 <= Math.floor(fail20 * 0.15);
    // (B) Silence: no successful send in 30 min while a window is open + campaigns active.
    const utcHour = new Date().getUTCHours(); // ~business hours in Europe: 8–16 UTC ≈ 10–18 Madrid (summer)
    const inBusinessHours = utcHour >= 8 && utcHour <= 16;
    const silence = ok30 === 0 && activeCampaigns > 0 && inBusinessHours;

    const problem = body.force === true || highFailure || silence || brokenAccounts.length > 0;
    const diagnostics = { ok20, fail20, ok30, activeCampaigns, highFailure, silence, brokenAccounts, topError, utcHour };
    if (!problem) return json({ ok: true, alerted: false, ...diagnostics });

    // ── Anti-spam: at most one alert per hour ──
    if (!body.test) {
      const { data: gotLock } = await admin.rpc("acquire_job_lock", { p_name: "engine-watchdog-alert", p_ttl_seconds: 3600 });
      if (gotLock === false) return json({ ok: true, alerted: false, debounced: true, ...diagnostics });
    }

    // ── Pick the best sending account (Google-hosted team@ = best deliverability) ──
    const { data: accts } = await admin.from("email_accounts")
      .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
      .eq("status", "connected").not("smtp_host", "is", null);
    const acct = (accts || []).find((a: any) => a.email === "team@onepulso.online") || (accts || [])[0];
    if (!acct?.smtp_host) return json({ ok: false, error: "No hay cuenta conectada para enviar el aviso", ...diagnostics }, 500);

    const reasons: string[] = [];
    if (highFailure) reasons.push(`Los envios estan FALLANDO: ${fail20} fallidos y solo ${ok20} correctos en los ultimos 20 minutos.`);
    if (silence) reasons.push(`El motor NO esta enviando: 0 envios correctos en los ultimos 30 minutos con campañas activas y la ventana de envio abierta.`);
    if (brokenAccounts.length) reasons.push(`Cuenta(s) de envio ROTAS (no envian nada, probable DNS/config): ${brokenAccounts.join("; ")}.\nRevisa su DNS (registro MX/A) o quitala de las campañas. El motor ya la aparta sola y reintenta con otras, asi que NO se pierden leads.`);
    const reason = reasons.join("\n\n") || "Aviso de prueba (force).";
    const text = [
      "Hola,",
      "",
      "Aviso automatico del sistema de envio (watchdog).",
      "",
      reason,
      topError ? `\nError mas frecuente: ${topError}` : "",
      "",
      "Que revisar:",
      "- Si el error habla de IONOS / 503 / rate / timeout, es el proveedor SMTP saturado: el motor reintenta solo y se recupera cuando IONOS vuelve.",
      "- Si persiste mas de 1-2 horas, avisa para revisarlo.",
      "",
      "Lo miro yo tambien, pero queria que lo supieras cuanto antes.",
      "",
      "Un saludo,",
      "OnePulso Team",
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

    const to = Deno.env.get("ALERT_EMAIL") || "team@onepulso.online";
    const subject = highFailure ? "AVISO: los envios estan fallando"
      : silence ? "AVISO: el motor no esta enviando"
      : "AVISO: una cuenta de envio esta rota";
    const r = await sendMail(acct, to, subject, text);
    return json({ ok: r.ok, alerted: r.ok, error: r.error, ...diagnostics, preview: body.test ? { subject, text } : undefined });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
