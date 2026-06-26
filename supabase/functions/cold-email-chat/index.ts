import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not configured");

    // Try to get user analytics context
    let analyticsContext = "";
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const token = authHeader.replace("Bearer ", "");
        const { data: userData } = await userClient.auth.getUser(token);
        const userId = userData?.user?.id;

        if (userId) {
          const db = createClient(supabaseUrl, serviceKey);

          // Fetch campaigns
          const { data: campaigns } = await db
            .from("campaigns")
            .select("id, name, status, created_at, daily_limit, signature_html")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(20);

          if (campaigns && campaigns.length > 0) {
            const campaignIds = campaigns.map((c: any) => c.id);

            // Fetch sent_emails stats per campaign
            const { data: sentEmails } = await db
              .from("sent_emails")
              .select("campaign_id, status, sent_at, replied_at, bounced_at, opened_at, to_email, subject")
              .eq("user_id", userId)
              .in("campaign_id", campaignIds);

            // Fetch campaign steps for message content
            const { data: steps } = await db
              .from("campaign_steps")
              .select("campaign_id, step_order, subject, body, delay_days")
              .in("campaign_id", campaignIds)
              .order("step_order", { ascending: true });

            // Fetch lead counts per campaign
            const { data: campaignLeads } = await db
              .from("campaign_leads")
              .select("campaign_id, status")
              .in("campaign_id", campaignIds);

            // Build analytics summary
            const campaignSummaries = campaigns.map((c: any) => {
              const emails = (sentEmails || []).filter((e: any) => e.campaign_id === c.id);
              const totalSent = emails.filter((e: any) => e.status === "sent" || e.replied_at || e.opened_at).length;
              const totalReplied = emails.filter((e: any) => e.replied_at).length;
              const totalBounced = emails.filter((e: any) => e.bounced_at).length;
              const totalOpened = emails.filter((e: any) => e.opened_at).length;
              const totalQueued = emails.filter((e: any) => e.status === "queued").length;
              const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : "0";
              const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : "0";
              const bounceRate = totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : "0";

              const cSteps = (steps || []).filter((s: any) => s.campaign_id === c.id);
              const cLeads = (campaignLeads || []).filter((l: any) => l.campaign_id === c.id);

              // Get who replied
              const repliedEmails = emails
                .filter((e: any) => e.replied_at)
                .slice(0, 10)
                .map((e: any) => `${e.to_email} (asunto: "${e.subject}")`)
                .join(", ");

              let summary = `📊 Campaña: "${c.name}" (${c.status})
- Leads asignados: ${cLeads.length}
- Emails enviados: ${totalSent} | En cola: ${totalQueued}
- Abiertos: ${totalOpened} (${openRate}%) | Respondidos: ${totalReplied} (${replyRate}%) | Rebotados: ${totalBounced} (${bounceRate}%)`;

              if (repliedEmails) {
                summary += `\n- Quién respondió: ${repliedEmails}`;
              }

              if (cSteps.length > 0) {
                summary += `\n- Secuencia (${cSteps.length} pasos):`;
                cSteps.forEach((s: any) => {
                  const bodyPreview = (s.body || "").replace(/<[^>]+>/g, "").substring(0, 150);
                  summary += `\n  Paso ${s.step_order}: Asunto="${s.subject}" | Delay=${s.delay_days}d | Mensaje: "${bodyPreview}..."`;
                });
              }

              return summary;
            });

            // Global stats
            const allEmails = sentEmails || [];
            const globalSent = allEmails.filter((e: any) => e.status === "sent" || e.replied_at || e.opened_at).length;
            const globalReplied = allEmails.filter((e: any) => e.replied_at).length;
            const globalBounced = allEmails.filter((e: any) => e.bounced_at).length;
            const globalOpened = allEmails.filter((e: any) => e.opened_at).length;

            analyticsContext = `\n\n--- DATOS REALES DEL USUARIO (úsalos para dar consejos personalizados) ---
📈 RESUMEN GLOBAL:
- Total campañas: ${campaigns.length}
- Total enviados: ${globalSent} | Abiertos: ${globalOpened} (${globalSent > 0 ? ((globalOpened / globalSent) * 100).toFixed(1) : 0}%)
- Respondidos: ${globalReplied} (${globalSent > 0 ? ((globalReplied / globalSent) * 100).toFixed(1) : 0}%) | Rebotados: ${globalBounced} (${globalSent > 0 ? ((globalBounced / globalSent) * 100).toFixed(1) : 0}%)

${campaignSummaries.join("\n\n")}
--- FIN DE DATOS ---

INSTRUCCIONES ADICIONALES SOBRE LOS DATOS:
- Cuando el usuario pregunte sobre sus campañas o métricas, usa estos datos reales para responder
- Si hay campañas con baja tasa de respuesta, sugiere mejoras específicas basándote en el contenido de los emails
- Si hay campañas con alto bounce rate, advierte sobre problemas de deliverability
- Compara el rendimiento entre campañas para identificar qué funciona mejor
- Da recomendaciones concretas basándote en los asuntos y cuerpos que mejor funcionaron`;
          }
        }
      } catch (e) {
        console.error("Error fetching analytics:", e);
        // Continue without analytics - not critical
      }
    }

    const systemPrompt = `Eres GodBot, un consultor de élite en cold email outreach y ventas B2B con +10 años de experiencia cerrando reuniones para startups SaaS, agencias y consultoras.

TU EXPERTISE:
- **Investigación de prospectos**: Sabes cómo hacer que cada email parezca investigado y personalizado (usar LinkedIn, web corporativa, noticias recientes del prospect)
- **Copywriting persuasivo**: Dominas frameworks como AIDA, PAS, BAB y los adaptas a cold email
- **Psicología de ventas**: Entiendes los disparadores mentales (curiosidad, prueba social, urgencia sutil, reciprocidad)
- **Segmentación por nichos**: Conoces las particularidades de cada industria (SaaS, eCommerce, consulting, real estate, fintech, etc.)
- **Deliverability**: DNS (SPF, DKIM, DMARC), warmup, reputación de dominio, ratios seguros
- **Secuencias multicanal**: Email + LinkedIn + calls para maximizar respuestas
- **A/B testing**: Sabes qué variables testear y cómo interpretar resultados estadísticamente significativos
- **Análisis de métricas**: Open rate, reply rate, bounce rate, meeting rate — sabes los benchmarks por industria

OBJETIVO PRINCIPAL: Ayudar al usuario a **conseguir reuniones cualificadas** a través de cold email.

REGLAS DE RESPUESTA:
- Responde siempre en español a menos que el usuario escriba en otro idioma
- Sé **directo, claro y accionable** — nada de rodeos
- Usa formato markdown con headers, bullets, negritas y bloques de código para emails
- Cuando escribas un email, siempre incluye: **Asunto** + **Cuerpo completo** + **Explicación de por qué funciona**
- Da datos concretos: "los asuntos de 3-5 palabras tienen un 21% más de apertura" en vez de "usa asuntos cortos"
- Si el usuario adjunta una imagen/gráfico, analízalo en detalle y da recomendaciones específicas
- Cuando analices campañas del usuario, sé **honesto y directo** — si algo no funciona, dilo claramente con la solución
- Compara siempre con benchmarks de la industria (reply rate B2B SaaS: 3-8%, open rate saludable: 45-65%)
- Estructura tus respuestas con secciones claras usando ## headers
- Tienes acceso a las analíticas reales de las campañas del usuario. Úsalas para personalizar cada consejo.${analyticsContext}`;

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Inténtalo en unos segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("cold-email-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
