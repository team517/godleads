import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  CUSTOM_LEVELS, CUSTOM_PRODUCT_ID, customByMetadata, customByPaymentLink, customByPriceId, customPerMonth, customYearSavings,
  fmtVolume, parseCustomLevel,
} from "../../supabase/functions/_shared/custom-plan";
import { camposAMedida, checkoutConPrueba, filaDesdeSesionDeEnlace, leerSuscripcion } from "../../supabase/functions/_shared/stripe-plan";
import { normalizeSignup } from "../../supabase/functions/signup-flow/rules";
import { choiceFromParams, choiceHasTrial, choicePlanParam, parseSavedChoice, paymentLinkFor, priceIdFor, priceInfo } from "@/lib/signup-flow";
import { getPlanLimits } from "@/contexts/SubscriptionContext";

/* Plan a medida (11-11-2026): barra de 10 niveles (envíos, contactos, clientes y precio), pago desde
   el primer día con Stripe (checkout o, sin clave, el enlace de pago del nivel) y topes guardados en
   user_entitlements con tier "scale". */

const USER = { id: "11111111-2222-3333-4444-555555555555", email: "ana@acme.com" };

describe("tabla de niveles", () => {
  it("10 niveles con los precios acordados y el anual = round(mes × 0,83) × 12", () => {
    expect(CUSTOM_LEVELS.map((l) => [l.emails, l.contacts, l.clients, l.eurMonth])).toEqual([
      [250_000, 85_000, 6, 99], [400_000, 135_000, 8, 149], [600_000, 200_000, 10, 209], [800_000, 270_000, 12, 269],
      [1_000_000, 340_000, 14, 319], [1_500_000, 500_000, 16, 449], [2_000_000, 670_000, 18, 569], [3_000_000, 1_000_000, 20, 799],
      [4_000_000, 1_350_000, 22, 1019], [5_000_000, 1_700_000, 25, 1229],
    ]);
    for (const l of CUSTOM_LEVELS) expect(l.eurYear).toBe(Math.round(l.eurMonth * 0.83) * 12);
  });
  it("todo sube con el nivel, pero cada 1.000 envíos salen más baratos; los clientes suben poco", () => {
    for (let i = 1; i < CUSTOM_LEVELS.length; i++) {
      const a = CUSTOM_LEVELS[i - 1], b = CUSTOM_LEVELS[i];
      expect(b.emails).toBeGreaterThan(a.emails);
      expect(b.contacts).toBeGreaterThan(a.contacts);
      expect(b.eurMonth).toBeGreaterThan(a.eurMonth);
      expect(b.clients - a.clients).toBeLessThanOrEqual(3);
      expect(b.eurMonth / b.emails).toBeLessThan(a.eurMonth / a.emails);
    }
  });
  it("cada nivel tiene sus 2 precios y sus 2 enlaces de pago, todos distintos", () => {
    const ids = CUSTOM_LEVELS.flatMap((l) => [l.priceMonth, l.priceYear, l.plinkMonth, l.plinkYear, l.linkMonth, l.linkYear]);
    expect(new Set(ids).size).toBe(60);
    for (const l of CUSTOM_LEVELS) {
      expect(l.priceMonth).toMatch(/^price_/); expect(l.plinkYear).toMatch(/^plink_/); expect(l.linkMonth).toMatch(/^https:\/\/buy\.stripe\.com\//);
    }
  });
  it("búsquedas por precio, enlace, metadata y formato", () => {
    expect(customByPriceId("price_1Uafny2ObXNkJIext0ou0oZK")).toMatchObject({ interval: "month", level: { level: 5 } });
    expect(customByPriceId("price_1Uafoc2ObXNkJIextbOwIEOL")).toMatchObject({ interval: "year", level: { level: 10 } });
    expect(customByPriceId("price_1UaCJz2ObXNkJIexLnC0KEao")).toBeNull();
    expect(customByPaymentLink("plink_1UafqP2ObXNkJIexX2l4MrXn")).toMatchObject({ interval: "year", level: { level: 6 } });
    expect(customByMetadata({ plan: "custom", level: "7" })?.emails).toBe(2_000_000);
    expect(customByMetadata({ plan: "scale" })).toBeNull();
    expect(parseCustomLevel("custom-3")).toBe(3); expect(parseCustomLevel("11")).toBeNull();
    expect(fmtVolume(250_000)).toBe("250K"); expect(fmtVolume(1_500_000)).toBe("1,5M"); expect(fmtVolume(5_000_000)).toBe("5M");
    expect(customPerMonth(CUSTOM_LEVELS[4], "year")).toBe(265);
    expect(customYearSavings(CUSTOM_LEVELS[0])).toBe(99 * 12 - 984);
  });
});

describe("servidor: Stripe → user_entitlements", () => {
  it("una suscripción con un precio a medida da tier scale y los topes de su nivel", () => {
    const r = leerSuscripcion([{ productId: CUSTOM_PRODUCT_ID, priceId: "price_1UafoV2ObXNkJIexygRmrDgK", quantity: 1 }], null);
    expect(r).toMatchObject({ esNuestra: true, tier: "scale", custom: { level: 8, emails: 3_000_000, clients: 20 } });
    expect(camposAMedida(r.custom)).toEqual({ custom_level: 8, plan_emails_month: 3_000_000, plan_contacts: 1_000_000, plan_clients: 20 });
    expect(camposAMedida(r.custom, true)).toEqual({ custom_level: null, plan_emails_month: null, plan_contacts: null, plan_clients: null });
  });
  it("un precio nuevo del producto a medida se lee por su metadata; y la de la suscripción como último recurso", () => {
    expect(leerSuscripcion([{ productId: CUSTOM_PRODUCT_ID, priceId: "price_nuevo", quantity: 1, priceTier: "custom", priceLevel: "2" }], null).custom?.level).toBe(2);
    expect(leerSuscripcion([{ productId: "prod_x", priceId: "price_x", quantity: 1 }], "custom", "", "4")).toMatchObject({ tier: "scale", custom: { level: 4 } });
  });
  it("sin clave de Stripe: el aviso del enlace de pago a medida activa el plan (sin prueba) con sus topes", () => {
    const fila = filaDesdeSesionDeEnlace({
      mode: "subscription", payment_link: "plink_1Uafpi2ObXNkJIexvxpRQhoI", metadata: { app: "warmlead", plan: "custom", level: "5", billing: "monthly" },
      customer: "cus_9", subscription: "sub_9", created: Date.UTC(2026, 10, 11) / 1000, amount_total: 31900,
    })!;
    expect(fila).toMatchObject({ tier: "scale", status: "active", trial_end: null, custom_level: 5, plan_emails_month: 1_000_000, plan_clients: 14, billing_interval: "month" });
    expect(fila.current_period_end).toBe(new Date(Date.UTC(2026, 11, 11)).toISOString());
    // Y un enlace normal deja las columnas a medida vacías.
    expect(filaDesdeSesionDeEnlace({ mode: "subscription", payment_link: "plink_1UaCM62ObXNkJIexIHPrhQKl", customer: "cus_1", amount_total: 0 })).toMatchObject({ tier: "starter", custom_level: null });
  });
  it("create-checkout: el plan a medida nunca lleva prueba", () => {
    expect(checkoutConPrueba("price_1Uafnl2ObXNkJIexMwu7C1xf", true, false)).toBe(false);
    expect(checkoutConPrueba("price_1UaCJz2ObXNkJIexLnC0KEao", true, false)).toBe(true);
    expect(checkoutConPrueba("price_1UaCJz2ObXNkJIexLnC0KEao", true, true)).toBe(false);
  });
  it("el alta guarda el nivel como custom-N", () => {
    const v = normalizeSignup({ name: "Ana", email: "ana@acme.com", password: "clave1234", plan: "custom", level: 6, period: "year" });
    expect(v).toMatchObject({ ok: true, value: { plan: "custom-6", period: "year" } });
    expect(normalizeSignup({ name: "Ana", email: "ana@acme.com", password: "clave1234", plan: "custom-11" })).toMatchObject({ value: { plan: "starter" } });
  });
});

describe("app: elección y límites", () => {
  it("?plan=custom&nivel=5 → plan a medida sin prueba, con su precio y su enlace", () => {
    const c = choiceFromParams(new URLSearchParams("plan=custom&nivel=5&periodo=year"));
    expect(c).toEqual({ plan: "custom", period: "year", level: 5 });
    expect(choiceHasTrial(c)).toBe(false);
    expect(choicePlanParam(c)).toBe("custom-5");
    expect(priceIdFor(c)).toBe("price_1Uafnz2ObXNkJIexIBSMra11");
    expect(priceInfo(c)).toMatchObject({ perMonth: 265, charge: 3180 });
    const u = new URL(paymentLinkFor(c, USER));
    expect(u.origin + u.pathname).toBe("https://buy.stripe.com/3cI9AM1fE4TaaSJbMs2ZO0w");
    expect(u.searchParams.get("client_reference_id")).toBe(USER.id);
    expect(parseSavedChoice(JSON.stringify(c))).toEqual(c);
    expect(choiceFromParams(new URLSearchParams("plan=custom-2"))).toMatchObject({ plan: "custom", level: 2 });
  });
  it("los límites del plan a medida mandan sobre los de Scale", () => {
    expect(getPlanLimits("scale", false, { level: 7, emailsPerMonth: 2_000_000, contacts: 670_000, clients: 18 }))
      .toMatchObject({ emailsPerMonth: 2_000_000, maxLeads: 670_000, maxClients: 18 });
    expect(getPlanLimits("scale", false, null)).toMatchObject({ emailsPerMonth: 500_000, maxClients: 10 });
  });
});

/* ── Pantallas ─────────────────────────────────────────────────────────────────────────── */

const sb = vi.hoisted(() => ({ invoke: vi.fn(), ent: { value: null as any }, user: { value: null as any }, sub: { value: {} as any } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: sb.invoke },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    rpc: vi.fn(async () => ({ data: false })),
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sb.ent.value, error: null }) }) }) })),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: sb.user.value, signOut: vi.fn() }) }));
vi.mock("@/contexts/SubscriptionContext", async () => {
  const real = await vi.importActual<any>("@/contexts/SubscriptionContext");
  return {
    ...real,
    useSubscription: () => ({
      subscribed: false, loading: false, status: "needs_card", customPlan: null, hasStripeSubscription: false, entitlement: null,
      refreshSubscription: vi.fn(async () => {}), ...sb.sub.value,
    }),
  };
});

