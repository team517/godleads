// ionos-domains (14-11-2026): SÓLO LECTURA. Lista los dominios de la cuenta de IONOS (API de dominios)
// y, para cada uno, cuántos buzones tiene la plataforma. Sirve para ver qué hay en IONOS sin usar.
// Acceso: el equipo (hello@, equipo@, support@) o el servidor (clave de servicio / secreto del cron).
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { cronOrServiceAuthorised, userFromRequest } from "../_shared/cron-auth.ts";

const IONOS = "https://api.hosting.ionos.com/domains/v1";
const EQUIPO = ["hello@onepulso.blog", "equipo@onepulso.online", "support@onepulso.online"];
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = await req.json().catch(() => ({}));
  const db0 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let ok = cronOrServiceAuthorised(req, body);
  if (!ok && typeof body?.token === "string" && body.token.length >= 32) {
    // Token de un solo uso creado por el equipo en la base (internal_task_tokens): se gasta al usarlo.
    const { data } = await db0.from("internal_task_tokens").delete().eq("token", body.token).eq("purpose", "ionos-domains").gt("expires_at", new Date().toISOString()).select("token");
    ok = !!data?.length;
  }
  if (!ok) {
    const u = await userFromRequest(req);
    if (!u || !EQUIPO.includes(u.email.toLowerCase())) return json({ error: "Sin acceso" }, 403);
  }
  const h = { "X-API-Key": Deno.env.get("IONOS_API_KEY") || "", accept: "application/json" };
  const dominios: string[] = [];
  let first = "";
  let ionosCount = 0;
  for (let offset = 0; offset < 50000; offset += 1000) {
    const r = await fetch(`${IONOS}/domainitems?limit=1000&offset=${offset}`, { headers: h });
    if (!r.ok) return json({ error: `IONOS ${r.status}` }, 502);
    const j = await r.json();
    const list: { id: string; name: string }[] = j.domains || [];
    ionosCount = Number(j.count || 0);
    if (!list.length || list[0].id === first) break;
    if (!first) first = list[0].id;
    for (const d of list) dominios.push(String(d.name).toLowerCase());
    if (list.length < 1000 || dominios.length >= (j.count || 0)) break;
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const usados = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("email_accounts").select("email").range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    for (const a of data || []) {
      const d = String(a.email || "").toLowerCase().split("@")[1];
      if (d) usados.set(d, (usados.get(d) || 0) + 1);
    }
    if (!data || data.length < 1000) break;
  }
  const filas = [...new Set(dominios)].sort().map((d) => ({ domain: d, platform_mailboxes: usados.get(d) || 0 }));
  return json({ ionos_count: ionosCount, total: filas.length, sin_usar: filas.filter((f) => f.platform_mailboxes === 0).length, domains: filas });
});
