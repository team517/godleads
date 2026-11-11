import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "ana@acme.com" } }) }));
vi.mock("@/contexts/ProfileContext", () => ({ useProfile: () => ({ profile: { full_name: "Ana Pérez", contact_email: null } }) }));

import FunnyTeam, { bookingEmbedUrl, FUNNY_TEAM_BOOKING_URL } from "@/pages/FunnyTeam";

/* Funny Team (11-11-2026): los clientes reservan una reunión con el equipo dentro de la plataforma. */
describe("Funny Team", () => {
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
    render(<FunnyTeam />);
    expect(screen.getByRole("heading", { name: /Reserva una reunión con tu equipo/ })).toBeTruthy();
    expect(screen.getByText("Entregabilidad")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Reservar una reunión/ })).toBeTruthy();
    // Se carga el script oficial y se pide la agenda del equipo con el nombre y el correo del cliente.
    expect(document.querySelector('script[src="https://app.cal.com/embed/embed.js"]')).not.toBeNull();
    const cal = (window as any).Cal;
    const inline = cal.ns.funnyteam.q.find((a: any[]) => a[0] === "inline");
    expect(inline[1].calLink).toBe("xavier-falco-hszeeb/15min");
    expect(inline[1].config).toMatchObject({ name: "Ana Pérez", email: "ana@acme.com", layout: "month_view" });
  });
});
