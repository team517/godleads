// ensure-ai-sent-thread — makes the AI auto-reply visible inside the Unibox conversation, "como si
// lo hubiera enviado yo". The agent stores every reply in client_service_log (service-role only);
// the Unibox thread is built from sent_emails. This backfills the MISSING sent_emails rows for one
// contact so the reply shows in the thread — for replies sent BEFORE the agent started recording
// them itself. Secure: JWT required, everything scoped to the caller (owner_id = auth.uid()), and
// it only ever inserts rows owned by the caller. Idempotent: skips a reply already recorded.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const REPLY_ACTIONS = ["prospect_reply", "reply", "confirm", "send_copys", "send_copys_later", "send_report", "new_campaign", "deliver_copys"];
const toHtml = (t: string) => String(t || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p style="margin:0 0 10px">${p.replace(/\n/g, "<br>")}</p>`).join("") || `<p>${String(t || "").replace(/\n/g, "<br>")}</p>`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: ud } = await userClient.auth.getUser();
    if (!ud?.user) return json({ inserted: 0 }, 401);
    const uid = ud.user.id;

    const body = await req.json().catch(() => ({} as any));
    const contact = String(body.contact || "").trim().toLowerCase();
    const accountId = String(body.account_id || "").trim();
    if (!contact || !accountId) return json({ inserted: 0 });

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // The caller must own the mailbox they're backfilling into.
    const { data: acc } = await admin.from("email_accounts").select("id").eq("id", accountId).eq("user_id", uid).maybeSingle();
    if (!acc) return json({ inserted: 0 }, 403);

    // AI replies to this contact, sent by this user's agent.
    const { data: logs } = await admin.from("client_service_log")
      .select("reply, created_at")
      .eq("owner_id", uid).eq("from_email", contact).in("action", REPLY_ACTIONS)
      .not("reply", "is", null).order("created_at", { ascending: true }).limit(50);

    let inserted = 0;
    for (const l of (logs || []) as any[]) {
      const reply = String(l.reply || "").trim();
      if (!reply) continue;
      const t = new Date(l.created_at).getTime();
      const from = new Date(t - 5 * 60000).toISOString();
      const to = new Date(t + 5 * 60000).toISOString();
      // Dedupe: skip if a sent email to this contact already exists around that time (either the
      // agent recorded it itself, or a previous backfill did).
      const { data: exists } = await admin.from("sent_emails").select("id")
        .eq("user_id", uid).eq("account_id", accountId).eq("to_email", contact)
        .gte("sent_at", from).lte("sent_at", to).limit(1);
      if (exists && exists.length) continue;
      const { error } = await admin.from("sent_emails").insert({
        user_id: uid, account_id: accountId, to_email: contact,
        subject: "Re: (respuesta IA)", body: toHtml(reply), status: "sent", sent_at: l.created_at,
      });
      if (!error) inserted++;
    }
    return json({ inserted });
  } catch (e) {
    return json({ inserted: 0, error: String((e as Error).message) }, 500);
  }
});
