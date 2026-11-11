import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* Alta con prueba gratuita (11-11-2026), pantalla. Una cuenta con sesión y sin prueba con tarjeta
   ("Activa tu prueba gratuita") elige plan y pide la tarjeta: create-checkout con trial y vuelta a
   /empezar, y se va a la URL de Stripe que devuelve. Sin sesión, el alta empieza por el plan. */

const st = vi.hoisted(() => ({
  user: { id: "u1", email: "ana@acme.com" } as null | { id: string; email: string },
  subscribed: false,
  status: "needs_card",
  ent: null as null | { status: string; custom_level?: number | null },
  invoke: vi.fn(async () => ({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_123", trial: true }, error: null })),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: st.user, signOut: vi.fn() }) }));
vi.mock("@/contexts/SubscriptionContext", async () => {
  const real = await vi.importActual<any>("@/contexts/SubscriptionContext");
  return { ...real, useSubscription: () => ({ subscribed: st.subscribed, loading: false, status: st.status, refreshSubscription: vi.fn(async () => {}) }) };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: st.invoke }, auth: { signUp: vi.fn() },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: st.ent, error: null }) }) }) })) },
}));

import { SignupFlow } from "@/components/signup/SignupFlow";

const pinta = (mode: "alta" | "activar", url = "/empezar") =>
  render(<MemoryRouter initialEntries={[url]}><SignupFlow mode={mode} /></MemoryRouter>);

describe("alta con tarjeta — pantalla", () => {
  beforeEach(() => {
    localStorage.clear();
    st.user = { id: "u1", email: "ana@acme.com" };
    st.subscribed = false; st.status = "needs_card"; st.ent = null;
    st.invoke.mockClear();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, href: "http://localhost/empezar", origin: "http://localhost" } });
  });

  it("'Activa tu prueba gratuita': Starter mensual preseleccionado, hoy 0 €, sin paso de cuenta", () => {
    pinta("activar");
    expect(screen.getByText("Activa tu prueba gratuita")).toBeTruthy();
    expect(screen.getByText("14 días gratis, hoy no te cobramos nada")).toBeTruthy();
    const starter = screen.getAllByRole("radio").find((r) => /Starter/.test(r.textContent || ""))!;
    expect(starter.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Tu cuenta")).toBeNull();
    expect(screen.getAllByText("0 €").length).toBeGreaterThan(0);
  });

  it("al pedir la tarjeta llama a create-checkout con la prueba y va a la página de pago de Stripe", async () => {
    pinta("activar", "/empezar?plan=growth&periodo=year");
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    expect(await screen.findByText("Añade tu tarjeta para activar la prueba")).toBeTruthy();
    expect(screen.getByText("Plan Growth")).toBeTruthy();
    expect(screen.getByText("648 € al año")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Añadir tarjeta y empezar mi prueba/ })); });
    expect(st.invoke).toHaveBeenCalledWith("create-checkout", { body: { price_id: "price_1UaCKB2ObXNkJIexITFdvpKA", trial: true, return_to: "empezar" } });
    expect(window.location.href).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
  });

  it("visitante sin sesión: el alta tiene los tres pasos y empieza por el plan", () => {
    st.user = null; st.status = "free";
    pinta("alta");
    expect(screen.getByText("Empieza gratis")).toBeTruthy();
    for (const p of ["Tu prueba", "Tu cuenta", "Tu tarjeta"]) expect(screen.getByText(p)).toBeTruthy();
  });

  it("?paso=listo por sí solo NUNCA enseña '¡Listo!': sólo cuando el servidor confirma", async () => {
    st.ent = null;
    const { unmount } = pinta("alta", "/empezar?paso=listo");
    expect(screen.getByText("Confirmando tu tarjeta con Stripe…")).toBeTruthy();
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByText(/¡Listo!/)).toBeNull();
    expect(screen.queryByRole("button", { name: /ya he (pagado|añadido)|comprobar/i })).toBeNull();
    unmount();
    // El webhook firmado de Stripe escribe la prueba de esta cuenta → procesando → listo.
    st.ent = { status: "trialing" };
    pinta("alta", "/empezar?paso=listo");
    expect(await screen.findByText("Pago recibido · Procesando tu plan…")).toBeTruthy();
    expect(await screen.findByText(/¡Listo! Tu prueba de 14 días ha empezado/, {}, { timeout: 4000 })).toBeTruthy();
  });
});
