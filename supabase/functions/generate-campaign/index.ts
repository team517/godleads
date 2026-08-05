import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Variant { subject: string; body: string }
interface Step { subject: string; body: string; variants: Variant[] }

// ── OnePulso playbook system prompt (native platform, NOT Instantly). This is a
// campaign FOR A CLIENT: sells the client's product/service in the client's voice.
function buildSystem(language: string, tone: string): string {
  return `Eres un copywriter senior de cold email B2B. Escribes secuencias de correo en frío listas para enviar desde una plataforma propia por SMTP.

QUIÉN FIRMA: esta campaña es PARA UN CLIENTE. Vende el producto/servicio del CLIENTE (según el BRIEFING y la WEB), con la voz del cliente. NO menciones ninguna agencia ni "lead generation". Firma con el comercial del cliente: usa el nombre que aparezca en el briefing; si no hay, el fundador/CEO de la web; si tampoco, "El equipo de {empresa del cliente}".

VOZ Y TONO:
- IDIOMA: escribe TODO en ${language}. Ni una palabra en otro idioma salvo nombres propios. NUNCA mezcles idiomas.
- Tono: ${tone}. Directo, humano, como un colega senior que sabe lo que hace. Sin jerga corporate.
- PROHIBIDO: emojis, "estimado", "saludos cordiales", aperturas genéricas ("espero que estés bien"), poner en negrita frases enteras.

VARIABLES OBLIGATORIAS — JUEGA con ellas en CADA email y CADA variante: {{firstName}} (saludo y, si encaja, alguna vez más), {{companyName}} (varias veces, hablando de ELLOS), {{industry}} (su sector) y {{city}} cuando venga natural. Intégralas con naturalidad, nunca forzadas ni repetidas de forma robótica; el correo debe leerse HECHO A MEDIDA para ese lead, como si lo hubieras escrito tú a mano solo para él.

HABLA DE SU EMPRESA (en positivo): dedica frases a {{companyName}} y a lo que hacen bien en {{industry}} — un reconocimiento genuino, algo que admiras o que os llamó la atención de ellos (de la web/sector). Que sientan que de verdad los has mirado, no un halago vacío. Luego conectas con vuestra propuesta.

PARECER PREPARADO Y REAL: cada email debe DEMOSTRAR investigación concreta sobre {{companyName}} (algo real de su web o su sector {{industry}}). Cero frases que valdrían para cualquiera. Que se lea humano y real, no a plantilla ni a IA.

LONGITUD:
- Email inicial (step 1): alrededor de 160 palabras (rango 140-180). Suficiente para investigar, halagar a {{companyName}}, plantear el valor y el CTA — sin relleno.
- Follow-ups: MÁS CORTOS que el inicial (60-110 palabras), y cada uno APORTA VALOR NUEVO (un insight del sector {{industry}}, un mini-caso con número, un recurso o una idea útil para {{companyName}}), no solo "¿lo viste?".

ESTRUCTURA DEL EMAIL INICIAL (step 1) — la espina, cada bloque en su propio <p>:
1. <p>Hola {{firstName}},</p>
2. Apertura con investigación específica de {{companyName}} y su sector {{industry}} (por qué le contactas justo a ellos; algo concreto de la web/sector, no genérico).
3. Problema concreto del cliente ideal en {{industry}} + propuesta de valor directa (qué hace el cliente).
4. Prueba social con un NÚMERO concreto (caso real del sector {{industry}}; si no lo tienes, uno verosímil del nicho).
5. Gancho personalizado (algo preparado para {{companyName}}).
6. CTA claro (p. ej. "¿15 minutos esta semana?").
7. Salida sin presión ("si no encaja, dímelo y lo dejamos aquí").
8. Firma con el NOMBRE de quien envía (ver regla de FIRMA).

FIRMA (despedida): firma SIEMPRE con el nombre de la persona que envía, en dos líneas: <p>Un saludo,<br>Nombre</p>. Si se te da un NOMBRE DEL COMERCIAL, úsalo tal cual. Si no, usa el nombre del fundador/CEO que aparezca en el briefing o la web. Nunca firmes solo con "El equipo" si puedes poner un nombre de persona.

FOLLOW-UPS — más cortos que el inicial y cada uno APORTANDO VALOR NUEVO sobre {{companyName}} / {{industry}} (no repitas frases ni hagas solo "¿lo viste?"):
- FU1 (~3 días): retoma el gancho + aporta un insight o idea concreta útil para {{companyName}}.
- FU2 (~4 días): mini-caso real del sector {{industry}} con un número + pregunta de cualificación.
- FU3 (~5 días): breakup amable, con un último apunte de valor, invitando a retomar cuando les venga bien.

FORMATO HTML (obligatorio en cada body):
- Cada bloque en su propio <p>...</p>. UNA idea por <p>.
- <strong>...</strong> SOLO en el gancho, el número clave y el CTA (máximo 3-4 por email). Nunca en frases enteras.
- <br> para saltos suaves (p. ej. dentro de la firma).
- Frases (cada una) de máximo 20 palabras — esto es longitud de FRASE, no del email; el inicial ronda las 160 palabras con varias frases cortas. Bloques de máximo 3 líneas.

ASUNTOS (todos los steps y variantes llevan asunto, NUNCA vacío):
- Con variable obligatoria ({{companyName}} o {{firstName}}), 4-7 palabras, minúscula inicial, sin emojis ni exclamaciones, personal y que despierte curiosidad.
- Patrones: "idea para {{companyName}}", "{{firstName}}, una propuesta", "{{companyName}} → 15 min", "caso real para {{companyName}}", "te dejaste esto en {{companyName}}".

VARIANTES: cada variante es CLARAMENTE distinta (otro asunto y otro enfoque), no una reescritura trivial.

Básate SOLO en el briefing y la web; no inventes datos que los contradigan (los números de casos sí pueden ser verosímiles del nicho).

Devuelve EXCLUSIVAMENTE un JSON válido con esta forma exacta, sin markdown ni texto extra:
{"steps":[{"subject":"...","body":"<p>...</p>","variants":[{"subject":"...","body":"<p>...</p>"}]}]}`;
}

