import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { normalizeSignup, pickAppOrigin, verificationEmailHtml } from "../../supabase/functions/signup-flow/rules";
import { publicStripeError } from "../../supabase/functions/_shared/stripe-plan";

/* Alta con verificación propia (11-11-2026): el correo lo manda team@ con un botón a funnyleads.com
   (no a supabase.co, que Gmail marcaba como peligroso); el botón verifica, abre la sesión y lleva
   directo a la tarjeta; y nunca se enseña en pantalla un error crudo de Stripe con la clave. */

const sb = vi.hoisted(() => ({
  invoke: vi.fn(),
  verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
  getSession: vi.fn(async () => ({ data: { session: null as any } })),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: sb.invoke }, auth: { verifyOtp: sb.verifyOtp, getSession: sb.getSession, signOut: sb.signOut, signInWithPassword: vi.fn() }, rpc: vi.fn(async () => ({ data: false })), from: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }));
vi.mock("@/contexts/SubscriptionContext", async () => {
  const real = await vi.importActual<any>("@/contexts/SubscriptionContext");
  return { ...real, useSubscription: () => ({ subscribed: false, loading: false, status: "needs_card", refreshSubscription: vi.fn() }) };
});

import VerificarCuenta from "@/pages/VerificarCuenta";
import { SignupFlow, mensajePago } from "@/components/signup/SignupFlow";

function Donde() { const l = useLocation(); return <p data-testid="donde">{l.pathname + l.search}</p>; }

const verificar = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/empezar/verificar" element={<VerificarCuenta />} />
      <Route path="/empezar" element={<Donde />} />
    </Routes>
  </MemoryRouter>,
);

describe("reglas del alta (servidor)", () => {
  it("el botón del correo vuelve a un sitio nuestro; cualquier otro origen va a www.funnyleads.com", () => {
    expect(pickAppOrigin("https://www.funnyleads.com")).toBe("https://www.funnyleads.com");
    expect(pickAppOrigin("https://funnyleads.com")).toBe("https://www.funnyleads.com");
    expect(pickAppOrigin("https://backend-onepulso-platfomr.25kofp.easypanel.host")).toBe("https://backend-onepulso-platfomr.25kofp.easypanel.host");
    expect(pickAppOrigin("http://localhost:4173")).toBe("http://localhost:4173");
    expect(pickAppOrigin("https://malo.example")).toBe("https://www.funnyleads.com");
    expect(pickAppOrigin(null)).toBe("https://www.funnyleads.com");
  });
  it("valida como la pantalla (nombre, correo, 8+ con letras y números) y normaliza plan y periodo", () => {
    const ok = normalizeSignup({ name: " Ana ", email: " ANA@Acme.com ", password: "clave1234", plan: "growth", period: "year" });
    expect(ok).toEqual({ ok: true, value: { name: "Ana", company: "", email: "ana@acme.com", password: "clave1234", plan: "growth", period: "year" } });
    expect(normalizeSignup({ name: "Ana", email: "ana@acme.com", password: "contraseña1", plan: "x" })).toMatchObject({ ok: true, value: { plan: "starter", period: "month" } });
    expect(normalizeSignup({ name: "A", email: "ana@acme.com", password: "clave1234" }).ok).toBe(false);
    expect(normalizeSignup({ name: "Ana", email: "ana", password: "clave1234" }).ok).toBe(false);
    expect(normalizeSignup({ name: "Ana", email: "ana@acme.com", password: "solamenteletras" }).ok).toBe(false);
  });
  it("el correo: botón 'Verificar mi cuenta' a funnyleads.com, sin enlaces a supabase.co, y escapa el nombre", () => {
    const html = verificationEmailHtml({ name: "Ana <b>García</b>", link: "https://www.funnyleads.com/empezar/verificar?t=abc" });
    expect(html).toContain("Verificar mi cuenta");
    expect(html).toContain('href="https://www.funnyleads.com/empezar/verificar?t=abc"');
    expect(html).not.toMatch(/supabase\.co/);
    expect(html).toContain("Hola Ana");
    expect(html).not.toContain("<b>García</b>");
  });
  it("Stripe: un problema de clave nunca enseña la clave, sale 'el pago no está disponible'", () => {
    const e = Object.assign(new Error("Invalid API Key provided: npxsupab*****zpzi"), { type: "StripeAuthenticationError" });
    const pub = publicStripeError(e);
    expect(pub.stripeUnavailable).toBe(true);
    expect(pub.message).not.toMatch(/npxsupab|API Key/i);
    expect(publicStripeError(new Error("No such price: sk_live_abc123")).message).not.toContain("sk_live_abc123");
  });
});

