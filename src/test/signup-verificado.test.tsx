import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* Alta (11-11-2026): la pestaña que espera "Confirma tu correo" se entera sola de la confirmación,
   enseña "¡Cuenta verificada!", abre la sesión y el alta pasa a la tarjeta. */

const sb = vi.hoisted(() => ({
  confirmado: false,
  rpc: vi.fn(),
  signIn: vi.fn(async () => ({ data: {}, error: null as null | { message: string } })),
  getSession: vi.fn(async () => ({ data: { session: null } })),
  invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
}));
sb.rpc.mockImplementation(async () => ({ data: sb.confirmado, error: null }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }));
vi.mock("@/contexts/SubscriptionContext", async () => {
  const real = await vi.importActual<any>("@/contexts/SubscriptionContext");
  return { ...real, useSubscription: () => ({ subscribed: false, loading: false, status: "needs_card", refreshSubscription: vi.fn() }) };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: sb.rpc, auth: { signInWithPassword: sb.signIn, getSession: sb.getSession }, functions: { invoke: sb.invoke }, from: vi.fn() },
}));

import { ConfirmaCorreo } from "@/components/signup/SignupFlow";

const pinta = () => render(
  <MemoryRouter>
    <ConfirmaCorreo email="ana@acme.com" userId="11111111-2222-3333-4444-555555555555" password="Secreta-123" choice={{ plan: "starter", period: "month" }} />
  </MemoryRouter>,
);

describe("alta — confirmación del correo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sb.confirmado = false;
    sb.rpc.mockClear(); sb.signIn.mockClear(); sb.invoke.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("pregunta por el id del alta (no por el correo) mientras espera", async () => {
    pinta();
    expect(screen.getByText("Confirma tu correo")).toBeTruthy();
    expect(screen.getByText(/Esperando la confirmación/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(6100); });
    expect(sb.rpc).toHaveBeenCalledWith("signup_email_confirmed", { p_user: "11111111-2222-3333-4444-555555555555" });
    expect(sb.rpc.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sb.signIn).not.toHaveBeenCalled();
  });

  it("en cuanto se confirma: '¡Cuenta verificada!' y abre la sesión para ir a la tarjeta", async () => {
    pinta();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    sb.confirmado = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText("¡Cuenta verificada!")).toBeTruthy();
    expect(screen.getByText(/Te llevamos al último paso/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(sb.signIn).toHaveBeenCalledWith({ email: "ana@acme.com", password: "Secreta-123" });
    expect(sessionStorage.getItem("fl_signup_verified")).toBe("1");
    // Ya no sigue preguntando.
    const n = sb.rpc.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(sb.rpc.mock.calls.length).toBe(n);
  });

  it("si no puede abrir la sesión, lo dice y ofrece iniciar sesión", async () => {
    sb.confirmado = true;
    sb.signIn.mockResolvedValueOnce({ data: {}, error: { message: "Invalid login" } });
    pinta();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText("¡Cuenta verificada!")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Iniciar sesión/ })).toBeTruthy();
  });

  it("reenviar el correo, tras la espera, lo pide al servidor (lo manda team@) para ese alta", async () => {
    pinta();
    expect(screen.getByText(/reenvíalo en 60 s/)).toBeTruthy();
    for (let i = 0; i < 61; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    fireEvent.click(screen.getByRole("button", { name: /reenvía el correo/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(sb.invoke).toHaveBeenCalledWith("signup-flow", { body: { action: "resend", user_id: "11111111-2222-3333-4444-555555555555" } });
    expect(screen.getByText("Te lo hemos vuelto a enviar.")).toBeTruthy();
  });
});

describe("alta — si el primer correo no salió", () => {
  it("lo dice y deja reenviarlo al momento", () => {
    render(
      <MemoryRouter>
        <ConfirmaCorreo email="ana@acme.com" userId="11111111-2222-3333-4444-555555555555" password="Secreta-123" choice={{ plan: "starter", period: "month" }} mailFailed />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No hemos podido enviarte el correo/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reenvía el correo/ })).toBeTruthy();
  });
});
