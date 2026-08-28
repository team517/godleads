// sync-auto-reply-log — mirrors the AI auto-reply agent's activity into auto_reply_log so the
// "Asistente IA → Respuestas automáticas" panel shows it. The running prospect agent logs to
// client_service_log (service-role only); the panel reads auto_reply_log — hence it showed "Sin
// respuestas registradas". This backfills the missing rows for the CALLER (owner_id = auth.uid()),
// idempotently (dedupe by to_email + created_at ±2min, which also skips rows the agent now writes
// directly). Read of the service-role log + write of the caller's own auto_reply_log only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const REPLY_ACTIONS = ["prospect_reply", "reply", "confirm", "send_copys", "send_copys_later", "send_report", "new_campaign", "deliver_copys"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: ud } = await userClient.auth.getUser();
    if (!ud?.user) return json({ inserted: 0 }, 401);
    const uid = ud.user.id;

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: logs } = await admin.from("client_service_log")
      .select("from_email, subject, reply, created_at")
      .eq("owner_id", uid).in("action", REPLY_ACTIONS)
      .not("reply", "is", null).order("created_at", { ascending: false }).limit(500);

    let inserted = 0;
    for (const l of (logs || []) as any[]) {
      const reply = String(l.reply || "").trim();
      const to = String(l.from_email || "").trim().toLowerCase();
      if (!reply || !to) continue;
      const t = new Date(l.created_at).getTime();
      const from = new Date(t - 2 * 60000).toISOString();
      const until = new Date(t + 2 * 60000).toISOString();
      const { data: exists } = await admin.from("auto_reply_log").select("id")
        .eq("user_id", uid).eq("to_email", to).gte("created_at", from).lte("created_at", until).limit(1);
      if (exists && exists.length) continue;
      const { error } = await admin.from("auto_reply_log").insert({
        user_id: uid, to_email: to, subject: String(l.subject || "Re: (respuesta IA)"),
        ai_response: reply.slice(0, 4000), status: "sent", created_at: l.created_at, sent_at: l.created_at,
      });
      if (!error) inserted++;
    }
    return json({ inserted });
  } catch (e) {
    return json({ inserted: 0, error: String((e as Error).message) }, 500);
  }
});
