// Web Push primitives — RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID ES256).
//
// Extracted from send-push so it can be exercised directly: a round-trip test encrypts for a
// throwaway subscription keypair and decrypts it back, which is the only way to prove the
// crypto without a physical device.
// ── base64url helpers ────────────────────────────────────────────────────────
export const b64uToBytes = (s: string): Uint8Array => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
export const bytesToB64u = (b: Uint8Array): string =>
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
export async function encryptPayload(payload: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
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
export async function vapidJwt(audience: string, subject: string, pubB64: string, privB64: string): Promise<string> {
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
