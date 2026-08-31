// ai-key — an external user connects/manages their own OpenAI/DeepSeek API key (BYOK). The key is
// stored service-role only and NEVER returned (status shows just a masked hint). JWT-scoped.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { isPlatformAiEligible } from "../_shared/ai-key.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) { tableReady = true; return; }
  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    await sql.unsafe(`create table if not exists public.user_ai_keys (user_id uuid primary key, provider text not null default 'openai', api_key text not null, created_at timestamptz default now(), updated_at timestamptz default now()); alter table public.user_ai_keys enable row level security; revoke all on public.user_ai_keys from anon, authenticated;`);
    tableReady = true;
  } catch { /* ignore */ } finally { try { await sql.end({ timeout: 3 }); } catch { /* */ } }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: ud } = await anon.auth.getUser();
    if (!ud?.user) return json({ error: "unauthorized" }, 401);
    const uid = ud.user.id;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({} as any));
    const action = body.action || "status";

    if (action === "save") {
      const provider = String(body.provider || "").toLowerCase();
      const apiKey = String(body.api_key || "").trim();
      if (provider !== "openai" && provider !== "deepseek") return json({ error: "Proveedor no válido (openai o deepseek)" }, 400);
      if (apiKey.length < 15 || apiKey.length > 300) return json({ error: "La clave no parece válida" }, 400);
      await ensureTable();
      const { error } = await admin.from("user_ai_keys").upsert({ user_id: uid, provider, api_key: apiKey, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, provider, hint: "••••" + apiKey.slice(-4) });
    }
    if (action === "delete") {
      await admin.from("user_ai_keys").delete().eq("user_id", uid);
      return json({ ok: true });
    }
    // status
    const eligible = await isPlatformAiEligible(admin, uid, ud.user.email || "");
    const { data } = await admin.from("user_ai_keys").select("provider, api_key").eq("user_id", uid).maybeSingle();
    const key = String((data as any)?.api_key || "");
    return json({ platform_eligible: eligible, connected: !!key, provider: (data as any)?.provider || null, hint: key ? "••••" + key.slice(-4) : null });
  } catch (e) {
    return json({ error: String((e as Error).message) }, 500);
  }
});
