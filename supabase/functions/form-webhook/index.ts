// form-webhook — receives Google Form submissions from a small Apps Script on the chosen
// form. No OAuth, no secrets: a per-owner random key in the query string maps the
// submission to the owner. Public (--no-verify-jwt) but gated by the key. Read-only toward
// Google; only writes to form_responses. Isolated from the sending engine.
//
//   POST ?key=<owner key>   body: { formId, formTitle, email, answers, ... }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";

  if (req.method === "GET") {
    return new Response("form-webhook ok", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!UUID_RE.test(key)) return new Response(JSON.stringify({ error: "bad key" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: wh } = await admin.from("form_webhooks").select("owner_id").eq("key", key).maybeSingle();
  if (!wh?.owner_id) return new Response(JSON.stringify({ error: "invalid key" }), { status: 403, headers: { "Content-Type": "application/json" } });

  let body: any = {};
  try { body = await req.json(); } catch { /* tolerate */ }

  const { error } = await admin.from("form_responses").insert({
    owner_id: wh.owner_id,
    form_id: body.formId ?? null,
    form_title: body.formTitle ?? null,
    respondent_email: body.email ?? null,
    answers: body.answers ?? null,
    raw: body,
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
