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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

async function resolveTxt(name: string) {
  const url = `${GOOGLE_DNS_ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`;
  const response = await fetch(url, {
    headers: { Accept: "application/dns-json, application/json" },
  });

  if (!response.ok) {
    throw new Error(`DNS lookup failed for ${name} [${response.status}]`);
  }

  const data = await response.json();
  const answers = Array.isArray(data?.Answer) ? (data.Answer as DnsAnswer[]) : [];

  return answers
    .map((answer) => String(answer.data ?? ""))
    .map((entry) => entry.replace(/^"|"$/g, "").replace(/"\s+"/g, ""))
    .filter(Boolean);
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
    status: hasPolicy ? (policy === "none" ? "warn" : "pass") : "fail",
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
    const body = await req.json();
    const domain = normalizeDomain(String(body?.domain ?? ""));
    const selectors = Array.isArray(body?.selectors)
      ? body.selectors.map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean)
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