import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/hooks/useConfirm";
import Clientes, { type ClientRow, type ClientUsage } from "@/pages/Clientes";

// La página habla con la edge function `clients` (el único sitio donde se aplica
// el tope), así que el doble de prueba es el fetch + la sesión de Supabase. El
// consumo del plan viene de dos RPC del servidor (`rpc`), que cada test ajusta.
let rpcResults: Record<string, { data: any; error: any }>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    rpc: (fn: string) => Promise.resolve(rpcResults[fn] ?? { data: null, error: null }),
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: { path: "p" }, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://cdn.test/logo.png" } }),
      }),
    },
  },
}));

// El plan (tier) y el usuario los dan los contextos de la aplicación; aquí sólo
// interesa que la página pinte lo que el servidor le diga, así que se fijan.
// Los objetos son CONSTANTES a propósito: si cambiaran de identidad en cada
// render, cualquier hook que dependa de ellos pediría las cifras en bucle.
vi.mock("@/contexts/AuthContext", () => {
  const auth = { user: { id: "u1", email: "dueno@agencia.com" }, loading: false };
  return { useAuth: () => auth };
});

vi.mock("@/contexts/SubscriptionContext", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/contexts/SubscriptionContext")>();
  const sub = { tier: "growth" as const, isTrialing: false };
  return { ...real, useSubscription: () => sub };
});

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

const client = (id: string, name: string, over: Partial<ClientRow> = {}): ClientRow => ({
  id,
  name,
  company_name: `${name} S.L.`,
  contact_email: `hola@${id}.com`,
  logo_url: null,
  brand_color: null,
  notes: null,
  created_at: "2026-09-01T10:00:00Z",
  stats: { campaigns: 2, sent: 120, replied: 7 },
  login_email: null,
  allowed_sections: [],
  setup: { datos: true, acceso: false, logo: false, colores: false, permisos: false, campanas: true },
  ...over,
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
  rpcResults = {
    my_monthly_send_usage: {
      data: [{ enviados: 12345, desde: "2026-09-01T00:00:00Z", hasta: "2026-10-01T00:00:00Z", cuentas: 1 }],
      error: null,
    },
    my_mailbox_usage: { data: [{ conectados: 37, totales: 40 }], error: null },
  };
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
    expect(await screen.findByText(/Dale a cada cliente su propia cuenta en la plataforma/)).toBeInTheDocument();
  });

  it("avisa cuando la carga falla en vez de mostrar una lista vacía", async () => {
    routes.list = { status: 500, body: { error: "boom" } };
    renderPage();
    expect(await screen.findByText("No pudimos cargar tus clientes")).toBeInTheDocument();
  });
});

// ── Consumo del plan en la cabecera ───────────────────────────────────────────
// La cifra la suma el SERVIDOR sobre toda la familia del plan (el dueño y sus
// cuentas de cliente). Aquí sólo se comprueba que se pinta lo que llega, que se
// dice de dónde sale, y que un fallo se cuenta en vez de inventar un 0.
describe("Clientes · consumo del plan", () => {
  it("dice los correos del mes contra el tope del plan", async () => {
    renderPage();
    expect(await screen.findByText("12.345 de 180.000 correos este mes")).toBeInTheDocument();
  });

  it("avisa de que la cifra incluye las cuentas de los clientes cuando el servidor ha sumado más de una", async () => {
    rpcResults.my_monthly_send_usage.data = [
      { enviados: 150000, desde: "2026-09-01T00:00:00Z", hasta: "2026-10-01T00:00:00Z", cuentas: 4 },
    ];
    renderPage();
    expect(await screen.findByText("150.000 de 180.000 correos este mes")).toBeInTheDocument();
    expect(screen.getByText(/Incluye lo que envían las 3 cuentas de tus clientes/)).toBeInTheDocument();
  });

  it("no bloquea nada al pasarse del tope: sigue pudiendo añadir clientes", async () => {
    rpcResults.my_monthly_send_usage.data = [
      { enviados: 200000, desde: "2026-09-01T00:00:00Z", hasta: "2026-10-01T00:00:00Z", cuentas: 2 },
    ];
    renderPage();
    expect(await screen.findByText("200.000 de 180.000 correos este mes")).toBeInTheDocument();
    expect(addButton()).not.toBeDisabled();
  });

  it("si la RPC falla lo dice, no muestra un 0 falso", async () => {
    rpcResults.my_monthly_send_usage = { data: null, error: { message: "permission denied" } };
    rpcResults.my_mailbox_usage = { data: null, error: { message: "permission denied" } };
    renderPage();
    expect(await screen.findByText(/No pudimos leer el consumo de tu plan/)).toBeInTheDocument();
    expect(screen.queryByText(/0 de 180.000 correos este mes/)).not.toBeInTheDocument();
  });
});

