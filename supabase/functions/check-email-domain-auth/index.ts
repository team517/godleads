import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-api-version",
};

type CheckStatus = "pass" | "warn" | "fail";

type DnsAnswer = {
  data?: string;
};

type CheckItem = {
  status: CheckStatus;
  summary: string;
  suggestions: string[];
  records?: string[];
  selectorsTested?: string[];
  passingSelectors?: string[];
};

const GOOGLE_DNS_ENDPOINT = "https://dns.google/resolve";
const CLOUDFLARE_DNS_ENDPOINT = "https://cloudflare-dns.com/dns-query";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una consulta TXT a un resolver DNS-over-HTTPS (Google o Cloudflare). Lanza si el resolver
 *  responde mal (p. ej. 429 por exceso de peticiones), para poder reintentar en otro. */
async function resolveTxtOnce(name: string, endpoint: string): Promise<string[]> {
  const url = `${endpoint}?name=${encodeURIComponent(name)}&type=TXT`;
  const response = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!response.ok) throw new Error(`DNS ${response.status} para ${name}`);
  const data = await response.json();
  const answers = Array.isArray(data?.Answer) ? (data.Answer as DnsAnswer[]) : [];
  return answers
    .map((answer) => String(answer.data ?? ""))
    .map((entry) => entry.replace(/^"|"$/g, "").replace(/"\s+"/g, ""))
    .filter(Boolean);
}

/** TXT con red de seguridad: si Google devuelve 429/5xx (pasa al comprobar muchos dominios a la
 *  vez), reintenta y luego prueba Cloudflare. Así un dominio BIEN configurado no aparece como
 *  "sin verificar" sólo porque el resolver estaba saturado en ese instante. */
