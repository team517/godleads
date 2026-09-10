import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveAiKeyForAuth } from "../_shared/ai-key.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_CONTENT = 20000; // a chat message; anything larger is abuse, not a post

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

    const { content } = await req.json();
    if (typeof content !== "string" || content.trim().length === 0) return json({ status: "safe" });
    if (content.length > MAX_CONTENT) return json({ error: "Mensaje demasiado largo" }, 400);

    const response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          {
            role: "system",
            content: `You are a content moderator for a professional community chat. Classify messages into exactly one category:
- "safe" - Constructive, helpful, professional, friendly messages
- "normal" - Neutral messages, greetings, simple questions
- "blocked" - Insults, slurs, harassment, spam, excessive self-promotion of companies/products, inappropriate content, offensive language

Respond ONLY with one word: safe, normal, or blocked. Nothing else.`
          },
          { role: "user", content }
        ],
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      console.error("AI gateway error:", response.status);
      return new Response(JSON.stringify({ status: "normal" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const result = (data.choices?.[0]?.message?.content || "normal").trim().toLowerCase();
    const status = ["safe", "normal", "blocked"].includes(result) ? result : "normal";

    return new Response(JSON.stringify({ status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Moderation error:", e);
    return new Response(JSON.stringify({ status: "normal" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
