import { describe, it, expect } from "vitest";
import { leadsCountKey, needsRecount } from "@/lib/leads-paging";

describe("Leads: cuándo se vuelve a contar", () => {
  it("al entrar (sin recuento previo) se cuenta", () => {
    expect(needsRecount(null, leadsCountKey("u1", null), false)).toBe(true);
  });
  it("pasar de página con la misma carpeta NO cuenta", () => {
    const key = leadsCountKey("u1", null);
    expect(needsRecount(key, key, false)).toBe(false);
  });
  it("cambiar de carpeta (o de usuario) cuenta", () => {
    expect(needsRecount(leadsCountKey("u1", null), leadsCountKey("u1", "lista-a"), false)).toBe(true);
    expect(needsRecount(leadsCountKey("u1", "lista-a"), leadsCountKey("u2", "lista-a"), false)).toBe(true);
  });
  it("tras un cambio (alta, borrado, importación) siempre cuenta", () => {
    const key = leadsCountKey("u1", "lista-a");
    expect(needsRecount(key, key, true)).toBe(true);
  });
});
