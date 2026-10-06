import { describe, expect, it } from "vitest";
import { domainAcceptsMail, isDnsNotFound, type DnsResolver } from "../../supabase/functions/_shared/recipient-check";

/* Menos rebotes (06-10-2026): el motor no escribe a dominios que no reciben correo. */
const notFound = () => Object.assign(new Error("no record found for Query { name: Name(\"x.\"), query_type: MX }"), { name: "NotFound" });
const resolver = (table: Record<string, unknown[] | "nx" | "timeout">): DnsResolver => async (d, t) => {
  const v = table[`${t} ${d}`];
  if (v === "nx" || v === undefined) throw notFound();
  if (v === "timeout") throw new Error("timed out");
  return v;
};

describe("domainAcceptsMail", () => {
  it("con MX recibe correo", async () => {
    expect(await domainAcceptsMail("empresa.es", resolver({ "MX empresa.es": [{ exchange: "mx1.ionos.es", preference: 10 }] }))).toBe(true);
  });
  it("sin MX pero con A: MX implícito, recibe", async () => {
    expect(await domainAcceptsMail("solo-web.com", resolver({ "A solo-web.com": ["1.2.3.4"] }))).toBe(true);
  });
  it("ni MX ni A ni AAAA: no recibe (se salta sin enviar)", async () => {
    expect(await domainAcceptsMail("fake-linkedin.com", resolver({}))).toBe(false);
  });
  it("MX nulo (RFC 7505): no recibe", async () => {
    expect(await domainAcceptsMail("nomail.example", resolver({ "MX nomail.example": [{ exchange: ".", preference: 0 }], "A nomail.example": ["1.2.3.4"] }))).toBe(false);
    expect(await domainAcceptsMail("nomail2.example", resolver({ "MX nomail2.example": [{ exchange: "", preference: 0 }] }))).toBe(false);
  });
  it("DNS que no contesta: no se sabe → se envía como siempre", async () => {
    expect(await domainAcceptsMail("lento.es", resolver({ "MX lento.es": "timeout" }))).toBeNull();
    expect(await domainAcceptsMail("lento2.es", resolver({ "A lento2.es": "timeout" }))).toBeNull();
  });
  it("dominio vacío o sin punto", async () => {
    expect(await domainAcceptsMail("", resolver({}))).toBe(false);
    expect(await domainAcceptsMail("localhost", resolver({}))).toBe(false);
  });
  it("isDnsNotFound distingue 'no existe' de un fallo pasajero", () => {
    expect(isDnsNotFound(notFound())).toBe(true);
    expect(isDnsNotFound(new Error("timed out"))).toBe(false);
  });
});
