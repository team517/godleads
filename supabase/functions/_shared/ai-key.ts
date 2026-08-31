// Resolve which AI API key a request should use (BYOK):
//  • Agency accounts (admin / client-manager / the 3 agency emails / special-access) AND the client
//    accounts the agency creates (they carry allowed_routes) → the PLATFORM key (DEEPSEEK). Free.
//  • Any OTHER (external self-signup) user → THEIR OWN OpenAI/DeepSeek key from user_ai_keys, so
//    their usage bills THEIR credits. If they haven't connected one yet → "needs_key".
// Both providers speak the OpenAI /chat/completions format, so callers just use baseUrl + model.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAILS = ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"];
const SPECIAL_FULL_ACCESS_EMAILS = ["oliver@llueert.com", "oliver@pannggostudioo.com", "alex@lluert.net", "rk@coldabry.com", "oliver@osakaadigital.com", "eric@dekano-core.es", "oliver@clackstudio-creative.com", "alex@vioonyx.com", "oliver@tiarecrew.com", "csnovacompany@gmail.com"];

export type AiKey = { apiKey: string; baseUrl: string; model: string; source: "platform" | "user" };
export type AiKeyResult = AiKey | "unauthorized" | "needs_key";

/** True when this user is on the PLATFORM AI (agency staff or an agency-created client). */
export async function isPlatformAiEligible(admin: ReturnType<typeof createClient>, userId: string, email: string): Promise<boolean> {
  const [{ data: role }, { data: prof }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("allowed_routes, contact_email, is_client_manager").eq("user_id", userId).maybeSingle(),
  ]);
  const contact = String((prof as any)?.contact_email || "").toLowerCase();
  return (role as any)?.role === "admin"
    || ADMIN_EMAILS.includes((email || "").toLowerCase())
    || (prof as any)?.is_client_manager === true
    || (Array.isArray((prof as any)?.allowed_routes) && (prof as any).allowed_routes.length > 0)
    || SPECIAL_FULL_ACCESS_EMAILS.includes(contact);
}

/** Resolve the AI key for the caller from their Authorization header. */
export async function resolveAiKeyForAuth(authHeader: string): Promise<AiKeyResult> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: ud } = await anon.auth.getUser();
  if (!ud?.user) return "unauthorized";
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (await isPlatformAiEligible(admin, ud.user.id, ud.user.email || "")) {
    return { apiKey: Deno.env.get("DEEPSEEK_API_KEY") || "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", source: "platform" };
  }
  const { data: uk } = await admin.from("user_ai_keys").select("provider, api_key").eq("user_id", ud.user.id).maybeSingle();
  const apiKey = String((uk as any)?.api_key || "").trim();
  if (!apiKey) return "needs_key";
  const provider = String((uk as any)?.provider || "openai").toLowerCase();
  return provider === "deepseek"
    ? { apiKey, baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", source: "user" }
    : { apiKey, baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", source: "user" };
}
