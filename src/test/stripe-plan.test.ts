import { describe, expect, it } from "vitest";
import { leerSuscripcion, PRECIOS_FUNNYLEADS, rangoEstado, tierDeMetadata } from "../../supabase/functions/_shared/stripe-plan";

describe("leerSuscripcion", () => {
  it("producto antiguo de la app", () => {
    expect(leerSuscripcion([{ productId: "prod_U29mEi2w9ltRwG", priceId: "p", quantity: 1 }], null))
      .toEqual({ esNuestra: true, tier: "growth", extraSlots: 0 });
  });
  it("productos de Funnyleads (landing 10-11-2026)", () => {
    expect(leerSuscripcion([{ productId: "prod_VbP8mquDtmuTKr", priceId: "p", quantity: 1 }], null).tier).toBe("starter");
    expect(leerSuscripcion([{ productId: "prod_VbP8T2qoDDeJOO", priceId: "p", quantity: 1 }], null).tier).toBe("growth");
    expect(leerSuscripcion([{ productId: "prod_VbP8hN9R1brqFJ", priceId: "p", quantity: 1 }], null).tier).toBe("scale");
  });
  it("precio de Funnyleads aunque el producto no venga", () => {
    for (const [priceId, { tier }] of Object.entries(PRECIOS_FUNNYLEADS)) {
      expect(leerSuscripcion([{ productId: "", priceId, quantity: 1 }], null).tier).toBe(tier);
    }
  });
  it("precio nuevo con metadata.tier o metadata.plan", () => {
    expect(leerSuscripcion([{ productId: "prod_nuevo", priceId: "p", quantity: 1, priceTier: "Scale" }], null).tier).toBe("scale");
    expect(leerSuscripcion([{ productId: "prod_nuevo", priceId: "p", quantity: 1, productTier: "growth" }], null).tier).toBe("growth");
  });
  it("metadata de la suscripción como último recurso (tier o plan)", () => {
    expect(leerSuscripcion([{ productId: "prod_nuevo", priceId: "p", quantity: 1 }], "starter").tier).toBe("starter");
    expect(tierDeMetadata({ app: "warmlead", plan: "growth", billing: "monthly" })).toBe("growth");
    expect(tierDeMetadata({ tier: "scale" })).toBe("scale");
    expect(tierDeMetadata(null)).toBeNull();
  });
  it("una suscripción de OTRO negocio de la misma cuenta se ignora (antes bajaba a free)", () => {
    expect(leerSuscripcion([{ productId: "prod_otro", priceId: "p", quantity: 1 }], null)).toEqual({ esNuestra: false, tier: null, extraSlots: 0 });
    // La mensualidad de la agencia (MENSUALIDAD ONEPULSO) tampoco es un plan del software.
    expect(leerSuscripcion([{ productId: "prod_UlhBnHZKPBvPCz", priceId: "price_1Tm9mf2ObXNkJIexmKk1Pn0M", quantity: 1 }], null).esNuestra).toBe(false);
  });
  it("plazas de cliente extra", () => {
    const r = leerSuscripcion([
      { productId: "prod_U29mvQRMbo5m6f", priceId: "p1", quantity: 1 },
      { productId: "prod_slot", priceId: "slot", quantity: 3 },
    ], null, "slot");
    expect(r).toEqual({ esNuestra: true, tier: "starter", extraSlots: 3 });
  });
  it("la mejor suscripción: active > trialing > past_due > unpaid > canceled", () => {
    expect(rangoEstado("active")).toBeGreaterThan(rangoEstado("trialing"));
    expect(rangoEstado("trialing")).toBeGreaterThan(rangoEstado("past_due"));
    expect(rangoEstado("past_due")).toBeGreaterThan(rangoEstado("unpaid"));
    expect(rangoEstado("unpaid")).toBeGreaterThan(rangoEstado("canceled"));
  });
});
