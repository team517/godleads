import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PERSONALIZE_SYSTEM, applyMapping, generatePersonalized } from "../_shared/personalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");

  try {
    // Claim ONE job: pending, or a running one that stalled (>90s) → resumable.
    const staleIso = new Date(Date.now() - 60_000).toISOString();
    const { data: jobs } = await db
      .from("personalization_csv_jobs")
      .select("*")
      .or(`status.eq.pending,and(status.eq.running,updated_at.lt.${staleIso})`)
      .order("updated_at", { ascending: true })
      .limit(1);
    const job = jobs?.[0];
    if (!job) return new Response(JSON.stringify({ ok: true, idle: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Claim it (bump updated_at so a concurrent tick skips it). `.neq(cancelled)` so a Stop
    // that landed between the SELECT and here is never overwritten back to running.
    await db.from("personalization_csv_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id).neq("status", "cancelled");

    const provider = job.provider === "claude" && claudeKey ? "claude" : "deepseek";
    if (provider === "deepseek" && !deepseekKey) {
      await db.from("personalization_csv_jobs").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", job.id);
      return new Response(JSON.stringify({ ok: false, error: "DEEPSEEK_API_KEY missing" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const system = (job.system && String(job.system).trim()) || PERSONALIZE_SYSTEM;
    const gen = (p: string) => generatePersonalized({ provider: provider as "claude" | "deepseek", deepseekKey, claudeKey, system, userPrompt: p, temperature: 0.7, retries: 2 });

    const rows: { __idx: number; [k: string]: any }[] = Array.isArray(job.rows) ? job.rows : [];
    const results: Record<string, { message: string; error?: string }> = job.results || {};

    // Rows not yet processed.
    const pending = rows.filter((r) => !(String(r.__idx) in results));
    const total = rows.length;

    // Time-boxed chunk: process until ~65s or 80 rows, whichever first (cron continues).
    const startMs = Date.now();
    const CONCURRENCY = 5;
    const MAX_MS = 90_000;
    const MAX_ROWS = 120;
    let processed = 0;

    for (let i = 0; i < pending.length && processed < MAX_ROWS && (Date.now() - startMs) < MAX_MS; i += CONCURRENCY) {
      // Respect a Stop pressed mid-run: re-read status each group (~5 rows apart) and, if the
      // user cancelled, save whatever is done and BAIL — without ever writing "running" again.
      // This clobber (progress write resurrecting a cancelled job) was why "Parar" no paraba.
      const { data: cur } = await db.from("personalization_csv_jobs").select("status").eq("id", job.id).maybeSingle();
      if ((cur as any)?.status === "cancelled") {
        await db.from("personalization_csv_jobs").update({
          results, done: Object.keys(results).length,
          ok: Object.values(results).filter((x) => x.message && !x.error).length,
          failed: Object.values(results).filter((x) => x.error).length,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id).eq("status", "cancelled");
        return new Response(JSON.stringify({ ok: true, cancelled: true, job_id: job.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const chunk = pending.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(async (r) => {
        const { __idx, ...data } = r;
        const msg = await gen(applyMapping(job.prompt, data));
        return { idx: __idx, message: msg };
      }));
      settled.forEach((s, j) => {
        const idx = String(chunk[j].__idx);
        if (s.status === "fulfilled") results[idx] = { message: s.value.message };
        else results[idx] = { message: "", error: String((s as PromiseRejectedResult).reason).slice(0, 200) };
      });
      processed += chunk.length;
      // Persist progress after each concurrent group → visible live + crash-safe.
      const done = Object.keys(results).length;
      const okN = Object.values(results).filter((x) => x.message && !x.error).length;
      const failN = Object.values(results).filter((x) => x.error).length;
      // `.neq(cancelled)` so a Stop that lands during the await above is never overwritten.
      await db.from("personalization_csv_jobs").update({
        results, done, ok: okN, failed: failN, total,
        status: done >= total ? "completed" : "running",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).neq("status", "cancelled");
    }

    const done = Object.keys(results).length;
    if (done >= total) {
      await db.from("personalization_csv_jobs").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", job.id).neq("status", "cancelled");
    }
    return new Response(JSON.stringify({ ok: true, job_id: job.id, processed, done, total }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
