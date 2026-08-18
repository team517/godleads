// google-forms-list — lists the connected owner's Google Forms so they can pick one in
// the Automatización module. The Forms API has no "list" endpoint, so we list Form files
// via the Drive API. Read-only. Isolated from the sending engine.
//
// Auth: requires the caller's Supabase JWT (the logged-in owner). We load THAT owner's
// stored Google refresh token (service role), mint a fresh access token, and query Drive.
// Tokens never leave the server.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function freshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json().catch(() => ({}));
  return res.ok ? (j.access_token ?? null) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "missing auth" }, 401);

    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: { user }, error: authErr } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: conn } = await admin
      .from("google_connections")
      .select("refresh_token, google_email")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!conn?.refresh_token) return json({ connected: false, forms: [] });

    const at = await freshAccessToken(conn.refresh_token);
    if (!at) return json({ connected: false, forms: [], error: "token_refresh_failed" });

    const q = encodeURIComponent("mimeType='application/vnd.google-apps.form' and trashed=false");
    const fields = encodeURIComponent("files(id,name,modifiedTime,webViewLink)");
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&orderBy=modifiedTime desc`,
      { headers: { Authorization: `Bearer ${at}` } },
    );
    const drive = await driveRes.json().catch(() => ({}));
    if (!driveRes.ok) return json({ connected: true, forms: [], error: drive?.error?.message || "drive_error" });

    const forms = (drive.files || []).map((f: any) => ({
      id: f.id,
      name: f.name || "(sin título)",
      url: f.webViewLink || `https://docs.google.com/forms/d/${f.id}/edit`,
      modifiedTime: f.modifiedTime || null,
    }));
    return json({ connected: true, email: conn.google_email || "", forms });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