import { CustomPlanBuilder } from "@/components/pricing/CustomPlanBuilder";
import { SignupFlow } from "@/components/signup/SignupFlow";

function Donde() { const l = useLocation(); return <p data-testid="donde">{l.pathname + l.search}</p>; }

describe("barra del plan a medida (Ajustes → Plan)", () => {
  beforeEach(() => { sb.invoke.mockReset(); sb.ent.value = null; sb.user.value = USER; sb.sub.value = {}; });

  const pintar = () => render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes><Route path="/settings" element={<CustomPlanBuilder />} /><Route path="/empezar" element={<Donde />} /></Routes>
    </MemoryRouter>,
  );

  it("mover la barra cambia envíos, contactos, clientes y precio; anual enseña el total y el ahorro", async () => {
    pintar();
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "3");
    await act(async () => { fireEvent.keyDown(thumb, { key: "ArrowRight" }); });
    expect(thumb).toHaveAttribute("aria-valuenow", "4");
    await waitFor(() => expect(screen.getByText("800.000")).toBeTruthy());
    expect(screen.getByText("Nivel 4 de 10")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Anual/ }));
    expect(screen.getByTestId("custom-billing-note").textContent).toMatch(/Facturado 2\.?676 € al año · ahorras 552 €/);
  });

  it("elegir → confirmar → 'Creando tu enlace de pago…' → sin clave abre el enlace del nivel con la cuenta dentro", async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: "non-2xx", context: { json: async () => ({ error: "El pago no está disponible", stripe_unavailable: true }) } } });
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: {} } as any);
    pintar();
    fireEvent.click(screen.getByTestId("custom-elegir"));
    expect(await screen.findByText("Confirma tu plan a medida")).toBeTruthy();
    expect(screen.getByTestId("custom-resumen").textContent).toMatch(/600\.000.*200\.000.*10.*209 € al mes/);
    await waitFor(() => expect(sb.invoke).toHaveBeenCalledWith("create-checkout", { body: { price_id: "price_1Uafnq2ObXNkJIex2WRv1VZo" } }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { fireEvent.click(screen.getByTestId("custom-confirmar")); });
    const url = new URL(String(open.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://buy.stripe.com/cNi4gsbUi85m5ypeYE2ZO0r");
    expect(url.searchParams.get("client_reference_id")).toBe(USER.id);
    expect(await screen.findByText("Completa el pago en la pestaña de Stripe")).toBeTruthy();
    // El webhook guarda el plan a medida de ESTA cuenta → la ventana lo detecta.
    sb.ent.value = { status: "active", custom_level: 3 };
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((r) => setTimeout(r, 10)); });
    expect(await screen.findByText("¡Listo! Tu plan a medida está activo")).toBeTruthy();
    open.mockRestore();
  });

  it("quien ya paga una suscripción cambia SU plan (nunca un segundo pago)", async () => {
    sb.sub.value = { hasStripeSubscription: true, subscribed: true, status: "active" };
    sb.invoke.mockResolvedValue({ data: { updated: true }, error: null });
    const open = vi.spyOn(window, "open");
    pintar();
    fireEvent.click(screen.getByTestId("custom-elegir"));
    expect(sb.invoke).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(await screen.findByTestId("custom-confirmar")); });
    expect(sb.invoke).toHaveBeenCalledWith("create-checkout", { body: { price_id: "price_1Uafnq2ObXNkJIex2WRv1VZo" } });
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByText("Cambiando tu plan…")).toBeTruthy();
    open.mockRestore();
  });

  it("sin sesión (landing) lleva al alta con el nivel y el periodo", () => {
    sb.user.value = null;
    pintar();
    fireEvent.click(screen.getByTestId("custom-elegir"));
    expect(screen.getByTestId("donde").textContent).toBe("/empezar?plan=custom&nivel=3&periodo=month");
  });
});

