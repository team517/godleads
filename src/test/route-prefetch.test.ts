import { describe, it, expect } from "vitest";
import { IDLE_PREFETCH_PATHS, routeKeyForPathname, shouldIdlePrefetch } from "@/lib/route-prefetch";

describe("routeKeyForPathname — qué trozo se precarga para la URL abierta", () => {
  it("coincidencia exacta", () => {
    expect(routeKeyForPathname("/unibox")).toBe("/unibox");
    expect(routeKeyForPathname("/dashboard/")).toBe("/dashboard");
    expect(routeKeyForPathname("/")).toBe("/");
  });
  it("prefijo más largo: /admin/clients antes que /admin; /o/<slug> → /o", () => {
    expect(routeKeyForPathname("/admin/clients")).toBe("/admin/clients");
    expect(routeKeyForPathname("/admin/clients/x")).toBe("/admin/clients");
    expect(routeKeyForPathname("/admin")).toBe("/admin");
    expect(routeKeyForPathname("/o/acme")).toBe("/o");
  });
  it("una ruta sin trozo propio (la app del móvil, 404) no precarga nada", () => {
    expect(routeKeyForPathname("/m")).toBeNull();
    expect(routeKeyForPathname("/no-existe")).toBeNull();
  });
  it("/metrics y /modificaciones-ia no se confunden con /m", () => {
    expect(routeKeyForPathname("/metrics")).toBe("/metrics");
    expect(routeKeyForPathname("/modificaciones-ia")).toBe("/modificaciones-ia");
  });
});

describe("prefetch en reposo", () => {
  it("se salta en teléfonos, ventanas estrechas y con ahorro de datos", () => {
    expect(shouldIdlePrefetch({ phone: false, narrow: false, saveData: false })).toBe(true);
    expect(shouldIdlePrefetch({ phone: true, narrow: true, saveData: false })).toBe(false);
    expect(shouldIdlePrefetch({ phone: false, narrow: true, saveData: false })).toBe(false);
    expect(shouldIdlePrefetch({ phone: false, narrow: false, saveData: true })).toBe(false);
  });
  it("deja fuera las rutas más pesadas y la del propietario", () => {
    expect(IDLE_PREFETCH_PATHS).not.toContain("/stats");
    expect(IDLE_PREFETCH_PATHS).not.toContain("/modificaciones-ia");
    expect(IDLE_PREFETCH_PATHS).not.toContain("/godtube");
    expect(IDLE_PREFETCH_PATHS).toContain("/unibox");
    expect(IDLE_PREFETCH_PATHS).toContain("/campaigns");
  });
});
