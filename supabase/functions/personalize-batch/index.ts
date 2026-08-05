import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PERSONALIZE_SYSTEM, applyMapping, generatePersonalized } from "../_shared/personalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const rows: { index: number; data: Record<string, string> }[] = Array.isArray(body?.rows) ? body.rows : [];
    const prompt: string = String(body?.prompt || "").trim();
    const provider: string = body?.provider === "claude" ? "claude" : "deepseek";
    const system: string = String(body?.system || "").trim() || PERSONALIZE_SYSTEM;

    if (!prompt) return new Response(JSON.stringify({ error: "Falta el prompt" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!rows.length) return new Response(JSON.stringify({ error: "No hay filas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (rows.length > 25) return new Response(JSON.stringify({ error: "Máximo 25 filas por lote" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    const useProvider = provider === "claude" && claudeKey ? "claude" : "deepseek";
    if (useProvider === "deepseek" && !deepseekKey) {
      return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY no configurada en el servidor" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const gen = (userPrompt: string) =>
      generatePersonalized({ provider: useProvider as "claude" | "deepseek", deepseekKey, claudeKey, system, userPrompt, temperature: 0.7, retries: 2 });

    // Bounded concurrency so a 25-row batch stays well within the edge time budget.
    const results: { index: number; message: string; error?: string }[] = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (r) => {
          const userPrompt = applyMapping(prompt, r.data || {});
          const message = await gen(userPrompt);
          return { index: r.index, message };
        })
      );
      settled.forEach((s, j) => {
        if (s.status === "fulfilled") results.push(s.value);
        else results.push({ index: chunk[j].index, message: "", error: String((s as PromiseRejectedResult).reason).slice(0, 200) });
      });
    }

    return new Response(JSON.stringify({ results, provider: useProvider }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
