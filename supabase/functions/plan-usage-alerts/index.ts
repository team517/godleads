// Avisos de consumo del plan (12-11-2026).
//
// La app del DUEÑO la llama al cargar (como mucho una vez cada pocos minutos): cuenta lo que ha
// enviado este mes toda la familia del plan (él y las cuentas de sus clientes, con la misma
// función que la tarjeta de consumo, my_monthly_send_usage) y lo compara con su plan.
//   · Devuelve el nivel de aviso (80 / 95 / 100 %) para el aviso en pantalla y la campana.
//   · La primera vez que se pasa cada umbral en el mes, guarda el aviso (plan_usage_alerts,
//     clave usuario + mes + umbral → nunca se repite) y manda UN correo desde team@.
// Una cuenta de cliente recibe { client: true } y nada más: el plan lo gestiona su agencia.
// No toca el motor de envío: el motor no corta envíos por el plan (hoy no lo hace con ninguno).
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { sendSmtpReply } from "../_shared/smtp.ts";
import { alertEmailHtml, alertSubject, crossedThresholds, madridDate, monthlyLimitFor, thresholdToEmail, usagePct } from "./rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const FROM_EMAIL = "team@onepulso.online";
const UPGRADE_LINK = "https://www.funnyleads.com/settings?tab=plan";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // Cuenta de cliente: no ve avisos de plan (lo paga su agencia).
    const { data: prof } = await db.from("profiles").select("client_login_of").eq("user_id", user.id).maybeSingle();
    if (prof?.client_login_of) return json({ client: true });

    const { data: ent } = await db.from("user_entitlements")
      .select("tier, status, plan_emails_month, custom_level").eq("user_id", user.id).maybeSingle();
    const plan = monthlyLimitFor(ent as any);
    if (!plan) return json({ limit: null });

    // Mismo recuento que la tarjeta de consumo (familia del plan, mes de Madrid).
    const { data: rows, error: usageErr } = await asUser.rpc("my_monthly_send_usage");
    if (usageErr) return json({ error: "No se pudo leer el consumo" }, 500);
    const row = Array.isArray(rows) ? rows[0] : rows;
    const sent = Number(row?.enviados ?? 0);
    const cuentas = Number(row?.cuentas ?? 1);
    const periodStart = madridDate(row?.desde ? new Date(String(row.desde)) : new Date());
    const pct = usagePct(sent, plan.limit);
    const crossed = crossedThresholds(sent, plan.limit);
    const level = crossed.length ? Math.max(...crossed) : null;
    const base = { sent, limit: plan.limit, pct, level, plan: plan.label, period_start: periodStart, accounts: cuentas };
    if (!crossed.length) return json(base);

    // Qué umbrales ya se avisaron este mes; los nuevos se guardan (la clave impide duplicados
    // aunque dos pestañas llamen a la vez).
    const { data: prev } = await db.from("plan_usage_alerts")
      .select("threshold, emailed_at").eq("user_id", user.id).eq("period_start", periodStart);
    const yaAvisados = (prev || []).filter((p: any) => p.emailed_at).map((p: any) => Number(p.threshold));
    const nuevos = crossed.filter((t) => !(prev || []).some((p: any) => Number(p.threshold) === t));
    if (nuevos.length) {
      await db.from("plan_usage_alerts").upsert(
        nuevos.map((t) => ({ user_id: user.id, period_start: periodStart, threshold: t, sent_count: sent, limit_count: plan.limit })),
        { onConflict: "user_id,period_start,threshold", ignoreDuplicates: true },
      );
    }
    const toEmail = thresholdToEmail(crossed, yaAvisados);
    let emailed = false;
    if (toEmail && user.email) {
      // Se "reserva" el envío antes de mandar: si otra llamada llega a la vez, no repite.
      const { data: claimed } = await db.from("plan_usage_alerts")
        .update({ emailed_at: new Date().toISOString(), sent_count: sent })
        .eq("user_id", user.id).eq("period_start", periodStart).eq("threshold", toEmail).is("emailed_at", null)
        .select("threshold");
      if (claimed && claimed.length) {
        // Los umbrales más bajos de este mismo salto se dan por avisados (un solo correo).
        await db.from("plan_usage_alerts").update({ emailed_at: new Date().toISOString() })
          .eq("user_id", user.id).eq("period_start", periodStart).lt("threshold", toEmail).is("emailed_at", null);
        const { data: acc } = await db.from("email_accounts")
          .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
          .eq("email", FROM_EMAIL).eq("status", "connected").not("smtp_host", "is", null).limit(1).maybeSingle();
        if (acc) {
          const r = await sendSmtpReply((acc as any).smtp_host, (acc as any).smtp_port || 587, (acc as any).smtp_username || (acc as any).email,
            (acc as any).smtp_password, (acc as any).email, user.email, alertSubject(toEmail),
            alertEmailHtml({ level: toEmail, sent, limit: plan.limit, planLabel: plan.label, link: UPGRADE_LINK, clientAccounts: cuentas }),
            null, null, "Funnyleads");
          emailed = r.ok;
          if (!r.ok) {
            console.error("[plan-usage-alerts] envío fallido:", r.error);
            // Se libera para reintentar en la próxima carga.
            await db.from("plan_usage_alerts").update({ emailed_at: null })
              .eq("user_id", user.id).eq("period_start", periodStart).eq("threshold", toEmail);
          }
        } else {
          console.error("[plan-usage-alerts] buzón team@ no conectado");
          await db.from("plan_usage_alerts").update({ emailed_at: null })
            .eq("user_id", user.id).eq("period_start", periodStart).eq("threshold", toEmail);
        }
      }
    }
    return json({ ...base, emailed });
  } catch (e) {
    console.error("[plan-usage-alerts]", (e as Error)?.message);
    return json({ error: "Error inesperado" }, 500);
  }
});
