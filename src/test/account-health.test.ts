import { describe, expect, it } from "vitest";
import { configSummary, configVerdict } from "@/lib/account-health";

describe("configVerdict — el estado del dominio que sale en la tabla", () => {
  it("los tres registros correctos → todo correcto, y no ofrece configurar", () => {
    const v = configVerdict("midominio.es", { spf: "pass", dkim: "pass", dmarc: "pass" });
    expect(v).toMatchObject({ level: "ok", label: "Todo correcto", canFix: false });
    expect(v.missing).toEqual([]);
  });
  it("sin DKIM lo dice por su nombre y ofrece configurarlo", () => {
    const v = configVerdict("midominio.es", { spf: "pass", dkim: "fail", dmarc: "pass" });
    expect(v).toMatchObject({ level: "bad", label: "Falta DKIM", canFix: true });
    expect(v.missing).toEqual(["DKIM"]);
  });
  it("varios que faltan se enumeran en orden", () => {
    expect(configVerdict("x.es", { spf: "fail", dkim: "fail", dmarc: "pass" }).label).toBe("Falta SPF y DKIM");
  });
  it("un registro a revisar no se cuenta como que falta", () => {
    const v = configVerdict("x.es", { spf: "pass", dkim: "pass", dmarc: "warn" });
    expect(v).toMatchObject({ level: "warn", label: "Revisar DMARC", canFix: true });
    expect(v.missing).toEqual([]);
  });
  it("lo que falta manda sobre lo que hay que revisar", () => {
    expect(configVerdict("x.es", { spf: "warn", dkim: "fail" }).label).toBe("Falta DKIM");
  });
  it("mientras comprueba o si no se pudo comprobar, no acusa al dominio", () => {
    expect(configVerdict("x.es", { loading: true }).level).toBe("checking");
    expect(configVerdict("x.es", undefined).level).toBe("checking");
    expect(configVerdict("x.es", { error: true })).toMatchObject({ level: "unknown", label: "Sin verificar", canFix: true });
    expect(configVerdict("x.es", {})).toMatchObject({ level: "unknown", label: "Sin verificar" });
  });
  it("sin dominio no hay veredicto", () => {
    expect(configVerdict("", { spf: "pass" })).toMatchObject({ level: "unknown", label: "Sin dominio", canFix: false });
  });
});

describe("configSummary — el recuento del encabezado", () => {
  it("cuenta cada cuenta en su estado", () => {
    const s = configSummary([
      { domain: "a.es", auth: { spf: "pass", dkim: "pass", dmarc: "pass" } },
      { domain: "b.es", auth: { spf: "pass", dkim: "pass", dmarc: "pass" } },
      { domain: "c.es", auth: { spf: "pass", dkim: "fail", dmarc: "pass" } },
      { domain: "d.es", auth: { spf: "pass", dkim: "pass", dmarc: "warn" } },
      { domain: "e.es", auth: { loading: true } },
      { domain: "", auth: undefined },
    ]);
    expect(s).toEqual({ ok: 2, bad: 1, warn: 1, checking: 1, unknown: 1 });
  });
});
