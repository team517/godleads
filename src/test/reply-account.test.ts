import { describe, expect, it } from "vitest";
import { cuentaPuedeEnviar, cuentasAlternativas, esErrorDeCuenta, marcaDeDominio } from "@/lib/reply-account";

describe("responder desde otra cuenta si la del hilo está bloqueada", () => {
  it("reconoce el 535 de IONOS como error de la cuenta, no los de la red", () => {
    expect(esErrorDeCuenta("Auth failed: 535 Authentication credentials invalid")).toBe(true);
    expect(esErrorDeCuenta("La cuenta no está conectada")).toBe(true);
    expect(esErrorDeCuenta("SMTP error: Timeout: connect smtp.ionos.es:465")).toBe(false);
    expect(esErrorDeCuenta("550 5.1.1 User unknown")).toBe(false);
  });
  it("sólo propone cuentas que pueden enviar, la misma persona y marca primero", () => {
    const cuentas = [
      { id: "orig", email: "mario@tunuevolead-agency.com", status: "auth_failed", first_name: "Mario" },
      { id: "a", email: "zoe@otra.es", status: "connected", first_name: "Zoe" },
      { id: "b", email: "mario@tunuevolead-boost.es", status: "connected", first_name: "Mario" },
      { id: "c", email: "mario@kingoflead.com", status: "connected", first_name: "Mario" },
      { id: "d", email: "ana@tunuevolead-pro.com", status: "connected", first_name: "Ana" },
      { id: "e", email: "mario@tunuevolead-x.com", status: "auth_failed", first_name: "Mario" },
    ];
    expect(cuentasAlternativas("orig", cuentas).map((c) => c.id)).toEqual(["b", "c", "d", "a"]);
  });
  it("utilidades", () => {
    expect(marcaDeDominio("juanjo@seoinnova-agency.com")).toBe("seoinnova");
    expect(cuentaPuedeEnviar({ status: "connected" })).toBe(true);
    expect(cuentaPuedeEnviar({ status: "auth_failed" })).toBe(false);
  });
});
