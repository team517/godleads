import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { body, variables } = await req.json();

    if (!body || !body.trim()) {
      return new Response(JSON.stringify({ error: "Se necesita el cuerpo del email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const variableList = (variables || []).map((v: string) => `{{${v}}}`).join(", ");

    // Rotación aleatoria de estilos para forzar variedad
    const styles = [
      { name: "intriga corta", hint: "una frase muy breve que despierte curiosidad sin revelar nada (ej: 'una idea suelta', 'pregunta rápida')" },
      { name: "observación personal", hint: "menciona algo que viste o notaste sobre la empresa/persona (ej: 'vi algo sobre {{company}}', 'detalle en {{company}}')" },
      { name: "pregunta directa", hint: "formula una pregunta corta y casual que invite a responder" },
      { name: "referencia indirecta", hint: "alude a algo del sector o contexto sin ser obvio (ej: 'sobre lo de {{company}}', '{{first_name}}, una cosa')" },
      { name: "tono colega", hint: "como si escribieras a un amigo (ej: '{{first_name}}, te cuento', 'oye {{first_name}}')" },
      { name: "valor sugerido", hint: "insinúa un beneficio sin venderlo (ej: 'idea para {{company}}', 'algo para {{company}}')" },
      { name: "minúsculas relajado", hint: "todo en minúsculas, ultra casual y humano" },
      { name: "guiño temporal", hint: "menciona tiempo de forma sutil (ej: '{{first_name}}, 30s', 'rápido sobre {{company}}')" },
    ];
    const pickedStyle = styles[Math.floor(Math.random() * styles.length)];
    const seed = Math.floor(Math.random() * 1_000_000);

    const systemPrompt = `Eres un copywriter de cold email outreach experto en asuntos que generan apertura y respuesta.

REGLAS GENERALES:
- Detecta el idioma del cuerpo del email y genera el asunto EN ESE MISMO IDIOMA
- Máximo 5-7 palabras, mejor cortos
- DEBE incluir al menos UNA variable de: ${variableList || "{{first_name}}"}
- Tono humano, personal, como si lo enviara un colega real
- NO uses emojis, NO mayúsculas innecesarias, NO exclamaciones, NO clickbait
- NO empieces SIEMPRE con "{{first_name}}," — varía la estructura: a veces empieza con la variable, a veces ponla al final, a veces en medio
- EVITA patrones repetidos como "quick question", "idea para X", "vi algo sobre X" — son muletillas, busca formulaciones FRESCAS

ESTILO PARA ESTA GENERACIÓN: **${pickedStyle.name}** — ${pickedStyle.hint}

CRÍTICO: Genera un asunto ÚNICO y ORIGINAL. No repitas plantillas obvias. Sé creativo dentro del estilo indicado.

Responde SOLO con el asunto, sin comillas ni explicaciones.`;

    const aiResp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 1.1,
        top_p: 0.95,
        seed,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Genera UN asunto fresco y original (estilo: ${pickedStyle.name}) para este email:\n\n${body.slice(0, 1500)}\n\nVariables disponibles: ${variableList || "ninguna"}\n\nSemilla creativa: ${seed}` },
        ],
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Inténtalo en unos segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResp.text();
      console.error("AI error:", status, errText);
      return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const subject = (data.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");

    return new Response(JSON.stringify({ subject }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-subject error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
