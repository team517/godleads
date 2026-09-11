// Classifies every NEW prospect reply server-side and pushes a phone notification for the ones
// that matter (Interesado / Pregunta).
//
// Why this exists: classification used to run only in the browser, so a lead's "me interesa"
// was labelled solely when somebody opened the Unibox — useless for alerting a phone that is
// in a pocket, and dependent on whatever frontend build that browser happened to have loaded.
// This runs on a cron every 2 minutes and is the AUTHORITY on the category.
//
// How a category is decided (hybrid, cheapest-first):
//   1. The text is taken through replyTextForClassification — an Outlook reply whose body_text
//      is an inline image is read from its HTML instead of from JPEG bytes.
//   2. The rule-based classifier (same file the Unibox uses) runs first. Its verdict is FINAL
//      for what rules do reliably: automatic mail, bounces and explicit "dadme de baja".
//   3. Everything else — the human, nuanced replies — is decided by the AI (DeepSeek, temperature
//      0, the owner's classification rules as the system prompt). If the AI fails, the rule
//      verdict stands.
//   4. The label is written with an "IA" marker so the browser never overwrites it with its
//      own rule-based guess, and a human's manual relabel is never touched (the marker is only
//      added by this function, and only on messages it labelled itself).
//
// Dedupe of the push lives in push_notified (one row per message pushed). It used to be the
// label itself, but the Unibox labels a message the moment somebody opens it, so whoever
// looked first silently stole the alert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyMessage } from "../_shared/classify.ts";
import { replyTextForClassification } from "../_shared/reply-text.ts";
import { aiClassifyReply } from "../_shared/ai-classify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_LABELS = ["Interesado", "No interesado", "No contactar", "Derivado", "Fuera / Auto", "Pregunta"];
/** Marker the server adds next to the category it wrote. The browser leaves such rows alone. */
const AI_MARKER = "IA";
const LABEL_OF: Record<string, string> = {
  interested: "Interesado", question: "Pregunta", not_interested: "No interesado",
  no_contactar: "No contactar", derivado: "Derivado", out_of_office: "Fuera / Auto",
};
/** Rule verdicts we trust without asking the model: automatic mail and explicit opt-outs. */
const RULES_ARE_FINAL = new Set(["out_of_office", "no_contactar"]);
/** Cost guard per run — the cron fires every 2 minutes, so this is ~2 000 replies/day of headroom. */
const MAX_AI_CALLS_PER_RUN = 60;

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
    const minutes = Math.min(Number(body?.minutes) || 30, 1440);
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const dryRun = body?.dry_run === true;
    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
    const useAi = deepseekKey && body?.ai !== false;
    // Backfill mode: relabel history without buzzing the phone for replies that are days old.
    const notify = body?.notify !== false;

    // Only REAL prospect replies: a reply inside a real thread (In-Reply-To / References) or tied
    // to a lead/campaign. Cold spam arriving at our mailboxes carries no thread headers.
    const { data: msgs, error } = await admin
      .from("inbox_messages")
      .select("id, user_id, from_email, from_name, subject, body_text, body_html, labels, received_at, lead_id, campaign_id, in_reply_to, ref_chain")
      .gte("created_at", since)
      .eq("is_warmup", false)
      .eq("is_archived", false)
      .or("lead_id.not.is.null,campaign_id.not.is.null,in_reply_to.not.is.null,ref_chain.not.is.null")
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const isRealReply = (m: { lead_id?: unknown; campaign_id?: unknown; in_reply_to?: string | null; ref_chain?: string | null }) =>
      !!(m.lead_id || m.campaign_id || (m.in_reply_to || "").trim() || (m.ref_chain || "").trim());

    // Already pushed? One indexed lookup for the whole batch.
    const ids = (msgs || []).map((m) => m.id);
    const yaEnviados = new Set<string>();
    if (ids.length > 0) {
      const { data: done } = await admin.from("push_notified").select("message_id").in("message_id", ids);
      for (const r of done || []) yaEnviados.add(r.message_id as string);
    }

    let scanned = 0, classified = 0, byAi = 0, byRules = 0, aiDisagreed = 0, notified = 0, skipped = 0, aiCalls = 0, deferred = 0;
    const sample: { tipo: string; via: string; from: string; subject: string; reglas?: string }[] = [];

    for (const m of msgs || []) {
      scanned++;
      if (!isRealReply(m)) continue;
      const labels: string[] = (m.labels as string[] | null) || [];
      // Already judged by this function (or relabelled by a human on top of it): leave it alone.
      if (labels.includes(AI_MARKER)) { skipped++; continue; }

      const text = replyTextForClassification(m.body_text, m.body_html);
      const ruleVerdict = classifyMessage(m.subject, text);
      let verdict = ruleVerdict;
      let via = "reglas";
      if (useAi && !RULES_ARE_FINAL.has(ruleVerdict)) {
        // Over the per-run budget: leave the message UNMARKED so the next tick (2 min) takes it,
        // instead of stamping a rule-only guess as final. Only a backfill ever gets here.
        if (aiCalls >= MAX_AI_CALLS_PER_RUN) { deferred++; continue; }
        aiCalls++;
        // The rules already cut the quote and the legal footer; give the model the same text.
        const ai = await aiClassifyReply(deepseekKey, m.subject, text);
        if (ai) { verdict = ai.category; via = "ia"; if (ai.category !== ruleVerdict) aiDisagreed++; }
      }
      const etiqueta = LABEL_OF[verdict] || "";   // neutral → no category label
      const others = labels.filter((l) => !CATEGORY_LABELS.includes(l));
      const newLabels = etiqueta ? [...others, etiqueta, AI_MARKER] : [...others, AI_MARKER];
      const shouldNotify = notify && (verdict === "interested" || verdict === "question") && !yaEnviados.has(m.id);

      if (!dryRun) {
        const { error: upErr } = await admin.from("inbox_messages").update({ labels: newLabels }).eq("id", m.id);
        if (upErr) continue;
        classified++; if (via === "ia") byAi++; else byRules++;

        if (shouldNotify) {
          // Record the push FIRST: if anything below throws, the worst case is a missed alert,
          // never the same lead buzzing the phone every two minutes.
          const { error: dupErr } = await admin.from("push_notified").insert({ message_id: m.id, user_id: m.user_id });
          if (!dupErr) {
            const who = (m.from_name || "").trim() || (m.from_email || "").split("@")[0];
            const preview = text.replace(/\s+/g, " ").trim().slice(0, 110);
            const esPregunta = verdict === "question";
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
              body: JSON.stringify({
                user_id: m.user_id,
                title: `${esPregunta ? "❓ Pregunta" : "🔥 Interesado"} — ${who}`,
                body: preview || m.subject || (esPregunta ? "Te han preguntado algo" : "Nueva respuesta interesada"),
                url: "/unibox",
              }),
            }).catch(() => { /* push is best-effort; push_notified is what prevents repeats */ });
            notified++;
          }
        }
      } else {
        classified++; if (via === "ia") byAi++; else byRules++;
        if (shouldNotify) notified++;
      }
      if (sample.length < 12) sample.push({ tipo: etiqueta || "(sin etiqueta)", via, from: m.from_email, subject: String(m.subject || "").slice(0, 50), ...(via === "ia" && verdict !== ruleVerdict ? { reglas: LABEL_OF[ruleVerdict] || "(sin etiqueta)" } : {}) });
    }

    return new Response(JSON.stringify({
      dry_run: dryRun, revisados: scanned, ya_clasificados: skipped, clasificados: classified,
      por_ia: byAi, por_reglas: byRules, ia_cambio_el_veredicto: aiDisagreed, llamadas_ia: aiCalls, aplazados_por_presupuesto: deferred, notificados: notified, muestra: sample,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