async function resolveTxt(name: string): Promise<string[]> {
  const endpoints = [GOOGLE_DNS_ENDPOINT, GOOGLE_DNS_ENDPOINT, CLOUDFLARE_DNS_ENDPOINT];
  let lastErr: unknown = null;
  for (let i = 0; i < endpoints.length; i++) {
    try {
      return await resolveTxtOnce(name, endpoints[i]);
    } catch (e) {
      lastErr = e;
      if (i < endpoints.length - 1) await sleep(120 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`DNS lookup failed for ${name}`);
}

function getOverallStatus(items: CheckItem[]): CheckStatus {
  if (items.some((item) => item.status === "fail")) return "fail";
  if (items.some((item) => item.status === "warn")) return "warn";
  return "pass";
}

function buildSpf(records: string[]): CheckItem {
  const spfRecords = records.filter((record) => /(^|\s)v=spf1\s/i.test(record));

  if (spfRecords.length === 0) {
    return {
      status: "fail",
      summary: "No se ha encontrado ningún registro SPF.",
      suggestions: [
        "Añade un TXT en el dominio raíz con v=spf1 e incluye los servidores autorizados para enviar.",
        "Mantén un único SPF; si tienes varios, combínalos en uno solo.",
      ],
      records,
    };
  }

  if (spfRecords.length > 1) {
    return {
      status: "fail",
      summary: "Se han encontrado varios registros SPF y eso invalida la política.",
      suggestions: [
        "Fusiona todos los mecanismos SPF en un único registro TXT v=spf1.",
      ],
      records: spfRecords,
    };
  }

  const record = spfRecords[0];
  const hasSoftOrHardFail = /(?:\s|^)(~all|-all)(?:\s|$)/i.test(record);

  return {
    status: hasSoftOrHardFail ? "pass" : "warn",
    summary: hasSoftOrHardFail
      ? "El dominio publica un SPF válido."
      : "El SPF existe, pero no termina con ~all o -all.",
    suggestions: hasSoftOrHardFail
      ? ["Verifica que incluya todos tus proveedores de envío autorizados."]
      : ["Cierra el SPF con ~all o -all para definir claramente qué servidores pueden enviar."],
    records: [record],
  };
}

function buildDkim(selectors: string[], selectorRecords: { selector: string; records: string[] }[]): CheckItem {
  const passingSelectors = selectorRecords
    .filter(({ records }) => records.some((record) => /v=dkim1/i.test(record) && /p=/i.test(record)))
    .map(({ selector }) => selector);

  if (passingSelectors.length > 0) {
    return {
      status: "pass",
      summary: "Se ha encontrado al menos un registro DKIM válido.",
      suggestions: ["Comprueba que el proveedor que usas para enviar firme siempre con uno de estos selectors."],
      selectorsTested: selectors,
      passingSelectors,
      records: selectorRecords.flatMap(({ selector, records }) => records.map((record) => `${selector}._domainkey → ${record}`)),
    };
  }

  return {
    status: "fail",
    summary: "No se ha encontrado un registro DKIM válido con los selectors probados.",
    suggestions: [
      "Añade el selector real que te da tu proveedor SMTP y publícalo como TXT en selector._domainkey.tudominio.",
      "Asegúrate de que el registro incluya v=DKIM1 y una clave pública p=... completa.",
    ],
    selectorsTested: selectors,
    records: selectorRecords.flatMap(({ selector, records }) => records.map((record) => `${selector}._domainkey → ${record}`)),
  };
}

function buildDmarc(records: string[]): CheckItem {
  const dmarcRecord = records.find((record) => /(^|\s)v=dmarc1\s*;/i.test(record));

  if (!dmarcRecord) {
    return {
      status: "fail",
      summary: "No se ha encontrado registro DMARC.",
      suggestions: [
        "Añade un TXT en _dmarc.tudominio con v=DMARC1; p=none/quarantine/reject.",
        "Configura rua=mailto:... para recibir informes y detectar fallos de autenticación.",
      ],
      records,
    };
  }

  const hasPolicy = /\bp=(none|quarantine|reject)\b/i.test(dmarcRecord);
  const policy = dmarcRecord.match(/\bp=(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();

  return {
    // A valid DMARC record (any policy, incl. p=none) counts as configured → green.
    // p=none is the standard IONOS-managed policy; we still note it can be strengthened.
    status: hasPolicy ? "pass" : "fail",
    summary: !hasPolicy
      ? "El registro DMARC existe pero no define una política p=."
      : policy === "none"
        ? "DMARC existe, pero está solo en monitorización (p=none)."
        : `DMARC válido con política ${policy}.`,
    suggestions: !hasPolicy
      ? ["Añade p=none, p=quarantine o p=reject al registro DMARC."]
      : policy === "none"
        ? ["Cuando todo esté alineado, sube a p=quarantine o p=reject para mejorar protección y reputación."]
        : ["Mantén alineados From, SPF y DKIM para que DMARC siga pasando correctamente."],
    records: [dmarcRecord],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // This ran unauthenticated: an open DNS-lookup proxy anyone could point at any domain.
    const authHeader = req.headers.get("Authorization") || "";
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: ud } = await anon.auth.getUser();
    if (!ud?.user) return jsonResponse({ error: "No autorizado" }, 401);

    const body = await req.json();
    const domain = normalizeDomain(String(body?.domain ?? ""));
    // Each selector is one more outbound DNS lookup — cap it so a single call can't fan out.
    const selectors = Array.isArray(body?.selectors)
      ? body.selectors.slice(0, 10).map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean)
      : [];

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return jsonResponse({ error: "domain inválido" }, 400);
    }

    const uniqueSelectors: string[] = Array.from(
      new Set<string>(selectors.length > 0 ? selectors : ["google", "selector1", "selector2"]),
    );

    const [rootTxtRecords, dmarcRecords, ...dkimLookups] = await Promise.all([
      resolveTxt(domain).catch(() => []),
      resolveTxt(`_dmarc.${domain}`).catch(() => []),
      ...uniqueSelectors.map(async (selector) => ({
        selector,
        records: await resolveTxt(`${selector}._domainkey.${domain}`).catch(() => []),
      })),
    ]);

    const spf = buildSpf(rootTxtRecords);
    const dkim = buildDkim(uniqueSelectors, dkimLookups as { selector: string; records: string[] }[]);
    const dmarc = buildDmarc(dmarcRecords);
    const ok = spf.status === "pass" && dkim.status === "pass" && dmarc.status === "pass";

    // Se guarda el veredicto para que la próxima carga lo enseñe YA PUESTO, sin volver a mirar el
    // DNS. El DNS es público, así que no hay nada sensible que proteger aquí.
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await admin.from("domain_auth").upsert({
        domain,
        spf: spf.status,
        dkim: dkim.status,
        dmarc: dmarc.status,
        ok,
        checked_at: new Date().toISOString(),
      }, { onConflict: "domain" });
    } catch (_e) { /* la caché es un extra: si falla, la respuesta sigue siendo válida */ }

    return jsonResponse({
      domain,
      checkedAt: new Date().toISOString(),
      overallStatus: getOverallStatus([spf, dkim, dmarc]),
      spf,
      dkim,
      dmarc,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});