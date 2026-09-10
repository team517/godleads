import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveAiKeyForAuth } from "../_shared/ai-key.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_BODY = 20000; // one email body; anything larger is abuse, not a draft

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Was an open proxy to the platform DEEPSEEK_API_KEY: anyone could burn the agency's credits.
    // Same BYOK gate as the other user-facing AI functions (see generate-subject).
    const ai = await resolveAiKeyForAuth(req.headers.get("Authorization") || "");
    if (ai === "unauthorized") return json({ error: "No autorizado" }, 401);
    if (ai === "needs_key") return json({ error: "Conecta tu clave de IA (OpenAI o DeepSeek) en Ajustes → IA.", needs_key: true }, 402);
    if (!ai.apiKey) return json({ error: "AI not configured" }, 500);

    const { body } = await req.json();
    if (typeof body !== "string" || !body.trim()) return json({ error: "El cuerpo del email está vacío" }, 400);
    if (body.length > MAX_BODY) return json({ error: "El cuerpo del email es demasiado largo" }, 400);

    const response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          {
            role: "system",
            content: `Eres un experto en cold email copywriting. Tu tarea es recibir el cuerpo de un email y devolver EXACTAMENTE el mismo texto, pero envolviendo las frases o palabras más importantes con etiquetas HTML <b>...</b>.

REGLAS ESTRICTAS:
- SIEMPRE usa etiquetas HTML <b>...</b> para negrita. NUNCA uses asteriscos (**texto**) ni markdown. Solo HTML: <b>texto</b>
- NO cambies ni una sola palabra del texto original
- NO añadas ni elimines texto
- Solo añade etiquetas <b>...</b> alrededor de las partes clave (propuesta de valor, CTA, beneficios, datos importantes)
- Pon en negrita entre 2 y 5 fragmentos por email, no más
- Mantén las variables como {{variable}} intactas
- Si una variable es importante, puedes ponerla en negrita: <b>{{variable}}</b>
- Responde SOLO con el texto modificado, sin explicaciones, sin bloques de código, sin markdown
- PROHIBIDO usar \`\`\`, **, __, o cualquier formato que no sea <b>...</b>`
          },
          {
            role: "user",
            content: body,
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de peticiones excedido, intenta de nuevo." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("Error del servicio de IA");
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ body: result.trim() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-bold error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
