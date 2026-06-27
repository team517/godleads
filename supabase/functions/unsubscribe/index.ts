import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
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
async function verifyToken(token: string, secret: string): Promise<{ userId: string; email: string } | null> {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return null;
  const expected = await hmacHex(payload, secret);
  if (expected !== sig) return null;
  let decoded = "";
  try { decoded = b64urlDecode(payload); } catch { return null; }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { userId: decoded.slice(0, idx), email: decoded.slice(idx + 1).toLowerCase() };
}

function page(message: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Baja de correos</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0f;color:#e7e7ea;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{max-width:460px;padding:32px;border:1px solid #26262e;border-radius:16px;background:#14141a;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#a1a1aa;font-size:14px;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${message}</h1><p>No recibirás más correos de esta lista.</p></div></body></html>`;
  return new Response(html, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") || "";
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const parsed = await verifyToken(token, secret);
    if (!parsed) {
      return page("Enlace de baja no válido o caducado");
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secret);
    const { userId, email } = parsed;

    // 1) Global suppression: the campaign queue already skips + completes any lead
    //    whose email/domain is in the blocklist, so this stops ALL future campaigns.
    await admin.from("blocklist").upsert(
      { user_id: userId, entry_type: "email", value: email },
      { onConflict: "user_id,entry_type,value" },
    );

    // 2) Immediate effect on existing leads/sequences for this user.
    const { data: leadRows } = await admin
      .from("leads")
      .select("id")
      .eq("user_id", userId)
      .ilike("email", email);
    const leadIds = (leadRows || []).map((l: any) => l.id);
    if (leadIds.length > 0) {
      await admin.from("leads").update({ status: "unsubscribed" }).in("id", leadIds);
      await admin.from("campaign_leads")
        .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
        .in("lead_id", leadIds);
    }

    // RFC 8058 one-click sends POST — return 200 (no page needed).
    if (req.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return page("Te has dado de baja correctamente");
  } catch (e) {
    console.error("unsubscribe error:", e);
    return page("No se pudo procesar la baja");
  }
});
