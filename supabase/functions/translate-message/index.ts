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

    const { text, target_lang, mode } = await req.json();
    // mode: "detect" → returns detected language code
    // mode: "translate" → translates text to target_lang

    if (!text) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "detect") {
      const aiResp = await fetch("https://api.deepseek.com/v1/chat/completions", {
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
              content: "You are a language detection tool. Respond with ONLY the ISO 639-1 language code (e.g. 'en', 'es', 'fr', 'de', 'pt', 'it', 'zh', 'ja', 'ko', 'ar', 'ru', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'tr', 'hi', 'ca'). Nothing else. Just the 2-letter code.",
            },
            { role: "user", content: text.slice(0, 500) },
          ],
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        console.error("AI detect error:", aiResp.status, errText);
        if (aiResp.status === 429) {
          return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Inténtalo en unos segundos." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (aiResp.status === 402) {
          return new Response(JSON.stringify({ error: "Créditos de IA agotados. Añade créditos en Settings > Workspace > Usage." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "AI detection failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await aiResp.json();
      const lang = (data.choices?.[0]?.message?.content || "es").trim().toLowerCase().slice(0, 2);

      return new Response(JSON.stringify({ language: lang }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // translate mode
    const targetLang = target_lang || "es";
    const langNames: Record<string, string> = {
      es: "Spanish", en: "English", fr: "French", de: "German", pt: "Portuguese",
      it: "Italian", zh: "Chinese", ja: "Japanese", ko: "Korean", ar: "Arabic",
      ru: "Russian", nl: "Dutch", sv: "Swedish", da: "Danish", no: "Norwegian",
      fi: "Finnish", pl: "Polish", cs: "Czech", tr: "Turkish", hi: "Hindi", ca: "Catalan",
    };
    const targetName = langNames[targetLang] || targetLang;

    const aiResp = await fetch("https://api.deepseek.com/v1/chat/completions", {
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
            content: `You are a professional translator. Translate the following text to ${targetName}. Return ONLY the translated text, nothing else. Preserve the original formatting, line breaks, and tone. Do not add explanations or notes.`,
          },
          { role: "user", content: text },
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
      return new Response(JSON.stringify({ error: "Translation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const translated = data.choices?.[0]?.message?.content || text;

    return new Response(JSON.stringify({ translated, target_lang: targetLang }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("translate-message error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
