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
// A problem alerts ONCE, when confirmed (failing on two consecutive runs), then
// stays quiet. A single gentle reminder is allowed only if it is STILL failing a
// full day later, so a genuinely stuck issue isn't forgotten — but never the old
// once-an-hour nagging of the same ongoing error.
const SAFETY_REMINDER_MS = 24 * 60 * 60 * 1000;

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
  const bouncePct = m.sent_2h >= 30 ? (m.bounced_2h / m.sent_2h) * 100 : 0;
  // Core hours only, and only if the engine is TOTALLY dead (nothing sent in 2h).
  // The per-account cadence is personalised (slow ramp + cooldowns), so normal gaps
  // must NOT alert — this fires only when the whole engine is stuck, not per-account pacing.
  const coreHours = m.hour_madrid >= 10 && m.hour_madrid < 17;
  return [
    { key: "over_sending", failing: m.accounts_over_cap > 0 || m.campaigns_over_limit > 0,
      msg: `🚀 SE HA PASADO DE LO PROGRAMADO (riesgo de quemar dominios): ${
        [m.accounts_over_cap > 0 ? `cuentas por encima del tope diario → ${m.over_cap_detail}` : "",
         m.campaigns_over_limit > 0 ? `campañas por encima de su límite → ${m.over_limit_detail}` : ""].filter(Boolean).join(" · ")}` },
    // Only "dead" if a campaign is ACTUALLY supposed to be sending right now: today is
    // in its send_days AND we're inside its window. On weekends / non-send days
    // (m.campaigns_scheduled_now === 0) NOT sending is CORRECT, so we never alert —
    // no more "engine stopped" false alarms on a Saturday the campaigns are paused.
    { key: "engine_dead", failing: m.campaigns_scheduled_now > 0 && coreHours && m.pending_leads > 0 && (m.last_send_min_ago == null || m.last_send_min_ago > 120),
      msg: `⛔ El motor de envío parece PARADO: ${m.last_send_min_ago ?? "∞"} min sin ningún envío (con ${m.campaigns_scheduled_now} campaña(s) que deberían estar enviando ahora y ${m.pending_leads} leads pendientes).` },
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

    // ── Debounce state (edge-triggered: alert once, no hourly repeats) ──
    const { data: stateRows } = await admin.from("health_monitor_state").select("*");
    const state = new Map<string, any>((stateRows || []).map((r: any) => [r.check_key, r]));
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // Which failing checks do we actually email about this run?
    //   • CONFIRM: a check must be failing on TWO consecutive runs before it can
    //     alert — kills transient 5-min blips and flapping (no alert/recovery spam).
    //   • ONCE per episode; then silent until it recovers.
    //   • One gentle reminder only if STILL failing a full day later.
    const toNotify: Check[] = [];
    for (const c of failing) {
      const prev = state.get(c.key);
      if (!prev) {
        // First sighting — open the episode, do NOT alert yet (confirm next run).
        await admin.from("health_monitor_state").upsert(
          { check_key: c.key, failing: true, since: nowIso, last_notified: null },
          { onConflict: "check_key" },
        );
        continue;
      }
      const lastMs = prev.last_notified ? new Date(prev.last_notified).getTime() : 0;
      const notYetAlerted = !prev.last_notified;                            // confirmed but never delivered
      const dueReminder = !!prev.last_notified && nowMs - lastMs > SAFETY_REMINDER_MS;
      if (notYetAlerted || dueReminder) toNotify.push(c);
      await admin.from("health_monitor_state").upsert(
        { check_key: c.key, failing: true, since: prev.since || nowIso, last_notified: prev.last_notified || null },
        { onConflict: "check_key" },
      );
    }

    // Recovered = had a row, no longer failing. Announce ONLY the ones the user was
    // actually alerted about (last_notified set); silently drop blips that never
    // got past the confirm step.
    const recoveredRows = (stateRows || []).filter((r: any) => !failingKeys.has(r.check_key));
    const recoveredAnnounce = recoveredRows.filter((r: any) => r.last_notified);
    if (recoveredRows.length) {
      await admin.from("health_monitor_state").delete().in("check_key", recoveredRows.map((r: any) => r.check_key));
    }

    const wantEmail = toNotify.length > 0 || recoveredAnnounce.length > 0;
    let emailed = false;
    if (wantEmail) {
      // Pick any healthy connected account to send FROM.
      const { data: acc } = await admin.from("email_accounts")
        .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
        .eq("status", "connected").not("smtp_host", "is", null).limit(1).maybeSingle();
      const to = Deno.env.get("ALERT_EMAIL") || "team@onepulso.online";
      if (acc?.smtp_host) {
        const problemRows = toNotify.map((c) => `<li style="margin:6px 0">${c.msg}</li>`).join("");
        const recoveredList = recoveredAnnounce.map((r: any) => `<li style="margin:6px 0">✅ Resuelto: <code>${r.check_key}</code></li>`).join("");
        const subject = toNotify.length
          ? `🚨 OnePulso: ${toNotify.length} problema(s) detectado(s)`
          : `✅ OnePulso: incidencia(s) resuelta(s)`;
        const sections =
          (toNotify.length ? `<h2 style="margin:0 0 10px">Problemas detectados</h2><ul style="padding-left:18px;margin:0 0 14px">${problemRows}</ul>` : "")
          + (recoveredAnnounce.length ? `<h2 style="margin:0 0 10px;font-size:15px">Recuperado</h2><ul style="padding-left:18px;margin:0 0 14px">${recoveredList}</ul>` : "");
        const html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#0a0d14">`
          + sections
          + `<p style="color:#667085;font-size:12px">Snapshot: ${metrics.active_campaigns} campañas activas · ${metrics.accounts_connected} cuentas · ${metrics.inbox_last_hour} msgs/última hora · ${metrics.sent_2h} enviados/2h.</p>`
          + `<p style="color:#98a2b3;font-size:11px">Monitor automático · comprueba cada 5 min · te aviso UNA vez por incidencia y otra cuando se resuelve.</p></div>`;
        const r = await sendSmtpEmail(acc.smtp_host, acc.smtp_port || 465, acc.smtp_username, acc.smtp_password, acc.email, to, subject, html);
        emailed = r.ok;
        if (r.ok && toNotify.length) {
          // Mark these as alerted so they stay quiet until recovery / the daily reminder.
          for (const c of toNotify) await admin.from("health_monitor_state").update({ last_notified: nowIso }).eq("check_key", c.key);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, failing: failing.map((c) => c.key), notified: toNotify.map((c) => c.key), recovered: recoveredAnnounce.map((r: any) => r.check_key), emailed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message || e) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
