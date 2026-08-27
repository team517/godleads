// google-forms-sync — pulls NEW Google Form responses into `form_responses` automatically so the
// Automatización flow advances on its own (a client answers the Form → their card moves forward and
// the campaign generates). Runs from the Automatización page poll AND (optionally) a cron. Uses the
// owner's already-stored Google OAuth refresh token (service role) to mint an access token and read
// responses via the Forms API. Read-only against Google; the only write is inserting new responses.
//
// SAFE by design: it ONLY fills form_responses. Campaign generation is driven by the FRONTEND
// matching a response to a client card, never by this function — so syncing responses has no
// side effects on the sending engine or on any campaign.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function freshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const j = await res.json().catch(() => ({}));
    return res.ok ? (j.access_token ?? null) : null;
  } catch { return null; }
}

// Map each questionId → its human title, so stored answers are readable (and company-name matching works).
async function questionTitles(formId: string, at: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const r = await fetch(`https://forms.googleapis.com/v1/forms/${formId}`, { headers: { Authorization: `Bearer ${at}` } });
    const f = await r.json().catch(() => ({}));
    for (const it of (f.items || [])) {
      const qid = it?.questionItem?.question?.questionId;
      if (qid) map[qid] = it.title || it?.questionItem?.question?.rowQuestion?.title || qid;
    }
  } catch { /* ignore — fall back to questionIds */ }
  return map;
}

function flattenAnswers(resp: any, titles: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const ans = resp?.answers || {};
  for (const qid of Object.keys(ans)) {
    const a = ans[qid];
    const vals = (a?.textAnswers?.answers || []).map((x: any) => x.value).filter(Boolean);
    const key = titles[qid] || a?.questionId || qid;
    if (vals.length) out[key] = vals.join(", ");
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ ok: false, reason: "google_secrets_missing", inserted: 0 });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = await req.json().catch(() => ({} as any));
  const onlyOwner = String(body.owner_id || "").trim();
  let connections = 0, formsSeen = 0, inserted = 0; const errors: string[] = [];
  try {
    let q = admin.from("google_connections").select("owner_id, refresh_token, google_email");
    if (onlyOwner) q = q.eq("owner_id", onlyOwner);
    const { data: conns } = await q;
    for (const conn of (conns || []) as any[]) {
      if (!conn?.refresh_token) continue;
      connections++;
      const at = await freshAccessToken(conn.refresh_token);
      if (!at) { errors.push(`token_refresh_failed:${conn.owner_id}`); continue; }
      // List the owner's Form files via Drive (the Forms API has no list endpoint).
      const dq = encodeURIComponent("mimeType='application/vnd.google-apps.form' and trashed=false");
      const dres = await fetch(`https://www.googleapis.com/drive/v3/files?q=${dq}&fields=${encodeURIComponent("files(id,name)")}&pageSize=50&orderBy=modifiedTime desc`, { headers: { Authorization: `Bearer ${at}` } });
      const drive = await dres.json().catch(() => ({}));
      const files = (drive.files || []) as any[];
      for (const file of files) {
        const formId = file.id; if (!formId) continue;
        formsSeen++;
        try {
          const titles = await questionTitles(formId, at);
          // Responses (paged; one page of up to 5000 is plenty here).
          const rres = await fetch(`https://forms.googleapis.com/v1/forms/${formId}/responses?pageSize=200`, { headers: { Authorization: `Bearer ${at}` } });
          const rj = await rres.json().catch(() => ({}));
          if (!rres.ok) { errors.push(`responses:${formId}:${rj?.error?.message || rres.status}`); continue; }
          const responses = (rj.responses || []) as any[];
          if (!responses.length) continue;
          // Dedupe: skip responses we already stored for this form.
          const ids = responses.map((r) => r.responseId).filter(Boolean);
          const { data: existing } = await admin.from("form_responses").select("provider_response_id").eq("owner_id", conn.owner_id).eq("form_id", formId).in("provider_response_id", ids);
          const have = new Set((existing || []).map((e: any) => e.provider_response_id));
          const rows = responses.filter((r) => r.responseId && !have.has(r.responseId)).map((r) => ({
            owner_id: conn.owner_id,
            form_id: formId,
            form_title: file.name || "",
            respondent_email: r.respondentEmail || "",
            answers: flattenAnswers(r, titles),
            provider_response_id: r.responseId,
            raw: r,
            received_at: r.lastSubmittedTime || r.createTime || new Date().toISOString(),
          }));
          if (rows.length) {
            const { error } = await admin.from("form_responses").insert(rows);
            if (error) errors.push(`insert:${formId}:${error.message}`); else inserted += rows.length;
          }
        } catch (e) { errors.push(`form:${formId}:${(e as Error).message}`); }
      }
    }
    return json({ ok: true, connections, forms: formsSeen, inserted, errors: errors.slice(0, 10) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message), inserted }, 500);
  }
});
