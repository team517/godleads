import { describe, expect, it } from "vitest";
import {
  apuntarEnvioEmpresa, CUPO_EMPRESA_DIA, esEmpresa, HUECO_EMPRESA_MIN, puedeEscribirEmpresa, type EstadoEmpresa,
} from "../../supabase/functions/_shared/company-pace";

const H = 60 * 60_000;

describe("esEmpresa", () => {
  it("un dominio corporativo es una empresa", () => {
    expect(esEmpresa("airbus.com")).toBe(true);
    expect(esEmpresa("orange.com")).toBe(true);   // la empresa Orange
  });
  it("el correo personal no es una empresa (cada dirección es una persona)", () => {
    expect(esEmpresa("gmail.com")).toBe(false);
    expect(esEmpresa("hotmail.es")).toBe(false);
    expect(esEmpresa("orange.fr")).toBe(false);   // el correo de los clientes de Orange
  });
  it("sin dominio no hay nada que contar", () => {
    expect(esEmpresa("")).toBe(false);
    expect(esEmpresa(null)).toBe(false);
  });
});

describe("puedeEscribirEmpresa", () => {
  const ahora = Date.parse("2026-09-25T12:00:00Z");
  it("una empresa a la que hoy no se ha escrito: adelante", () => {
    expect(puedeEscribirEmpresa(undefined, ahora)).toBe("si");
  });
  it("con el cupo del día lleno: mañana", () => {
    expect(puedeEscribirEmpresa({ n: CUPO_EMPRESA_DIA, ultimoMs: ahora - 5 * H }, ahora)).toBe("cupo");
  });
  it("si el último correo a esa empresa fue hace poco: espera", () => {
    expect(puedeEscribirEmpresa({ n: 1, ultimoMs: ahora - 30 * 60_000 }, ahora)).toBe("espera");
  });
  it("pasado el hueco y con cupo: adelante", () => {
    expect(puedeEscribirEmpresa({ n: 1, ultimoMs: ahora - (HUECO_EMPRESA_MIN + 1) * 60_000 }, ahora)).toBe("si");
  });
});

describe("apuntarEnvioEmpresa", () => {
  it("suma uno y guarda la hora", () => {
    const m = new Map<string, EstadoEmpresa>();
    apuntarEnvioEmpresa(m, "u1|airbus.com", 1000);
    apuntarEnvioEmpresa(m, "u1|airbus.com", 5000);
    expect(m.get("u1|airbus.com")).toEqual({ n: 2, ultimoMs: 5000 });
  });
  it("cada cliente lleva su cuenta: u1 y u2 no se mezclan", () => {
    const m = new Map<string, EstadoEmpresa>();
    apuntarEnvioEmpresa(m, "u1|airbus.com", 1000);
    expect(m.get("u2|airbus.com")).toBeUndefined();
  });
});
