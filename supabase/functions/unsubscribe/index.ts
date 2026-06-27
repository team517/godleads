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

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Shell page. `state` controls the icon/title/copy and whether the action button shows.
function page(state: "done" | "resubscribed" | "error", email: string, token: string): Response {
  const safeEmail = esc(email);
  const safeToken = encodeURIComponent(token);

  const blocks: Record<string, { icon: string; color: string; title: string; body: string; button: string }> = {
    done: {
      icon: "✓", color: "#22c55e",
      title: "Te has dado de baja",
      body: email
        ? `No volverás a recibir correos en <b style="color:#e7e7ea">${safeEmail}</b>.`
        : "No volverás a recibir más correos de esta lista.",
      // Undo button → resubscribe with the SAME signed token.
      button: token
        ? `<a class="btn" href="?t=${safeToken}&amp;action=resubscribe">No, quiero seguir recibiendo correos</a>
           <p class="hint">¿Te diste de baja sin querer? Pulsa el botón para deshacerlo.</p>`
        : "",
    },
    resubscribed: {
      icon: "↩", color: "#6366f1",
      title: "Suscripción restaurada",
      body: "Perfecto, seguirás recibiendo nuestros correos. ¡Gracias!",
      button: "",
    },
    error: {
      icon: "!", color: "#f59e0b",
      title: "Enlace no válido o caducado",
      body: "No hemos podido procesar tu solicitud. El enlace puede estar incompleto.",
      button: "",
    },
  };
  const b = blocks[state];

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Baja de correos</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0f;color:#e7e7ea;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
.card{max-width:460px;width:100%;padding:36px 32px;border:1px solid #26262e;border-radius:18px;background:#14141a;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.4)}
.ic{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:30px;font-weight:700}
h1{font-size:21px;margin:0 0 10px;font-weight:700}
p{color:#a1a1aa;font-size:14px;line-height:1.55;margin:0}
.btn{display:inline-block;margin-top:24px;padding:12px 18px;border:1px solid #3a3a44;border-radius:11px;
background:#1c1c24;color:#e7e7ea;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;transition:background .15s}
.btn:hover{background:#26262e}
.hint{margin-top:12px;font-size:11px;color:#71717a}
</style></head>
<body><div class="card">
<div class="ic" style="background:${b.color}1a;color:${b.color}">${b.icon}</div>
<h1>${b.title}</h1>
<p>${b.body}</p>
${b.button}
</div></body></html>`;
  return new Response(html, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") || "";
    const action = url.searchParams.get("action") || "unsubscribe";
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const parsed = await verifyToken(token, secret);
    if (!parsed) {
      return page("error", "", "");
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secret);
    const { userId, email } = parsed;

    // ── UNDO: re-subscribe. Removes the suppression and restores the leads. Nothing was deleted. ──
    if (action === "resubscribe") {
      await admin.from("blocklist")
        .delete()
        .eq("user_id", userId).eq("entry_type", "email").eq("value", email);

      const { data: leadRows } = await admin
        .from("leads").select("id").eq("user_id", userId).ilike("email", email);
      const leadIds = (leadRows || []).map((l: any) => l.id);
      if (leadIds.length > 0) {
        await admin.from("leads").update({ status: "active" }).in("id", leadIds).eq("status", "unsubscribed");
        await admin.from("campaign_leads")
          .update({ status: "pending", unsubscribed_at: null })
          .in("lead_id", leadIds).eq("status", "unsubscribed");
      }
      if (req.method === "POST") {
        return new Response(JSON.stringify({ ok: true, status: "subscribed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return page("resubscribed", email, token);
    }

    // ── Default: unsubscribe (the lead is kept, only suppressed) ──
    // 1) Global suppression: the campaign queue already skips + completes any lead
    //    whose email/domain is in the blocklist, so this stops ALL future campaigns.
    await admin.from("blocklist").upsert(
      { user_id: userId, entry_type: "email", value: email },
      { onConflict: "user_id,entry_type,value" },
    );

    // 2) Immediate effect on existing leads/sequences for this user (kept in the DB).
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
    return page("done", email, token);
  } catch (e) {
    console.error("unsubscribe error:", e);
    return page("error", "", "");
  }
});