// ── Configuración por fases ───────────────────────────────────────────────────
// El progreso NO se guarda en esta pantalla: sale del objeto `setup` que manda el
// servidor, así que se puede dejar a medias y retomar desde cualquier fase.
describe("Clientes · configuración por fases", () => {
  const only = (c: ClientRow) => {
    routes.list.body.clients = [c];
  };
  const openConfig = async (name: string) => {
    fireEvent.click(await screen.findByRole("button", { name: `Configurar el cliente ${name}` }));
    return screen.findByText(`Configurar «${name}»`);
  };

  it("las fichas de cada cliente dicen qué fases están hechas y cuáles no", async () => {
    only(
      client("vera", "Clínica Vera", {
        setup: { datos: true, acceso: true, logo: false, colores: false, permisos: true, campanas: false },
      }),
    );
    renderPage();
    expect(await screen.findByLabelText("Datos: hecho")).toBeInTheDocument();
    expect(screen.getByLabelText("Acceso: hecho")).toBeInTheDocument();
    expect(screen.getByLabelText("Permisos: hecho")).toBeInTheDocument();
    expect(screen.getByLabelText("Logo: pendiente")).toBeInTheDocument();
    expect(screen.getByLabelText("Colores: pendiente")).toBeInTheDocument();
  });

  it("abre la configuración en la primera fase que falta", async () => {
    only(client("vera", "Clínica Vera", { setup: { datos: true, acceso: true, logo: true, colores: false, permisos: false, campanas: true } }));
    renderPage();
    await openConfig("Clínica Vera");
    expect(await screen.findByText("Fase 4 · Colores")).toBeInTheDocument();
  });

  it("la fase de acceso avisa en claro de que la contraseña NO se guarda", async () => {
    only(client("vera", "Clínica Vera", { setup: { datos: true, acceso: false, logo: false, colores: false, permisos: false, campanas: false } }));
    renderPage();
    await openConfig("Clínica Vera");

    expect(await screen.findByText("Fase 2 · Acceso")).toBeInTheDocument();
    expect(screen.getByText(/no la guardamos/i)).toBeInTheDocument();
    expect(screen.getByText(/le pones una nueva desde aquí/i)).toBeInTheDocument();
    // Y viene una contraseña fuerte ya puesta, con su botón de copiar.
    const pass = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(pass.value.length).toBeGreaterThanOrEqual(12);
    expect(screen.getByRole("button", { name: /Copiar/ })).toBeInTheDocument();
  });

  it("crear el acceso manda email y contraseña a create_login y cuenta el error del servidor", async () => {
    only(client("vera", "Clínica Vera", { setup: { datos: true, acceso: false, logo: false, colores: false, permisos: false, campanas: false } }));
    routes.create_login = { status: 409, body: { error: "Ese email ya tiene una cuenta en la plataforma" } };
    renderPage();
    await openConfig("Clínica Vera");
    fireEvent.change(await screen.findByLabelText("Email de acceso"), { target: { value: "ana@verasalud.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Crear acceso/ }));

    await waitFor(() => expect(calls.some((c) => c.action === "create_login")).toBe(true));
    const call = calls.find((c) => c.action === "create_login")!;
    expect(call.payload.email).toBe("ana@verasalud.com");
    expect(String(call.payload.password).length).toBeGreaterThanOrEqual(12);
    expect(await screen.findByText("Ese email ya tiene una cuenta en la plataforma")).toBeInTheDocument();
  });

  it("con acceso ya creado ofrece cambiar la contraseña y quitar el acceso", async () => {
    only(
      client("vera", "Clínica Vera", {
        login_email: "ana@verasalud.com",
        setup: { datos: true, acceso: true, logo: false, colores: false, permisos: false, campanas: false },
      }),
    );
    renderPage();
    await openConfig("Clínica Vera");
    fireEvent.click(screen.getByRole("button", { name: /Acceso/ }));
    expect(await screen.findByText("ana@verasalud.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cambiar contraseña/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quitar acceso/ })).toBeInTheDocument();
  });

  it("la fase 5 ofrece las SIETE secciones de la lista blanca, con su explicación", async () => {
    only(
      client("vera", "Clínica Vera", {
        allowed_sections: [],
        setup: { datos: true, acceso: true, logo: true, colores: true, permisos: false, campanas: true },
      }),
    );
    renderPage();
    await openConfig("Clínica Vera");
    expect(await screen.findByText("Fase 5 · Qué puede ver")).toBeInTheDocument();

    // Las mismas siete de client_routes_for_sections, ni una más.
    for (const label of [
      "Dashboard",
      "Cuentas de email",
      "Campañas",
      "Leads",
      "Unibox",
      "Estadísticas",
      "IA",
    ]) {
      expect(screen.getByRole("checkbox", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    // Las dos nuevas se explican por lo que el cliente HACE con ellas, no por lo que mira.
    expect(screen.getByText("Conecta y gestiona sus propios buzones.")).toBeInTheDocument();
    expect(screen.getByText("Sube y gestiona sus listas.")).toBeInTheDocument();
    expect(screen.getByText("La evolución de envíos y respuestas por día.")).toBeInTheDocument();
    // Las secciones inventadas de antes ya no existen.
    expect(screen.queryByRole("checkbox", { name: /Informes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Respuestas/ })).not.toBeInTheDocument();
  });

  it("marcar «Cuentas de email» y «Leads» las manda al servidor con su clave de la lista blanca", async () => {
    only(
      client("vera", "Clínica Vera", {
        allowed_sections: ["dashboard"],
        setup: { datos: true, acceso: true, logo: true, colores: true, permisos: false, campanas: true },
      }),
    );
    routes.set_sections = { status: 200, body: { ok: true, allowed_sections: ["cuentas", "dashboard", "leads"] } };
    renderPage();
    await openConfig("Clínica Vera");
    fireEvent.click(await screen.findByRole("checkbox", { name: /Cuentas de email/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Leads/ }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar permisos/ }));
    await waitFor(() => expect(calls.some((c) => c.action === "set_sections")).toBe(true));
    expect(calls.find((c) => c.action === "set_sections")!.payload.sections).toEqual([
      "dashboard",
      "cuentas",
      "leads",
    ]);
  });

  it("set_sections viaja SOLO con secciones de la lista blanca", async () => {
    only(
      client("vera", "Clínica Vera", {
        // Una sección inventada (o antigua) no debe salir de aquí.
        allowed_sections: ["dashboard", "campanas", "loquesea"],
        setup: { datos: true, acceso: true, logo: true, colores: true, permisos: false, campanas: true },
      }),
    );
    routes.set_sections = { status: 200, body: { ok: true, allowed_sections: ["dashboard", "campanas"] } };
    renderPage();
    await openConfig("Clínica Vera");
    expect(await screen.findByText("Fase 5 · Qué puede ver")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Guardar permisos/ }));
    await waitFor(() => expect(calls.some((c) => c.action === "set_sections")).toBe(true));
    expect(calls.find((c) => c.action === "set_sections")!.payload.sections).toEqual(["dashboard", "campanas"]);
  });

  it("marcar una sección la añade a lo que se guarda", async () => {
    only(
      client("vera", "Clínica Vera", {
        allowed_sections: ["dashboard"],
        setup: { datos: true, acceso: true, logo: true, colores: true, permisos: false, campanas: true },
      }),
    );
    routes.set_sections = { status: 200, body: { ok: true, allowed_sections: ["dashboard", "estadisticas"] } };
    renderPage();
    await openConfig("Clínica Vera");
    fireEvent.click(await screen.findByRole("checkbox", { name: /Estadísticas/ }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar permisos/ }));
    await waitFor(() => expect(calls.some((c) => c.action === "set_sections")).toBe(true));
    expect(calls.find((c) => c.action === "set_sections")!.payload.sections).toEqual(["dashboard", "estadisticas"]);
  });

  it("el resumen dice qué falta en vez de afirmar que está listo, y da el enlace de acceso", async () => {
    only(
      client("vera", "Clínica Vera", {
        setup: { datos: true, acceso: false, logo: true, colores: true, permisos: true, campanas: true },
      }),
    );
    renderPage();
    await openConfig("Clínica Vera");
    fireEvent.click(screen.getByRole("button", { name: /Resumen/ }));
    expect(await screen.findByText("Todavía falta una fase")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fase 2 · Acceso" })).toBeInTheDocument();
    expect(screen.queryByText(/Todo listo/)).not.toBeInTheDocument();
    expect((screen.getByLabelText("Enlace de acceso del cliente") as HTMLInputElement).value).toContain("/acceso-cliente");
  });

  it("cuando no falta nada, el resumen dice que el cliente está conectado", async () => {
    only(
      client("vera", "Clínica Vera", {
        login_email: "ana@verasalud.com",
        allowed_sections: ["dashboard", "campanas"],
        setup: { datos: true, acceso: true, logo: true, colores: true, permisos: true, campanas: true },
      }),
    );
    renderPage();
    await openConfig("Clínica Vera");
    expect(await screen.findByText(/Todo listo: Clínica Vera ya está conectado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar enlace/ })).toBeInTheDocument();
  });
});