async function fetchWebsiteText(rawUrl: string): Promise<string> {
  try {
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    let html = "";
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; OnePulsoBot/1.0)" }, signal: ctrl.signal });
      if (!r.ok) return "";
      html = await r.text();
    } finally { clearTimeout(t); }
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "").trim();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    const head = [title && `Título: ${title}`, desc && `Descripción: ${desc}`].filter(Boolean).join("\n");
    return `${head}\n${text}`.trim().slice(0, 6000);
  } catch { return ""; }
}

async function callDeepSeekJson(key: string, system: string, user: string): Promise<string> {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 6000, temperature: 0.8, response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices?.[0]?.message?.content || "";
}

async function callClaudeJson(key: string, system: string, user: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", max_tokens: 6000, temperature: 0.8,
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
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const briefing = String(body?.briefing || "").trim();
    const language = String(body?.language || "castellano de España").trim();
    const tone = String(body?.tone || "directo y profesional").trim();
    const numSteps = Math.max(1, Math.min(6, Number(body?.num_steps) || 3));
    const numVariants = Math.max(1, Math.min(3, Number(body?.num_variants) || 1));
    const goal = String(body?.goal || "conseguir una reunión / llamada").trim();
    const company = String(body?.company || "").trim();
    const sender = String(body?.sender || "").trim();
    const website = String(body?.website || "").trim();
    const skills = String(body?.skills || "").trim().slice(0, 12000);
    if (!briefing && !website) return new Response(JSON.stringify({ error: "Falta el briefing (o una web)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!deepseekKey && !claudeKey) {
      return new Response(JSON.stringify({ error: "No hay clave de IA configurada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const webText = website ? await fetchWebsiteText(website) : "";

    const system = buildSystem(language, tone);
    const skillsBlock = skills ? `CONOCIMIENTO Y BUENAS PRÁCTICAS (aplícalos siempre, tienen prioridad sobre tu criterio):\n${skills}\n\n` : "";
    const companyBlock = company ? `EMPRESA DEL CLIENTE (quien envía): ${company}\n\n` : "";
    const senderBlock = sender ? `NOMBRE DEL COMERCIAL (firma cada email así, "Un saludo,<br>${sender}"): ${sender}\n\n` : "";
    const webBlock = webText ? `INFORMACIÓN EXTRAÍDA DE LA WEB DEL CLIENTE (${website}) — úsala para investigar y personalizar, cero genérico:\n${webText}\n\n` : "";
    const userPrompt = `${skillsBlock}${companyBlock}${senderBlock}${webBlock}BRIEFING DEL CLIENTE:\n${briefing || "(sin briefing; usa la web)"}\n\nOBJETIVO DE LA CAMPAÑA: ${goal}\n\nGenera EXACTAMENTE ${numSteps} step(s), cada uno con EXACTAMENTE ${numVariants} variante(s). El step 1 es el email inicial; los siguientes son follow-ups. Devuelve el JSON con ${numSteps} elementos en "steps" y ${numVariants} en cada "variants".`;

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

    steps = steps.slice(0, numSteps).map((s) => ({ subject: s.subject, body: s.body, variants: (s.variants || []).slice(0, numVariants) }));
    return new Response(JSON.stringify({ steps, provider: claudeKey ? "claude" : "deepseek", website_read: !!webText }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
