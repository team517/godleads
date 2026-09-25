import { describe, expect, it } from "vitest";
import { leerSuscripcion } from "../../supabase/functions/_shared/stripe-plan";

describe("leerSuscripcion", () => {
  it("producto antiguo de la app", () => {
    expect(leerSuscripcion([{ productId: "prod_U29mEi2w9ltRwG", priceId: "p", quantity: 1 }], null))
      .toEqual({ esNuestra: true, tier: "growth", extraSlots: 0 });
  });
  it("precio nuevo de la landing (metadata.tier)", () => {
    expect(leerSuscripcion([{ productId: "prod_nuevo", priceId: "p", quantity: 1, priceTier: "Scale" }], null).tier).toBe("scale");
  });
  it("metadata de la suscripción como último recurso", () => {
    expect(leerSuscripcion([{ productId: "prod_nuevo", priceId: "p", quantity: 1 }], "starter").tier).toBe("starter");
  });
  it("una suscripción de OTRO negocio de la misma cuenta se ignora (antes bajaba a free)", () => {
    expect(leerSuscripcion([{ productId: "prod_otro", priceId: "p", quantity: 1 }], null)).toEqual({ esNuestra: false, tier: null, extraSlots: 0 });
  });
  it("plazas de cliente extra", () => {
    const r = leerSuscripcion([
      { productId: "prod_U29mvQRMbo5m6f", priceId: "p1", quantity: 1 },
      { productId: "prod_slot", priceId: "slot", quantity: 3 },
    ], null, "slot");
    expect(r).toEqual({ esNuestra: true, tier: "starter", extraSlots: 3 });
  });
});
