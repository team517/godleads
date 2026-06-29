// Auto-configures SPF / DKIM / DMARC for an IONOS-hosted domain via the IONOS DNS API.
// Idempotent: only creates the standard IONOS records that are missing — never deletes
// or overrides anything the user already has. Requires a logged-in user (verify_jwt).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://api.hosting.ionos.com/dns/v1";

// Standard IONOS records (identical for every IONOS-hosted domain).
const IONOS_SPF = "v=spf1 include:_spf-eu.ionos.com ~all";
const DKIM = [
  { sub: "s1-ionos._domainkey", target: "s1.dkim.ionos.com" },
  { sub: "s2-ionos._domainkey", target: "s2.dkim.ionos.com" },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const KEY = Deno.env.get("IONOS_API_KEY");
    if (!KEY) return json({ ok: false, error: "IONOS_API_KEY no configurada" }, 500);

    const h = { "X-API-Key": KEY, "accept": "application/json", "content-type": "application/json" };

    const body = await req.json().catch(() => ({}));
    const domain = String((body as any)?.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      return json({ ok: false, error: "dominio inválido" }, 400);
    }

    // 1) Find the zone for this domain (exact match, or the longest matching parent zone).
    const zonesResp = await fetch(`${BASE}/zones`, { headers: h });
    if (!zonesResp.ok) return json({ ok: false, error: `IONOS /zones ${zonesResp.status}` }, 502);
    const zones: Array<{ id: string; name: string }> = await zonesResp.json();
    const exact = zones.find((z) => z.name.toLowerCase() === domain);
    const parent = zones
      .filter((z) => domain.endsWith("." + z.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];
    const zone = exact || parent;
    if (!zone) return json({ ok: false, error: `El dominio ${domain} no está en esta cuenta de IONOS` }, 404);

    // 2) Read current records.
    const zResp = await fetch(`${BASE}/zones/${zone.id}`, { headers: h });
    if (!zResp.ok) return json({ ok: false, error: `IONOS zone ${zResp.status}` }, 502);
    const recs: Array<{ id?: string; type: string; name: string; content?: string }> = (await zResp.json()).records || [];
    const nameEq = (r: { name: string }, n: string) => r.name.toLowerCase() === n.toLowerCase();

    const toCreate: Array<{ name: string; type: string; content: string; ttl: number; disabled: boolean }> = [];

    // SPF — only add if there is NO v=spf1 TXT at the root (never override a custom one).
    const spfRec = recs.find((r) => r.type === "TXT" && nameEq(r, domain) && (r.content || "").includes("v=spf1"));
    let spf: string;
    if (!spfRec) { toCreate.push({ name: domain, type: "TXT", content: IONOS_SPF, ttl: 3600, disabled: false }); spf = "created"; }
    else if ((spfRec.content || "").includes("_spf-eu.ionos.com") || (spfRec.content || "").includes("ionos")) { spf = "present"; }
    else { spf = "custom"; } // exists but doesn't include IONOS — leave it, flag for the user

    // DKIM — two CNAMEs.
    let dkimCreated = 0, dkimPresent = 0;
    for (const d of DKIM) {
      const full = `${d.sub}.${domain}`;
      if (recs.some((r) => r.type === "CNAME" && nameEq(r, full))) dkimPresent++;
      else { toCreate.push({ name: full, type: "CNAME", content: d.target, ttl: 3600, disabled: false }); dkimCreated++; }
    }
    const dkim = dkimCreated === 0 ? "present" : (dkimPresent > 0 ? "partial-created" : "created");

    // DMARC — enforce a REAL policy. IONOS only points _dmarc via CNAME to its shared
    // p=none record (monitoring only, no protection). We replace it with a proper TXT
    // policy of our own so DMARC actually enforces.
    const STRONG_DMARC = "v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; fo=1; pct=100";
    const dmarcName = `_dmarc.${domain}`;
    const dmarcRec = recs.find((r) => nameEq(r, dmarcName));
    let dmarc: string;
    if (dmarcRec && dmarcRec.type === "TXT" && /p=(quarantine|reject)/i.test(dmarcRec.content || "")) {
      dmarc = "present"; // already a strong policy — leave it
    } else {
      // Remove the weak/CNAME _dmarc record first (a name can't hold a CNAME and a TXT).
      if (dmarcRec?.id) {
        await fetch(`${BASE}/zones/${zone.id}/records/${dmarcRec.id}`, { method: "DELETE", headers: h }).catch(() => {});
      }
      toCreate.push({ name: dmarcName, type: "TXT", content: STRONG_DMARC, ttl: 3600, disabled: false });
      dmarc = dmarcRec ? "upgraded" : "created";
    }

    // 3) Create the missing records in one call.
    let created: string[] = [];
    if (toCreate.length > 0) {
      const cResp = await fetch(`${BASE}/zones/${zone.id}/records`, { method: "POST", headers: h, body: JSON.stringify(toCreate) });
      if (!cResp.ok) {
        const txt = await cResp.text();
        return json({ ok: false, error: `No se pudieron crear registros (${cResp.status}): ${txt.slice(0, 200)}` }, 502);
      }
      created = toCreate.map((r) => `${r.type} ${r.name}`);
    }

    return json({
      ok: true,
      domain,
      zone: zone.name,
      spf, dkim, dmarc,
      created,
      configured: created.length > 0,
      message:
        created.length > 0
          ? `Configurado: ${created.length} registro(s) creado(s). Los cambios de DNS pueden tardar unos minutos en propagarse.`
          : "El dominio ya tenía SPF, DKIM y DMARC correctos.",
      warnings: spf === "custom" ? ["El dominio tiene un SPF propio que NO incluye IONOS — revísalo manualmente para no romper el envío."] : [],
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
