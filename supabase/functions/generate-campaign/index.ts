import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Variant { subject: string; body: string }
interface Step { subject: string; body: string; variants: Variant[] }

function buildSystem(language: string, tone: string): string {
  return `Eres un copywriter senior de cold email B2B. Generas una SECUENCIA de correos en frío lista para enviar.

REGLAS OBLIGATORIAS:
- IDIOMA: escribe TODO en ${language}. Ni una palabra en otro idioma (salvo nombres propios). No mezcles idiomas.
- TONO: ${tone}. Humano y directo, como un email real de una persona, nunca a plantilla.
- VARIABLES: puedes usar SOLO {{first_name}} y {{company_name}}. Redacta de forma que el correo se lea natural aunque una variable quede vacía. No inventes otras variables ni dejes corchetes.
- ASUNTO: corto (máx ~55 caracteres), en minúsculas estilo humano, sin emojis, sin palabras spam (gratis, oferta, oportunidad única…), sin signos raros.
- CUERPO: 40–90 palabras, UNA sola idea, específico al negocio del briefing, con un CTA suave (una pregunta o proponer una llamada breve). Nada de "espero que estés bien" ni relleno.
- SECUENCIA: cada step es un follow-up MÁS CORTO del anterior, con un ángulo nuevo (prueba social, caso, recordatorio con valor, ruptura amable). No repitas frases entre steps.
- VARIANTES: cada variante es una versión CLARAMENTE distinta (distinto asunto y distinto enfoque), no una reescritura trivial.
- Básate SOLO en el briefing; no inventes datos, cifras ni clientes que no estén en él.

Devuelve EXCLUSIVAMENTE un JSON válido con esta forma exacta, sin markdown ni texto extra:
{"steps":[{"subject":"...","body":"...","variants":[{"subject":"...","body":"..."}]}]}`;
}

async function callDeepSeekJson(key: string, system: string, user: string): Promise<any> {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 4000,
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "";
}

async function callClaudeJson(key: string, system: string, user: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      temperature: 0.8,
      system: system + "\n\nResponde SOLO con el JSON, empezando por { y terminando por }.",
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

function parseSteps(raw: string): Step[] {
  let txt = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Grab the outermost {...} if the model added stray text.
  const first = txt.indexOf("{"); const last = txt.lastIndexOf("}");
  if (first > 0 || last < txt.length - 1) txt = txt.slice(first, last + 1);
  const obj = JSON.parse(txt);
  const steps = Array.isArray(obj?.steps) ? obj.steps : [];
  return steps.map((s: any) => ({
    subject: String(s?.subject || "").trim(),
    body: String(s?.body || "").trim(),
    variants: (Array.isArray(s?.variants) ? s.variants : []).map((v: any) => ({
      subject: String(v?.subject || "").trim(),
      body: String(v?.body || "").trim(),
    })).filter((v: Variant) => v.subject || v.body),
  })).filter((s: Step) => s.subject || s.body);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Verify the caller is a signed-in user.
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const briefing = String(body?.briefing || "").trim();
    const language = String(body?.language || "español de España").trim();
    const tone = String(body?.tone || "cercano y profesional").trim();
    const numSteps = Math.max(1, Math.min(6, Number(body?.num_steps) || 3));
    const numVariants = Math.max(1, Math.min(3, Number(body?.num_variants) || 1));
    const goal = String(body?.goal || "conseguir una reunión / llamada").trim();
    if (!briefing) return new Response(JSON.stringify({ error: "Falta el briefing" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!deepseekKey && !claudeKey) {
      return new Response(JSON.stringify({ error: "No hay clave de IA configurada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const system = buildSystem(language, tone);
    const userPrompt = `BRIEFING DEL CLIENTE:\n${briefing}\n\nOBJETIVO DE LA CAMPAÑA: ${goal}\n\nGenera EXACTAMENTE ${numSteps} step(s), cada uno con EXACTAMENTE ${numVariants} variante(s). El step 1 es el email inicial; los siguientes son follow-ups. Devuelve el JSON con ${numSteps} elementos en "steps" y ${numVariants} en cada "variants".`;

    // Prefer Claude when available (better instruction-following), else DeepSeek. Retry once.
    let steps: Step[] = [];
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2 && steps.length === 0; attempt++) {
      try {
        const raw = claudeKey ? await callClaudeJson(claudeKey, system, userPrompt) : await callDeepSeekJson(deepseekKey!, system, userPrompt);
        steps = parseSteps(raw);
      } catch (e) { lastErr = e; }
    }
    if (steps.length === 0) {
      return new Response(JSON.stringify({ error: `No se pudo generar la secuencia: ${lastErr instanceof Error ? lastErr.message : "IA sin respuesta"}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Normalize to the requested shape: exactly numSteps, each padded to numVariants.
    steps = steps.slice(0, numSteps).map((s) => ({
      subject: s.subject,
      body: s.body,
      variants: (s.variants || []).slice(0, numVariants),
    }));

    return new Response(JSON.stringify({ steps, provider: claudeKey ? "claude" : "deepseek" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
