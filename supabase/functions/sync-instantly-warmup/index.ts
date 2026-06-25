// Sync warmup score from Instantly API v2 for the user's email accounts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INSTANTLY_API_KEY = Deno.env.get("INSTANTLY_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function fetchAllInstantlyAccounts(): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  let startingAfter: string | null = null;
  for (let i = 0; i < 50; i++) {
    const url = new URL("https://api.instantly.ai/api/v2/accounts");
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${INSTANTLY_API_KEY}` },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) break;
    const json = await res.json();
    const items: any[] = json?.items ?? [];
    for (const it of items) {
      if (it?.email) map.set(String(it.email).toLowerCase(), it);
    }
    if (!json?.next_starting_after || items.length === 0) break;
    startingAfter = String(json.next_starting_after);
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!INSTANTLY_API_KEY) throw new Error("INSTANTLY_API_KEY missing");

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { data: accounts, error: aErr } = await supabase
      .from("email_accounts")
      .select("id, email")
      .eq("user_id", userId);
    if (aErr) throw aErr;

    const instantlyMap = await fetchAllInstantlyAccounts();

    let matched = 0;
    let unmatched = 0;
    const updates: Promise<any>[] = [];

    for (const acc of accounts ?? []) {
      const info = instantlyMap.get(String(acc.email).toLowerCase());
      if (!info) {
        unmatched++;
        updates.push(
          supabase
            .from("email_accounts")
            .update({
              warmup_score: null,
              warmup_status_instantly: null,
              warmup_synced_at: new Date().toISOString(),
            })
            .eq("id", acc.id)
            .then(() => null),
        );
        continue;
      }
      matched++;
      updates.push(
        supabase
          .from("email_accounts")
          .update({
            warmup_score: typeof info.stat_warmup_score === "number"
              ? Math.round(info.stat_warmup_score)
              : null,
            warmup_status_instantly: typeof info.warmup_status === "number"
              ? info.warmup_status
              : null,
            warmup_synced_at: new Date().toISOString(),
          })
          .eq("id", acc.id)
          .then(() => null),
      );
    }

    await Promise.allSettled(updates);

    return new Response(
      JSON.stringify({
        ok: true,
        total: accounts?.length ?? 0,
        matched,
        unmatched,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
