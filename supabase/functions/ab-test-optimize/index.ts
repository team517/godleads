import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No auth");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { campaign_id, step_id, action } = await req.json();
    if (!campaign_id || !step_id) throw new Error("campaign_id and step_id required");

    // Get step data
    const { data: step } = await adminClient
      .from("campaign_steps")
      .select("*")
      .eq("id", step_id)
      .single();
    if (!step) throw new Error("Step not found");

    // Verify ownership
    const { data: campaign } = await adminClient
      .from("campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("user_id", user.id)
      .single();
    if (!campaign) throw new Error("Campaign not found");

    // Get performance stats per variant
    const { data: sentEmails } = await adminClient
      .from("sent_emails")
      .select("variant_index, status, replied_at")
      .eq("campaign_id", campaign_id)
      .eq("campaign_step_id", step_id);

    const emails = sentEmails || [];
    const variants: any[] = step.variants || [];
    const allVariants = [
      { subject: step.subject, body: step.body },
      ...variants.map((v: any) => ({ subject: v.subject || step.subject, body: v.body || step.body })),
    ];

    // Build performance stats
    const variantStats = allVariants.map((v, i) => {
      const varEmails = emails.filter(e => (e.variant_index || 0) === i);
      const sent = varEmails.filter(e => e.status === "sent").length;
      const replied = varEmails.filter(e => e.replied_at).length;
      const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : "0.0";
      return {
        index: i,
        label: String.fromCharCode(65 + i),
        subject: v.subject,
        body: v.body,
        sent,
        replied,
        replyRate: parseFloat(replyRate as string),
      };
    });

    // Action: get_stats — just return analytics
    if (action === "get_stats") {
      return new Response(JSON.stringify({ variantStats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: remove_worst — delete the worst performing variant
    if (action === "remove_worst") {
      const withData = variantStats.filter(v => v.sent >= 3); // Need at least 3 sends
      if (withData.length < 2) {
        return new Response(JSON.stringify({ error: "Se necesitan al menos 2 variantes con 3+ envíos para comparar" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const worst = withData.reduce((a, b) => a.replyRate < b.replyRate ? a : b);
      if (worst.index === 0) {
        // Worst is the main (A) — replace it with the best variant
        const best = withData.reduce((a, b) => a.replyRate > b.replyRate ? a : b);
        if (best.index > 0) {
          const bestVariant = variants[best.index - 1];
          const newVariants = variants.filter((_, i) => i !== best.index - 1);
          await adminClient.from("campaign_steps").update({
            subject: bestVariant.subject || step.subject,
            body: bestVariant.body || step.body,
            variants: newVariants as any,
          }).eq("id", step_id);
        }
      } else {
        // Remove from variants array
        const newVariants = variants.filter((_, i) => i !== worst.index - 1);
        await adminClient.from("campaign_steps").update({ variants: newVariants as any }).eq("id", step_id);
      }
      return new Response(JSON.stringify({
        success: true,
        removed: worst.label,
        message: `Variante ${worst.label} eliminada (${worst.replyRate}% reply rate, ${worst.sent} enviados)`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: optimize — use AI to generate improved variants
    if (action === "optimize") {
      const currentCount = allVariants.length;
      if (currentCount >= 5) {
        return new Response(JSON.stringify({ error: "Ya tienes el máximo de 5 variantes" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get dynamic variables from leads
      const { data: campaignLeads } = await adminClient
        .from("campaign_leads")
        .select("leads(email, custom_fields)")
        .eq("campaign_id", campaign_id)
        .limit(5);

      const fieldKeys = new Set<string>(["email"]);
      (campaignLeads || []).forEach((cl: any) => {
        const fields = cl.leads?.custom_fields;
        if (fields && typeof fields === "object") {
          Object.keys(fields).forEach(k => fieldKeys.add(k));
        }
      });
      const availableVars = Array.from(fieldKeys).map(k => `{{${k}}}`);

      const variantsToGenerate = Math.min(5 - currentCount, 2); // Generate 1-2 at a time

      const performanceContext = variantStats.map(v =>
        `Variante ${v.label}: Subject="${v.subject}" | Body="${v.body.slice(0, 200)}" | Enviados=${v.sent} | Replies=${v.replied} | Reply Rate=${v.replyRate}%`
      ).join("\n");

      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

      const systemPrompt = `Eres un experto en cold email outreach y A/B testing. Tu trabajo es analizar el rendimiento de las variantes actuales de una campaña de email y crear nuevas variantes mejoradas que aumenten la tasa de respuesta.

REGLAS CRÍTICAS:
1. Usa EXACTAMENTE las mismas variables disponibles: ${availableVars.join(", ")}
2. NO inventes variables nuevas
3. Mantén un tono profesional pero cercano
4. Cada variante debe tener subject Y body diferentes
5. Analiza qué funciona mejor de las variantes con más replies y potencia esas características
6. Si hay variantes sin replies, evita su estilo
7. El body debe ser conciso (3-5 líneas máximo)
8. NO uses HTML, solo texto plano
9. Genera exactamente ${variantsToGenerate} variante(s) nueva(s)`;

      const userPrompt = `RENDIMIENTO ACTUAL DE VARIANTES:
${performanceContext}

VARIABLES DISPONIBLES: ${availableVars.join(", ")}

Genera ${variantsToGenerate} nueva(s) variante(s) mejorada(s) basándote en el análisis de rendimiento. Responde SOLO con un JSON array con objetos {subject, body}. Sin explicaciones adicionales.`;

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
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados. Añade créditos en Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Inténtalo de nuevo en unos segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!aiResp.ok) {
        const errText = await aiResp.text();
        console.error("AI error:", aiResp.status, errText);
        throw new Error("Error de IA");
      }

      const aiData = await aiResp.json();
      const content = aiData.choices?.[0]?.message?.content || "";

      // Parse JSON from response
      let newVariants: { subject: string; body: string }[] = [];
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          newVariants = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error("Failed to parse AI response:", content);
        throw new Error("No se pudo parsear la respuesta de IA");
      }

      if (!newVariants.length) throw new Error("IA no generó variantes");

      // Add new variants to step
      const updatedVariants = [...variants, ...newVariants.slice(0, variantsToGenerate)];
      await adminClient.from("campaign_steps").update({
        variants: updatedVariants as any,
      }).eq("id", step_id);

      return new Response(JSON.stringify({
        success: true,
        added: newVariants.length,
        variants: newVariants,
        totalVariants: 1 + updatedVariants.length,
        analysis: variantStats,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("ab-test-optimize error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
