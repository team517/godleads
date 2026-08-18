// google-oauth — OAuth handshake for the Automatización module (owner-only).
//
// Two roles, one URL:
//   • START    GET  ?owner=<uuid>   → 302 redirect to Google's consent screen
//   • CALLBACK GET  ?code=...&state=<owner uuid> → exchange code, store tokens, show a page
//
// Isolated from the sending engine. Tokens are stored server-side only (google_connections)
// and never returned to the browser. Deploy with --no-verify-jwt (Google/browser hit it
// without a Supabase JWT).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth`;
const SCOPES = [
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/forms.body.readonly",
  "openid",
  "email",
].join(" ");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, msg: string, ok: boolean) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <div style="font-family:system-ui,-apple-system,sans-serif;max-width:440px;margin:14vh auto;text-align:center;padding:24px">
       <div style="font-size:52px">${ok ? "✅" : "⚠️"}</div>
       <h2 style="margin:14px 0 6px">${title}</h2>
       <p style="color:#555;line-height:1.5">${msg}</p>
       <p style="color:#999;font-size:13px;margin-top:18px">Ya puedes cerrar esta pestaña y volver a la app.</p>
     </div>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const oauthError = url.searchParams.get("error");

  if (oauthError) return page("No se pudo conectar", `Google devolvió: ${oauthError}`, false);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return page("Falta configuración", "Aún no están los secretos GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en Supabase.", false);
  }

  // ── START ──
  if (!code) {
    const owner = url.searchParams.get("owner") || "";
    if (!UUID_RE.test(owner)) return page("Falta el usuario", "Inicia la conexión desde el botón de la app.", false);
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", SCOPES);
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("include_granted_scopes", "true");
    auth.searchParams.set("state", owner);
    return Response.redirect(auth.toString(), 302);
  }

  // ── CALLBACK ──
  if (!UUID_RE.test(state)) return page("Sesión no válida", "Vuelve a iniciar la conexión desde la app.", false);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok) {
      return page("No se pudo conectar", tok.error_description || tok.error || "Error al canjear el código.", false);
    }

    let email = "";
    try { if (tok.id_token) email = JSON.parse(atob(tok.id_token.split(".")[1])).email || ""; } catch { /* ignore */ }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error: dbErr } = await admin.from("google_connections").upsert({
      owner_id: state,
      google_email: email,
      refresh_token: tok.refresh_token ?? null,
      access_token: tok.access_token ?? null,
      token_expiry: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
      scope: tok.scope ?? SCOPES,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id" });
    if (dbErr) return page("Casi", `Se conectó pero no se pudo guardar: ${dbErr.message}`, false);

    if (!tok.refresh_token) {
      return page("Conectado (revisa permisos)", "Google no devolvió refresh_token. Quita el acceso de la app en tu cuenta de Google y vuelve a conectar para forzar el consentimiento.", true);
    }
    return page("Conectado con Google", email ? `Cuenta: <b>${email}</b>. La IA ya podrá leer las respuestas del Form.` : "Conexión guardada.", true);
  } catch (e) {
    return page("Error", String(e), false);
  }
});
