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

    // Verify access: full admin, OR a limited "client manager" (profiles.is_client_manager)
    // who can ONLY manage clients — not the full admin panel (users list / Stripe / roles).
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();
    const isAdmin = roleData?.role === "admin";
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("is_client_manager")
      .eq("user_id", caller.id)
      .single();
    const isManager = !!callerProfile?.is_client_manager;
    if (!isAdmin && !isManager) throw new Error("Forbidden: admin only");

    const body = await req.json().catch(() => ({}));
    const action = body.action || "list";

    // A client manager is restricted to client CRUD — never the full-admin actions.
    const MANAGER_ACTIONS = new Set(["list_clients", "create_user", "update_client", "delete", "list_client_accounts"]);
    if (!isAdmin && !MANAGER_ACTIONS.has(action)) throw new Error("Forbidden: admin only");

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
      // A client manager may only delete CLIENT accounts (users with allowed_routes) — never
      // an admin or a regular user.
      if (!isAdmin) {
        const { data: tgt } = await supabase.from("profiles").select("allowed_routes").eq("user_id", targetUserId).single();
        if (!tgt?.allowed_routes || (tgt.allowed_routes as string[]).length === 0) throw new Error("Forbidden: managers can only delete clients");
      }

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
      const { email, password, full_name, company_name, allowed_routes, logo_url, brand_color,
        report_enabled, report_from_account_id, report_low_contacts_threshold } = body;
      if (!email || !password) throw new Error("email and password required");

      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });
      if (createErr) throw new Error(`Create user error: ${createErr.message}`);

      // Set the client's profile: access (allowed_routes) + branding + report config.
      if (newUser?.user) {
        const upd: Record<string, unknown> = { client_password: password };
        if (full_name) upd.full_name = full_name;
        if (company_name) upd.company_name = company_name;
        if (allowed_routes && allowed_routes.length > 0) upd.allowed_routes = allowed_routes;
        if (logo_url !== undefined) upd.logo_url = logo_url || null;
        if (brand_color !== undefined) upd.brand_color = brand_color || null;
        if (report_enabled !== undefined) upd.report_enabled = !!report_enabled;
        if (report_from_account_id !== undefined) upd.report_from_account_id = report_from_account_id || null;
        if (report_low_contacts_threshold !== undefined) upd.report_low_contacts_threshold = Number(report_low_contacts_threshold) || 200;
        if (Object.keys(upd).length > 0) {
          await supabase.from("profiles").update(upd).eq("user_id", newUser.user.id);
        }
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser?.user?.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list_clients") {
      const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, company_name, allowed_routes, logo_url, brand_color, client_password, created_at, is_client_manager, report_enabled, report_from_account_id, report_low_contacts_threshold");
      const pMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const clients = (authUsers?.users || [])
        .map((u: any) => {
          const p: any = pMap.get(u.id);
          if (!p || !p.allowed_routes || p.allowed_routes.length === 0) return null;
          if (p.is_client_manager) return null; // a client manager is staff, not a client
          return {
            id: u.id, email: u.email, created_at: u.created_at,
            full_name: p.full_name, company_name: p.company_name,
            allowed_routes: p.allowed_routes, logo_url: p.logo_url, brand_color: p.brand_color,
            client_password: p.client_password,
            report_enabled: !!p.report_enabled,
            report_from_account_id: p.report_from_account_id || null,
            report_low_contacts_threshold: p.report_low_contacts_threshold ?? 200,
          };
        })
        .filter(Boolean);
      return new Response(JSON.stringify({ clients }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_client") {
      const { user_id, allowed_routes, company_name, full_name, logo_url, brand_color, password,
        report_enabled, report_from_account_id, report_low_contacts_threshold } = body;
      if (!user_id) throw new Error("user_id required");
      const upd: Record<string, unknown> = {};
      if (allowed_routes !== undefined) upd.allowed_routes = allowed_routes || null;
      if (company_name !== undefined) upd.company_name = company_name || null;
      if (full_name !== undefined) upd.full_name = full_name || null;
      if (logo_url !== undefined) upd.logo_url = logo_url || null;
      if (brand_color !== undefined) upd.brand_color = brand_color || null;
      if (report_enabled !== undefined) upd.report_enabled = !!report_enabled;
      if (report_from_account_id !== undefined) upd.report_from_account_id = report_from_account_id || null;
      if (report_low_contacts_threshold !== undefined) upd.report_low_contacts_threshold = Number(report_low_contacts_threshold) || 200;
      if (password) upd.client_password = password;
      if (Object.keys(upd).length > 0) {
        const { error } = await supabase.from("profiles").update(upd).eq("user_id", user_id);
        if (error) throw new Error(`Update error: ${error.message}`);
      }
      if (password) {
        const { error } = await supabase.auth.admin.updateUserById(user_id, { password });
        if (error) throw new Error(`Password error: ${error.message}`);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list_client_accounts") {
      // The email accounts a client can send its report FROM. Restricted to actual
      // clients (has allowed_routes), same as the other manager actions.
      const { user_id } = body;
      if (!user_id) throw new Error("user_id required");
      if (!isAdmin) {
        const { data: p } = await supabase.from("profiles").select("allowed_routes").eq("user_id", user_id).single();
        if (!p?.allowed_routes || (p.allowed_routes as string[]).length === 0) throw new Error("Forbidden: not a client");
      }
      const { data: accounts } = await supabase
        .from("email_accounts")
        .select("id, email, status")
        .eq("user_id", user_id)
        .order("email");
      return new Response(JSON.stringify({ accounts: accounts || [] }), {
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
