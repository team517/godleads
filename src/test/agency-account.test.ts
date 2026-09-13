import { describe, it, expect } from "vitest";
import { isAgencyAccount } from "@/lib/access";

describe("isAgencyAccount — quién NO ve la sección Clientes", () => {
  it("support@ y equipo@ son agencia", () => {
    expect(isAgencyAccount("support@onepulso.online", false)).toBe(true);
    expect(isAgencyAccount("equipo@onepulso.online", false)).toBe(true);
    expect(isAgencyAccount("EQUIPO@onepulso.online", false)).toBe(true); // sin distinguir mayúsculas
  });
  it("el propietario es agencia", () => {
    expect(isAgencyAccount("hello@onepulso.blog", false)).toBe(true);
  });
  it("un gestor de clientes es agencia aunque su email no esté en la lista", () => {
    expect(isAgencyAccount("otra@empresa.com", true)).toBe(true);
  });
  it("un usuario de pago normal NO es agencia (sí ve Clientes)", () => {
    expect(isAgencyAccount("cliente@empresa.com", false)).toBe(false);
    expect(isAgencyAccount(null, false)).toBe(false);
  });
});