describe("mensajes del pago en pantalla", () => {
  it("errores técnicos o de clave → mensaje amable; el resto, tal cual", () => {
    expect(mensajePago("Invalid API Key provided: npxsupab****zpzi")).toMatch(/El pago no está disponible/);
    expect(mensajePago("Edge Function returned a non-2xx status code")).toMatch(/El pago no está disponible/);
    expect(mensajePago("")).toMatch(/El pago no está disponible/);
    expect(mensajePago("Precio no válido")).toBe("Precio no válido");
  });
});

describe("página del botón del correo (/empezar/verificar)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    sb.invoke.mockReset(); sb.verifyOtp.mockClear(); sb.signOut.mockClear();
    sb.getSession.mockResolvedValue({ data: { session: null } });
  });

  it("verifica, abre la sesión y pasa sola a la tarjeta con el plan elegido", async () => {
    sb.invoke.mockResolvedValue({ data: { verified: true, email: "ana@acme.com", token_hash: "th_1", plan: "growth", period: "year" }, error: null });
    vi.useFakeTimers();
    verificar("/empezar/verificar?t=" + "a".repeat(43));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(sb.invoke).toHaveBeenCalledWith("signup-flow", { body: { action: "verify", token: "a".repeat(43) } });
    expect(sb.verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "th_1" });
    expect(screen.getByText("¡Cuenta verificada!")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByTestId("donde").textContent).toBe("/empezar?paso=tarjeta&plan=growth&periodo=year&verificado=1");
  });

  it("si el navegador tenía abierta OTRA cuenta, la cierra antes de entrar con la nueva", async () => {
    sb.getSession.mockResolvedValue({ data: { session: { user: { email: "otra@empresa.com" } } } });
    sb.invoke.mockResolvedValue({ data: { verified: true, email: "ana@acme.com", token_hash: "th_2", plan: "starter", period: "month" }, error: null });
    verificar("/empezar/verificar?t=" + "b".repeat(43));
    await screen.findByText("¡Cuenta verificada!");
    expect(sb.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(sb.verifyOtp).toHaveBeenCalled();
  });

  it("enlace caducado o roto: lo explica y no abre ninguna sesión", async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: "expired_link" }) } } });
    verificar("/empezar/verificar?t=" + "c".repeat(43));
    expect(await screen.findByText("El enlace ha caducado")).toBeTruthy();
    expect(sb.verifyOtp).not.toHaveBeenCalled();
  });

  it("sin token en la dirección: 'Este enlace no es válido' sin llamar al servidor", async () => {
    verificar("/empezar/verificar");
    expect(await screen.findByText("Este enlace no es válido")).toBeTruthy();
    expect(sb.invoke).not.toHaveBeenCalled();
  });
});

describe("formulario de cuenta → signup-flow", () => {
  beforeEach(() => { sb.invoke.mockReset(); localStorage.clear(); });

  const rellenar = () => {
    fireEvent.change(screen.getByLabelText("Tu nombre"), { target: { value: "Ana García" } });
    fireEvent.change(screen.getByLabelText("Correo de trabajo"), { target: { value: "Ana@Acme.com" } });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "clave12345" } });
    fireEvent.click(screen.getByRole("checkbox"));
  };

  it("crea la cuenta en el servidor (no con signUp de Supabase) y espera la verificación", async () => {
    sb.invoke.mockResolvedValue({ data: { user_id: "11111111-2222-3333-4444-555555555555" }, error: null });
    render(<MemoryRouter initialEntries={["/empezar?paso=cuenta&plan=growth&periodo=month"]}><SignupFlow mode="alta" /></MemoryRouter>);
    rellenar();
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /Crear cuenta|Continuar/ }).closest("form")!); });
    expect(sb.invoke).toHaveBeenCalledWith("signup-flow", { body: expect.objectContaining({ action: "start", email: "ana@acme.com", name: "Ana García", plan: "growth", period: "month" }) });
    expect(await screen.findByText("Confirma tu correo")).toBeTruthy();
    expect(screen.getByText(/Verificar mi cuenta/)).toBeTruthy();
  });

  it("correo ya registrado: lo dice y ofrece iniciar sesión", async () => {
    sb.invoke.mockResolvedValue({ data: null, error: { message: "non-2xx", context: { json: async () => ({ error: "already_registered" }) } } });
    render(<MemoryRouter initialEntries={["/empezar?paso=cuenta"]}><SignupFlow mode="alta" /></MemoryRouter>);
    rellenar();
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /Crear cuenta|Continuar/ }).closest("form")!); });
    expect(await screen.findByText(/Ya hay una cuenta con este correo/)).toBeTruthy();
  });
});
