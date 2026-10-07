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

// null = could not count (failed or timed-out query). It used to become 0 and raised a false
// "el motor no está enviando" (07-10-2026).
const countSince = async (admin: any, minutes: number, filter: (q: any) => any): Promise<number | null> => {
  const sinceIso = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count, error } = await filter(admin.from("sent_emails").select("id", { count: "exact", head: true }).gte("created_at", sinceIso));
  if (error || count == null) return null;
  return count;
};

const DAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** Weekday + minutes of the day in the campaign's time zone (same as the engine). */
function localClock(now: Date, tz: string): { day: string; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const wd = (parts.find((p) => p.type === "weekday")?.value || "").slice(0, 3).toLowerCase();
    const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
    const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
    return { day: wd, minutes: h * 60 + m };
  } catch {
    return { day: DAY_ABBR[now.getUTCDay()], minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

/**
 * Active campaigns whose sending window has been OPEN for at least `minutes` (07-10-2026).
 * Silence only counts if the whole half hour falls inside some campaign's real window: the old
 * fixed 08–16 UTC range (10:00–18:59 Madrid) alerted at 18:30 with every window closed at 18:00.
 * null = could not read the campaigns.
 */
async function campaignsWithOpenWindow(admin: any, minutes: number): Promise<number | null> {
  const { data, error } = await admin.from("campaigns")
    .select("id, send_days, send_start_hour, send_end_hour, timezone").eq("status", "active").limit(5000);
  if (error || !data) return null;
  const now = new Date();
  let open = 0;
  for (const c of data as any[]) {
    const { day, minutes: cur } = localClock(now, c.timezone || "UTC");
    const days: string[] = c.send_days || ["mon", "tue", "wed", "thu", "fri"];
    if (!days.includes(day)) continue;
    let start = c.send_start_hour ?? 9, end = c.send_end_hour ?? 18;
    if (!(start < end)) { start = 9; end = 18; }
    if (cur - minutes >= start * 60 && cur < end * 60) open++;
  }
  return open;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.secret || body.secret !== Deno.env.get("REPORTS_CRON_SECRET")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ── Read recent send health (platform-wide) ──
    const [ok20n, fail20n, ok30, openCampaigns] = await Promise.all([
      countSince(admin, 20, (q) => q.eq("status", "sent")),
      countSince(admin, 20, (q) => q.in("status", ["failed", "bounced"])),
      countSince(admin, 30, (q) => q.eq("status", "sent")),
      campaignsWithOpenWindow(admin, 30),
    ]);
    const ok20 = ok20n ?? 0, fail20 = fail20n ?? 0;

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
    const highFailure = ok20n != null && fail20n != null && fail20 >= 25 && ok20 <= Math.floor(fail20 * 0.15);
    // (B) Silence: no successful send in 30 min while some campaign's REAL window has been open
    // the whole 30 min. A count that could not be read is NOT a zero. Before alerting it is
    // counted again after a short pause, so a momentary glitch does not trigger it (07-10-2026).
    let silence = ok30 === 0 && (openCampaigns ?? 0) > 0;
    if (silence) {
      await new Promise((r) => setTimeout(r, 20_000));
      const again = await countSince(admin, 30, (q) => q.eq("status", "sent"));
      silence = again === 0;
    }

    const problem = body.force === true || highFailure || silence || brokenAccounts.length > 0;
    const diagnostics = { ok20, fail20, ok30, openCampaigns, highFailure, silence, brokenAccounts, topError };
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
    // Sólo el buzón de la agencia: un aviso interno nunca sale por el buzón de un cliente.
    const acct = (accts || []).find((a: any) => a.email === (Deno.env.get("ALERT_FROM") || "team@onepulso.online"));
    if (!acct?.smtp_host) {
      if (!body.test) { try { await admin.rpc("release_job_lock", { p_name: "engine-watchdog-alert" }); } catch { /* TTL */ } }
      return json({ ok: false, error: "No hay cuenta conectada para enviar el aviso", ...diagnostics }, 500);
    }

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
    // Si el aviso no salió (justo cuando IONOS falla), se suelta el candado: la pasada siguiente
    // (15 min) vuelve a intentarlo en vez de callar una hora.
    if (!r.ok && !body.test) { try { await admin.rpc("release_job_lock", { p_name: "engine-watchdog-alert" }); } catch { /* TTL */ } }
    return json({ ok: r.ok, alerted: r.ok, error: r.error, ...diagnostics, preview: body.test ? { subject, text } : undefined });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
