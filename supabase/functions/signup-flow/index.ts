// Alta de Funnyleads con verificación propia (11-11-2026).
//
// Por qué: el correo de Supabase llegaba desde noreply@mail.app.supabase.io con un enlace a
// *.supabase.co, y Gmail lo marcaba como "enlace peligroso". Ahora:
//   start  → crea la cuenta SIN confirmar (Supabase no manda nada) y team@ envía un correo con el
//            botón "Verificar mi cuenta" → https://www.funnyleads.com/empezar/verificar?t=…
//   verify → el botón: confirma el correo, devuelve un token de sesión de un solo uso (magiclink,
//            como el cambio de cuenta) y el plan elegido, y la página pasa directa a la tarjeta.
//   resend → reenvía el botón (con límite).
// La cuenta no cuenta como registrada hasta que tiene suscripción (is_pending_signup en SQL).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { sendSmtpReply } from "../_shared/smtp.ts";
import {
  SIGNUP_LINK_TTL_MS, SIGNUP_MAX_SENDS_PER_HOUR, normalizeSignup, pickAppOrigin, verificationEmailHtml,
} from "./rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const FROM_EMAIL = "team@onepulso.online";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof createClient>;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Crea un enlace nuevo, lo guarda (sólo la huella) y manda el correo desde team@. */
async function sendVerification(db: Db, o: { userId: string; email: string; name: string; plan: string; period: string; origin: string }) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db.from("signup_verifications").select("id", { count: "exact", head: true })
    .eq("user_id", o.userId).gte("created_at", since);
  if ((count ?? 0) >= SIGNUP_MAX_SENDS_PER_HOUR) return { ok: false, status: 429, error: "rate_limited" };

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const { error: insErr } = await db.from("signup_verifications").insert({
    user_id: o.userId, token_hash: await sha256Hex(token), plan: o.plan, period: o.period,
    expires_at: new Date(Date.now() + SIGNUP_LINK_TTL_MS).toISOString(),
  });
  if (insErr) return { ok: false, status: 500, error: "No se pudo preparar el correo" };

  const { data: acc } = await db.from("email_accounts")
    .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
    .eq("email", FROM_EMAIL).eq("status", "connected").not("smtp_host", "is", null)
    .limit(1).maybeSingle();
  if (!acc) { console.error("[signup-flow] buzón team@ no conectado"); return { ok: false, status: 503, error: "mail_unavailable" }; }

  const link = `${o.origin}/empezar/verificar?t=${token}`;
  const r = await sendSmtpReply((acc as any).smtp_host, (acc as any).smtp_port || 587, (acc as any).smtp_username || (acc as any).email,
    (acc as any).smtp_password, (acc as any).email, o.email, "Confirma tu cuenta de Funnyleads", verificationEmailHtml({ name: o.name, link }),
    null, null, "Funnyleads");
  if (!r.ok) { console.error("[signup-flow] envío fallido:", r.error); return { ok: false, status: 502, error: "mail_unavailable" }; }
  return { ok: true as const };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action || "");
  const origin = pickAppOrigin(req.headers.get("origin"));

  try {
    if (action === "start") {
      const v = normalizeSignup(body);
      if (!v.ok) return json({ error: v.error }, 400);
      const s = v.value;

      const { data: found } = await db.rpc("signup_user_by_email", { p_email: s.email });
      const existing = Array.isArray(found) ? found[0] : null;
      let userId: string;
      if (existing?.email_confirmed_at) {
        return json({ error: "already_registered" }, 409);
      } else if (existing?.id) {
        // Un alta anterior sin confirmar con este correo: se actualiza (nueva contraseña y datos).
        userId = existing.id;
        const { error } = await db.auth.admin.updateUserById(userId, {
          password: s.password, user_metadata: { full_name: s.name, company_name: s.company },
        });
        if (error) return json({ error: error.message }, 400);
      } else {
        const { data, error } = await db.auth.admin.createUser({
          email: s.email, password: s.password, email_confirm: false,
          user_metadata: { full_name: s.name, company_name: s.company },
          app_metadata: { signup_flow: "funnyleads" },
        });
        if (error || !data.user) return json({ error: error?.message || "No se pudo crear la cuenta" }, 400);
        userId = data.user.id;
      }
      if (s.company) await db.from("profiles").update({ company_name: s.company }).eq("user_id", userId);

      const sent = await sendVerification(db, { userId, email: s.email, name: s.name, plan: s.plan, period: s.period, origin });
      if (!sent.ok) return json({ error: sent.error, user_id: userId }, sent.status);
      return json({ user_id: userId });
    }

    if (action === "resend") {
      const userId = String(body.user_id || "");
      if (!UUID_RE.test(userId)) return json({ error: "Solicitud no válida" }, 400);
      const { data: u } = await db.auth.admin.getUserById(userId);
      const user = u?.user;
      if (!user?.email) return json({ error: "Solicitud no válida" }, 400);
      if (user.email_confirmed_at) return json({ already_confirmed: true });
      const { data: last } = await db.from("signup_verifications").select("plan, period")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const sent = await sendVerification(db, {
        userId, email: user.email, name: String((user.user_metadata as any)?.full_name || ""),
        plan: (last as any)?.plan || "starter", period: (last as any)?.period || "month", origin,
      });
      if (!sent.ok) return json({ error: sent.error }, sent.status);
      return json({ ok: true });
    }

    if (action === "verify") {
      const token = String(body.token || "");
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return json({ error: "invalid_link" }, 400);
      const { data: row } = await db.from("signup_verifications")
        .select("id, user_id, plan, period, expires_at, used_at").eq("token_hash", await sha256Hex(token)).maybeSingle();
      if (!row) return json({ error: "invalid_link" }, 404);
      if (Date.parse((row as any).expires_at) < Date.now()) return json({ error: "expired_link" }, 410);

      const { data: u } = await db.auth.admin.getUserById((row as any).user_id);
      const user = u?.user;
      if (!user?.email) return json({ error: "invalid_link" }, 404);
      // Si ya tiene suscripción, el enlace no sirve para entrar: que inicie sesión normal.
      const { data: pend } = await db.rpc("is_pending_signup", { p_user: user.id });
      if (pend === false && user.email_confirmed_at && (row as any).used_at) return json({ error: "already_done" }, 409);

      if (!user.email_confirmed_at) {
        const { error } = await db.auth.admin.updateUserById(user.id, { email_confirm: true });
        if (error) return json({ error: "No se pudo verificar la cuenta" }, 500);
      }
      if (!(row as any).used_at) await db.from("signup_verifications").update({ used_at: new Date().toISOString() }).eq("id", (row as any).id);

      // Sesión para este dispositivo: un token de un solo uso (no se manda ningún correo).
      const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email: user.email });
      const hashed = (link as any)?.properties?.hashed_token;
      if (linkErr || !hashed) return json({ verified: true, email: user.email, plan: (row as any).plan, period: (row as any).period });
      return json({ verified: true, email: user.email, token_hash: hashed, plan: (row as any).plan, period: (row as any).period });
    }

    return json({ error: "Acción no válida" }, 400);
  } catch (e) {
    console.error("[signup-flow]", action, (e as Error)?.message);
    return json({ error: "Error inesperado. Inténtalo de nuevo." }, 500);
  }
});
