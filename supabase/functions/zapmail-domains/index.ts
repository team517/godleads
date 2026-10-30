// Zapmail (30-10-2026): pasar dominios de IONOS a Zapmail desde el apartado /zapmail.
// Sólo hello@onepulso.blog y support@onepulso.online (y el cron, para refrescar estados).
//
//   check   {domains}  → para cada dominio: ¿está en IONOS?, nameservers actuales, buzones de la
//                         plataforma que dejarían de funcionar, estado en Zapmail. No cambia nada.
//   connect {domains}  → en IONOS pone los nameservers de Zapmail, pide a Zapmail que lo conecte
//                         y lo apunta en zapmail_domains.
//   refresh            → pregunta a Zapmail por los que no están conectados (cron cada 10 min).
//   list               → lo apuntado, para la pantalla.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cronOrServiceAuthorised, userFromRequest } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALLOWED = ["hello@onepulso.blog", "support@onepulso.online"];
const IONOS = "https://api.hosting.ionos.com/domains/v1";
const ZAP = "https://api.zapmail.ai/api";
// Los nameservers que Zapmail pide para conectar un dominio (docs: connect-domain).
const ZAP_NS = ["pns61.cloudns.net", "pns62.cloudns.com", "pns63.cloudns.net", "pns64.cloudns.uk"];
// Estados de Zapmail que ya no van a cambiar solos.
const ZAP_DONE_OK = new Set(["SUCCESS", "DOMAIN_ALREADY_CONNECTED"]);
const ZAP_DONE_BAD = new Set(["DOMAIN_NOT_REGISTERED", "WORKSPACE_ALREADY_EXISTS", "BLACKLISTED_DOMAIN", "BANNED_DOMAIN", "FAILED", "PERMISSION_REQUIRED"]);

const ionosH = () => ({ "X-API-Key": Deno.env.get("IONOS_API_KEY") || "", accept: "application/json", "content-type": "application/json" });
const zapH = (ws?: string) => ({ "x-auth-zapmail": Deno.env.get("ZAPMAIL_API_KEY") || "", "content-type": "application/json", accept: "application/json", ...(ws ? { "x-workspace-key": ws } : {}) });

