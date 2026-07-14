import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_SYSTEM =
  "Eres un experto en cold email B2B en español de España. Genera SOLO el texto " +
  "personalizado que se te pide (una línea, un párrafo o el cuerpo, según el prompt). " +
  "Frases cortas (<20 palabras), tono natural y directo, sin sonar a plantilla. " +
  "Devuelve SOLO el texto final: sin comillas, sin prefijos, sin explicaciones, sin markdown.";

function applyMapping(prompt: string, data: Record<string, string>): string {
  return prompt.replace(/\{\{?\s*([^{}]+?)\s*\}?\}/g, (_m, rawKey) => {
    const key = String(rawKey).trim();
    if (key in data) return data[key] ?? "";
    const hit = Object.keys(data).find((k) => k.toLowerCase() === key.toLowerCase());
    return hit ? (data[hit] ?? "") : "";
  });
}
function cleanOutput(t: string): string {
  return (t || "").trim().replace(/^```(?:html|text)?\s*/i, "").replace(/\s*```$/i, "").replace(/^["'“”]+|["'“”]+$/g, "").trim();
}
// A hung LLM call must never stall a chunk (would let another tick double-process).
async function fetchWithTimeout(url: string, init: RequestInit, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}
async function callDeepSeek(key: string, system: string, prompt: string): Promise<string> {
  const r = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: 1000, temperature: 0.75, stream: false }),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return cleanOutput((await r.json()).choices?.[0]?.message?.content || "");
}
async function callClaude(key: string, system: string, prompt: string): Promise<string> {
  const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, temperature: 0.75, system, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return cleanOutput((d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""));
}

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

    // Claim it (bump updated_at so a concurrent tick skips it).
    await db.from("personalization_csv_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);

    const provider = job.provider === "claude" && claudeKey ? "claude" : "deepseek";
    if (provider === "deepseek" && !deepseekKey) {
      await db.from("personalization_csv_jobs").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", job.id);
      return new Response(JSON.stringify({ ok: false, error: "DEEPSEEK_API_KEY missing" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const system = (job.system && String(job.system).trim()) || DEFAULT_SYSTEM;
    const gen = (p: string) => (provider === "claude" ? callClaude(claudeKey!, system, p) : callDeepSeek(deepseekKey!, system, p));

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
      await db.from("personalization_csv_jobs").update({
        results, done, ok: okN, failed: failN, total,
        status: done >= total ? "completed" : "running",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }

    const done = Object.keys(results).length;
    if (done >= total) {
      await db.from("personalization_csv_jobs").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", job.id);
    }
    return new Response(JSON.stringify({ ok: true, job_id: job.id, processed, done, total }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
