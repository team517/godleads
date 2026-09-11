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
// Load, deliberately bounded. The database sees ONE indexed select (≤200 rows, 30-minute window)
// plus one small update per new reply — a few milliseconds per tick. The AI is outbound HTTP and
// costs only this function's wall time, so: calls run in small parallel batches, there is a
// per-run time budget well under the platform limit, and a circuit breaker stops calling the
// model for the rest of a run once it fails repeatedly (rules take over, nothing is lost).
// Anything not reached within the budget is left UNMARKED for the next tick two minutes later.
//
// Dedupe of the push lives in push_notified (one row per message pushed). It used to be the
// label itself, but the Unibox labels a message the moment somebody opens it, so whoever
// looked first silently stole the alert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyMessage } from "../_shared/classify.ts";
import { replyTextForClassification } from "../_shared/reply-text.ts";
import { aiClassifyOnce } from "../_shared/ai-classify.ts";

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
/** How many model calls are in flight at once. Four keeps a 60-call backlog under ~30 s. */
const AI_CONCURRENCY = 4;
/** Stop STARTING model calls after this — the edge runtime kills the whole run well past it. */
const RUN_TIME_BUDGET_MS = 50_000;
/** Consecutive transient failures before the model is considered down for this run. */
const AI_BREAKER_FAILURES = 3;

