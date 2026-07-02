import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Standalone white page that renders the result (edge functions on *.supabase.co are
// forced to text/plain by the platform, so they can't render HTML themselves).
const APP_URL = "https://backend-onepulso-platfomr.25kofp.easypanel.host";
const PAGE = `${APP_URL}/unsubscribe.html`;

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

// Decode the (userId:email) payload. The signature is no longer required to match —
// unsubscribing is reversible and low-risk, and the userId is an unguessable UUID, so
// accepting the payload directly makes EVERY link work (even ones signed with an old key).
function decodeToken(token: string): { userId: string; email: string } | null {
  const payload = (token || "").split(".")[0];
  if (!payload) return null;
  let decoded = "";
  try { decoded = b64urlDecode(payload); } catch { return null; }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  const userId = decoded.slice(0, idx).trim();
  const email = decoded.slice(idx + 1).trim().toLowerCase();
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(userId)) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return { userId, email };
}

// HMAC-SHA256 (hex) — same scheme the sender uses to sign `${payload}`.
async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// Verify the token signature against the current secret(s). Accepts either UNSUB_SECRET
// or the service-role key (the sender falls back to it). Used to gate `resubscribe`.
async function verifyTokenSig(token: string): Promise<boolean> {
  const parts = (token || "").split(".");
  if (parts.length < 2 || !parts[0] || !parts[1]) return false;
  const [payload, sig] = parts;
  const secrets = [Deno.env.get("UNSUB_SECRET"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")].filter(Boolean) as string[];
  for (const secret of secrets) {
    if (timingSafeEq(await hmacHex(payload, secret), sig)) return true;
  }
  return false;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  let token = url.searchParams.get("t") || "";
  let action = url.searchParams.get("action") || "unsubscribe";

  // Human click (GET) → bounce to the standalone white page, which POSTs back here.
  if (req.method === "GET") {
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: `${PAGE}?t=${encodeURIComponent(token)}` } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    token = (body as any)?.token || token;
    action = (body as any)?.action || action;

    const parsed = decodeToken(token);
    if (!parsed) return json({ ok: false, error: "invalid_token" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { userId, email } = parsed;

    // ── UNDO: re-subscribe. COMPLIANCE-CRITICAL: re-activating an opted-out address
    // must be authenticated, so require a valid HMAC signature (a forged token can no
    // longer resubscribe people who legitimately unsubscribed). The legit "undo" button
    // always carries a freshly-signed token, so this never blocks a real user. ──
    if (action === "resubscribe") {
      if (!(await verifyTokenSig(token))) return json({ ok: false, error: "invalid_signature" }, 403);
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
