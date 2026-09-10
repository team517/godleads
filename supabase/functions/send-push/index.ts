// Web Push sender — RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID).
//
// The previous version posted the payload UNENCRYPTED and with no VAPID header, with a comment
// admitting it ("without encryption for now"). Every push service rejects that (401/400), so no
// notification ever arrived. This implements the real thing with WebCrypto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── base64url helpers ────────────────────────────────────────────────────────
const b64uToBytes = (s: string): Uint8Array => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const bytesToB64u = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

// ── HKDF (RFC 5869). Every output here is <= 32 bytes, so one expand round suffices.
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);                                  // extract
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));     // expand, T(1)
  return okm.slice(0, len);
}

/** Encrypt the payload for ONE subscription, per RFC 8291. */
async function encryptPayload(payload: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(p256dhB64);   // 65 bytes, uncompressed P-256 point
  const authSecret = b64uToBytes(authB64);   // 16 bytes

  // Ephemeral application-server ECDH keypair (fresh per message).
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  const enc = new TextEncoder();
  // The IKM binds BOTH public keys, so only this subscription can open the record.
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 marks the last record's padding delimiter.
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, plaintext));

  // aes128gcm header: salt(16) | rs(4, big-endian) | idlen(1) | keyid(as_public) | ciphertext
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/** VAPID ES256 JWT for one push origin. */
async function vapidJwt(audience: string, subject: string, pubB64: string, privB64: string): Promise<string> {
  const pub = b64uToBytes(pubB64);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: privB64,
    ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64u(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const signingInput = header + "." + body;
  // WebCrypto returns the raw r||s pair, which is exactly what JWS ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)));
  return signingInput + "." + bytesToB64u(sig);
}

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