type Row = {
  id: string; user_id: string; from_email: string | null; from_name: string | null; subject: string | null;
  body_text: string | null; body_html: string | null; labels: string[] | null; lead_id: unknown; campaign_id: unknown;
  in_reply_to: string | null; ref_chain: string | null;
};
type Pending = { m: Row; text: string; ruleVerdict: string; verdict: string; via: "reglas" | "ia" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
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
    const useAi = !!deepseekKey && body?.ai !== false;
    // Backfill mode: relabel history without buzzing the phone for replies that are days old.
    const notify = body?.notify !== false;
    // Dry-run only: re-evaluate rows already marked, to measure the model path on real data.
    const force = dryRun && body?.force === true;

    // Only REAL prospect replies: a reply inside a real thread (In-Reply-To / References) or tied
    // to a lead/campaign. Cold spam arriving at our mailboxes carries no thread headers.
    const COLS = "id, user_id, from_email, from_name, subject, body_text, body_html, labels, lead_id, campaign_id, in_reply_to, ref_chain";
    const { data: msgs, error } = await admin
      .from("inbox_messages")
      .select(COLS)
      .gte("created_at", since)
      .eq("is_warmup", false)
      .eq("is_archived", false)
      .or("lead_id.not.is.null,campaign_id.not.is.null,in_reply_to.not.is.null,ref_chain.not.is.null")
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // ── Catch-up sweep ──────────────────────────────────────────────────────────────────────
    // The window above is the last `minutes`. A reply that could not be judged inside its window
    // (AI budget spent, or more than 200 arrived at once) used to age out of it and stay
    // UNLABELLED forever: measured live on 2026-09-11, 36 of 463 real campaign replies in a week
    // had no category at all. So top the batch up with the OLDEST still-unlabelled replies, up to
    // the room left in the 200-row budget. They are classified but never pushed (see staleIds) —
    // nobody wants their phone buzzing for a three-day-old reply.
    const staleIds = new Set<string>();
    const room = 200 - (msgs?.length || 0);
    if (room > 20 && !force) {
      const { data: old } = await admin
        .from("inbox_messages")
        .select(COLS)
        .lt("created_at", since)
        .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString())
        .eq("is_warmup", false)
        .eq("is_archived", false)
        .or("labels.is.null,labels.eq.{}")   // never judged: NULL or an empty array
        .or("lead_id.not.is.null,campaign_id.not.is.null,in_reply_to.not.is.null,ref_chain.not.is.null")
        .order("received_at", { ascending: true })
        .limit(room);
      // Re-check both conditions here in JS: the row must really be a thread reply and really
      // carry no category. Correctness must not depend on how the REST layer combines two
      // separate .or() groups.
      for (const m of (old || []) as Row[]) {
        const unlabelled = !m.labels || m.labels.length === 0;
        const threadReply = !!(m.lead_id || m.campaign_id || (m.in_reply_to || "").trim() || (m.ref_chain || "").trim());
        if (!unlabelled || !threadReply) continue;
        staleIds.add(m.id);
        (msgs as Row[]).push(m);
      }
    }

    const isRealReply = (m: Row) => !!(m.lead_id || m.campaign_id || (m.in_reply_to || "").trim() || (m.ref_chain || "").trim());

    // Already pushed? One indexed lookup for the whole batch.
    const ids = (msgs || []).map((m) => m.id);
    const yaEnviados = new Set<string>();
    if (ids.length > 0) {
      const { data: done } = await admin.from("push_notified").select("message_id").in("message_id", ids);
      for (const r of done || []) yaEnviados.add(r.message_id as string);
    }

    // ── Phase 1: rules (pure CPU, microseconds each) ─────────────────────────────────────────
    let scanned = 0, skipped = 0;
    const pending: Pending[] = [];
    for (const m of (msgs || []) as Row[]) {
      scanned++;
      if (!isRealReply(m)) continue;
      const labels = m.labels || [];
      // Already judged by this function (or relabelled by a human on top of it): leave it alone.
      if (!force && labels.includes(AI_MARKER)) { skipped++; continue; }
      const text = replyTextForClassification(m.body_text, m.body_html);
      const ruleVerdict = classifyMessage(m.subject, text);
      pending.push({ m, text, ruleVerdict, verdict: ruleVerdict, via: "reglas" });
    }

    // ── Phase 2: the model, for what rules cannot settle — bounded in calls, time and failures ─
    const needAi = useAi ? pending.filter((p) => !RULES_ARE_FINAL.has(p.ruleVerdict)) : [];
    const aiQueue = needAi.slice(0, MAX_AI_CALLS_PER_RUN);
    const deferred = new Set<string>(needAi.slice(MAX_AI_CALLS_PER_RUN).map((p) => p.m.id));
    let aiCalls = 0, aiFailures = 0, consecutiveTransient = 0, breakerTripped = false, outOfTime = false;
    for (let i = 0; i < aiQueue.length; i += AI_CONCURRENCY) {
      if (breakerTripped) { for (const p of aiQueue.slice(i)) deferred.add(p.m.id); break; }
      if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) { outOfTime = true; for (const p of aiQueue.slice(i)) deferred.add(p.m.id); break; }
      const batch = aiQueue.slice(i, i + AI_CONCURRENCY);
      const results = await Promise.all(batch.map((p) => aiClassifyOnce(deepseekKey, p.m.subject, p.text)));
      for (let k = 0; k < batch.length; k++) {
        aiCalls++;
        const r = results[k];
        if (r.verdict) {
          consecutiveTransient = 0;
          batch[k].verdict = r.verdict.category; batch[k].via = "ia";
        } else {
          aiFailures++;
          // A transient failure leaves the row UNMARKED (next tick retries); a malformed answer
          // keeps the rule verdict — asking again at temperature 0 would not change it.
          if (r.transient) { deferred.add(batch[k].m.id); consecutiveTransient++; }
          if (consecutiveTransient >= AI_BREAKER_FAILURES) breakerTripped = true;
        }
      }
    }

    // ── Phase 3: write labels, notify ────────────────────────────────────────────────────────
    let classified = 0, byAi = 0, byRules = 0, aiDisagreed = 0, notified = 0;
    const sample: { tipo: string; via: string; from: string | null; subject: string; reglas?: string }[] = [];
    for (const p of pending) {
      if (deferred.has(p.m.id)) continue;
      const labels = p.m.labels || [];
      const etiqueta = LABEL_OF[p.verdict] || "";   // neutral → no category label
      const others = labels.filter((l) => !CATEGORY_LABELS.includes(l));
      const newLabels = etiqueta ? [...others, etiqueta, AI_MARKER] : [...others, AI_MARKER];
      // staleIds = rows pulled in by the catch-up sweep: label them, never buzz the phone for them.
      const shouldNotify = notify && (p.verdict === "interested" || p.verdict === "question") && !yaEnviados.has(p.m.id) && !staleIds.has(p.m.id);
      if (p.via === "ia" && p.verdict !== p.ruleVerdict) aiDisagreed++;

      if (!dryRun) {
        const { error: upErr } = await admin.from("inbox_messages").update({ labels: newLabels }).eq("id", p.m.id);
        if (upErr) continue;
      }
      classified++; if (p.via === "ia") byAi++; else byRules++;

      if (shouldNotify) {
        if (!dryRun) {
          // Record the push FIRST: if anything below throws, the worst case is a missed alert,
          // never the same lead buzzing the phone every two minutes.
          const { error: dupErr } = await admin.from("push_notified").insert({ message_id: p.m.id, user_id: p.m.user_id });
          if (dupErr) continue;   // another tick got there first
          const who = (p.m.from_name || "").trim() || (p.m.from_email || "").split("@")[0];
          const preview = p.text.replace(/\s+/g, " ").trim().slice(0, 110);
          const esPregunta = p.verdict === "question";
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
            body: JSON.stringify({
              user_id: p.m.user_id,
              title: `${esPregunta ? "❓ Pregunta" : "🔥 Interesado"} — ${who}`,
              body: preview || p.m.subject || (esPregunta ? "Te han preguntado algo" : "Nueva respuesta interesada"),
              url: "/unibox",
            }),
          }).catch(() => { /* push is best-effort; push_notified is what prevents repeats */ });
        }
        notified++;
      }
      if (sample.length < 12) sample.push({ tipo: etiqueta || "(sin etiqueta)", via: p.via, from: p.m.from_email, subject: String(p.m.subject || "").slice(0, 50), ...(p.via === "ia" && p.verdict !== p.ruleVerdict ? { reglas: LABEL_OF[p.ruleVerdict] || "(sin etiqueta)" } : {}) });
    }

    return new Response(JSON.stringify({
      dry_run: dryRun, revisados: scanned, ya_clasificados: skipped, clasificados: classified,
      por_ia: byAi, por_reglas: byRules, ia_cambio_el_veredicto: aiDisagreed, llamadas_ia: aiCalls, fallos_ia: aiFailures,
      aplazados: deferred.size, cortacircuitos: breakerTripped, sin_tiempo: outOfTime, ms: Date.now() - startedAt,
      notificados: notified, muestra: sample,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
