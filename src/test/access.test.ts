import { describe, it, expect } from "vitest";
import { decideAccess, decideFromEntitlement, AccessInput, TRIAL_DAYS, CARD_REQUIRED_CUTOFF_MS } from "@/lib/access";

// Billing gate — this decides who accesses free vs. must pay, so every case is pinned down.
const base: AccessInput = {
  email: "newuser@example.com",
  role: null,
  isClientManager: false,
  allowedRoutes: null,
  contactEmail: null,
  createdAt: "2026-09-01T00:00:00Z", // after the cutoff → a genuinely NEW self-signup
  stripeSubscribed: false,
  nowMs: Date.parse("2026-09-03T00:00:00Z"), // 2 days after signup
};

describe("decideAccess — billing / trial gate", () => {
  it("agency emails are staff (free unlimited), even after the cutoff & unpaid", () => {
    for (const email of ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"]) {
      expect(decideAccess({ ...base, email }).kind).toBe("staff");
    }
  });
  it("role=admin is staff", () => {
    expect(decideAccess({ ...base, role: "admin" }).kind).toBe("staff");
  });
  it("is_client_manager is staff", () => {
    expect(decideAccess({ ...base, isClientManager: true }).kind).toBe("staff");
  });
  it("special full-access LOGIN email is staff", () => {
    expect(decideAccess({ ...base, email: "alex@vioonyx.com" }).kind).toBe("staff");
  });
  it("a spoofed contact_email does NOT grant staff (only the immutable login email counts)", () => {
    expect(decideAccess({ ...base, contactEmail: "alex@vioonyx.com" }).kind).not.toBe("staff");
  });
  it("csnovacompany@gmail.com gets free access (staff) by its LOGIN email, unpaid & after cutoff", () => {
    expect(decideAccess({ ...base, email: "csnovacompany@gmail.com" }).kind).toBe("staff");
    expect(decideAccess({ ...base, email: "CSNovaCompany@gmail.com" }).kind).toBe("staff"); // case-insensitive
  });

  it("admin-created client (allowed_routes) is free — never gated, even with an unpaid row", () => {
    expect(decideAccess({ ...base, allowedRoutes: ["/dashboard", "/campaigns"], entitlement: { status: "past_due", tier: "growth", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("free");
  });
  it("account created BEFORE the cutoff is grandfathered (free)", () => {
    expect(decideAccess({ ...base, createdAt: "2026-08-01T00:00:00Z" }).kind).toBe("free");
  });

  it("NEW self-signup with an active Stripe sub (compat flag) is subscribed", () => {
    expect(decideAccess({ ...base, stripeSubscribed: true }).kind).toBe("subscribed");
  });
  it(`NEW self-signup, unpaid, WITHIN ${TRIAL_DAYS} days is trialing (days left counted)`, () => {
    const d = decideAccess(base);
    expect(d.kind).toBe("trialing");
    if (d.kind === "trialing") expect(d.daysLeft).toBe(12); // signup +14d = Sep 15; now Sep 3 → 12 left
  });
  it(`NEW self-signup, unpaid, AFTER ${TRIAL_DAYS} days is expired (BLOCKED)`, () => {
    expect(decideAccess({ ...base, nowMs: Date.parse("2026-09-20T00:00:00Z") }).kind).toBe("expired");
  });
  it("on the exact boundary (=14 days) it is expired, not trialing", () => {
    expect(decideAccess({ ...base, nowMs: Date.parse("2026-09-15T00:00:00Z") }).kind).toBe("expired");
  });
  it("missing creation date → free (fail-safe, never blocked)", () => {
    expect(decideAccess({ ...base, createdAt: null }).kind).toBe("free");
  });

  it("PRECEDENCE: staff wins even when unpaid + after cutoff", () => {
    expect(decideAccess({ ...base, email: "hello@onepulso.blog", stripeSubscribed: false }).kind).toBe("staff");
  });
});

describe("decideAccess — lo que dice el servidor (user_entitlements, 10-11-2026)", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const b: AccessInput = { ...base, createdAt: "2026-10-01T00:00:00Z", nowMs: now };

  it("pagó desde la landing: trialing con 14 días de Stripe → subscribed con su plan", () => {
    const d = decideAccess({ ...b, entitlement: { status: "trialing", tier: "growth", trialEnd: "2026-11-24T00:00:00Z", currentPeriodEnd: "2026-11-24T00:00:00Z" } });
    expect(d).toMatchObject({ kind: "subscribed", tier: "growth", status: "trialing", trialEnd: "2026-11-24T00:00:00Z" });
  });
  it("active con renovación futura → subscribed; cancel_at_period_end se transmite", () => {
    const d = decideAccess({ ...b, entitlement: { status: "active", tier: "scale", trialEnd: null, currentPeriodEnd: "2026-12-10T00:00:00Z", cancelAtPeriodEnd: true } });
    expect(d).toMatchObject({ kind: "subscribed", tier: "scale", status: "active", cancelAtPeriodEnd: true });
  });
  it("active pero el periodo venció hace más de un día (la renovación no llegó) → canceled", () => {
    const d = decideAccess({ ...b, entitlement: { status: "active", tier: "starter", trialEnd: null, currentPeriodEnd: "2026-11-01T00:00:00Z" } });
    expect(d.kind).toBe("canceled");
  });
  it("active con el periodo vencido hace unas horas → sigue subscribed (margen de 1 día)", () => {
    const d = decideAccess({ ...b, entitlement: { status: "active", tier: "starter", trialEnd: null, currentPeriodEnd: "2026-11-10T02:00:00Z" } });
    expect(d.kind).toBe("subscribed");
  });
  it("sin periodo informado (fila vieja) → subscribed si active", () => {
    expect(decideAccess({ ...b, entitlement: { status: "active", tier: "growth", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("subscribed");
  });
  it("past_due / unpaid / incomplete → payment_failed con el error y el plan", () => {
    for (const status of ["past_due", "unpaid", "incomplete", "incomplete_expired"]) {
      const d = decideAccess({ ...b, entitlement: { status, tier: "growth", trialEnd: null, currentPeriodEnd: "2026-12-01T00:00:00Z", lastPaymentError: "Tarjeta rechazada" } });
      expect(d).toMatchObject({ kind: "payment_failed", tier: "growth", status, lastPaymentError: "Tarjeta rechazada" });
    }
  });
  it("canceled / paused → canceled", () => {
    expect(decideAccess({ ...b, entitlement: { status: "canceled", tier: "free", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("canceled");
    expect(decideAccess({ ...b, entitlement: { status: "paused", tier: "free", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("canceled");
  });
  it("fila inactive (nunca pagó) → la prueba de la plataforma manda", () => {
    expect(decideAccess({ ...b, entitlement: { status: "inactive", tier: "free", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("expired");
    expect(decideAccess({ ...b, createdAt: "2026-11-05T00:00:00Z", entitlement: { status: "inactive", tier: "free", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("trialing");
  });
  it("el servidor manda sobre el flag de compatibilidad: impago no se tapa con stripeSubscribed", () => {
    expect(decideAccess({ ...b, stripeSubscribed: true, entitlement: { status: "past_due", tier: "growth", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("payment_failed");
  });
  it("el staff nunca ve un bloqueo aunque su fila diga impago", () => {
    expect(decideAccess({ ...b, email: "support@onepulso.online", entitlement: { status: "unpaid", tier: "growth", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("staff");
  });
  it("decideFromEntitlement: sin fila → null", () => {
    expect(decideFromEntitlement(null, now)).toBeNull();
    expect(decideFromEntitlement({ status: null, tier: null, trialEnd: null, currentPeriodEnd: null }, now)).toBeNull();
  });
});


/* Alta con tarjeta (11-11-2026): "no puede crear cuenta sin el free trial o haber pagado". */
describe("decideAccess — registros desde el corte necesitan prueba con tarjeta", () => {
  const nuevo: AccessInput = { ...base, createdAt: "2026-11-11T09:00:00Z", nowMs: Date.parse("2026-11-12T00:00:00Z") };
  it("el corte es el 11-11-2026 a las 00:00 UTC", () => {
    expect(new Date(CARD_REQUIRED_CUTOFF_MS).toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });
  it("registro nuevo sin fila o con fila inactive → needs_card (sin prueba de la plataforma)", () => {
    expect(decideAccess(nuevo).kind).toBe("needs_card");
    expect(decideAccess({ ...nuevo, entitlement: { status: "inactive", tier: "free", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("needs_card");
  });
  it("con la prueba de Stripe (tarjeta puesta) → subscribed en prueba", () => {
    const d = decideAccess({ ...nuevo, entitlement: { status: "trialing", tier: "starter", trialEnd: "2026-11-25T09:00:00Z", currentPeriodEnd: "2026-11-25T09:00:00Z" } });
    expect(d.kind).toBe("subscribed");
    expect(d.kind === "subscribed" && d.status).toBe("trialing");
  });
  it("con un plan pagado → subscribed; con impago → payment_failed (no needs_card)", () => {
    expect(decideAccess({ ...nuevo, entitlement: { status: "active", tier: "growth", trialEnd: null, currentPeriodEnd: "2026-12-11T00:00:00Z" } }).kind).toBe("subscribed");
    expect(decideAccess({ ...nuevo, entitlement: { status: "past_due", tier: "growth", trialEnd: null, currentPeriodEnd: null } }).kind).toBe("payment_failed");
  });
  it("registros ANTERIORES al corte conservan su prueba sin tarjeta hasta que acabe", () => {
    const viejo = { ...base, createdAt: "2026-11-10T20:00:00Z", nowMs: Date.parse("2026-11-12T00:00:00Z") };
    expect(decideAccess(viejo).kind).toBe("trialing");
    expect(decideAccess({ ...viejo, nowMs: Date.parse("2026-11-25T00:00:00Z") }).kind).toBe("expired");
  });
  it("el equipo, los clientes de la agencia y las cuentas antiguas no cambian", () => {
    expect(decideAccess({ ...nuevo, email: "hello@onepulso.blog" }).kind).toBe("staff");
    expect(decideAccess({ ...nuevo, allowedRoutes: ["/unibox"] }).kind).toBe("free");
    expect(decideAccess({ ...nuevo, createdAt: "2026-07-01T00:00:00Z" }).kind).toBe("free");
  });
});
