import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { content } = await req.json();
    if (!content || content.trim().length === 0) {
      return new Response(JSON.stringify({ status: "safe" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not configured");

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
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
