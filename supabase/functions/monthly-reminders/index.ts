// Avisos mensuales por correo (26-10-2026): cada fila de monthly_email_reminders sale su día del
// mes, una sola vez, desde un buzón de la agencia. Lo llama el cron "monthly-reminders" cada mañana.
// {"dry_run": true} dice qué enviaría hoy sin enviar nada; {"force_id": "<id>"} lo envía ya (prueba).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cronOrServiceAuthorised, unauthorized } from "../_shared/cron-auth.ts";
import { sendSmtpReply } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Fecha y hora de Madrid. */
function madrid(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const year = Number(p.year), month = Number(p.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { day: Number(p.day), hour: Number(p.hour), ym: `${p.year}-${p.month}`, lastDay };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  if (!cronOrServiceAuthorised(req, body)) return unauthorized(corsHeaders);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const t = madrid(new Date());
  const dryRun = body?.dry_run === true;
  const forceId = typeof body?.force_id === "string" ? body.force_id : null;

  const { data: rows, error } = await admin.from("monthly_email_reminders").select("*").eq("active", true);
  if (error) return json({ error: error.message }, 500);

  // Toca hoy: su día (o el último del mes si el mes es más corto), desde las 9:00 y aún no enviado este mes.
  const due = (rows || []).filter((r: any) => forceId
    ? r.id === forceId
    : (Math.min(r.day_of_month, t.lastDay) === t.day && t.hour >= 9 && r.last_sent_month !== t.ym));

  const results: unknown[] = [];
  for (const r of due as any[]) {
    // Sólo un buzón de la agencia conectado; si el mismo buzón está en varias cuentas, cualquiera vale.
    const { data: acc } = await admin.from("email_accounts")
      .select("email, smtp_host, smtp_port, smtp_username, smtp_password, first_name")
      .eq("email", r.from_email).eq("status", "connected").not("smtp_host", "is", null)
      .limit(1).maybeSingle();
    if (!acc) { results.push({ name: r.name, ok: false, error: "buzón no conectado" }); continue; }
    if (dryRun) { results.push({ name: r.name, would_send: true, from: acc.email, to: r.to_email }); continue; }
    const res = await sendSmtpReply(acc.smtp_host, acc.smtp_port || 465, acc.smtp_username || acc.email, acc.smtp_password,
      acc.email, r.to_email, r.subject, r.body_html, null, null, "OnePulso");
    if (res.ok) {
      await admin.from("monthly_email_reminders").update({ last_sent_month: forceId ? r.last_sent_month : t.ym, last_error: null }).eq("id", r.id);
    } else {
      await admin.from("monthly_email_reminders").update({ last_error: res.error || "error" }).eq("id", r.id);
    }
    results.push({ name: r.name, ok: res.ok, error: res.error });
  }
  return json({ ok: true, madrid: t, due: due.length, results });
});
