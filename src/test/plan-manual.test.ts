import { describe, expect, it } from "vitest";
import { decideAccess } from "@/lib/access";

// Plan concedido a mano por el equipo (cuenta de prueba): active, sin Stripe, con fin a un año.
describe("plan concedido a mano", () => {
  it("un alta nueva sin tarjeta con fila active de Starter entra como suscrita", () => {
    const d = decideAccess({
      email: "prueba@ejemplo.com", role: "client", isClientManager: false, allowedRoutes: null, contactEmail: null,
      createdAt: "2026-11-11T14:36:50Z", stripeSubscribed: false,
      entitlement: { status: "active", tier: "starter", trialEnd: null, currentPeriodEnd: "2027-11-11T00:00:00Z", cancelAtPeriodEnd: false, lastPaymentError: null },
    } as any);
    expect(d.kind).toBe("subscribed");
    expect((d as any).tier).toBe("starter");
  });
});
