import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveAiKeyForAuth } from "../_shared/ai-key.ts";
import { MAX_STEPS, asuntoParaPaso, esperaParaPaso, leerPasos, peticionSecuencia, sistemaSecuencia } from "../_shared/sequence-copy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { context, variables, numSteps, stepPosition, senderName } = await req.json();
    // Both reach the prompt verbatim, so bound what a caller can make us pay for.
    const unico = Number(stepPosition) >= 1 ? Math.min(20, Math.floor(Number(stepPosition))) : null;
    const stepCount = unico ? 1 : Math.min(MAX_STEPS, Math.max(1, Math.floor(Number(numSteps) || 3)));
    const ctx = String(context ?? "").slice(0, 8000);
    const vars = (Array.isArray(variables) ? variables : []).map((v: unknown) => String(v).slice(0, 60)).slice(0, 40);
    // BYOK: platform key for agency/agency-clients, the user's own key otherwise.
    const ai = await resolveAiKeyForAuth(req.headers.get("Authorization") || "");
    if (ai === "unauthorized") return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (ai === "needs_key") return new Response(JSON.stringify({ error: "Conecta tu clave de IA (OpenAI o DeepSeek) en Ajustes → IA para usar la generación con IA.", needs_key: true }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!ai.apiKey) throw new Error("AI key not configured");

    // El molde de los EJEMPLOS QUE FUNCIONAN (el mismo que usan el bot de support y "Crear campaña").
    const systemPrompt = sistemaSecuencia({ variables: vars, firma: typeof senderName === "string" ? senderName.slice(0, 60) : null });
    const userPrompt = peticionSecuencia(ctx, stepCount, unico);

    const response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0.5,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de peticiones excedido, intenta de nuevo en unos segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("Error del servicio de IA");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let steps;
    try {
      const posInicial = unico ?? 1;
      steps = leerPasos(content).slice(0, stepCount).map((st, i) => ({ subject: asuntoParaPaso(posInicial + i, st.subject), body: st.body, delay_days: esperaParaPaso(posInicial + i) }));
      if (!steps.length) throw new Error("vacía");
    } catch {
      console.error("Failed to parse AI response:", content.slice(0, 500));
      throw new Error("La IA no ha devuelto los correos en el formato esperado. Prueba otra vez.");
    }

    return new Response(JSON.stringify({ steps }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-sequence error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
