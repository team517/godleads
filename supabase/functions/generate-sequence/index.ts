import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { context, variables, numSteps } = await req.json();
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not configured");

    const variableList = (variables || []).map((v: string) => `{{${v}}}`).join(", ");

    const systemPrompt = `Eres un experto en cold email outreach en español. Generas secuencias de emails de ventas/prospección que son directos, personalizados y profesionales.

REGLAS IMPORTANTES:
- Escribe en español
- Usa las variables proporcionadas de forma natural: ${variableList || "no hay variables disponibles"}
- Cada email debe ser corto (3-5 líneas máximo)
- El primer email es de presentación, los siguientes son follow-ups
- NO uses emojis
- Tono profesional pero cercano
- Incluye un CTA claro en cada email
- Los follow-ups deben hacer referencia al email anterior sin ser repetitivos
- Usa saltos de línea entre párrafos

Responde EXCLUSIVAMENTE con un JSON array con este formato exacto (sin markdown, sin backticks):
[{"subject":"...","body":"...","delay_days":0},{"subject":"...","body":"...","delay_days":3}]

El primer step siempre tiene delay_days: 0. Los siguientes entre 2-7 días.`;

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Genera una secuencia de ${numSteps || 3} emails de cold outreach con este contexto:\n\n${context}\n\nVariables disponibles para personalizar: ${variableList || "ninguna"}` },
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

    // Parse JSON from response - handle potential markdown wrapping
    let steps;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      steps = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", content);
      throw new Error("Error al parsear la respuesta de IA");
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