/** "https://www.Dominio.com/" → "dominio.com"; null si no parece un dominio. */
export function cleanDomain(raw: string): string | null {
  const d = String(raw || "").trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[\/?#].*$/, "").replace(/\.+$/, "").replace(/^.*@/, "");
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

async function ionosDomains(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const limit = 1000;
  let firstSeen = "";
  for (let offset = 0; offset < 20000; offset += limit) {
    const r = await fetch(`${IONOS}/domainitems?limit=${limit}&offset=${offset}`, { headers: ionosH() });
    if (!r.ok) throw new Error(`IONOS ${r.status}`);
    const j = await r.json();
    const list: { id: string; name: string }[] = j.domains || [];
    if (!list.length || list[0].id === firstSeen) break;   // sin paginación: no repetir
    if (!firstSeen) firstSeen = list[0].id;
    for (const d of list) map.set(String(d.name).toLowerCase(), d.id);
    if (list.length < limit || map.size >= (j.count || 0)) break;
  }
  return map;
}

async function ionosNs(id: string): Promise<{ type: string; names: string[] } | null> {
  const r = await fetch(`${IONOS}/domainitems/${id}/nameservers`, { headers: ionosH() });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j ? { type: j.type || "", names: (j.nameservers || []).map((n: any) => String(n.name || "").toLowerCase()) } : null;
}

/** Pone los nameservers de Zapmail. Devuelve null si va bien, o el error de IONOS. */
async function ionosSetZapNs(id: string): Promise<string | null> {
  const bodies = [
    { type: "CUSTOM", nameservers: ZAP_NS.map((name) => ({ name })) },
    { type: "CUSTOM", nameservers: ZAP_NS.map((name) => ({ name, ipv4Addresses: [], ipv6Addresses: [] })) },
  ];
  let last = "";
  for (const b of bodies) {
    const r = await fetch(`${IONOS}/domainitems/${id}/nameservers`, { method: "PUT", headers: ionosH(), body: JSON.stringify(b) });
    if (r.ok) {
      // Comprobar que de verdad quedaron puestos.
      const now = await ionosNs(id);
      if (now && ZAP_NS.every((n) => now.names.includes(n))) return null;
      last = `IONOS aceptó el cambio pero devuelve ${now?.names.join(", ") || "?"}`;
      continue;
    }
    last = `IONOS ${r.status}: ${(await r.text()).slice(0, 200)}`;
    if (r.status !== 400 && r.status !== 422) break;
  }
  return last || "IONOS no aceptó el cambio";
}

async function zapWorkspace(): Promise<string | undefined> {
  const r = await fetch(`${ZAP}/v2/workspaces?page=1&limit=10`, { headers: zapH() });
  const j = await r.json().catch(() => null);
  return j?.data?.currentWorkspace?.id;
}

/** Pide (o vuelve a pedir: así se consulta el estado) que Zapmail conecte estos dominios. */
async function zapConnect(domains: string[], ws?: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < domains.length; i += 50) {
    const chunk = domains.slice(i, i + 50);
    const r = await fetch(`${ZAP}/v2/domains/connect-domain`, { method: "POST", headers: zapH(ws), body: JSON.stringify({ domainNames: chunk }) });
    const j = await r.json().catch(() => null);
    const per = j?.data?.domains || {};
    for (const d of chunk) {
      const st = per[d]?.status || (r.ok ? "PENDING" : `ERROR_${r.status}`);
      out[d] = String(st);
    }
    if (!r.ok) console.warn("zapmail connect", r.status, JSON.stringify(j).slice(0, 300));
  }
  return out;
}

/** Dominios que Zapmail ya tiene (los conectados). */
async function zapDomains(ws?: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`${ZAP}/v2/domains?page=${page}&limit=100`, { headers: zapH(ws) });
    const j = await r.json().catch(() => null);
    const list = j?.data?.domains || [];
    for (const d of list) map.set(String(d.domain || "").toLowerCase(), String(d.status || "ACTIVE"));
    if (!list.length || page >= (j?.data?.totalPages || 1)) break;
  }
  return map;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "list");
  const isCron = cronOrServiceAuthorised(req, body);
  const user = isCron ? null : await userFromRequest(req);
  if (!isCron && !(user && ALLOWED.includes(user.email.toLowerCase()))) return json({ error: "Sin acceso" }, 403);
  // El cron sólo lee y refresca; cambiar nameservers lo hace siempre una persona con acceso.
  if (isCron && action === "connect") return json({ error: "Sólo desde la pantalla" }, 403);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = () => new Date().toISOString();

  try {
    if (action === "list") {
      const { data } = await admin.from("zapmail_domains").select("*").order("created_at", { ascending: false });
      return json({ ok: true, rows: data || [] });
    }

    if (action === "check" || action === "connect") {
      const raw: string[] = Array.isArray(body?.domains) ? body.domains : String(body?.domains || "").split(/[\s,;]+/);
      const domains = Array.from(new Set(raw.map(cleanDomain).filter(Boolean) as string[])).slice(0, 300);
      const invalid = raw.filter((d) => d && d.trim() && !cleanDomain(d)).slice(0, 50);
      if (!domains.length) return json({ ok: false, error: "No hay ningún dominio válido", invalid });
      const ionos = await ionosDomains();

      if (action === "check") {
        const [ws, known] = await Promise.all([zapWorkspace(), admin.from("zapmail_domains").select("domain, step, zapmail_status").in("domain", domains)]);
        const zap = await zapDomains(ws);
        const knownMap = new Map((known.data || []).map((r: any) => [r.domain, r]));
        // Buzones de la plataforma en esos dominios: con los nameservers de Zapmail, el MX deja de
        // ser el de IONOS y esos buzones dejan de recibir (y de autenticar el envío).
        const accs: { email: string; status: string }[] = [];
        for (let i = 0; i < domains.length; i += 40) {
          const { data } = await admin.from("email_accounts").select("email, status").or(domains.slice(i, i + 40).map((d) => `email.ilike.%@${d}`).join(","));
          accs.push(...((data || []) as { email: string; status: string }[]));
        }
        const rows = [];
        for (const d of domains) {
          const id = ionos.get(d);
          const ns = id ? await ionosNs(id) : null;
          const mine = (accs || []).filter((a: any) => String(a.email).toLowerCase().endsWith("@" + d));
          rows.push({
            domain: d, inIonos: !!id, nameservers: ns?.names || [], nsType: ns?.type || null,
            alreadyZapNs: !!ns && ZAP_NS.every((n) => ns.names.includes(n)),
            mailboxes: mine.length, mailboxesConnected: mine.filter((a: any) => a.status === "connected").length,
            zapmail: zap.get(d) || null, tracked: knownMap.get(d) || null,
          });
        }
        return json({ ok: true, rows, invalid });
      }

      // connect
      const ws = await zapWorkspace();
      const results: Record<string, unknown>[] = [];
      const okForZap: string[] = [];
      for (const d of domains) {
        const id = ionos.get(d);
        if (!id) {
          await admin.from("zapmail_domains").upsert({ domain: d, step: "error", error: "No está en la cuenta de IONOS", requested_by: user?.email, updated_at: now() });
          results.push({ domain: d, ok: false, error: "No está en la cuenta de IONOS" });
          continue;
        }
        const before = await ionosNs(id);
        const already = !!before && ZAP_NS.every((n) => before.names.includes(n));
        const err = already ? null : await ionosSetZapNs(id);
        const { data: prev } = await admin.from("zapmail_domains").select("ns_before").eq("domain", d).maybeSingle();
        await admin.from("zapmail_domains").upsert({
          domain: d, ionos_id: id, ns_before: prev?.ns_before ?? before ?? null, requested_by: user?.email, updated_at: now(),
          step: err ? "error" : "ns_cambiados", error: err,
        });
        if (err) { results.push({ domain: d, ok: false, error: err }); continue; }
        okForZap.push(d);
        results.push({ domain: d, ok: true });
      }
      if (okForZap.length) {
        const st = await zapConnect(okForZap, ws);
        for (const d of okForZap) {
          const s = st[d];
          const step = ZAP_DONE_OK.has(s) ? "connected" : ZAP_DONE_BAD.has(s) || s.startsWith("ERROR_") ? "error" : "conectando";
          await admin.from("zapmail_domains").update({ zapmail_status: s, step, error: step === "error" ? `Zapmail: ${s}` : null, updated_at: now(), ...(step === "connected" ? { connected_at: now() } : {}) }).eq("domain", d);
          const r = results.find((x) => x.domain === d);
          if (r) Object.assign(r, { zapmail: s, step });
        }
      }
      return json({ ok: true, results });
    }

    if (action === "refresh") {
      const { data: pend } = await admin.from("zapmail_domains").select("domain").in("step", ["ns_cambiados", "conectando"]);
      const domains = (pend || []).map((r: any) => r.domain);
      if (!domains.length) return json({ ok: true, refreshed: 0 });
      const ws = await zapWorkspace();
      const [zap, st] = [await zapDomains(ws), await zapConnect(domains, ws)];
      let connected = 0;
      for (const d of domains) {
        const s = zap.has(d) ? "SUCCESS" : st[d];
        const step = ZAP_DONE_OK.has(s) ? "connected" : ZAP_DONE_BAD.has(s) ? "error" : "conectando";
        if (step === "connected") connected++;
        await admin.from("zapmail_domains").update({ zapmail_status: s, step, error: step === "error" ? `Zapmail: ${s}` : null, updated_at: now(), ...(step === "connected" ? { connected_at: now() } : {}) }).eq("domain", d);
      }
      return json({ ok: true, refreshed: domains.length, connected });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error("zapmail-domains", e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
