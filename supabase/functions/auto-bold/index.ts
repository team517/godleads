import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { body } = await req.json();
    if (!body || !body.trim()) throw new Error("El cuerpo del email está vacío");

    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not configured");

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
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
