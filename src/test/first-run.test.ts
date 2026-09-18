import { describe, expect, it } from "vitest";
import {
  GOALS, MAX_GOALS, SOURCES, WELCOME_PATH, normalizeWebsite, shouldShowWelcome, toggleGoal, welcomeDoneKey,
} from "@/lib/first-run";

describe("a quién se le enseña la bienvenida", () => {
  const base = { pathname: "/dashboard", status: "pending" as const, clientLogin: false, trialExpired: false };

  it("a quien entra por primera vez", () => {
    expect(shouldShowWelcome(base)).toBe(true);
  });
  it("a nadie mientras aún no se sabe", () => {
    expect(shouldShowWelcome({ ...base, status: "loading" })).toBe(false);
  });
  it("a nadie que ya la haya hecho", () => {
    expect(shouldShowWelcome({ ...base, status: "done" })).toBe(false);
  });
  it("no se reenvía a sí misma (nada de bucles)", () => {
    expect(shouldShowWelcome({ ...base, pathname: WELCOME_PATH })).toBe(false);
  });
  it("no se le pregunta nada al acceso de sólo mirar de un cliente", () => {
    expect(shouldShowWelcome({ ...base, clientLogin: true })).toBe(false);
  });
  it("con la prueba caducada manda el muro de pago, no la bienvenida", () => {
    expect(shouldShowWelcome({ ...base, trialExpired: true })).toBe(false);
  });
  it("la marca del navegador va por usuario", () => {
    expect(welcomeDoneKey("u1")).not.toBe(welcomeDoneKey("u2"));
  });
});

describe("objetivos: como mucho tres", () => {
  it("marca y desmarca", () => {
    expect(toggleGoal([], "leads")).toEqual(["leads"]);
    expect(toggleGoal(["leads"], "leads")).toEqual([]);
  });
  it("no deja pasar del máximo", () => {
    const tres = ["cold_email", "leads", "campaigns"];
    expect(toggleGoal(tres, "unibox")).toEqual(tres);
    // pero sí se puede cambiar uno por otro
    expect(toggleGoal(toggleGoal(tres, "leads"), "unibox")).toEqual(["cold_email", "campaigns", "unibox"]);
  });
  it("las opciones no se repiten y son las del diseño", () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    expect(SOURCES.map((s) => s.id)).toContain("private");
    expect(GOALS.length).toBeGreaterThan(MAX_GOALS);
  });
});

describe("la web de la empresa", () => {
  it("acepta lo que escribe cualquiera", () => {
    expect(normalizeWebsite("tuempresa.com")).toBe("https://tuempresa.com");
    expect(normalizeWebsite("  WWW.Acme.ES/precios/ ")).toBe("https://www.acme.es/precios");
    expect(normalizeWebsite("http://acme.es")).toBe("http://acme.es");
    expect(normalizeWebsite("acme.es ")).toBe("https://acme.es");
  });
  it("rechaza lo que no es una dirección", () => {
    expect(normalizeWebsite("")).toBeNull();
    expect(normalizeWebsite("   ")).toBeNull();
    expect(normalizeWebsite("no tengo")).toBeNull();
    expect(normalizeWebsite("acme")).toBeNull();
    expect(normalizeWebsite("acme..es")).toBeNull();
    expect(normalizeWebsite(null)).toBeNull();
  });
});
