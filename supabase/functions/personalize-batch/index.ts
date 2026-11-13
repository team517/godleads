import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PERSONALIZE_SYSTEM, promptForLead, generatePersonalized } from "../_shared/personalize-ai.ts";
import { resolveAiKeyForAuth, type AiKey } from "../_shared/ai-key.ts";
import { cobrarMonedas, devolverMonedas, costePersonalizar, devolucionPersonalizar } from "../_shared/coins.ts";

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

    // BYOK: agency + agency-created clients use the platform key; external users use their own.
    const aiRes = await resolveAiKeyForAuth(req.headers.get("Authorization") || "");
    if (aiRes === "unauthorized") return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    // Monedas (13-11-2026): sin clave propia se usa la IA de la plataforma pagando 0,75 monedas por lead.
    // Con clave propia no se cobra nada (ya paga su proveedor); equipo y clientes gestionados, gratis.
    let ai: AiKey;
    let cobradas = 0;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (aiRes === "needs_key") {
      const cobro = await cobrarMonedas(admin, userData.user.id, userData.user.email ?? null, costePersonalizar(rows.length));
      if (!cobro.ok) {
        return new Response(JSON.stringify({ error: `Te faltan monedas: personalizar ${rows.length} leads cuesta ${cobro.required} y tienes ${cobro.available}. Compra monedas o conecta tu clave de IA en Ajustes → IA.`, insufficient_coins: true, required: cobro.required, available: cobro.available }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      cobradas = cobro.gratis ? 0 : costePersonalizar(rows.length);
      ai = { apiKey: Deno.env.get("DEEPSEEK_API_KEY") || "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", source: "platform" };
    } else {
      ai = aiRes;
    }

    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    let genBase: Record<string, unknown>;
    // Hoisted: it was `const` inside the else-branch but read at the response below → every
    // request threw ReferenceError AFTER spending the AI tokens (always 500).
    let useProvider: "claude" | "deepseek" = "deepseek";
    if (ai.source === "user") {
      genBase = { provider: "deepseek", deepseekKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model };
    } else {
      const envDeepseek = Deno.env.get("DEEPSEEK_API_KEY");
      useProvider = provider === "claude" && claudeKey ? "claude" : "deepseek";
      if (useProvider === "deepseek" && !envDeepseek) return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY no configurada en el servidor" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      genBase = { provider: useProvider, deepseekKey: envDeepseek, claudeKey };
    }

    const gen = (userPrompt: string) =>
      generatePersonalized({ ...(genBase as any), system, userPrompt, temperature: 0.7, retries: 2 });

    // Bounded concurrency so a 25-row batch stays well within the edge time budget.
    const results: { index: number; message: string; error?: string }[] = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (r) => {
          const userPrompt = promptForLead(prompt, r.data || {});
          const message = await gen(userPrompt);
          return { index: r.index, message };
        })
      );
      settled.forEach((s, j) => {
        if (s.status === "fulfilled") results.push(s.value);
        else results.push({ index: chunk[j].index, message: "", error: String((s as PromiseRejectedResult).reason).slice(0, 200) });
      });
    }

    // Los que fallaron no se cobran.
    const buenos = results.filter((r) => !r.error && r.message).length;
    const devolver = cobradas > 0 ? devolucionPersonalizar(cobradas, buenos) : 0;
    if (devolver > 0) await devolverMonedas(admin, userData.user.id, userData.user.email ?? null, devolver);
    return new Response(JSON.stringify({ results, provider: useProvider, coins_spent: cobradas - devolver }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
