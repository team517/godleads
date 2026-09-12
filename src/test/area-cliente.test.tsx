import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AreaCliente, { type CampaignStat, type ClientContext } from "@/pages/AreaCliente";

// El área del cliente no decide nada: lo que puede ver viene de my_client_context()
// y las cifras de client_campaign_stats(). El doble de prueba son esos dos RPC.
const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { id: "u1" }, session: null, loading: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ctx = (sections: string[], over: Partial<ClientContext> = {}): ClientContext => ({
  client_id: "c1",
  owner_user_id: "o1",
  name: "Clínica Vera",
  company_name: "Vera Salud S.L.",
  logo_url: null,
  brand_color: "#1EA7B5",
  sections,
  ...over,
});

const campaign = (over: Partial<CampaignStat> = {}): CampaignStat => ({
  campaign_id: "k1",
  name: "Clínicas Madrid",
  status: "active",
  created_at: "2026-09-01T10:00:00Z",
  leads: 800,
  sent: 1240,
  replied: 37,
  bounced: 4,
  ...over,
});

/** Arma los dos RPC: contexto (o nada) y campañas. */
function wire(context: ClientContext | null, campaigns: CampaignStat[] = []) {
  rpc.mockImplementation((name: string) => {
    if (name === "my_client_context") return Promise.resolve({ data: context ? [context] : [], error: null });
    if (name === "client_campaign_stats") return Promise.resolve({ data: campaigns, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

function renderArea() {
  return render(
    <MemoryRouter initialEntries={["/area-cliente"]}>
      <Routes>
        <Route path="/area-cliente" element={<AreaCliente />} />
        <Route path="/dashboard" element={<div>Panel de la agencia</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpc.mockReset();
});

describe("Área del cliente", () => {
  it("pinta la marca del cliente y solo las secciones permitidas", async () => {
    wire(ctx(["resumen", "campanas"]), [campaign()]);
    renderArea();

    expect(await screen.findByText("Vera Salud S.L.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Resumen/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Campañas/ })).toBeInTheDocument();
    // Lo que no le han abierto no existe en la página.
    expect(screen.queryByRole("heading", { name: /Respuestas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Informes/ })).not.toBeInTheDocument();
  });

  it("suma los totales de sus campañas en el resumen", async () => {
    wire(ctx(["resumen"]), [campaign(), campaign({ campaign_id: "k2", leads: 200, sent: 60, replied: 3, bounced: 1 })]);
    renderArea();

    // Ojo: en español no se agrupan los millares de cuatro cifras (1240, no 1.240).
    expect(await screen.findByText("1000")).toBeInTheDocument(); // leads
    expect(screen.getByText("1300")).toBeInTheDocument(); // enviados
    expect(screen.getByText("40")).toBeInTheDocument(); // respuestas
    expect(screen.getByText("5")).toBeInTheDocument(); // rebotes
  });

  it("lista sus campañas con estado y cifras", async () => {
    wire(ctx(["campanas"]), [campaign({ status: "paused" })]);
    renderArea();

    expect(await screen.findByText("Clínicas Madrid")).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(screen.getByText("1240")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
  });

  it("cuando una sección no tiene de dónde sacar datos, lo dice en vez de inventarlos", async () => {
    wire(ctx(["respuestas", "informes"]), []);
    renderArea();

    expect(await screen.findByRole("heading", { name: /Respuestas/ })).toBeInTheDocument();
    expect(screen.getAllByText("Todavía no hay nada que mostrar aquí").length).toBe(2);
  });

  it("ignora una sección que no está en la lista blanca", async () => {
    wire(ctx(["resumen", "facturacion"]), []);
    renderArea();

    expect(await screen.findByRole("heading", { name: /Resumen/ })).toBeInTheDocument();
    expect(screen.queryByText(/facturacion/i)).not.toBeInTheDocument();
  });

  it("una cuenta que NO es el acceso de un cliente se va al panel normal", async () => {
    wire(null);
    renderArea();
    expect(await screen.findByText("Panel de la agencia")).toBeInTheDocument();
  });

  it("si el servidor falla, lo dice y deja reintentar (no finge un área vacía)", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    renderArea();
    expect(await screen.findByText("No pudimos cargar tu área")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("no ofrece ninguna acción de crear, editar o borrar", async () => {
    wire(ctx(["resumen", "campanas", "respuestas", "informes"]), [campaign()]);
    renderArea();
    await screen.findByText("Vera Salud S.L.");
    for (const name of [/crear/i, /editar/i, /borrar/i, /eliminar/i, /guardar/i, /nueva/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
