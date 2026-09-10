// Detects NEW interested replies server-side and pushes a phone notification.
//
// Why this exists: classification used to run only in the browser, so a lead's "me interesa"
// was labelled solely when somebody opened the Unibox — useless for alerting a phone that is
// in a pocket. This runs on a cron with the SAME classifier the UI uses (kept byte-identical
// by src/test/shared-copies.test.ts) and notifies as soon as the message is synced.
//
// Dedupe without an extra table: the message is only notified when WE are the ones adding the
// "Interesado" label. Once labelled, the next run skips it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyMessage } from "../_shared/classify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_LABELS = ["Interesado", "No interesado", "No contactar", "Derivado", "Fuera / Auto", "Pregunta"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    // Cron shared secret, or the service role for manual runs.
    const cronSecret = Deno.env.get("REPORTS_CRON_SECRET") || "";
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const authorised = (cronSecret && body?.secret === cronSecret) || (svc && auth === svc);
    if (!authorised) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, svc);
    const minutes = Math.min(Number(body?.minutes) || 30, 240);
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const dryRun = body?.dry_run === true;

    // Only REAL prospect replies: tied to a lead/campaign and not warm-up traffic.
    const { data: msgs, error } = await admin
      .from("inbox_messages")
      .select("id, user_id, from_email, from_name, subject, body_text, labels, received_at")
      .gte("created_at", since)
      .eq("is_warmup", false)
      .or("lead_id.not.is.null,campaign_id.not.is.null")
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    let scanned = 0, notified = 0, alreadyLabelled = 0;
    const sample: { from: string; subject: string }[] = [];

    for (const m of msgs || []) {
      scanned++;
      const labels: string[] = (m.labels as string[] | null) || [];
      // Someone (a previous run, or the UI) already judged it → never notify twice.
      if (labels.some((l) => CATEGORY_LABELS.includes(l))) { alreadyLabelled++; continue; }
      if (classifyMessage(m.subject, m.body_text) !== "interested") continue;

      if (!dryRun) {
        // Label first: if the push fails we still must not re-notify on the next tick.
        await admin.from("inbox_messages").update({ labels: [...labels, "Interesado"] }).eq("id", m.id);
        const who = (m.from_name || "").trim() || (m.from_email || "").split("@")[0];
        const preview = String(m.body_text || "").replace(/\s+/g, " ").trim().slice(0, 110);
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
          body: JSON.stringify({
            user_id: m.user_id,
            title: `🔥 Interesado — ${who}`,
            body: preview || m.subject || "Nueva respuesta interesada",
            url: "/unibox",
          }),
        }).catch(() => { /* push is best-effort; the label is what prevents repeats */ });
      }
      notified++;
      if (sample.length < 5) sample.push({ from: m.from_email, subject: String(m.subject || "").slice(0, 60) });
    }

    return new Response(JSON.stringify({ dry_run: dryRun, revisados: scanned, ya_etiquetados: alreadyLabelled, notificados: notified, muestra: sample }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
