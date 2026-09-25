import { describe, expect, it } from "vitest";
import { tipoDeUsuario, estadoPanel, estaPagando, coincideBusqueda, type AdminUserRaw } from "@/lib/admin-users";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const base: AdminUserRaw = {
  id: "u1", email: "ana@acme.com", created_at: "2026-09-23T12:00:00Z", last_sign_in_at: null, email_confirmed: true,
  provider: "email", full_name: "Ana", company_name: "Acme", contact_email: null, role: "client", is_client_manager: false,
  allowed_routes: null, client_password: null, leads_count: 0, accounts_count: 0, clients_count: 0,
  plan: { tier: "free", status: "inactive", current_period_end: null, stripe_customer_id: null },
};

describe("tipoDeUsuario — el panel lista a TODOS", () => {
  it("registro propio", () => expect(tipoDeUsuario(base)).toBe("registro"));
  it("cliente creado por la agencia (allowed_routes)", () => expect(tipoDeUsuario({ ...base, allowed_routes: ["/campaigns"] })).toBe("cliente"));
  it("equipo: admin, gestor o correo de la agencia", () => {
    expect(tipoDeUsuario({ ...base, role: "admin" })).toBe("equipo");
    expect(tipoDeUsuario({ ...base, is_client_manager: true, allowed_routes: ["/x"] })).toBe("equipo");
    expect(tipoDeUsuario({ ...base, email: "Support@OnePulso.online" })).toBe("equipo");
  });
  it("acceso gratis dado a mano", () => expect(tipoDeUsuario({ ...base, email: "oliver@tiarecrew.com" })).toBe("invitado"));
});

describe("estadoPanel", () => {
  it("registro nuevo dentro de los 5 días → en prueba", () => {
    expect(estadoPanel(base, NOW)).toEqual({ estado: "prueba", etiqueta: "Prueba: quedan 3 días" });
  });
  it("registro nuevo pasados 5 días sin pagar → prueba acabada", () => {
    expect(estadoPanel({ ...base, created_at: "2026-09-10T12:00:00Z" }, NOW).estado).toBe("caducada");
  });
  it("con plan activo → pagando, aunque la prueba haya acabado", () => {
    const u = { ...base, created_at: "2026-09-10T12:00:00Z", plan: { ...base.plan, tier: "growth", status: "active" } };
    expect(estadoPanel(u, NOW)).toEqual({ estado: "pago", etiqueta: "Pagando" });
  });
  it("pago atrasado se marca aparte", () => {
    expect(estadoPanel({ ...base, plan: { ...base.plan, tier: "starter", status: "past_due" } }, NOW).etiqueta).toBe("Pago pendiente");
  });
  it("cliente creado por la agencia y cuentas antiguas → gratis", () => {
    expect(estadoPanel({ ...base, allowed_routes: ["/x"], created_at: "2026-09-01T00:00:00Z" }, NOW).estado).toBe("gratis");
    expect(estadoPanel({ ...base, created_at: "2026-05-01T00:00:00Z" }, NOW).estado).toBe("gratis");
  });
  it("un plan cancelado o 'free' no cuenta como pago", () => {
    expect(estaPagando({ ...base.plan, tier: "growth", status: "canceled" })).toBe(false);
    expect(estaPagando({ ...base.plan, tier: "free", status: "active" })).toBe(false);
  });
});

describe("coincideBusqueda", () => {
  it("busca en correo, nombre, empresa y correo de contacto", () => {
    expect(coincideBusqueda(base, "ACME")).toBe(true);
    expect(coincideBusqueda({ ...base, contact_email: "facturas@otra.es" }, "otra.es")).toBe(true);
    expect(coincideBusqueda(base, "zzz")).toBe(false);
    expect(coincideBusqueda(base, "  ")).toBe(true);
  });
});

import { campanasActivas } from "@/lib/admin-users";
describe("campanasActivas", () => {
  it("sólo las que están en marcha; sin campañas → lista vacía", () => {
    const c = (status: string) => ({ id: status, name: status, status, created_at: "", sent_today: null });
    expect(campanasActivas({ campaigns: [c("active"), c("paused"), c("draft"), c("active")] }).length).toBe(2);
    expect(campanasActivas({})).toEqual([]);
  });
});
