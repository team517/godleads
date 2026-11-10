import { describe, expect, it } from "vitest";
import { subscriptionStatusLine } from "@/components/settings/PlanUsageCard";

/* Ajustes → Plan: la línea de estado de la suscripción (10-11-2026). */
describe("subscriptionStatusLine", () => {
  it("prueba de 14 días de Stripe", () => {
    const l = subscriptionStatusLine({ status: "trialing", trialEnd: "2026-11-24T10:00:00Z", periodEnd: "2026-11-24T10:00:00Z", cancelAtPeriodEnd: false });
    expect(l?.text).toMatch(/^Prueba gratuita hasta el 24 de noviembre de 2026/);
    expect(l?.tone).toBe("ok");
  });
  it("activo con renovación", () => {
    expect(subscriptionStatusLine({ status: "active", trialEnd: null, periodEnd: "2026-12-10T10:00:00Z", cancelAtPeriodEnd: false })?.text).toBe("Activo · se renueva el 10 de diciembre de 2026");
  });
  it("activo con cancelación programada", () => {
    const l = subscriptionStatusLine({ status: "active", trialEnd: null, periodEnd: "2026-12-10T10:00:00Z", cancelAtPeriodEnd: true });
    expect(l?.text).toContain("termina el 10 de diciembre de 2026");
    expect(l?.tone).toBe("warn");
  });
  it("pago pendiente con el motivo del banco", () => {
    const l = subscriptionStatusLine({ status: "payment_failed", trialEnd: null, periodEnd: null, cancelAtPeriodEnd: false, lastPaymentError: "Fondos insuficientes" });
    expect(l).toEqual({ text: "Pago pendiente · Fondos insuficientes", tone: "bad" });
  });
  it("terminada, prueba de la plataforma y expirada", () => {
    expect(subscriptionStatusLine({ status: "canceled", trialEnd: null, periodEnd: null, cancelAtPeriodEnd: false })?.text).toBe("Suscripción terminada");
    expect(subscriptionStatusLine({ status: "platform_trial", trialEnd: "2026-11-20T00:00:00Z", periodEnd: null, cancelAtPeriodEnd: false })?.text).toContain("sin método de pago");
    expect(subscriptionStatusLine({ status: "expired", trialEnd: null, periodEnd: null, cancelAtPeriodEnd: false })?.tone).toBe("bad");
  });
  it("el equipo y las cuentas gratis no ven nada de pago", () => {
    expect(subscriptionStatusLine({ status: "staff", trialEnd: null, periodEnd: null, cancelAtPeriodEnd: false })).toBeNull();
    expect(subscriptionStatusLine({ status: "free", trialEnd: null, periodEnd: null, cancelAtPeriodEnd: false })).toBeNull();
  });
});
