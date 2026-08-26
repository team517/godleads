// automation-view — serves the Automatización module's data (the support@ mailbox activity, the
// agent's service log, and pending new-campaign requests) to AUTHORIZED users so a delegate account
// (equipo@onepulso.online) sees/manages the SAME automation as the owner, WITHOUT owning the
// mailbox. All data is the automation owner's (b94a0bdf / support@ mailbox), read with the service
// role. Access is limited to the owner login + equipo@ — nobody else.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const OWNER = "b94a0bdf-0120-44cd-8c7d-51126bfc2075";           // the automation owner (runs the agent)
const SUPPORT_ACCOUNT = "7b97ced3-007b-44b4-846b-49dfb78d8454"; // support@onepulso.online mailbox
const ALLOWED = ["hello@onepulso.blog", "equipo@onepulso.online"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Authorize: the caller's JWT must belong to the owner or equipo@.
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: aerr } = await userClient.auth.getUser();
    const email = String(ud?.user?.email || "").toLowerCase();
    if (aerr || !ud?.user || !ALLOWED.includes(email)) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({} as any));
    const action = body.action || "load";

    if (action === "load") {
      const [inbox, service, pending] = await Promise.all([
        admin.from("inbox_messages").select("id, from_email, from_name, subject, body_text, body_html, received_at, auto_replied").eq("account_id", SUPPORT_ACCOUNT).eq("is_sent", false).eq("is_warmup", false).order("received_at", { ascending: false }).limit(40),
        admin.from("client_service_log").select("from_email, action, reply, created_at").eq("owner_id", OWNER).order("created_at", { ascending: false }).limit(25),
        admin.from("new_campaign_requests").select("*").eq("owner_id", OWNER).in("status", ["awaiting_form", "pending_approval"]).order("requested_at", { ascending: false }).limit(50),
      ]);
      return new Response(JSON.stringify({ inbox: inbox.data || [], service: service.data || [], pending: pending.data || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "campaign_steps") {
      // The generated campaign's steps (for the review popup / copys PDF). Verify the campaign
      // belongs to one of the owner's new-campaign requests before returning it.
      const { data: reqRow } = await admin.from("new_campaign_requests").select("id").eq("campaign_id", String(body.campaign_id)).eq("owner_id", OWNER).limit(1);
      if (!reqRow || !(reqRow as any[]).length) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: steps } = await admin.from("campaign_steps").select("step_order, subject, body, variants, delay_days").eq("campaign_id", String(body.campaign_id)).order("step_order", { ascending: true });
      return new Response(JSON.stringify({ steps: steps || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "approve") {
      if (!body.req_id) return new Response(JSON.stringify({ error: "req_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { error } = await admin.from("new_campaign_requests").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", String(body.req_id)).eq("owner_id", OWNER);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // The account to SEND from for automation actions (copys/intro emails) — the owner's support@,
    // else team@. Lets equipo@ run the flow without owning a mailbox.
    if (action === "send_account") {
      const { data: accts } = await admin.from("email_accounts").select("id, email").eq("user_id", OWNER).eq("status", "connected");
      const acc = (accts || []).find((a: any) => /support@onepulso/i.test(a.email)) || (accts || []).find((a: any) => /team@onepulso/i.test(a.email)) || (accts || [])[0];
      return new Response(JSON.stringify({ account_id: acc?.id || null, email: acc?.email || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
