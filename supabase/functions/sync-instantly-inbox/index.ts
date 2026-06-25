// Sync replies received in Instantly into OnePulso's inbox_messages.
// Uses the workspace-level INSTANTLY_API_KEY secret. Maps each reply by
// `eaccount` -> email_accounts.email and inserts under that account's owner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const INSTANTLY_API_KEY = Deno.env.get("INSTANTLY_API_KEY");
    if (!INSTANTLY_API_KEY) throw new Error("INSTANTLY_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional: limit to a single user (manual sync from UI)
    let onlyUserId: string | null = null;
    try {
      const body = await req.json();
      if (body?.user_id) onlyUserId = String(body.user_id);
    } catch (_) {}

    // Build email -> {id, user_id} map
    let accountQuery = supabase.from("email_accounts").select("id, user_id, email");
    if (onlyUserId) accountQuery = accountQuery.eq("user_id", onlyUserId);
    const { data: accounts, error: accErr } = await accountQuery;
    if (accErr) throw accErr;

    const accountMap = new Map<string, { id: string; user_id: string }>();
    for (const a of accounts ?? []) {
      accountMap.set((a as any).email.toLowerCase(), {
        id: (a as any).id,
        user_id: (a as any).user_id,
      });
    }

    let imported = 0;
    let skipped = 0;
    let pages = 0;
    let starting_after: string | null = null;
    const MAX_PAGES = 2;
    const PAGE_SIZE = 50;
    const CHUNK = 10;

    while (pages < MAX_PAGES) {
      const url = new URL(`${INSTANTLY_BASE}/emails`);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("email_type", "received");
      if (starting_after) url.searchParams.set("starting_after", starting_after);

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${INSTANTLY_API_KEY}` },
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Instantly API ${resp.status}: ${t}`);
      }
      const json = await resp.json();
      const items: any[] = json.items ?? [];
      pages++;
      if (items.length === 0) break;

      const rows: any[] = [];
      for (const m of items) {
        const eaccount = String(m.eaccount || "").toLowerCase();
        const acct = accountMap.get(eaccount);
        if (!acct) { skipped++; continue; }

        const fromList = Array.isArray(m.from_address_json) ? m.from_address_json : [];
        const fromEmail = (m.from_address_email || fromList[0]?.address || "").toLowerCase();
        const fromName = fromList[0]?.name || null;
        if (!fromEmail) { skipped++; continue; }

        rows.push({
          user_id: acct.user_id,
          account_id: acct.id,
          message_id: m.message_id || m.id,
          from_email: fromEmail,
          from_name: fromName,
          subject: m.subject || "(sin asunto)",
          body_text: m.body?.text || m.content_preview || "",
          body_html: m.body?.html || null,
          received_at: m.timestamp_email || m.timestamp_created || new Date().toISOString(),
          labels: ["instantly"],
        });
      }

      if (rows.length > 0) {
        // Batch insert; rely on dedupe_hash unique index to drop duplicates
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { data: inserted, error: insErr } = await supabase
          .from("inbox_messages")
          .upsert(chunk as any, { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
          .select("id");
        if (insErr) {
          console.error("chunk insert error", insErr.message);
          skipped += chunk.length;
        } else {
          const ins = inserted?.length ?? 0;
          imported += ins;
          skipped += chunk.length - ins;
        }
      }
      }

      starting_after = json.next_starting_after || null;
      if (!starting_after) break;
    }

    return new Response(
      JSON.stringify({ ok: true, imported, skipped, pages }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
