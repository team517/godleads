import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { sendSmtpReply, sendSmtpWithAttachments } from "../_shared/smtp.ts";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { buildCopyDoc } from "../_shared/report/buildCopyPdf.ts";
import { ONEPULSO_LOGO_WHITE_DATAURL, ONEPULSO_LOGO_RATIO } from "../_shared/report/onepulsoLogoWhite.ts";

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
    const AGENCY_EMAILS = new Set(["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"]);
    const isManager = !!callerProfile?.is_client_manager || AGENCY_EMAILS.has((caller.email || "").toLowerCase());
    if (!isAdmin && !isManager) throw new Error("Forbidden: admin only");

    const body = await req.json().catch(() => ({}));
    const action = body.action || "list";

    // A client manager is restricted to client CRUD — never the full-admin actions.
    // NOTE: "delete" is deliberately NOT here — only a full admin can delete clients.
    // A client-manager (e.g. support@) can create/edit/list clients + campaigns, not delete.
    const MANAGER_ACTIONS = new Set(["list_clients", "create_user", "update_client", "list_client_accounts", "list_client_reports", "create_client_campaign", "client_campaign_copy", "send_copy"]);
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
        report_enabled, report_from_account_id, report_low_contacts_threshold, report_to_email } = body;
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
        if (report_to_email !== undefined) upd.report_to_email = report_to_email || null;
        if (Object.keys(upd).length > 0) {
          await supabase.from("profiles").update(upd).eq("user_id", newUser.user.id);
        }
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser?.user?.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a full campaign (steps + variants + leads) INSIDE a client's account, as a draft.
    if (action === "create_client_campaign") {
      const { client_user_id, name, options, steps, leads } = body;
      if (!client_user_id) throw new Error("client_user_id requerido");
      // Target must be a real client of this manager (has allowed_routes, not staff).
      const { data: tgt } = await supabase.from("profiles").select("allowed_routes, is_client_manager").eq("user_id", client_user_id).single();
      if (!tgt?.allowed_routes || (tgt.allowed_routes as string[]).length === 0 || tgt.is_client_manager) {
        throw new Error("El destino no es un cliente válido");
      }

      const opt = options || {};
      const { data: camp, error: campErr } = await supabase.from("campaigns").insert({
        user_id: client_user_id,
        name: String(name || "Nueva campaña").slice(0, 200),
        status: "draft",
        stop_on_reply: opt.stop_on_reply !== false,
        first_email_text_only: !!opt.first_email_text_only,
        text_only_emails: !!opt.text_only_emails,
        break_thread_after: Number.isFinite(opt.break_thread_after) ? Math.max(0, Math.floor(opt.break_thread_after)) : 0,
        include_unsubscribe: !!opt.include_unsubscribe,
        ab_test_enabled: Array.isArray(steps) && steps.some((s: any) => Array.isArray(s.variants) && s.variants.length > 0),
      }).select("id").single();
      if (campErr || !camp) throw new Error(`No se pudo crear la campaña: ${campErr?.message}`);
      const campaignId = camp.id;

      // Steps (+ variants + per-step delay). Drop empty steps/variants so nothing
      // broken reaches the campaign.
      const stepRows = (Array.isArray(steps) ? steps : [])
        .filter((s: any) => String(s?.subject || "").trim() && String(s?.body || "").trim())
        .map((s: any, i: number) => ({
          campaign_id: campaignId,
          step_order: i,
          subject: String(s?.subject || "").trim().slice(0, 500),
          body: String(s?.body || ""),
          delay_days: Math.max(0, Math.floor(Number(s?.delay_days) || 0)),
          variants: (Array.isArray(s?.variants) ? s.variants : [])
            .filter((v: any) => String(v?.subject || "").trim() && String(v?.body || "").trim())
            .map((v: any) => ({ subject: String(v?.subject || "").trim().slice(0, 500), body: String(v?.body || "") })),
        }));
      if (stepRows.length === 0) throw new Error("La campaña no tiene ningún mensaje válido");
      const { error: stepErr } = await supabase.from("campaign_steps").insert(stepRows);
      if (stepErr) throw new Error(`No se pudieron crear los steps: ${stepErr.message}`);

      // Leads: dedup by email; the BEFORE INSERT trigger silently skips blocklisted ones.
      let addedLeads = 0;
      const rawLeads = Array.isArray(leads) ? leads : [];
      const seen = new Set<string>();
      const clean = rawLeads
        .map((l: any) => ({ email: String(l?.email || "").trim().toLowerCase(), custom_fields: (l?.custom_fields && typeof l.custom_fields === "object") ? l.custom_fields : {} }))
        .filter((l) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email) && !seen.has(l.email) && seen.add(l.email));

      for (let i = 0; i < clean.length; i += 500) {
        const batch = clean.slice(i, i + 500).map((l) => ({ user_id: client_user_id, email: l.email, custom_fields: l.custom_fields, is_campaign_only: true }));
        const { data: ins } = await supabase.from("leads").insert(batch).select("id");
        const ids = (ins || []).map((d: any) => d.id);
        if (ids.length) {
          await supabase.from("campaign_leads").upsert(
            ids.map((id: string) => ({ campaign_id: campaignId, lead_id: id })),
            { onConflict: "campaign_id,lead_id", ignoreDuplicates: true },
          );
          addedLeads += ids.length;
        }
      }

      return new Response(JSON.stringify({ success: true, campaign_id: campaignId, steps: stepRows.length, leads: addedLeads, leads_submitted: clean.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list_clients") {
      const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, company_name, allowed_routes, logo_url, brand_color, client_password, created_at, is_client_manager, report_enabled, report_from_account_id, report_low_contacts_threshold, report_to_email, ai_reply_enabled, ai_reply_prompt, ai_reply_calendar_url, ai_reply_mode, onboarding_slug, onboarding_status");
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
            report_to_email: p.report_to_email || null,
            ai_reply_enabled: !!p.ai_reply_enabled,
            ai_reply_prompt: p.ai_reply_prompt || "",
            ai_reply_calendar_url: p.ai_reply_calendar_url || "",
            ai_reply_mode: p.ai_reply_mode || "rules",
            onboarding_slug: p.onboarding_slug || "",
            onboarding_status: Array.isArray(p.onboarding_status) ? p.onboarding_status : [],
          };
        })
        .filter(Boolean);
      return new Response(JSON.stringify({ clients }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_client") {
      const { user_id, allowed_routes, company_name, full_name, logo_url, brand_color, password,
        report_enabled, report_from_account_id, report_low_contacts_threshold, report_to_email,
        ai_reply_enabled, ai_reply_prompt, ai_reply_calendar_url, ai_reply_mode,
        onboarding_slug, onboarding_status } = body;
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
      if (report_to_email !== undefined) upd.report_to_email = report_to_email || null;
      if (ai_reply_enabled !== undefined) upd.ai_reply_enabled = !!ai_reply_enabled;
      if (ai_reply_prompt !== undefined) upd.ai_reply_prompt = ai_reply_prompt || null;
      if (ai_reply_calendar_url !== undefined) upd.ai_reply_calendar_url = ai_reply_calendar_url || null;
      if (ai_reply_mode !== undefined) upd.ai_reply_mode = ai_reply_mode || "rules";
      if (onboarding_slug !== undefined) upd.onboarding_slug = (onboarding_slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "") || null;
      if (onboarding_status !== undefined) upd.onboarding_status = Array.isArray(onboarding_status) ? onboarding_status : [];
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

    if (action === "list_client_reports") {
      // Report history for the agency owner, with short-lived signed URLs to the PDFs
      // (the bucket is private; only the service role can mint these).
      const { user_id } = body;
      if (!user_id) throw new Error("user_id required");
      const { data: rows } = await supabase
        .from("client_reports")
        .select("id, kind, period_label, pdf_path, sent_to, sent_ok, error, created_at, message")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(30);
      const reports = await Promise.all((rows || []).map(async (r: any) => {
        let url: string | null = null;
        if (r.pdf_path) {
          const { data: s } = await supabase.storage.from("client-reports").createSignedUrl(r.pdf_path, 3600);
          url = s?.signedUrl || null;
        }
        return { ...r, url };
      }));
      return new Response(JSON.stringify({ reports }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "client_campaign_copy") {
      // All campaign COPY (subject + body of every step + variant) for a client, so the
      // owner can export a clean PDF to hand over. Plus one real lead's fields (data used)
      // and, if present, a personalized message (long text in custom_fields).
      const { user_id } = body;
      if (!user_id) throw new Error("user_id required");
      const { data: camps } = await supabase
        .from("campaigns")
        .select("id, name, status, created_at")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false });
      const campaigns: any[] = [];
      for (const c of camps || []) {
        const { data: steps } = await supabase
          .from("campaign_steps")
          .select("step_order, subject, body, variants, delay_days")
          .eq("campaign_id", c.id)
          .order("step_order", { ascending: true });
        campaigns.push({ id: c.id, name: c.name, status: c.status, steps: steps || [] });
      }
      // Pick a sample lead — prefer one whose custom_fields hold a long text (a
      // personalized message) so the example shows real, filled-in copy.
      let sampleLead: any = null;
      const { data: leadRows } = await supabase
        .from("leads")
        .select("email, custom_fields")
        .eq("user_id", user_id)
        .not("custom_fields", "is", null)
        .limit(30);
      for (const l of leadRows || []) {
        const cf = l.custom_fields || {};
        if (!sampleLead) sampleLead = l;
        const hasLongText = Object.values(cf).some((v: any) => typeof v === "string" && v.length > 120);
        if (hasLongText) { sampleLead = l; break; }
      }
      // Effective sender for the Copy section: equipo@onepulso.online when that mailbox is
      // connected with SMTP; otherwise the client-facing support@ mailbox. Surfaced so the UI
      // can show "Se envía desde …" at the top (and flips to equipo@ the day it gets connected).
      const { data: sndRows } = await supabase.from("email_accounts")
        .select("email").in("email", ["equipo@onepulso.online", "support@onepulso.online"])
        .not("smtp_host", "is", null).eq("status", "connected");
      const senderEmails = (sndRows || []).map((r: any) => r.email);
      const sender_email = senderEmails.includes("equipo@onepulso.online") ? "equipo@onepulso.online"
        : (senderEmails[0] || "support@onepulso.online");
      return new Response(JSON.stringify({ campaigns, sampleLead, sender_email }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "send_copy") {
      // Email a client the COPY of their campaigns as a branded PDF ATTACHMENT (Copy section).
      // test:true sends to the CALLER's own email with a [PRUEBA] subject — never the client.
      const { user_id, campaign_ids, to_email, note, test } = body;
      if (!user_id) throw new Error("user_id required");
      const { data: clientUser } = await supabase.auth.admin.getUserById(user_id);
      const clientEmail = test
        ? ((to_email || caller.email || "").trim())
        : ((to_email || clientUser?.user?.email || "").trim());
      if (!clientEmail || !clientEmail.includes("@")) throw new Error("destino sin email válido");
      const { data: prof } = await supabase.from("profiles").select("company_name, full_name").eq("user_id", user_id).single();
      const clientName = prof?.company_name || prof?.full_name || (clientUser?.user?.email || "cliente").split("@")[0];

      let q = supabase.from("campaigns").select("id, name, status").eq("user_id", user_id).order("created_at", { ascending: false });
      if (Array.isArray(campaign_ids) && campaign_ids.length > 0) q = q.in("id", campaign_ids);
      const { data: camps } = await q;
      if (!camps || camps.length === 0) throw new Error("el cliente no tiene campañas que enviar");

      // Build the branded PDF (same generator the reports/portal already use).
      const pdfCampaigns: any[] = [];
      for (const c of camps) {
        const { data: steps } = await supabase.from("campaign_steps")
          .select("step_order, subject, body, variants, delay_days")
          .eq("campaign_id", c.id).order("step_order", { ascending: true });
        pdfCampaigns.push({ name: c.name, status: c.status, steps: steps || [] });
      }
      const doc = buildCopyDoc(jsPDF, {
        clientName,
        generatedAtLabel: new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }),
        campaigns: pdfCampaigns, sampleLead: null,
        agencyLogoDataUrl: ONEPULSO_LOGO_WHITE_DATAURL, agencyLogoRatio: ONEPULSO_LOGO_RATIO,
      });
      const pdfBytes = new Uint8Array(doc.output("arraybuffer"));
      let pdfBin = ""; const CH = 0x8000;
      for (let i = 0; i < pdfBytes.length; i += CH) pdfBin += String.fromCharCode.apply(null, Array.from(pdfBytes.subarray(i, i + CH)) as any);
      const pdfBase64 = btoa(pdfBin);
      const safeName = String(clientName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cliente";

      // Sender: PREFER equipo@onepulso.online when that mailbox exists; else support@. Gmail
      // DROPS a spoofed From (verified live), so we always send as the real mailbox address.
      let acctQ = supabase.from("email_accounts").select("email, smtp_host, smtp_port, smtp_username, smtp_password");
      acctQ = body.from_account_id
        ? acctQ.eq("id", body.from_account_id)
        : acctQ.in("email", ["equipo@onepulso.online", "support@onepulso.online"]).not("smtp_host", "is", null).eq("status", "connected");
      const { data: senders } = await acctQ.limit(5);
      const acct = (senders || []).find((a: any) => a.email === "equipo@onepulso.online") || (senders || [])[0];
      if (!acct?.smtp_host) throw new Error("no se encontró un buzón remitente conectado (equipo@ / support@)");

      const baseSubject = camps.length === 1 ? ("Copy de tu campaña: " + camps[0].name) : "Copy de tus campañas";
      const subject = (test ? "[PRUEBA] " : "") + baseSubject;
      const noteTxt = note ? String(note).trim() + "\n\n" : "";
      const bodyTxt = "Hola " + clientName + ",\n\n" + noteTxt
        + "Te adjuntamos en PDF el copy de " + (camps.length === 1 ? "tu campaña «" + camps[0].name + "»" : "tus " + camps.length + " campañas") + "."
        + "\n\nLas {{variables}} se rellenan automáticamente con los datos de cada contacto."
        + "\n\n¿Quieres cambiar algo del copy? Responde a este correo y lo ajustamos."
        + "\n\n— Equipo OnePulso";
      const result = await sendSmtpWithAttachments({
        host: acct.smtp_host, port: acct.smtp_port, username: acct.smtp_username, password: acct.smtp_password,
        from: acct.email, fromName: "Equipo OnePulso", to: clientEmail, subject, body: bodyTxt,
        attachments: [{ filename: "copy-" + safeName + ".pdf", mime: "application/pdf", base64: pdfBase64 }],
      });
      if (!result.ok) throw new Error("SMTP: " + (result.error || "fallo de envío"));
      return new Response(JSON.stringify({ ok: true, sent_to: clientEmail, sent_from: acct.email, campaigns: camps.length, test: !!test, pdf_kb: Math.round(pdfBytes.length / 1024) }), {
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
