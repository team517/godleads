// Web Push sender — RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID).
//
// The previous version posted the payload UNENCRYPTED and with no VAPID header, with a comment
// admitting it ("without encryption for now"). Every push service rejects that (401/400), so no
// notification ever arrived. This implements the real thing with WebCrypto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptPayload, vapidJwt } from "../_shared/webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Server-to-server only: with the anon key anyone could otherwise push spoofed
    // notifications to any user's devices.
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!svc || auth !== svc) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id, title, body: msgBody, url } = await req.json();
    if (!user_id) throw new Error("user_id required");

    const pubKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const privKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:team@onepulso.online";
    if (!pubKey || !privKey) throw new Error("VAPID keys not configured");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, svc);
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", user_id);
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title: title || "OnePulso",
      body: msgBody || "Tienes un nuevo mensaje",
      url: url || "/unibox",
    });

    let sent = 0;
    const stale: string[] = [];
    const errors: string[] = [];
    for (const sub of subs as { endpoint: string; p256dh: string; auth: string }[]) {
      try {
        const origin = new URL(sub.endpoint).origin;
        const jwt = await vapidJwt(origin, subject, pubKey, privKey);
        const body = await encryptPayload(payload, sub.p256dh, sub.auth);
        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            TTL: "86400",
            Urgency: "high",
            Authorization: "vapid t=" + jwt + ", k=" + pubKey,
          },
          body,
        });
        if (res.status >= 200 && res.status < 300) sent++;
        else if (res.status === 404 || res.status === 410) stale.push(sub.endpoint); // device gone
        else errors.push(res.status + " " + (await res.text()).slice(0, 120));
      } catch (e) {
        errors.push(String((e as Error)?.message || e).slice(0, 120));
      }
    }
    // 404/410 means that device unsubscribed for good — drop it so it is not retried forever.
    if (stale.length > 0) {
      await admin.from("push_subscriptions").delete().eq("user_id", user_id).in("endpoint", stale);
    }

    return new Response(
      JSON.stringify({ sent, total: subs.length, caducadas: stale.length, errores: errors.slice(0, 3) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
