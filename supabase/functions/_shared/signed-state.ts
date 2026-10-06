// `state` firmado para el flujo OAuth de Google (google-oauth).
//
// Auditoría 06-10-2026: el `state` era el UUID del dueño tal cual. Cualquiera que supiera (o
// adivinara) un UUID podía abrir el callback con SU código de Google y un `state` ajeno, y
// los tokens se guardaban en la conexión de otro usuario. Ahora el `state` lleva
//   v1.<base64url(JSON {o: dueño, n: nonce aleatorio, e: caducidad en ms})>.<HMAC-SHA256 hex>
// y el callback sólo acepta uno firmado por nosotros y que no haya caducado.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vida de un state: lo que tarda una persona en pasar por la pantalla de Google. */
export const STATE_TTL_MS = 15 * 60 * 1000;

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

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

function randomNonce(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Crea un state firmado para `ownerId` (UUID). Lanza si el dueño no es un UUID o falta el secreto. */
export async function signOauthState(
  ownerId: string, secret: string, now: number = Date.now(), ttlMs: number = STATE_TTL_MS, nonce: string = randomNonce(),
): Promise<string> {
  if (!UUID_RE.test(ownerId)) throw new Error("owner no válido");
  if (!secret) throw new Error("falta el secreto de firma");
  const payload = b64urlEncode(JSON.stringify({ o: ownerId, n: nonce, e: now + ttlMs }));
  return `v1.${payload}.${await hmacHex(`v1.${payload}`, secret)}`;
}

/** Devuelve el UUID del dueño si el state está bien firmado y vigente; si no, null. */
export async function verifyOauthState(
  state: string, secret: string, now: number = Date.now(),
): Promise<string | null> {
  if (!secret) return null;
  const parts = String(state || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;
  const expected = await hmacHex(`v1.${parts[1]}`, secret);
  if (!timingSafeEq(expected, parts[2])) return null;
  try {
    const p = JSON.parse(b64urlDecode(parts[1]));
    if (!p || typeof p.o !== "string" || !UUID_RE.test(p.o) || typeof p.n !== "string" || !p.n) return null;
    if (typeof p.e !== "number" || !(p.e > now)) return null;
    return p.o;
  } catch {
    return null;
  }
}
