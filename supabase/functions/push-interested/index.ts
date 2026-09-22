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
import { classifyMessage, authorText, isPoliteFileAway } from "../_shared/classify.ts";
import { replyTextForClassification } from "../_shared/reply-text.ts";
import { aiClassifyOnce, evidenceSupported } from "../_shared/ai-classify.ts";
import { planCalls, cooldownAfterLimit, pacingGapMs, type ThrottleState } from "../_shared/ai-throttle.ts";
import { isWarmupMessage, looksLikeWarmupSubject } from "../_shared/inbox-filters.ts";
import { shouldPushReply } from "../_shared/push-rule.ts";

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
type Pending = { m: Row; text: string; ruleVerdict: string; verdict: string; via: "reglas" | "ia"; evidence?: string; reason?: string };

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
    // El cron normal mira como mucho un día atrás. Un repaso manual del histórico (force +
    // notify:false) puede pedir más, hasta 30 días, para corregir etiquetas ya escritas.
    const repaso = body?.force === true && body?.notify === false;
    const minutes = Math.min(Number(body?.minutes) || 30, repaso ? 43200 : 1440);
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const dryRun = body?.dry_run === true;
    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
    const useAi = !!deepseekKey && body?.ai !== false;
    // Backfill mode: relabel history without buzzing the phone for replies that are days old.
    const notify = body?.notify !== false;
    // Re-evaluar filas YA marcadas. En dry-run sirve para medir el modelo sobre datos reales;
    // fuera del dry-run es el repaso del histórico, y entonces se exige notify:false — nadie
    // quiere que le suene el teléfono por respuestas de hace días. Las categorías sólo las pone
    // este clasificador (a mano únicamente se marca "Importante"), así que un repaso no puede
    // pisar la decisión de una persona.
    const force = body?.force === true && (dryRun || body?.notify === false);
    // Ventana hacia atrás para repasar el histórico por tramos: created_at < before.
    const before = typeof body?.before === "string" && !Number.isNaN(Date.parse(body.before)) ? body.before : null;
    // Un repaso manual puede pedir más llamadas por tanda; el cron normal no cambia.
    const maxAiCalls = Math.min(Math.max(Number(body?.max_ai) || MAX_AI_CALLS_PER_RUN, 1), 120);
    const concurrency = Math.min(Math.max(Number(body?.concurrency) || AI_CONCURRENCY, 1), 6);

    // Only REAL prospect replies: a reply inside a real thread (In-Reply-To / References) or tied
    // to a lead/campaign. Cold spam arriving at our mailboxes carries no thread headers.
    const COLS = "id, user_id, from_email, from_name, subject, body_text, body_html, labels, lead_id, campaign_id, in_reply_to, ref_chain, created_at";
    let windowQuery = admin
      .from("inbox_messages")
      .select(COLS)
      .gte("created_at", since);
    if (before) windowQuery = windowQuery.lt("created_at", before);
    const { data: msgs, error } = await windowQuery
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
    // Siempre con un mínimo de sitio: en cuentas con ≥180 respuestas por ventana el barrido
    // —el único rescate de las respuestas que salían de la ventana sin juzgar— no corría nunca.
    const room = Math.max(30, 200 - (msgs?.length || 0));
    if (!force) {
      const { data: old } = await admin
        .from("inbox_messages")
        .select(COLS)
        .lt("created_at", since)
        .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString())
        .eq("is_warmup", false)
        .eq("is_archived", false)
        .or("labels.is.null,labels.eq.{}")   // never judged: NULL or an empty array
        // Sólo lo ENLAZADO (lo que sin duda sale en Global/Campaigns): los hilos sin enlazar que no
        // son de campaña nunca se etiquetan y, si entraran aquí, ocuparían el barrido para siempre.
        .or("lead_id.not.is.null,campaign_id.not.is.null")
        .order("received_at", { ascending: true })
        .limit(room);
      // Re-check both conditions here in JS: the row must really be a thread reply and really
      // carry no category. Correctness must not depend on how the REST layer combines two
      // separate .or() groups.
      for (const m of (old || []) as Row[]) {
        const unlabelled = !m.labels || m.labels.length === 0;
        const threadReply = !!(m.lead_id || m.campaign_id);
        if (!unlabelled || !threadReply) continue;
        // Menos de 6 h: aún se avisa (la IA estuvo caída o enfriándose). Más viejo: sólo etiqueta.
        if (Date.parse((m as unknown as { created_at: string }).created_at) < Date.now() - 6 * 3600_000) staleIds.add(m.id);
        (msgs as Row[]).push(m);
      }
    }

    // Correos sin hilo ni enlace, pero de la EMPRESA de un lead (mismo dominio, no genérico): un
    // compañero que escribe de cero es tan "de campaña" como una respuesta. Se buscan aparte y se
    // confirman con lead_domains_hit (índice leads(user_id, dominio)).
    const GENERIC = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|protonmail|proton|gmx|mail|zoho|yandex|hey|fastmail|tutanota|qq|163|126|web|t-online|orange|wanadoo|free|libero|virgilio|telefonica|movistar|terra|ono)\./i;
    const leadCompany = new Set<string>(); // ids de mensajes de la empresa de un lead
    {
      let q = admin.from("inbox_messages").select(COLS).gte("created_at", since);
      if (before) q = q.lt("created_at", before);
      const { data: loose } = await q
        .eq("is_warmup", false).eq("is_archived", false)
        .is("lead_id", null).is("campaign_id", null)
        .is("in_reply_to", null)
        .order("received_at", { ascending: false })
        .limit(200);
      const byUser = new Map<string, Row[]>();
      for (const m of (loose || []) as Row[]) {
        if ((m.ref_chain || "").trim()) continue;
        const dom = String(m.from_email || "").split("@")[1]?.toLowerCase() || "";
        if (!dom || GENERIC.test(dom)) continue;
        if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
        byUser.get(m.user_id)!.push(m);
      }
      for (const [uid, rows] of byUser) {
        const doms = [...new Set(rows.map((m) => String(m.from_email).split("@")[1].toLowerCase()))];
        const { data: hits } = await admin.rpc("lead_domains_hit", { p_user: uid, p_domains: doms });
        const hitSet = new Set(((hits || []) as { dom: string }[]).map((h) => h.dom));
        for (const m of rows) {
          if (!hitSet.has(String(m.from_email).split("@")[1].toLowerCase())) continue;
          leadCompany.add(m.id);
          if (!(msgs as Row[]).some((x) => x.id === m.id)) (msgs as Row[]).push(m);
        }
      }
    }

    // Mensajes en hilo pero SIN enlazar: sólo cuentan si son de la empresa de un lead o si responden
    // a un correo NUESTRO (su References cita un Message-ID de uno de los dominios del usuario).
    // Así un aviso sólo sale por lo que se ve en Global/Campaigns, nunca por algo que sólo está en
    // "Todos" (hilos de terceros, newsletters con "Re:", warm-up).
    const replyToOurs = new Set<string>();
    {
      const unlinked = ((msgs || []) as Row[]).filter((m) => !m.lead_id && !m.campaign_id && !leadCompany.has(m.id));
      const byUser = new Map<string, Row[]>();
      for (const m of unlinked) { if (!byUser.has(m.user_id)) byUser.set(m.user_id, []); byUser.get(m.user_id)!.push(m); }
      for (const [uid, rows] of byUser) {
        const { data: accs } = await admin.from("email_accounts").select("email").eq("user_id", uid).limit(5000);
        const own = new Set(((accs || []) as { email: string }[]).map((a) => String(a.email || "").split("@")[1]?.toLowerCase()).filter(Boolean));
        const doms = [...new Set(rows.map((m) => String(m.from_email || "").split("@")[1]?.toLowerCase()).filter((d) => d && !GENERIC.test(d)))];
        const hitSet = new Set<string>();
        if (doms.length) {
          const { data: hits } = await admin.rpc("lead_domains_hit", { p_user: uid, p_domains: doms });
          for (const h of (hits || []) as { dom: string }[]) hitSet.add(h.dom);
        }
        for (const m of rows) {
          const dom = String(m.from_email || "").split("@")[1]?.toLowerCase() || "";
          if (dom && hitSet.has(dom)) { leadCompany.add(m.id); continue; }
          if (looksLikeWarmupSubject(m.subject)) continue;
          const refs = String(m.ref_chain || "").toLowerCase();
          if (refs.includes("@") && [...own].some((d) => refs.includes("@" + d))) replyToOurs.add(m.id);
        }
      }
    }

    const isRealReply = (m: Row) => !!(m.lead_id || m.campaign_id || leadCompany.has(m.id) || replyToOurs.has(m.id));

    // Already pushed? One indexed lookup for the whole batch.
    const ids = (msgs || []).map((m) => m.id);
    const yaEnviados = new Set<string>();
    if (ids.length > 0) {
      const { data: done } = await admin.from("push_notified").select("message_id").in("message_id", ids);
      for (const r of done || []) yaEnviados.add(r.message_id as string);
    }

    // ── Phase 1: rules (pure CPU, microseconds each) ─────────────────────────────────────────
    let scanned = 0, skipped = 0, warmupFlagged = 0;
    // El mensaje más antiguo de esta tanda: el repaso encadena tramos pasándolo como `before`.
    let oldestSeen: string | null = null;
    const pending: Pending[] = [];
    for (const m of (msgs || []) as Row[]) {
      scanned++;
      const created = (m as unknown as { created_at?: string }).created_at || null;
      if (created && (!oldestSeen || created < oldestSeen)) oldestSeen = created;
      if (!isRealReply(m)) continue;
      // Warm-up pool threads carry References (our seed mailbox started them) and generic English
      // office subjects the sync detector used to miss; the model then read "let's confirm the
      // workshop" as Interesado and 99 phones buzzed in a week (2026-09-15). Flag them here — the
      // same detector as the sync, with the same lead/campaign exemption — and never judge them.
      if (isWarmupMessage({ subject: m.subject, body: m.body_text, fromEmail: m.from_email, linked: !!(m.lead_id || m.campaign_id) || leadCompany.has(m.id) })) {
        warmupFlagged++;
        if (!dryRun) await admin.from("inbox_messages").update({ is_warmup: true }).eq("id", m.id);
        continue;
      }
      const labels = m.labels || [];
      // Already judged by this function (or relabelled by a human on top of it): leave it alone.
      if (!force && labels.includes(AI_MARKER)) { skipped++; continue; }
      const text = replyTextForClassification(m.body_text, m.body_html);
      const ruleVerdict = classifyMessage(m.subject, text);
      pending.push({ m, text, ruleVerdict, verdict: ruleVerdict, via: "reglas" });
    }

    // ── Phase 2: the model, for what rules cannot settle — bounded in calls, time and failures ─
    const needAi = useAi ? pending.filter((p) => !RULES_ARE_FINAL.has(p.ruleVerdict)) : [];

    // ── Ritmo: cuántas llamadas caben AHORA ──────────────────────────────────────────────────
    // El control se recuerda entre ejecuciones (una fila en ai_throttle_state): tope por minuto,
    // y enfriamiento si la API devolvió 429. En enfriamiento NO se llama al modelo y las filas se
    // dejan para el próximo tick (dos minutos después) en vez de etiquetarlas peor con reglas.
    const { data: throttleRow } = await admin
      .from("ai_throttle_state")
      .select("window_started_at, calls_in_window, cooldown_until, consecutive_limits")
      .eq("id", 1)
      .maybeSingle();
    const plan = planCalls((throttleRow as ThrottleState) || null, Math.min(needAi.length, maxAiCalls), Date.now());
    const enfriando = plan.cooldownMs;

    const aiQueue = needAi.slice(0, plan.allowed);
    const deferred = new Set<string>(needAi.slice(plan.allowed).map((p) => p.m.id));
    const gapMs = pacingGapMs(concurrency);
    let aiCalls = 0, aiFailures = 0, consecutiveTransient = 0, breakerTripped = false, outOfTime = false, unsupported = 0;
    let rateLimited = false, retryAfterMs = 0;
    for (let i = 0; i < aiQueue.length; i += concurrency) {
      if (breakerTripped) { for (const p of aiQueue.slice(i)) deferred.add(p.m.id); break; }
      if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) { outOfTime = true; for (const p of aiQueue.slice(i)) deferred.add(p.m.id); break; }
      // Reparte las llamadas dentro del minuto en vez de soltarlas de golpe: así ni la API ni
      // esta función ven picos.
      if (i > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
      const batch = aiQueue.slice(i, i + concurrency);
      // The model reads ONLY the author's words (quote + legal footers cut), exactly what the
      // prompt promises. It used to get the whole text and judged our own quoted pitch and the
      // sender's RGPD footer ("lo veo con el equipo" → No contactar, 2026-09-15).
      const texts = batch.map((p) => authorText(p.text));
      const results = await Promise.all(batch.map((p, k) => aiClassifyOnce(deepseekKey, p.m.subject, texts[k])));
      for (let k = 0; k < batch.length; k++) {
        aiCalls++;
        const r = results[k];
        if (r.verdict) {
          consecutiveTransient = 0;
          let cat: string = r.verdict.category;
          // An auto-reply that names a replacement ("ya no forma parte… escriba a X") is
          // actionable: the rules say Derivado, the model tends to say out_of_office. Keep the
          // referral — there is somebody to write to.
          if (cat === "out_of_office" && batch[k].ruleVerdict === "derivado") cat = "derivado";
          // "No contactar" is final and suppresses a lead for good. When the rules read the reply as
          // a plain rejection and found NO cessation phrase (baja / no me escribáis / borrad mis
          // datos — those make the rules say no_contactar themselves), the model's stricter reading
          // ("Gracias, no estoy interesado" → no_contactar, GISMA 2026-09-15) is downgraded.
          if (cat === "no_contactar" && batch[k].ruleVerdict === "not_interested") cat = "not_interested";
          // "Interesado" es la única categoría que hace sonar un teléfono, y era la que más se
          // inflaba: el modelo leía una cortesía ("os tenemos en cuenta", "podría ser interesante")
          // como una puerta abierta. Ahora debe CITAR la frase del autor que lo justifica; si esa
          // cita no está de verdad en el texto, su lectura no se sostiene y no se da por interesado
          // (se queda con lo que digan las reglas, o sin etiqueta).
          // "Tenemos cubierta esa necesidad, pero mándame info y os tenemos en cuenta para el
          // futuro": el modelo sigue leyéndolo como interés porque el tono es amable. La frase
          // manda sobre el tono, y aquí las reglas lo tienen claro.
          if (cat === "interested" && isPoliteFileAway(texts[k])) cat = "not_interested";
          if (cat === "interested" && !evidenceSupported(r.verdict.evidence, texts[k])) {
            cat = batch[k].ruleVerdict === "interested" ? "interested" : "neutral";
            unsupported++;
          }
          batch[k].verdict = cat; batch[k].via = "ia";
          batch[k].evidence = r.verdict.evidence; batch[k].reason = r.verdict.reason;
        } else {
          aiFailures++;
          // A transient failure leaves the row UNMARKED (next tick retries); a malformed answer
          // keeps the rule verdict — asking again at temperature 0 would not change it.
          if (r.transient) { deferred.add(batch[k].m.id); consecutiveTransient++; }
          // Un 429 no es un fallo cualquiera: es la API pidiendo que paremos. Se anota para
          // enfriar y no se insiste en esta tanda.
          if (r.rateLimited) { rateLimited = true; retryAfterMs = Math.max(retryAfterMs, r.retryAfterMs || 0); breakerTripped = true; }
          if (consecutiveTransient >= AI_BREAKER_FAILURES) breakerTripped = true;
        }
      }
    }

    // Guardar el ritmo para la próxima ejecución: lo gastado en esta ventana y, si la API pidió
    // parar, hasta cuándo no se la vuelve a llamar.
    // En enfriamiento no se ha llamado al modelo: no hay nada que anotar y, sobre todo, no se
    // borra el enfriamiento ni el contador de 429 seguidos (los borraba cada dos minutos).
    if (useAi && !dryRun && !(enfriando > 0 && aiCalls === 0)) {
      const consecutive = rateLimited ? ((throttleRow as ThrottleState)?.consecutive_limits || 0) + 1 : 0;
      await admin.from("ai_throttle_state").upsert({
        id: 1,
        window_started_at: plan.windowStart,
        calls_in_window: plan.callsInWindow + aiCalls,
        cooldown_until: rateLimited ? new Date(Date.now() + cooldownAfterLimit(consecutive, retryAfterMs)).toISOString() : null,
        consecutive_limits: consecutive,
        updated_at: new Date().toISOString(),
      });
    }

    // ── Phase 3: write labels, notify ────────────────────────────────────────────────────────
    let classified = 0, byAi = 0, byRules = 0, aiDisagreed = 0, notified = 0;
    const sample: { tipo: string; via: string; from: string | null; subject: string; reglas?: string; cita?: string; motivo?: string; texto?: string }[] = [];
    for (const p of pending) {
      if (deferred.has(p.m.id)) continue;
      const labels = p.m.labels || [];
      const etiqueta = LABEL_OF[p.verdict] || "";   // neutral → no category label
      const others = labels.filter((l) => !CATEGORY_LABELS.includes(l));
      // Un veredicto "neutral" NO borra la categoría que ya tenía el mensaje. Importa en los
      // repasos: si el modelo está caído y deciden sólo las reglas, un mensaje bien etiquetado se
      // quedaba SIN categoría y, con la marca "IA" puesta, ya nadie volvía a mirarlo.
      const previousCats = labels.filter((l) => CATEGORY_LABELS.includes(l));
      // Sin duplicados: cada repaso volvía a añadir la marca y las filas acababan con ["IA","IA","IA"].
      const newLabels = Array.from(new Set(etiqueta ? [...others, etiqueta, AI_MARKER] : [...others, ...previousCats, AI_MARKER]));
      // staleIds = rows pulled in by the catch-up sweep: label them, never buzz the phone for them.
      // "Pregunta" sólo avisa cuando lo ha decidido el modelo: la regla salta con un simple "?"
      // (una firma con "¿nos sigues en LinkedIn?") y con la IA caída hacía sonar el móvil sin motivo.
      // AVISO SÓLO POR LO QUE ESTÁ EN "CAMPAIGNS" (22-09-2026, petición del usuario): el correo tiene
      // que estar atado a una campaña (respuesta del lead, de un compañero de su empresa o del mismo
      // nombre de empresa: fetch-inbox pone campaign_id en los tres casos). Lo que sólo sale en
      // Global o en "Todos" se sigue etiquetando para el Unibox, pero NUNCA hace sonar el móvil:
      // en 3 días 21 de 48 avisos eran de hilos sin campaña (warm-up "RE: Gym Membership Discount",
      // respuestas a envíos hechos fuera de la plataforma).
      const shouldNotify = shouldPushReply({
        notify, campaignId: p.m.campaign_id, verdict: p.verdict, via: p.via,
        alreadyPushed: yaEnviados.has(p.m.id), stale: staleIds.has(p.m.id),
      });
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
          const pushRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
            body: JSON.stringify({
              user_id: p.m.user_id,
              title: `${esPregunta ? "❓ Pregunta" : "🔥 Interesado"} — ${who}`,
              body: preview || p.m.subject || (esPregunta ? "Te han preguntado algo" : "Nueva respuesta interesada"),
              url: "/unibox",
            }),
          }).then((r) => r.json().catch(() => ({}))).catch(() => null);
          // Si no llegó a ningún dispositivo (el usuario aún no había activado los avisos), se
          // libera la marca para que el aviso salga en cuanto los active. Un fallo duro la deja
          // puesta: mejor un aviso perdido que el móvil sonando cada dos minutos.
          if (pushRes && Number((pushRes as any).sent) === 0) {
            await admin.from("push_notified").delete().eq("message_id", p.m.id);
          }
        }
        notified++;
      }
      if (sample.length < (dryRun ? 60 : 12)) sample.push({
        tipo: etiqueta || "(sin etiqueta)", via: p.via, from: p.m.from_email, subject: String(p.m.subject || "").slice(0, 50),
        ...(p.via === "ia" && p.verdict !== p.ruleVerdict ? { reglas: LABEL_OF[p.ruleVerdict] || "(sin etiqueta)" } : {}),
        ...(dryRun ? { cita: p.evidence, motivo: p.reason, texto: authorText(p.text).replace(/\s+/g, " ").slice(0, 220) } : {}),
      });
    }

    return new Response(JSON.stringify({
      dry_run: dryRun, revisados: scanned, ya_clasificados: skipped, clasificados: classified,
      por_ia: byAi, por_reglas: byRules, ia_cambio_el_veredicto: aiDisagreed, llamadas_ia: aiCalls, fallos_ia: aiFailures,
      aplazados: deferred.size, cortacircuitos: breakerTripped, sin_tiempo: outOfTime, interes_sin_cita: unsupported,
      limite_api: rateLimited, enfriando_ms: enfriando, cupo_tanda: plan.allowed, ms: Date.now() - startedAt,
      notificados: notified, hasta: oldestSeen, muestra: sample,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
