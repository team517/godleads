import { describe, expect, it } from "vitest";
import { esPagoFunnyPro, FUNNY_PRO_LINK_ID } from "../../supabase/functions/_shared/funny-pro";
import { funnyProPagado, funnyProPayUrl } from "@/lib/funny-pro";

// Funny Pro (12-11-2026): sólo un pago cobrado de la formación abre la agenda.
describe("pago de Funny Pro en el aviso de Stripe", () => {
  it("el enlace de Funny Pro cobrado cuenta", () => {
    expect(esPagoFunnyPro({ mode: "payment", payment_status: "paid", payment_link: FUNNY_PRO_LINK_ID })).toBe(true);
    expect(esPagoFunnyPro({ mode: "payment", payment_status: "paid", metadata: { plan: "formacion" } })).toBe(true);
  });
  it("sin cobrar, suscripciones u otros pagos no cuentan", () => {
    expect(esPagoFunnyPro({ mode: "payment", payment_status: "unpaid", payment_link: FUNNY_PRO_LINK_ID })).toBe(false);
    expect(esPagoFunnyPro({ mode: "subscription", payment_status: "paid", metadata: { plan: "formacion" } })).toBe(false);
    expect(esPagoFunnyPro({ mode: "payment", payment_status: "paid", payment_link: "plink_otro", metadata: { plan: "growth" } })).toBe(false);
    expect(esPagoFunnyPro(null)).toBe(false);
  });
});

describe("enlace de pago y respuesta del servidor", () => {
  it("lleva la cuenta del usuario, su correo y Stripe en español", () => {
    const u = new URL(funnyProPayUrl({ id: "11111111-2222-3333-4444-555555555555", email: "ana@acme.test" }));
    expect(u.origin + u.pathname).toBe("https://buy.stripe.com/14AeV64rQgBSbWN03K2ZO0m");
    expect(u.searchParams.get("client_reference_id")).toBe("11111111-2222-3333-4444-555555555555");
    expect(u.searchParams.get("prefilled_email")).toBe("ana@acme.test");
    expect(u.searchParams.get("locale")).toBe("es");
  });
  it("sólo una fila con paid=true del servidor desbloquea", () => {
    expect(funnyProPagado([{ paid: true, paid_at: "2026-11-12T10:00:00Z" }])).toEqual({ paid: true, paidAt: "2026-11-12T10:00:00Z" });
    expect(funnyProPagado([])).toEqual({ paid: false, paidAt: null });
    expect(funnyProPagado(null)).toEqual({ paid: false, paidAt: null });
  });
});
