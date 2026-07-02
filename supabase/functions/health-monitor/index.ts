import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH MONITOR — runs every 5 min (pg_cron). Reads a single SQL snapshot
// (health_metrics RPC), evaluates a handful of checks, and emails ONE alert to
// the owner ONLY when something is wrong. Debounced via health_monitor_state so
// the same ongoing problem re-alerts at most once/hour (no spam). When everything
// recovers it sends a single "todo recuperado" note. Cheap: 1 SQL call per run,
// email only on anomalies.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const RE_ALERT_MS = 60 * 60 * 1000; // remind at most once per hour while still failing

// Minimal SMTP sender (implicit TLS 465 or STARTTLS 587) — same scheme as notify-interested.
async function sendSmtpEmail(host: string, port: number, username: string, password: string, from: string, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try {
    let conn: Deno.Conn = port === 465 ? await Deno.connectTls({ hostname: host, port }) : await Deno.connect({ hostname: host, port });
    const read = async () => { const b = new Uint8Array(4096); const n = await conn.read(b); return new TextDecoder().decode(b.subarray(0, n || 0)); };
    const write = async (cmd: string) => { await conn.write(new TextEncoder().encode(cmd + "\r\n")); return await read(); };
    await read();
    if (port !== 465) {
      const ehlo = await write("EHLO monitor");
      if (ehlo.includes("STARTTLS")) { await conn.write(new TextEncoder().encode("STARTTLS\r\n")); await read(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); }
    }
    await write("EHLO monitor");
    const creds = btoa(`\0${username}\0${password}`);
    const auth = await write(`AUTH PLAIN ${creds}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch {} return { ok: false, error: `Auth failed: ${auth.trim()}` }; }
    await write(`MAIL FROM:<${from}>`);
    await write(`RCPT TO:<${to}>`);
    await write("DATA");
    const msg = `From: OnePulso Monitor <${from}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${html}\r\n.\r\n`;
    const resp = await write(msg);
    try { await write("QUIT"); } catch {}
    try { conn.close(); } catch {}
    return resp.includes("250") ? { ok: true } : { ok: false, error: `Send failed: ${resp.trim()}` };
  } catch (e) { return { ok: false, error: String((e as any)?.message || e) }; }
}

type Check = { key: string; failing: boolean; msg: string };

function evaluate(m: any): Check[] {
  const inWindow = m.hour_madrid >= 9 && m.hour_madrid < 18;
  const bouncePct = m.sent_2h >= 30 ? (m.bounced_2h / m.sent_2h) * 100 : 0;
  return [
    { key: "sends_stalled", failing: inWindow && m.active_campaigns > 0 && m.pending_leads > 0 && (m.last_send_min_ago == null || m.last_send_min_ago > 30),
      msg: `⛔ Envíos PARADOS: ${m.last_send_min_ago ?? "∞"} min sin enviar, con ${m.pending_leads} leads pendientes y estando en ventana de envío.` },
    { key: "unibox_no_intake", failing: m.hour_madrid >= 9 && m.hour_madrid < 21 && m.inbox_last_hour === 0,
      msg: `📭 No ha entrado NINGÚN mensaje al Unibox en la última hora — la sincronización IMAP podría estar caída.` },
    { key: "accounts_out_of_sync", failing: m.accounts_stale_30m > 8,
      msg: `🔌 ${m.accounts_stale_30m} de ${m.accounts_connected} cuentas llevan >30 min sin sincronizar.` },
    { key: "accounts_auth_failed", failing: m.accounts_auth_failed > 0,
      msg: `🔑 ${m.accounts_auth_failed} cuenta(s) desconectada(s) por fallo de credenciales (auth_failed).` },
    { key: "cron_failures", failing: m.cron_failures_15m > 0,
      msg: `⚙️ ${m.cron_failures_15m} ejecución(es) de cron fallidas en los últimos 15 min.` },
    { key: "zombie_locks", failing: m.zombie_locks > 0,
      msg: `🔒 ${m.zombie_locks} lock(s) atascado(s) >1h — el motor de envío podría estar bloqueado.` },
    { key: "high_bounce", failing: bouncePct > 8,
      msg: `📈 Tasa de rebote ALTA: ${bouncePct.toFixed(1)}% en 2h (${m.bounced_2h}/${m.sent_2h}) — revisa deliverability.` },
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: metrics, error: mErr } = await admin.rpc("health_metrics");
    if (mErr) return new Response(JSON.stringify({ ok: false, error: mErr.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const checks = evaluate(metrics);
    const failing = checks.filter((c) => c.failing);
    const failingKeys = new Set(failing.map((c) => c.key));

    // Debounce state
    const { data: stateRows } = await admin.from("health_monitor_state").select("*");
    const state = new Map<string, any>((stateRows || []).map((r: any) => [r.check_key, r]));
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    let shouldNotify = false;
    for (const c of failing) {
      const prev = state.get(c.key);
      const lastMs = prev?.last_notified ? new Date(prev.last_notified).getTime() : 0;
      if (!prev || !prev.last_notified || nowMs - lastMs > RE_ALERT_MS) shouldNotify = true;
      await admin.from("health_monitor_state").upsert(
        { check_key: c.key, failing: true, since: prev?.since || nowIso, last_notified: prev?.last_notified || null },
        { onConflict: "check_key" },
      );
    }
    // Recovered checks (had a row, no longer failing)
    const recovered = (stateRows || []).filter((r: any) => !failingKeys.has(r.check_key));
    if (recovered.length) await admin.from("health_monitor_state").delete().in("check_key", recovered.map((r: any) => r.check_key));

    const wantEmail = shouldNotify || (recovered.length > 0 && failing.length === 0);
    let emailed = false;
    if (wantEmail) {
      // Pick any healthy connected account to send FROM.
      const { data: acc } = await admin.from("email_accounts")
        .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
        .eq("status", "connected").not("smtp_host", "is", null).limit(1).maybeSingle();
      const to = Deno.env.get("ALERT_EMAIL") || "team@onepulso.online";
      if (acc?.smtp_host) {
        const subject = failing.length
          ? `🚨 OnePulso: ${failing.length} problema(s) detectado(s)`
          : `✅ OnePulso: todo recuperado`;
        const rows = (failing.length ? failing.map((c) => `<li style="margin:6px 0">${c.msg}</li>`).join("")
          : `<li style="margin:6px 0">Todos los sistemas vuelven a estar OK.</li>`);
        const html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#0a0d14">`
          + `<h2 style="margin:0 0 10px">${failing.length ? "Problemas detectados en la plataforma" : "Todo recuperado ✅"}</h2>`
          + `<ul style="padding-left:18px;margin:0 0 14px">${rows}</ul>`
          + `<p style="color:#667085;font-size:12px">Snapshot: ${metrics.active_campaigns} campañas activas · ${metrics.accounts_connected} cuentas · ${metrics.inbox_last_hour} msgs/última hora · ${metrics.sent_2h} enviados/2h.</p>`
          + `<p style="color:#98a2b3;font-size:11px">Monitor automático · comprueba cada 5 min · re-avisa como máx. 1×/hora.</p></div>`;
        const r = await sendSmtpEmail(acc.smtp_host, acc.smtp_port || 465, acc.smtp_username, acc.smtp_password, acc.email, to, subject, html);
        emailed = r.ok;
        if (r.ok && failing.length) {
          // Reset the 1h timer for all currently-failing checks.
          for (const c of failing) await admin.from("health_monitor_state").update({ last_notified: nowIso }).eq("check_key", c.key);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, failing: failing.map((c) => c.key), recovered: recovered.map((r: any) => r.check_key), emailed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message || e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
