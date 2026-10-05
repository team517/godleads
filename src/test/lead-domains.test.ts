import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainOf, pendingDomains, readLeadDomainMemo, resolveLeadDomains, LEAD_DOMAINS_IN_KEY } from "@/lib/lead-domains";
import { cacheSet } from "@/lib/instant-cache";

/* Dominios de leads pedidos bajo demanda: sólo los de los mensajes cargados, recordados en la
   sesión. Antes se pedían TODOS (59.064 en support@, y PostgREST sólo devolvía 1.000). */

beforeEach(() => { cacheSet(LEAD_DOMAINS_IN_KEY, { at: 0, asked: [], hits: [] }); });

describe("dominios de leads bajo demanda", () => {
  it("dominio del remitente, en minúsculas", () => {
    expect(domainOf("Ana <ANA@Acme.ES>".replace(/.*</, "").replace(">", ""))).toBe("acme.es");
    expect(domainOf("sin-arroba")).toBe("");
    expect(domainOf(null)).toBe("");
  });

  it("sólo los dominios que faltan, sin repetir", () => {
    const asked = new Set(["acme.es"]);
    expect(pendingDomains(["a@acme.es", "b@foo.com", "c@FOO.com", "", null, "x@bar.io"], asked)).toEqual(["foo.com", "bar.io"]);
  });

  it("pregunta una vez y lo recuerda (aciertos y fallos)", async () => {
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => ({
      data: (args.p_domains as string[]).filter((d) => d === "acme.es").map((domain) => ({ domain })),
      error: null,
    }));
    const r1 = await resolveLeadDomains(rpc, ["acme.es", "spam.net"]);
    expect([...r1.hits]).toEqual(["acme.es"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("lead_domains_in");
    const memo = readLeadDomainMemo();
    expect(memo.asked.has("spam.net")).toBe(true);
    // Segunda vez: no vuelve a preguntar.
    const r2 = await resolveLeadDomains(rpc, ["acme.es", "spam.net"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r2.hits.has("acme.es")).toBe(true);
  });

  it("si la petición falla, esos dominios NO quedan como preguntados (se reintentan)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "timeout" } }));
    const r = await resolveLeadDomains(rpc, ["acme.es"]);
    expect(r.ok).toBe(false);
    expect(readLeadDomainMemo().asked.has("acme.es")).toBe(false);
  });

  it("de 1.000 en 1.000", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const many = Array.from({ length: 2500 }, (_, i) => `d${i}.com`);
    await resolveLeadDomains(rpc, many);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
