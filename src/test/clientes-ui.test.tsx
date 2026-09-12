import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/hooks/useConfirm";
import Clientes, { type ClientRow, type ClientUsage } from "@/pages/Clientes";

// La página habla con la edge function `clients` (el único sitio donde se aplica
// el tope), así que el doble de prueba es el fetch + la sesión de Supabase.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const usage = (over: Partial<ClientUsage> = {}): ClientUsage => ({
  slots: 5,
  used: 3,
  remaining: 2,
  tier: "growth",
  status: "active",
  extra_slots: 0,
  extra_slot_price_usd: 15,
  can_buy_slots: true,
  ...over,
});

const client = (id: string, name: string): ClientRow => ({
  id,
  name,
  company_name: `${name} S.L.`,
  contact_email: `hola@${id}.com`,
  logo_url: null,
  brand_color: null,
  notes: null,
  created_at: "2026-09-01T10:00:00Z",
  stats: { campaigns: 2, sent: 120, replied: 7 },
});

/** Respuestas por acción; cada test cambia las que le interesan. */
let routes: Record<string, { status: number; body: any }>;
let calls: { action: string; payload: any }[];

const fetchMock = vi.fn(async (_url: string, init: any) => {
  const payload = JSON.parse(init.body);
  calls.push({ action: payload.action, payload });
  const r = routes[payload.action] || { status: 400, body: { error: "sin ruta de prueba" } };
  return { status: r.status, json: async () => r.body } as any;
});

beforeEach(() => {
  calls = [];
  routes = {
    list: { status: 200, body: { clients: [client("vera", "Clínica Vera"), client("nomo", "Nomo"), client("adwake", "Adwake")], usage: usage() } },
  };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ConfirmProvider>
          <Clientes />
        </ConfirmProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const addButton = () => screen.getByRole("button", { name: /Añadir cliente/ });

describe("Clientes", () => {
  it("dice cuántos clientes caben en el plan", async () => {
    renderPage();
    expect(await screen.findByText("3 de 5 clientes · plan Growth")).toBeInTheDocument();
    expect(screen.getByText("Clínica Vera")).toBeInTheDocument();
  });

  it("cuenta las plazas extra compradas en la línea del plan", async () => {
    routes.list.body.usage = usage({ slots: 6, used: 3, remaining: 3, extra_slots: 1 });
    renderPage();
    expect(await screen.findByText("3 de 6 clientes · plan Growth · 1 plaza extra")).toBeInTheDocument();
  });

  it("desactiva «Añadir cliente» sin plazas y explica por qué", async () => {
    routes.list.body.usage = usage({ used: 5, remaining: 0 });
    renderPage();
    await screen.findByText("5 de 5 clientes · plan Growth");
    expect(addButton()).toBeDisabled();
    expect(screen.getByTitle(/Archiva uno o añade una plaza/)).toBeInTheDocument();
  });

  it("muestra el panel del plan cuando la función responde 402 (el tope es del servidor)", async () => {
    // La interfaz cree que queda 1 plaza; el servidor dice que no. Manda el servidor.
    routes.list.body.usage = usage({ used: 4, remaining: 1 });
    routes.create = {
      status: 402,
      body: { error: "sin_plazas", message: "Has usado las 5 plazas de cliente de tu plan.", usage: usage({ used: 5, remaining: 0 }) },
    };
    renderPage();
    await screen.findByText("4 de 5 clientes · plan Growth");

    fireEvent.click(addButton());
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Nueva SL" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));

    expect(await screen.findByText("Tu plan no incluye más clientes")).toBeInTheDocument();
    expect(screen.getByText("Has usado las 5 plazas de cliente de tu plan.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mejorar plan/ })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: /Añadir plaza por 15 \$\/mes/ })).toBeInTheDocument();
  });

  it("no muestra la compra de plazas cuando el servidor dice que no se pueden comprar", async () => {
    routes.list.body.usage = usage({ used: 4, remaining: 1, can_buy_slots: false });
    routes.create = { status: 402, body: { error: "sin_plazas", message: "Sin plazas." } };
    renderPage();
    await screen.findByText("4 de 5 clientes · plan Growth");
    fireEvent.click(addButton());
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Nueva SL" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await screen.findByText("Tu plan no incluye más clientes");
    expect(screen.queryByRole("button", { name: /Añadir plaza por/ })).not.toBeInTheDocument();
  });

  it("dice el nombre repetido en el propio campo, no en un toast", async () => {
    routes.create = { status: 409, body: { error: "Ya tienes un cliente con ese nombre" } };
    renderPage();
    await screen.findByText("3 de 5 clientes · plan Growth");
    fireEvent.click(addButton());
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Clínica Vera" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    expect(await screen.findByText("Ya tienes un cliente con ese nombre")).toBeInTheDocument();
    // El diálogo sigue abierto para corregir el nombre.
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
  });

  it("pide confirmación del cargo recurrente antes de comprar una plaza", async () => {
    routes.list.body.usage = usage({ used: 4, remaining: 1 });
    routes.create = { status: 402, body: { error: "sin_plazas", message: "Sin plazas." } };
    routes.add_slots = {
      status: 501,
      body: { error: "precio_no_configurado", message: "Falta el precio en Stripe." },
    };
    renderPage();
    await screen.findByText("4 de 5 clientes · plan Growth");
    fireEvent.click(addButton());
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Nueva SL" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await screen.findByText("Tu plan no incluye más clientes");

    fireEvent.click(screen.getByRole("button", { name: /Añadir plaza por 15 \$\/mes/ }));

    // 1) Primero la confirmación, que dice el cargo en claro. Nada se ha cobrado aún.
    expect(await screen.findByText("Añadir una plaza de cliente")).toBeInTheDocument();
    expect(screen.getByText(/15 \$ más al mes/)).toBeInTheDocument();
    expect(screen.getByText(/se repite cada mes/)).toBeInTheDocument();
    expect(calls.some((c) => c.action === "add_slots")).toBe(false);

    // 2) Al confirmar sí se llama — y un 501 se cuenta como lo que es: no está a la venta.
    fireEvent.click(screen.getByRole("button", { name: "Sí, añadir plaza" }));
    await waitFor(() => expect(calls.some((c) => c.action === "add_slots")).toBe(true));
    expect(await screen.findByText(/aún no están a la venta/)).toBeInTheDocument();
  });

  it("cancelar la confirmación no compra nada", async () => {
    routes.list.body.usage = usage({ used: 4, remaining: 1 });
    routes.create = { status: 402, body: { error: "sin_plazas", message: "Sin plazas." } };
    renderPage();
    await screen.findByText("4 de 5 clientes · plan Growth");
    fireEvent.click(addButton());
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Nueva SL" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await screen.findByText("Tu plan no incluye más clientes");

    fireEvent.click(screen.getByRole("button", { name: /Añadir plaza por 15 \$\/mes/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("Añadir una plaza de cliente")).not.toBeInTheDocument());
    expect(calls.some((c) => c.action === "add_slots")).toBe(false);
  });

  it("explica qué es un cliente cuando no hay ninguno", async () => {
    routes.list.body = { clients: [], usage: usage({ used: 0, remaining: 5 }) };
    renderPage();
    expect(await screen.findByText(/Agrupa campañas por cliente para ver sus resultados por separado/)).toBeInTheDocument();
  });

  it("avisa cuando la carga falla en vez de mostrar una lista vacía", async () => {
    routes.list = { status: 500, body: { error: "boom" } };
    renderPage();
    expect(await screen.findByText("No pudimos cargar tus clientes")).toBeInTheDocument();
  });
});
