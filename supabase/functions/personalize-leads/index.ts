import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const { job_id } = await req.json();
    if (!job_id) {
      return new Response(JSON.stringify({ error: "Missing job_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for DB operations
    const db = createClient(supabaseUrl, supabaseServiceKey);

    // Load the job
    const { data: job, error: jobErr } = await db
      .from("personalization_jobs")
      .select("*")
      .eq("id", job_id)
      .eq("user_id", userId)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (job.status !== "pending") {
      return new Response(JSON.stringify({ error: "Job already processed", status: job.status }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check coins
    const totalLeads = (job.lead_ids as string[]).length;
    const cost = Math.ceil(totalLeads * 0.1);
    const { data: profile } = await db.from("profiles").select("coins").eq("user_id", userId).single();
    const currentCoins = profile?.coins ?? 0;

    // Check for infinite coins (special accounts handled client-side, but also check here)
    const { data: profileFull } = await db.from("profiles").select("contact_email").eq("user_id", userId).single();
    const INFINITE_EMAILS = ["oliver@llueert.com", "oliver@pannggostudioo.com", "alex@lluert.net", "rk@coldabry.com", "hello@onepulso.blog", "oliver@osakaadigital.com", "eric@dekano-core.es"];
    const hasInfinite = INFINITE_EMAILS.includes(profileFull?.contact_email || "");

    if (!hasInfinite && currentCoins < cost) {
      await db.from("personalization_jobs").update({ status: "failed" }).eq("id", job_id);
      return new Response(JSON.stringify({ error: "insufficient_coins" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduct coins
    if (!hasInfinite) {
      await db.from("profiles").update({ coins: currentCoins - cost }).eq("user_id", userId);
    }

    // Mark as running
    await db.from("personalization_jobs").update({ status: "running" }).eq("id", job_id);

    // Respond immediately - processing continues in background
    const responsePromise = new Response(
      JSON.stringify({ success: true, job_id, message: "Job started" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

    // Process in background using waitUntil pattern via EdgeRuntime
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      await db.from("personalization_jobs").update({ status: "failed", errors: job.total }).eq("id", job_id);
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load all leads
    const leadIds: string[] = job.lead_ids;
    const selectedFields: string[] = job.selected_fields;
    const prompt = job.prompt;
    const colName = job.column_name;

    // Fetch leads data in batches
    const allLeads: any[] = [];
    const fetchBatchSize = 100;
    for (let i = 0; i < leadIds.length; i += fetchBatchSize) {
      const batch = leadIds.slice(i, i + fetchBatchSize);
      const { data } = await db.from("leads").select("id, email, custom_fields").in("id", batch);
      if (data) allLeads.push(...data);
    }

    // Process in batches of 5
    const batchSize = 5;
    let completed = 0;
    let errors = 0;

    for (let i = 0; i < allLeads.length; i += batchSize) {
      const batch = allLeads.slice(i, i + batchSize);
      const promises = batch.map(async (lead) => {
        const fields = lead.custom_fields || {};
        const leadData: Record<string, string> = { email: lead.email || "" };
        selectedFields.forEach((f: string) => {
          if (fields[f]) leadData[f] = fields[f];
        });

        const context = Object.entries(leadData)
          .map(([key, value]) => `- ${key}: ${value}`)
          .join("\n");

        try {
          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                {
                  role: "system",
                  content: "Genera contenido personalizado basado en la información del lead. Responde SOLO con el texto generado, sin explicaciones, sin comillas, sin prefijos.",
                },
                {
                  role: "user",
                  content: `${prompt}\n\nDatos del lead:\n${context}\n\nResponde SOLO con el texto generado, sin explicaciones.`,
                },
              ],
            }),
          });

          if (!aiResp.ok) {
            errors++;
            return;
          }

          const data = await aiResp.json();
          const generatedText = data.choices?.[0]?.message?.content?.trim() || "";

          if (generatedText) {
            const updatedFields = { ...fields, [colName]: generatedText };
            await db.from("leads").update({ custom_fields: updatedFields }).eq("id", lead.id);
          } else {
            errors++;
          }
        } catch {
          errors++;
        }
      });

      await Promise.all(promises);
      completed += batch.length;

      // Update progress
      await db.from("personalization_jobs").update({
        completed: Math.min(completed, allLeads.length),
        errors,
      }).eq("id", job_id);
    }

    // Mark as done
    await db.from("personalization_jobs").update({
      status: "completed",
      completed: allLeads.length - errors,
      errors,
    }).eq("id", job_id);

    return responsePromise;
  } catch (e) {
    console.error("personalize-leads error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
