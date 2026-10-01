import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cronOrServiceAuthorised, userFromRequest, unauthorized } from "../_shared/cron-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PERSONALIZE_SYSTEM, promptForLead, generatePersonalized } from "../_shared/personalize-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Cuántas personalizaciones lleva a la vez una misma pasada (cada una con 5 leads en vuelo). */
const MAX_JOBS = 4;
const CONCURRENCY = 5;
const MAX_MS = 90_000;
const MAX_ROWS = 120;
/** Un trabajo "running" sin avanzar en este tiempo se da por parado y se puede retomar. Un grupo de
 *  5 leads puede tardar más de un minuto si la IA va lenta; con 60 s otro proceso lo daba por
 *  muerto y se ponía a generar los mismos leads a la vez. */
const STALE_MS = 120_000;

type Results = Record<string, { message: string; error?: string }>;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const reqBody = await req.json().catch(() => ({}));
  let onlyUser: string | null = null;
  if (!cronOrServiceAuthorised(req, reqBody)) {
    const user = await userFromRequest(req);
    if (!user) return unauthorized(corsHeaders);
    onlyUser = user.id; // el botón de Personalización empuja SUS trabajos, no los de otros
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");

  /** Una tanda de UN trabajo: hasta 120 leads o 90 s. Devuelve cómo ha quedado. */
  const procesar = async (job: any) => {
    const provider = job.provider === "claude" && claudeKey ? "claude" : "deepseek";
    if (provider === "deepseek" && !deepseekKey) {
      await db.from("personalization_csv_jobs").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", job.id);
      return { job_id: job.id, error: "DEEPSEEK_API_KEY missing" };
    }
    const system = (job.system && String(job.system).trim()) || PERSONALIZE_SYSTEM;
    const gen = (p: string) => generatePersonalized({ provider: provider as "claude" | "deepseek", deepseekKey, claudeKey, system, userPrompt: p, temperature: 0.7, retries: 2 });

    const rows: { __idx: number; [k: string]: any }[] = Array.isArray(job.rows) ? job.rows : [];
    const results: Results = job.results || {};
    const pending = rows.filter((r) => !(String(r.__idx) in results));
    const total = rows.length;
    const counts = () => ({
      done: Object.keys(results).length,
      ok: Object.values(results).filter((x) => x.message && !x.error).length,
      failed: Object.values(results).filter((x) => x.error).length,
    });

    const startMs = Date.now();
    let processed = 0;
    for (let i = 0; i < pending.length && processed < MAX_ROWS && (Date.now() - startMs) < MAX_MS; i += CONCURRENCY) {
      // Respect a Stop pressed mid-run: re-read status each group (~5 rows apart) and, if the
      // user cancelled, save whatever is done and BAIL — without ever writing "running" again.
      // This clobber (progress write resurrecting a cancelled job) was why "Parar" no paraba.
      const { data: cur } = await db.from("personalization_csv_jobs").select("status").eq("id", job.id).maybeSingle();
      if ((cur as any)?.status === "cancelled") {
        await db.from("personalization_csv_jobs").update({ results, ...counts(), updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "cancelled");
        return { job_id: job.id, cancelled: true };
      }
      if (!cur) return { job_id: job.id, deleted: true }; // lo han borrado del registro a mitad
      const chunk = pending.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(async (r) => {
        const { __idx, ...data } = r;
        // UN lead = UNA llamada a la IA con SUS datos; el resultado se guarda por su __idx.
        const msg = await gen(promptForLead(job.prompt, data));
        return { idx: __idx, message: msg };
      }));
      settled.forEach((s, j) => {
        const idx = String(chunk[j].__idx);
        if (s.status === "fulfilled") results[idx] = { message: s.value.message };
        else results[idx] = { message: "", error: String((s as PromiseRejectedResult).reason).slice(0, 200) };
      });
      processed += chunk.length;
      // Persist progress after each concurrent group → visible live + crash-safe.
      // `.neq(cancelled)` so a Stop that lands during the await above is never overwritten.
      const c = counts();
      await db.from("personalization_csv_jobs").update({
        results, ...c, total,
        status: c.done >= total ? "completed" : "running",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).neq("status", "cancelled");
    }

    const done = Object.keys(results).length;
    if (done >= total) {
      await db.from("personalization_csv_jobs").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", job.id).neq("status", "cancelled");
    } else {
      // Tanda terminada y quedan leads: se SUELTA el trabajo (pending) para que la siguiente pasada
      // lo coja ya. Si se quedara en "running" habría que esperar a que se diera por parado.
      await db.from("personalization_csv_jobs").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
    }
    return { job_id: job.id, processed, done, total };
  };

  try {
    // Candidatos: pendientes, o "running" que llevan parados demasiado (→ se retoman). Se miran
    // primero los que más llevan esperando, así varias personalizaciones avanzan a la par.
    const staleIso = new Date(Date.now() - STALE_MS).toISOString();
    const disponible = `status.eq.pending,and(status.eq.running,updated_at.lt.${staleIso})`;
    let q = db.from("personalization_csv_jobs").select("id").or(disponible).order("updated_at", { ascending: true }).limit(MAX_JOBS);
    if (onlyUser) q = q.eq("user_id", onlyUser);
    const { data: candidatos } = await q;
    if (!candidatos?.length) return json({ ok: true, idle: true });

    // La reserva es ATÓMICA: cada trabajo lo consigue UN solo proceso (el cron y el botón de la
    // página pueden llegar a la vez). Los que ya tiene otro proceso se dejan pasar.
    const tandas = await Promise.all(candidatos.map(async ({ id }: { id: string }) => {
      const { data: claimed } = await db.from("personalization_csv_jobs")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", id).or(disponible)
        .select("*");
      const job = claimed?.[0];
      if (!job) return null;
      try { return await procesar(job); }
      catch (e) { return { job_id: id, error: e instanceof Error ? e.message : "error" }; }
    }));
    const hechas = tandas.filter(Boolean);
    if (!hechas.length) return json({ ok: true, idle: true, taken: true });
    return json({ ok: true, jobs: hechas, ...(hechas.length === 1 ? hechas[0] : {}) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" });
  }
});
