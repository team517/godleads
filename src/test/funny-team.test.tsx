import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { canUseFunnyTeam } from "@/lib/access";

const sub = vi.hoisted(() => ({ status: "trialing", isAdmin: false, loading: false }));
const auth = vi.hoisted(() => ({ email: "ana@acme.com" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: auth.email } }) }));
vi.mock("@/contexts/ProfileContext", () => ({ useProfile: () => ({ profile: { full_name: "Ana Pérez", contact_email: null, is_client_manager: false } }) }));
vi.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => sub }));

const renderPage = () => render(
  <MemoryRouter initialEntries={["/funny-team"]}>
    <Routes>
      <Route path="/funny-team" element={<FunnyTeam />} />
      <Route path="/" element={<p>Inicio</p>} />
    </Routes>
  </MemoryRouter>,
);

import FunnyTeam, { bookingEmbedUrl, FUNNY_TEAM_BOOKING_URL } from "@/pages/FunnyTeam";

/* Funny Team (11-11-2026): los clientes reservan una reunión con el equipo dentro de la plataforma. */
describe("Funny Team", () => {
  beforeEach(() => { sub.status = "trialing"; sub.isAdmin = false; auth.email = "ana@acme.com"; });

  it("sólo para clientes nuevos con suscripción activa o en prueba, y para el equipo", () => {
    expect(canUseFunnyTeam("active", false)).toBe(true);
    expect(canUseFunnyTeam("trialing", false)).toBe(true);
    // Clientes del portal de la agencia (free), pruebas sin tarjeta, impagos, bajas: no.
    for (const st of ["free", "platform_trial", "needs_card", "expired", "payment_failed", "canceled", null]) {
      expect(canUseFunnyTeam(st, false)).toBe(false);
    }
    expect(canUseFunnyTeam("staff", true)).toBe(true);
  });

  it("un cliente del portal de la agencia que entra a mano en /funny-team vuelve al inicio", () => {
    sub.status = "free";
    renderPage();
    expect(screen.getByText("Inicio")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Reserva una reunión/ })).toBeNull();
  });

  it("el equipo de la agencia sí la ve (para revisarla)", () => {
    sub.status = "staff"; auth.email = "equipo@onepulso.online";
    renderPage();
    expect(screen.getByRole("heading", { name: /Reserva una reunión con tu equipo/ })).toBeTruthy();
  });

  it("la agenda va incrustada con el nombre y el correo del cliente ya puestos", () => {
    const u = new URL(bookingEmbedUrl({ name: "Ana Pérez", email: "ana@acme.com", dark: false }));
    expect(u.origin + u.pathname).toBe(FUNNY_TEAM_BOOKING_URL);
    expect(u.searchParams.get("embed")).toBe("true");
    expect(u.searchParams.get("name")).toBe("Ana Pérez");
    expect(u.searchParams.get("email")).toBe("ana@acme.com");
    expect(u.searchParams.get("theme")).toBe("light");
    expect(new URL(bookingEmbedUrl({ dark: true })).searchParams.get("name")).toBeNull();
  });

  it("pinta la cabecera, en qué ayudamos y la agenda con la integración oficial de Cal.com", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /Reserva una reunión con tu equipo/ })).toBeTruthy();
    expect(screen.getByText("Entregabilidad")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Reservar una reunión/ })).toBeTruthy();
    // Se carga el script oficial y se pide la agenda del equipo con el nombre y el correo del cliente.
    expect(document.querySelector('script[src="https://app.cal.com/embed/embed.js"]')).not.toBeNull();
    const cal = (window as any).Cal;
    const inline = [...cal.ns.funnyteam.q].reverse().find((a: any[]) => a[0] === "inline");
    expect(inline[1].calLink).toBe("xavier-falco-hszeeb/funny-team");
    expect(inline[1].config).toMatchObject({ name: "Ana Pérez", email: "ana@acme.com", layout: "month_view" });
  });
});
