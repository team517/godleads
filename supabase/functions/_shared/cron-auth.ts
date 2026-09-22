// Puerta de entrada de las funciones que ejecuta el cron (pg_cron → net.http_post).
//
// Antes bastaba la clave pública anon —la misma que va en el bundle del frontend— o incluso
// ninguna cabecera: cualquiera podía disparar el motor de envío, las sincronizaciones IMAP o los
// trabajos de IA a su antojo (auditoría 22-09-2026). Ahora hace falta el secreto compartido
// (REPORTS_CRON_SECRET, en el cuerpo `secret` o en la cabecera x-cron-secret) o la clave
// service_role (ejecuciones manuales desde el servidor).
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

export function cronOrServiceAuthorised(req: Request, body: any): boolean {
  const cron = Deno.env.get("REPORTS_CRON_SECRET") || "";
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const header = (req.headers.get("x-cron-secret") || "").trim();
  return !!((cron && (body?.secret === cron || header === cron)) || (svc && bearer === svc));
}

/** El usuario del JWT del navegador, o null (la clave anon NO cuenta como usuario). */
export async function userFromRequest(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === (Deno.env.get("SUPABASE_ANON_KEY") || "")) return null;
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data } = await client.auth.getUser();
    return data?.user ? { id: data.user.id, email: data.user.email || "" } : null;
  } catch {
    return null;
  }
}

export function unauthorized(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
