import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Writes the AI narrative (executive summary + highlights + next steps + Friday
// suggestions + optional alert) for a client campaign report. It does NOT read the
// database — the numbers are passed in the body — so it can be called both by the
// browser (user JWT, for the "Hacer una prueba" preview) and by the scheduled
// send-report function (service role, internal). Returns strict JSON.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM =
  "Eres un analista senior de cold email B2B que escribe informes para clientes de una agencia, en español de España. " +
  "Tu tono es profesional, claro y honesto: explicas qué está pasando en la campaña y qué hacer a continuación, sin humo ni promesas vacías. " +
  "Hablas SIEMPRE en primera persona del plural ('hemos contactado', 'estamos recibiendo'), como la agencia que gestiona la campaña para el cliente. " +
  "La tasa de respuesta se mide SOBRE personas contactadas, no sobre correos enviados. " +
  "Devuelves EXCLUSIVAMENTE un objeto JSON válido, sin markdown ni texto alrededor.";

async function callDeepSeek(apiKey: string, userPrompt: string): Promise<string> {
  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt }],
      max_tokens: 2000,
      temperature: 0.5,
      stream: false,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callClaude(apiKey: string, userPrompt: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      temperature: 0.5,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

function parseJson(raw: string): any {
  let t = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const a = t.indexOf("{"); const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

const asList = (v: any, max: number): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, max);

function buildPrompt(body: any): string {
  const t = body.totals || {};
  const camps: any[] = Array.isArray(body.campaigns) ? body.campaigns : [];
  const lines = camps.map((c) => {
    const rate = c.contacted > 0 ? ((c.replied / c.contacted) * 100).toFixed(1) : "0";
    return `- "${c.name}": contactados ${c.contacted}, enviados ${c.sent}, respuestas ${c.replied} (${rate}%), interesados ${c.positive || 0}, restantes ${c.remaining || 0}, nuevos en el periodo ${c.periodNewContacts || 0}, respuestas en el periodo ${c.periodReplies || 0}`;
  }).join("\n");

  const kindTxt = body.kind === "weekly"
    ? "Es el REPASO SEMANAL (viernes). Haz un análisis didáctico de cómo ha ido la semana, explicando QUÉ ESTAMOS VIENDO en las cifras y QUÉ VAMOS A MEJORAR, con sugerencias concretas para la próxima semana."
    : "Es el informe periódico (cada 48 horas). Explica de forma clara y didáctica QUÉ ESTAMOS VIENDO (interpretación de las cifras, no solo repetirlas) y QUÉ ESTAMOS HACIENDO / VAMOS A MEJORAR en la campaña.";

  return [
    `Cliente: ${body.clientName || "Cliente"}. Periodo: ${body.periodLabel || ""}. ${kindTxt}`,
    "",
    "MÉTRICAS GLOBALES:",
    `- Personas contactadas (únicas): ${t.contacted || 0}`,
    `- Correos enviados (con follow-ups): ${t.sent || 0}`,
    `- Respuestas (leads que respondieron): ${t.replied || 0}`,
    `- Tasa de respuesta sobre contactados: ${Number(body.replyRate ?? 0).toFixed(1)}%`,
    `- Interesados detectados: ${t.positive || 0}`,
    `- Rebotes: ${t.bounced || 0}`,
    `- Contactos restantes por enviar: ${t.remaining || 0}`,
    `- En el periodo: ${t.periodNewContacts || 0} nuevas personas contactadas, ${t.periodReplies || 0} respuestas, ${t.periodSent || 0} correos enviados`,
    "",
    "POR CAMPAÑA:",
    lines || "(sin campañas)",
    "",
    body.lowContacts ? "IMPORTANTE: quedan POCOS contactos por enviar — incluye un aviso claro en 'alert' recomendando subir nuevos leads pronto para no parar la campaña." : "No hace falta aviso salvo que veas algo crítico; en ese caso usa 'alert', si no ponlo a null.",
    "",
    "Devuelve un JSON EXACTAMENTE con esta forma (sin nada más):",
    "{",
    '  "summary": "3-5 frases de resumen ejecutivo que INTERPRETEN las cifras (qué significan, si vamos bien o mal y por qué), no solo las repitan; con las cifras clave incluidas",',
    '  "highlights": ["3-5 puntos de lo más destacado, con números"],',
    '  "nextSteps": ["3-5 próximos pasos accionables y explicados: qué vamos a hacer ahora"],',
    '  "suggestions": ["3-5 mejoras CONCRETAS que vamos a aplicar y por qué: p.ej. optimizar el asunto de X forma, reescribir el primer email más directo, añadir una variante con otro ángulo, activar seguimiento adicional, subir más leads, etc. Explica el motivo de cada una en 1 frase"],',
    '  "alert": "texto del aviso o null"',
    "}",
    "",
    "Todo en español de España, en primera persona del plural, sin markdown dentro de los strings.",
  ].join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Unauthorized" }, 401);

    // Accept either a logged-in user (browser preview) OR the service role (internal cron call).
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    let authorized = token === serviceKey;
    if (!authorized) {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getUser();
      authorized = !error && !!data?.user;
    }
    if (!authorized) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();

    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    const provider = body?.provider === "claude" && claudeKey ? "claude" : "deepseek";
    if (provider === "deepseek" && !deepseekKey) {
      if (claudeKey) { /* fall through to claude */ }
      else return json({ error: "No hay API key de IA configurada (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY)" }, 500);
    }

    const prompt = buildPrompt(body);
    let raw = "";
    try {
      raw = provider === "claude" || !deepseekKey
        ? await callClaude(claudeKey!, prompt)
        : await callDeepSeek(deepseekKey!, prompt);
    } catch (e) {
      // one fallback to the other provider if available
      if (deepseekKey && claudeKey) raw = provider === "claude" ? await callDeepSeek(deepseekKey, prompt) : await callClaude(claudeKey, prompt);
      else throw e;
    }

    let parsed: any = {};
    try {
      parsed = parseJson(raw);
    } catch {
      // Never dump raw JSON braces into the client's "Resumen ejecutivo". Try to
      // salvage just the summary string; otherwise leave a clean, honest fallback.
      const m = /"summary"\s*:\s*"([^"]{0,600})/.exec(raw || "");
      parsed = { summary: m ? m[1] : "El análisis automático no se pudo generar correctamente esta vez; las métricas del informe son correctas." };
    }

    const narrative = {
      summary: String(parsed.summary || "").trim(),
      highlights: asList(parsed.highlights, 6),
      nextSteps: asList(parsed.nextSteps, 6),
      suggestions: asList(parsed.suggestions, 6),
      alert: parsed.alert && String(parsed.alert).trim() && String(parsed.alert).toLowerCase() !== "null"
        ? String(parsed.alert).trim() : null,
    };
    return json({ narrative });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