describe("alta con plan a medida", () => {
  beforeEach(() => { sb.invoke.mockReset(); sb.user.value = USER; sb.sub.value = {}; localStorage.clear(); });

  it("el plan dice que se paga hoy (no 0 €) y la tarjeta 'se cobra hoy', sin pedir prueba a Stripe", async () => {
    sb.invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_1" }, error: null });
    sb.user.value = null;
    const { unmount } = render(<MemoryRouter initialEntries={["/empezar?plan=custom&nivel=5&periodo=month"]}><SignupFlow mode="alta" /></MemoryRouter>);
    expect(screen.getByTestId("hoy-pagas").textContent).toBe("319 €");
    expect(screen.queryByText(/hoy no te cobramos nada/i)).toBeNull();
    unmount();
    sb.user.value = USER;
    render(<MemoryRouter initialEntries={["/empezar?paso=tarjeta&plan=custom&nivel=5&periodo=month"]}><SignupFlow mode="alta" /></MemoryRouter>);
    expect(await screen.findByText("Paga tu plan a medida")).toBeTruthy();
    expect(screen.getByTestId("se-cobra-hoy").textContent).toBe("319 €");
    await waitFor(() => expect(sb.invoke).toHaveBeenCalledWith("create-checkout", { body: { price_id: "price_1Uafny2ObXNkJIext0ou0oZK", trial: false, return_to: "empezar" } }));
  });
});
