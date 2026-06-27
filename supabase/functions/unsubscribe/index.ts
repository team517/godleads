import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Where the React app is hosted (it can render HTML — edge functions on *.supabase.co
// are forced to text/plain + nosniff by the platform, so they cannot show a real page).
const APP_URL = "https://backend-onepulso-platfomr.25kofp.easypanel.host";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Verify against ANY of the candidate secrets. We accept both our dedicated
// UNSUB_SECRET (stable, never rotates) and the service-role key (for tokens that
// were signed with it / in case Lovable reverts the signer). Either match = valid.
async function verifyToken(token: string, secrets: string[]): Promise<{ userId: string; email: string } | null> {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return null;
  let matched = false;
  for (const secret of secrets) {
    if (!secret) continue;
    if ((await hmacHex(payload, secret)) === sig) { matched = true; break; }
  }
  if (!matched) return null;
  let decoded = "";
  try { decoded = b64urlDecode(payload); } catch { return null; }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { userId: decoded.slice(0, idx), email: decoded.slice(idx + 1).toLowerCase() };
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  let token = url.searchParams.get("t") || "";
  let action = url.searchParams.get("action") || "unsubscribe";

  // Human click (GET) → bounce to the app's /unsubscribe page, which renders the
  // "Te has dado de baja" screen + the undo button. The page then POSTs back here.
  if (req.method === "GET") {
    const dest = `${APP_URL}/unsubscribe?t=${encodeURIComponent(token)}`;
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: dest } });
  }

  // POST → perform the action. Called by the app page, or by Gmail/Yahoo one-click
  // (RFC 8058 List-Unsubscribe-Post, where the token rides in the query string).
  try {
    const body = await req.json().catch(() => ({}));
    token = (body as any)?.token || token;
    action = (body as any)?.action || action;

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const unsubSecret = Deno.env.get("UNSUB_SECRET") || "";
    const parsed = await verifyToken(token, [unsubSecret, serviceKey]);
    if (!parsed) return json({ ok: false, error: "invalid_token" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const { userId, email } = parsed;

    // ── UNDO: re-subscribe. Removes the suppression and restores the leads. Nothing was deleted. ──
    if (action === "resubscribe") {
      await admin.from("blocklist")
        .delete().eq("user_id", userId).eq("entry_type", "email").eq("value", email);
      const { data: leadRows } = await admin
        .from("leads").select("id").eq("user_id", userId).ilike("email", email);
      const leadIds = (leadRows || []).map((l: any) => l.id);
      if (leadIds.length > 0) {
        await admin.from("leads").update({ status: "active" }).in("id", leadIds).eq("status", "unsubscribed");
        await admin.from("campaign_leads")
          .update({ status: "pending", unsubscribed_at: null })
          .in("lead_id", leadIds).eq("status", "unsubscribed");
      }
      return json({ ok: true, status: "subscribed", email });
    }

    // ── Default: unsubscribe. The lead is KEPT in the DB, only suppressed. ──
    await admin.from("blocklist").upsert(
      { user_id: userId, entry_type: "email", value: email },
      { onConflict: "user_id,entry_type,value" },
    );
    const { data: leadRows } = await admin
      .from("leads").select("id").eq("user_id", userId).ilike("email", email);
    const leadIds = (leadRows || []).map((l: any) => l.id);
    if (leadIds.length > 0) {
      await admin.from("leads").update({ status: "unsubscribed" }).in("id", leadIds);
      await admin.from("campaign_leads")
        .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
        .in("lead_id", leadIds);
    }
    return json({ ok: true, status: "unsubscribed", email });
  } catch (e) {
    console.error("unsubscribe error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
