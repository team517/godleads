import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Auth error: ${userError.message}`);
    const caller = userData.user;
    if (!caller) throw new Error("Not authenticated");

    // Verify admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();
    if (roleData?.role !== "admin") throw new Error("Forbidden: admin only");

    const body = await req.json().catch(() => ({}));
    const action = body.action || "list";

    if (action === "list") {
      // Get all users from auth
      const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (authErr) throw new Error(`List users error: ${authErr.message}`);

      // Get all profiles
      const { data: profiles } = await supabase.from("profiles").select("*");
      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

      // Get all roles
      const { data: roles } = await supabase.from("user_roles").select("*");
      const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));

      // Get lead counts per user
      const { data: leadCounts } = await supabase.rpc("admin_lead_counts") as any;
      const leadCountMap = new Map((leadCounts || []).map((lc: any) => [lc.user_id, lc.count]));

      // Get account counts per user  
      const { data: accountCounts } = await supabase.rpc("admin_account_counts") as any;
      const accountCountMap = new Map((accountCounts || []).map((ac: any) => [ac.user_id, ac.count]));

      // Check Stripe subscriptions for all users
      const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" });
      
      // Emails to always hide from admin panel
      const HIDDEN_EMAILS = ["oliver@llueert.com", "oliver@pannggostudioo.com", "alex@lluert.net", "hello@onepulso.blog", "rk@coldabry.com", "oliver@osakaadigital.com", "eric@dekano-core.es", "oliver@clackstudio-creative.com", "oliver@warnier-base.com", "info@kidekom.com"];

      const users = await Promise.all(authUsers.users.map(async (u: any) => {
        const profile = profileMap.get(u.id) || {};
        const role = roleMap.get(u.id) || "client";
        const trialStartedAt = profile.trial_started_at || null;

        // Hide by email or by allowed_routes
        if (HIDDEN_EMAILS.includes(u.email?.toLowerCase())) return null;
        if (profile.allowed_routes && profile.allowed_routes.length > 0) return null;
        
        let stripeStatus: any = { subscribed: false, product_id: null, subscription_end: null };
        
        try {
          if (u.email) {
            const customers = await stripe.customers.list({ email: u.email, limit: 1 });
            if (customers.data.length > 0) {
              const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
              if (subs.data.length > 0) {
                const sub = subs.data[0];
                stripeStatus = {
                  subscribed: true,
                  product_id: sub.items.data[0].price.product,
                  subscription_end: new Date(sub.current_period_end * 1000).toISOString(),
                };
              }
            }
          }
        } catch (e) {
          // Skip Stripe errors per user
        }

        return {
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          full_name: profile.full_name || null,
          company_name: profile.company_name || null,
          role,
          trial_started_at: trialStartedAt,
          leads_count: leadCountMap.get(u.id) || 0,
          accounts_count: accountCountMap.get(u.id) || 0,
          stripe: stripeStatus,
        };
      }));

      const filteredUsers = users.filter(Boolean);

      return new Response(JSON.stringify({ users: filteredUsers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const targetUserId = body.user_id;
      if (!targetUserId) throw new Error("user_id required");
      if (targetUserId === caller.id) throw new Error("Cannot delete yourself");
      
      const { error: delErr } = await supabase.auth.admin.deleteUser(targetUserId);
      if (delErr) throw new Error(`Delete error: ${delErr.message}`);
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_role") {
      const targetUserId = body.user_id;
      const newRole = body.role;
      if (!targetUserId || !newRole) throw new Error("user_id and role required");
      if (!["admin", "client"].includes(newRole)) throw new Error("Invalid role");
      if (targetUserId === caller.id) throw new Error("Cannot change your own role");

      const { error: upsertErr } = await supabase
        .from("user_roles")
        .update({ role: newRole })
        .eq("user_id", targetUserId);
      if (upsertErr) throw new Error(`Role update error: ${upsertErr.message}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create_user") {
      const { email, password, full_name, allowed_routes } = body;
      if (!email || !password) throw new Error("email and password required");

      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });
      if (createErr) throw new Error(`Create user error: ${createErr.message}`);

      // Set allowed_routes if provided
      if (allowed_routes && allowed_routes.length > 0 && newUser?.user) {
        await supabase
          .from("profiles")
          .update({ allowed_routes })
          .eq("user_id", newUser.user.id);
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser?.user?.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_allowed_routes") {
      const { user_id, allowed_routes } = body;
      if (!user_id) throw new Error("user_id required");

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ allowed_routes: allowed_routes || null })
        .eq("user_id", user_id);
      if (updateErr) throw new Error(`Update error: ${updateErr.message}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: msg.includes("Forbidden") ? 403 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
