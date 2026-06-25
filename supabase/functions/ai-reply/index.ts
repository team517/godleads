import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = user.id;

    const { message_id } = await req.json();
    if (!message_id) {
      return new Response(JSON.stringify({ error: "message_id required" }), { status: 400, headers: corsHeaders });
    }

    // 1. Get the message
    const { data: message, error: msgErr } = await supabase
      .from("inbox_messages")
      .select("*, email_accounts(email, tags)")
      .eq("id", message_id)
      .eq("user_id", userId)
      .single();

    if (msgErr || !message) {
      return new Response(JSON.stringify({ error: "Message not found" }), { status: 404, headers: corsHeaders });
    }

    const accountTags: string[] = message.email_accounts?.tags || [];

    // 2. Find matching AI prompt
    const { data: allPrompts } = await supabase
      .from("ai_prompts")
      .select("*")
      .eq("user_id", userId);

    const matchingPrompt = (allPrompts || []).find((p: any) =>
      p.tags.some((t: string) => accountTags.includes(t))
    );

    // Use matching prompt or a generic fallback
    const promptName = matchingPrompt?.name || "Asistente IA";
    const companyInfo = matchingPrompt?.company_info || "";
    const promptInstructions = matchingPrompt?.prompt || "Genera una respuesta profesional, amable y concisa al email recibido.";

    // 3. Build prompt and call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), { status: 500, headers: corsHeaders });
    }

    const systemPrompt = `Eres un asistente de email profesional. Tu trabajo es generar respuestas de email basándote en el contexto proporcionado.
${companyInfo ? `\nINFORMACIÓN DE LA EMPRESA:\n${companyInfo}\n` : ""}
INSTRUCCIONES DEL USUARIO:
${promptInstructions}

REGLAS:
- Responde SOLO con el cuerpo del email, sin incluir "Asunto:", "De:", ni saludos como "Hola" a menos que sea apropiado.
- Mantén un tono profesional y natural.
- Responde en el mismo idioma que el mensaje recibido.
- No inventes datos, si no tienes información suficiente, sé genérico pero útil.
- Sé conciso y directo.`;

    const userMessage = `Genera una respuesta para este email:

De: ${message.from_name || ""} <${message.from_email}>
Asunto: ${message.subject || "(sin asunto)"}
Cuerpo:
${message.body_text || message.body_html || "(vacío)"}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes de IA. Inténtalo en unos segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados. Añade créditos en Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResp.text();
      console.error("AI gateway error:", status, errText);
      return new Response(JSON.stringify({ error: "Error generando respuesta IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const suggestion = aiData.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ suggestion, prompt_name: promptName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-reply error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
