// ai-replied-emails — returns the set of sender emails that the AI auto-reply agent ACTUALLY
// replied to (so the Unibox can badge them "Respondido por IA"). Scoped to the CALLER: it reads
// client_service_log (service-role only) filtered to owner_id = the authenticated user, and only
// counts actions that SENT a reply — never "ignore"/"error" (auto_replied alone is not enough,
// because the agent marks a message auto_replied to CLAIM it before deciding, including the ones
// it ignores). Read-only; a user can only ever see their own agent's activity.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const REPLY_ACTIONS = ["prospect_reply", "reply", "confirm", "send_copys", "send_copys_later", "send_report", "new_campaign", "deliver_copys"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return new Response(JSON.stringify({ emails: [] }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: aerr } = await userClient.auth.getUser();
    if (aerr || !ud?.user) return new Response(JSON.stringify({ emails: [] }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await admin.from("client_service_log")
      .select("from_email")
      .eq("owner_id", ud.user.id)
      .in("action", REPLY_ACTIONS)
      .not("from_email", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000);
    const emails = Array.from(new Set((data || []).map((r: any) => String(r.from_email || "").trim().toLowerCase()).filter(Boolean)));
    return new Response(JSON.stringify({ emails }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ emails: [], error: String((e as Error).message) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
