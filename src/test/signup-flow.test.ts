import { describe, expect, it } from "vitest";
import {
  accountErrors, choiceFromParams, parseSavedChoice, passwordStrength, priceIdFor, priceInfo, signupErrorMessage,
  stepFromParams, trialEndDate, isValidEmail,
} from "@/lib/signup-flow";

/* Alta con prueba gratuita de 14 días (11-11-2026). */
const q = (s: string) => new URLSearchParams(s);

describe("alta — plan y periodo preseleccionados", () => {
  it("sin nada → Starter mensual (el plan básico)", () => {
    expect(choiceFromParams(q(""))).toEqual({ plan: "starter", period: "month" });
  });
  it("desde un Choose o con ?plan&periodo", () => {
    expect(choiceFromParams(q("plan=growth&periodo=year"))).toEqual({ plan: "growth", period: "year" });
    expect(choiceFromParams(q("plan=Scale&periodo=anual"))).toEqual({ plan: "scale", period: "year" });
    expect(choiceFromParams(q("plan=basico&periodo=mensual"))).toEqual({ plan: "starter", period: "month" });
  });
  it("lo que no se entiende no rompe; la elección guardada (vuelta de Stripe) se respeta", () => {
    expect(choiceFromParams(q("plan=enterprise&periodo=semanal"))).toEqual({ plan: "starter", period: "month" });
    expect(choiceFromParams(q(""), { plan: "growth", period: "year" })).toEqual({ plan: "growth", period: "year" });
    expect(parseSavedChoice(JSON.stringify({ plan: "scale", period: "month" }))).toEqual({ plan: "scale", period: "month" });
    expect(parseSavedChoice("{roto")).toBeNull();
    expect(parseSavedChoice(JSON.stringify({ plan: "gratis", period: "month" }))).toBeNull();
  });
  it("paso pedido en la URL", () => {
    expect(stepFromParams(q("paso=tarjeta"))).toBe("tarjeta");
    expect(stepFromParams(q("paso=listo"))).toBe("listo");
    expect(stepFromParams(q("paso=panel"))).toBeNull();
  });
});

describe("alta — precios y prueba", () => {
  it("los price ids son los de Funnyleads que acepta create-checkout", () => {
    expect(priceIdFor({ plan: "starter", period: "month" })).toBe("price_1UaCJz2ObXNkJIexLnC0KEao");
    expect(priceIdFor({ plan: "starter", period: "year" })).toBe("price_1UaCK82ObXNkJIex9sAU4ko7");
    expect(priceIdFor({ plan: "growth", period: "month" })).toBe("price_1UaCK42ObXNkJIexveYDJQRh");
    expect(priceIdFor({ plan: "scale", period: "year" })).toBe("price_1UaCKD2ObXNkJIexO8o0rU1L");
  });
  it("lo que se cobrará al acabar la prueba", () => {
    expect(priceInfo({ plan: "starter", period: "month" })).toMatchObject({ perMonth: 21, charge: 21 });
    expect(priceInfo({ plan: "growth", period: "year" })).toMatchObject({ perMonth: 54, charge: 648 });
    expect(priceInfo({ plan: "scale", period: "month" }).chargeLabel).toBe("170 € al mes");
  });
  it("la prueba acaba 14 días después", () => {
    const hoy = Date.parse("2026-11-11T10:00:00Z");
    expect(trialEndDate(hoy).toISOString()).toBe("2026-11-25T10:00:00.000Z");
  });
});

describe("alta — formulario de cuenta", () => {
  it("correo", () => {
    expect(isValidEmail("ana@acme.com")).toBe(true);
    expect(isValidEmail("ana@acme")).toBe(false);
    expect(isValidEmail(" ana@acme.es ")).toBe(true);
  });
  it("fuerza de la contraseña: mínimo 8 con letras y números", () => {
    expect(passwordStrength("abc").ok).toBe(false);
    expect(passwordStrength("abcdefgh").ok).toBe(false);
    expect(passwordStrength("abcdefg1")).toMatchObject({ score: 2, ok: true });
    expect(passwordStrength("Abcdefgh12!")).toMatchObject({ score: 3, ok: true });
  });
  it("errores por campo; la empresa es opcional", () => {
    const vacio = accountErrors({ name: "", company: "", email: "", password: "", terms: false });
    expect(Object.keys(vacio).sort()).toEqual(["email", "name", "password", "terms"]);
    expect(accountErrors({ name: "Ana", company: "", email: "ana@acme.com", password: "abcdefg1", terms: true })).toEqual({});
  });
  it("correo ya registrado → mensaje claro con iniciar sesión", () => {
    expect(signupErrorMessage("User already registered")).toMatchObject({ alreadyRegistered: true });
    expect(signupErrorMessage("Email rate limit exceeded").text).toMatch(/Espera un minuto/);
  });
});
