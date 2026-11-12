import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoBrand } from "@/components/clients/CoBrand";
import { sectionsFor, shouldShowClientWelcome, WELCOME_SECTIONS } from "@/components/clients/ClientWelcome";
import { rowToAgency } from "@/hooks/useAgencyBrand";

// Cuenta de un cliente (12-11-2026): marca doble agencia × cliente y "Bienvenido a <agencia>".

describe("marca de la agencia que llega del servidor", () => {
  it("nombre, logo https y color válido", () => {
    expect(rowToAgency({ agency_name: " Acme Growth ", logo_url: "https://x.test/l.png", brand_color: "#ec5e69" }))
      .toEqual({ name: "Acme Growth", logo: "https://x.test/l.png", color: "#EC5E69" });
  });
  it("descarta logos que no son http(s) y colores raros; sin nombre no hay marca", () => {
    expect(rowToAgency({ agency_name: "A", logo_url: "javascript:alert(1)", brand_color: "red" })).toEqual({ name: "A", logo: null, color: null });
    expect(rowToAgency({ agency_name: "  ", logo_url: null, brand_color: null })).toBeNull();
    expect(rowToAgency(null)).toBeNull();
  });
});

describe("bienvenida", () => {
  it("sólo a una cuenta de cliente que no la ha visto, y nunca al equipo mirando", () => {
    const base = { clientLogin: true, impersonating: false, seenMeta: false, seenLocal: false };
    expect(shouldShowClientWelcome(base)).toBe(true);
    expect(shouldShowClientWelcome({ ...base, clientLogin: false })).toBe(false);
    expect(shouldShowClientWelcome({ ...base, impersonating: true })).toBe(false);
    expect(shouldShowClientWelcome({ ...base, seenMeta: true })).toBe(false);
    expect(shouldShowClientWelcome({ ...base, seenLocal: true })).toBe(false);
  });
  it("el mini tutorial enseña sólo las secciones que tiene abiertas", () => {
    expect(sectionsFor(["/campaigns", "/unibox"]).map((s) => s.label)).toEqual(["Campañas", "Unibox"]);
    expect(sectionsFor(null)).toHaveLength(WELCOME_SECTIONS.length);
  });
});

describe("marca doble en la barra", () => {
  it("logo de la agencia × logo del cliente", () => {
    render(<CoBrand agency={{ name: "Acme Growth", logo: "https://x.test/a.png", color: null }} client={{ name: "Clínica Vera", logo: "https://x.test/c.png", color: "#16A34A" }} />);
    expect(screen.getByAltText("Acme Growth")).toBeTruthy();
    expect(screen.getByAltText("Clínica Vera")).toBeTruthy();
    expect(screen.getByText("×")).toBeTruthy();
  });
  it("sin logos: las iniciales en su color, y el nombre del cliente", () => {
    render(<CoBrand agency={{ name: "acme", logo: null, color: "#EC5E69" }} client={{ name: "vera", logo: null, color: null }} />);
    expect(screen.getByLabelText("acme").textContent).toBe("A");
    expect(screen.getByText("vera")).toBeTruthy();
  });
  it("sin datos de la agencia todavía: sólo el cliente, sin aspa", () => {
    render(<CoBrand agency={null} client={{ name: "Vera", logo: null, color: null }} />);
    expect(screen.queryByText("×")).toBeNull();
  });
});
