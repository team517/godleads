import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { filaDesdeSesionDeEnlace } from "../../supabase/functions/_shared/stripe-plan";
import { paymentLinkFor, entitlementGivesAccess } from "@/lib/signup-flow";

/* Pago con plan B (11-11-2026): si la app no puede crear el checkout de Stripe (clave mal o Stripe
   caído), el alta abre el enlace de pago del plan con el usuario dentro, el webhook da la prueba a
   ESA cuenta sólo con el aviso firmado, y la pantalla lo detecta sola y deja entrar. */

const USER = { id: "11111111-2222-3333-4444-555555555555", email: "ana@acme.com" };

const sb = vi.hoisted(() => ({
  invoke: vi.fn(),
  entStatus: { value: null as string | null },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: sb.invoke },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    rpc: vi.fn(async () => ({ data: false })),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sb.entStatus.value ? { status: sb.entStatus.value } : null, error: null }) }) }),
    })),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: USER, signOut: vi.fn() }) }));
vi.mock("@/contexts/SubscriptionContext", async () => {
  const real = await vi.importActual<any>("@/contexts/SubscriptionContext");
  return { ...real, useSubscription: () => ({ subscribed: false, loading: false, status: "needs_card", refreshSubscription: vi.fn(async () => {}) }) };
});

import { SignupFlow } from "@/components/signup/SignupFlow";

describe("webhook sin clave: la prueba sale del aviso del enlace de pago", () => {
  it("enlace de Growth anual con 0 € → prueba de 14 días de Growth para ese cliente", () => {
    const fila = filaDesdeSesionDeEnlace({
      mode: "subscription", payment_link: "plink_1UaCMJ2ObXNkJIexE46HfZkS", metadata: { app: "warmlead", plan: "growth", billing: "yearly" },
      customer: "cus_1", subscription: "sub_1", created: 1_700_000_000, amount_total: 0,
    }, 1_700_000_005)!;
    expect(fila).toMatchObject({ tier: "growth", status: "trialing", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", billing_interval: "year" });
    expect(fila.trial_end).toBe(new Date((1_700_000_000 + 14 * 86_400) * 1000).toISOString());
  });
  it("sin el id del enlace vale la metadata nuestra; con cobro es 'active'", () => {
    expect(filaDesdeSesionDeEnlace({ mode: "subscription", metadata: { app: "warmlead", plan: "scale", billing: "monthly" }, customer: "cus_2", amount_total: 17000 }))
      .toMatchObject({ tier: "scale", status: "active", billing_interval: "month", trial_end: null });
  });
  it("pagos que no son nuestros (otro negocio, pago único, sin cliente) → nada", () => {
    expect(filaDesdeSesionDeEnlace({ mode: "subscription", metadata: { plan: "basic" }, customer: "cus_3" })).toBeNull();
    expect(filaDesdeSesionDeEnlace({ mode: "payment", payment_link: "plink_1UaCM62ObXNkJIexIHPrhQKl", customer: "cus_4" })).toBeNull();
    expect(filaDesdeSesionDeEnlace({ mode: "subscription", payment_link: "plink_1UaCM62ObXNkJIexIHPrhQKl", customer: null })).toBeNull();
  });
});

describe("enlace de pago del usuario", () => {
  it("lleva su id (para asignarle la suscripción), su correo y Stripe en español", () => {
    const u = new URL(paymentLinkFor({ plan: "starter", period: "month" }, USER));
    expect(u.origin + u.pathname).toBe("https://buy.stripe.com/aFa28kcYmbhy0e55o42ZO0g");
    expect(u.searchParams.get("client_reference_id")).toBe(USER.id);
    expect(u.searchParams.get("prefilled_email")).toBe(USER.email);
    expect(u.searchParams.get("locale")).toBe("es");
    expect(paymentLinkFor({ plan: "scale", period: "year" }, USER)).toContain("https://buy.stripe.com/5kQcMYe2q85m2mddUA2ZO0l?");
  });
  it("sólo trialing/active dan acceso", () => {
    expect(entitlementGivesAccess("trialing")).toBe(true);
    expect(entitlementGivesAccess("active")).toBe(true);
    expect(entitlementGivesAccess("past_due")).toBe(false);
    expect(entitlementGivesAccess(null)).toBe(false);
  });
});

describe("paso de la tarjeta", () => {
  beforeEach(() => { sb.invoke.mockReset(); sb.entStatus.value = null; localStorage.clear(); vi.useRealTimers(); });

  const pintar = () => render(<MemoryRouter initialEntries={["/empezar?paso=tarjeta&plan=growth&periodo=month"]}><SignupFlow mode="alta" /></MemoryRouter>);

  it("Stripe no deja crear el checkout → abre el enlace del plan en otra pestaña y, al pagar, entra solo", async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: "non-2xx", context: { json: async () => ({ error: "El pago no está disponible", stripe_unavailable: true }) } } });
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: {} } as any);
    pintar();
    const boton = await screen.findByRole("button", { name: /Añadir tarjeta y empezar/ });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(boton.getAttribute("data-via")).toBe("enlace");
    // Nunca se enseña el error de la clave: el cliente sólo ve el pago.
    expect(screen.queryByText(/no está disponible/)).toBeNull();

    fireEvent.click(boton);
    const url = String(open.mock.calls[0][0]);
    expect(url).toContain("https://buy.stripe.com/dRm14ggaydpG7Gx6s82ZO0i?");
    expect(url).toContain(`client_reference_id=${USER.id}`);
    expect(await screen.findByText("Completa el pago en la pestaña de Stripe")).toBeTruthy();

    // El webhook guarda la prueba de esta cuenta → la pantalla lo detecta (al volver a la pestaña).
    sb.entStatus.value = "trialing";
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((r) => setTimeout(r, 10)); });
    expect(await screen.findByText(/Activando tu prueba|Tu prueba de 14 días ha empezado/)).toBeTruthy();
    open.mockRestore();
  });

  it("'Ya he añadido la tarjeta' sin confirmación aún: lo explica y sigue esperando", async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: "non-2xx", context: { json: async () => ({ error: "x" }) } } });
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: {} } as any);
    pintar();
    const boton = await screen.findByRole("button", { name: /Añadir tarjeta y empezar/ });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(boton);
    fireEvent.click(await screen.findByRole("button", { name: /Ya he añadido la tarjeta/ }));
    expect(await screen.findByText(/Aún no nos ha llegado la confirmación/)).toBeTruthy();
    open.mockRestore();
  });

  it("con la clave bien: va al checkout de la app en la misma pestaña (sin enlace)", async () => {
    sb.invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_1" }, error: null });
    const open = vi.spyOn(window, "open");
    pintar();
    const boton = await screen.findByRole("button", { name: /Añadir tarjeta y empezar/ });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(boton.getAttribute("data-via")).toBe("checkout");
    expect(sb.invoke).toHaveBeenCalledWith("create-checkout", { body: { price_id: expect.any(String), trial: true, return_to: "empezar" } });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
