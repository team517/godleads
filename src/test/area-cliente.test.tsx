import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AreaCliente, {
  type AiStat,
  type CampaignStat,
  type ClientContext,
  type DailyPoint,
  type InboxItem,
} from "@/pages/AreaCliente";

// El área del cliente no decide nada: lo que puede ver viene de my_client_context()
// y las cifras de las funciones de servidor de cada sección. El doble de prueba
// son esos RPC — y de paso se comprueba que sólo viaja el client_id del contexto.
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

const reply = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "m1",
  received_at: new Date(Date.now() - 3600_000).toISOString(),
  from_email: "ana@clinicavera.es",
  from_name: "Ana Ruiz",
  subject: "Me interesa",
  preview: "Buenos días, nos encaja. ¿Podemos verlo el jueves?",
  labels: ["Interesado"],
  campaign_name: "Clínicas Madrid",
  ...over,
});

type Wired = {
  context?: ClientContext | null;
  campaigns?: CampaignStat[];
  inbox?: InboxItem[];
  daily?: DailyPoint[];
  ai?: AiStat[];
};

/** Registro de lo que se ha pedido al servidor, para poder auditar los argumentos. */
let calls: { fn: string; args: Record<string, unknown> | undefined }[];

function wire(w: Wired) {
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
    calls.push({ fn: name, args });
    if (name === "my_client_context")
      return Promise.resolve({ data: w.context ? [w.context] : [], error: null });
    if (name === "client_campaign_stats") return Promise.resolve({ data: w.campaigns || [], error: null });
    if (name === "client_inbox") {
      // El servidor pagina de verdad: el doble respeta p_offset Y p_limit.
      const off = Number(args?.p_offset || 0);
      const lim = Number(args?.p_limit || 50);
      return Promise.resolve({ data: (w.inbox || []).slice(off, off + lim), error: null });
    }
    if (name === "client_daily_stats") return Promise.resolve({ data: w.daily || [], error: null });
    if (name === "client_ai_stats") return Promise.resolve({ data: w.ai || [], error: null });
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

const tab = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  rpc.mockReset();
  calls = [];
});

describe("Área del cliente", () => {
  it("pinta la marca del cliente y sólo las secciones concedidas en el raíl", async () => {
    wire({ context: ctx(["dashboard", "campanas"]), campaigns: [campaign()] });
    renderArea();

    expect(await screen.findByText("Vera Salud S.L.")).toBeInTheDocument();
    expect(tab("Dashboard")).toBeInTheDocument();
    expect(tab("Campañas")).toBeInTheDocument();
    // Lo que no le han abierto no existe ni en el raíl.
    expect(screen.queryByRole("button", { name: "Unibox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Estadísticas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "IA" })).not.toBeInTheDocument();
  });

  it("una sección que el servidor NO concedió no se pide ni se pinta", async () => {
    wire({ context: ctx(["campanas"]), campaigns: [campaign()], inbox: [reply()] });
    renderArea();

    await screen.findByText("Clínicas Madrid");
    expect(screen.queryByRole("button", { name: "Unibox" })).not.toBeInTheDocument();
    // Y sus datos no se han llegado a pedir.
    expect(calls.some((c) => c.fn === "client_inbox")).toBe(false);
    expect(calls.some((c) => c.fn === "client_ai_stats")).toBe(false);
  });

  it("abre la primera sección concedida por defecto", async () => {
    wire({ context: ctx(["unibox", "ia"]), inbox: [reply()] });
    renderArea();

    expect(await screen.findByRole("heading", { name: /Unibox/ })).toBeInTheDocument();
    expect(tab("Unibox")).toHaveAttribute("aria-current", "page");
  });

  it("suma los totales de sus campañas y calcula la tasa de respuesta", async () => {
    wire({
      context: ctx(["dashboard"]),
      campaigns: [campaign(), campaign({ campaign_id: "k2", leads: 200, sent: 60, replied: 3, bounced: 1 })],
      inbox: [],
    });
    renderArea();

    // Ojo: en español no se agrupan los millares de cuatro cifras (1300, no 1.300).
    expect(await screen.findByText("1000")).toBeInTheDocument(); // leads
    expect(screen.getByText("1300")).toBeInTheDocument(); // enviados
    expect(screen.getByText("40")).toBeInTheDocument(); // respuestas
    expect(screen.getByText("5")).toBeInTheDocument(); // rebotes
    // 40 / 1300 = 3,1 %
    expect(screen.getByText("3,1")).toBeInTheDocument();
  });

  it("el dashboard asoma las últimas respuestas, como mucho cinco", async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      reply({ id: `m${i}`, from_name: `Lead ${i}`, subject: `Asunto ${i}` }),
    );
    wire({ context: ctx(["dashboard"]), campaigns: [campaign()], inbox: many });
    renderArea();

    expect(await screen.findByText("Lead 0")).toBeInTheDocument();
    expect(screen.getByText("Lead 4")).toBeInTheDocument();
    expect(screen.queryByText("Lead 5")).not.toBeInTheDocument();
  });

  it("lista sus campañas con estado y cifras", async () => {
    wire({ context: ctx(["campanas"]), campaigns: [campaign({ status: "paused" })] });
    renderArea();

    expect(await screen.findByText("Clínicas Madrid")).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(screen.getByText("1240")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
  });

  it("el Unibox del cliente muestra remitente, asunto, adelanto, campaña y etiquetas", async () => {
    wire({ context: ctx(["unibox"]), inbox: [reply()] });
    renderArea();

    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getByText("Me interesa")).toBeInTheDocument();
    expect(screen.getByText(/Podemos verlo el jueves/)).toBeInTheDocument();
    expect(screen.getByText("Clínicas Madrid")).toBeInTheDocument();
    expect(screen.getByText("Interesado")).toBeInTheDocument();
  });

  it("«Ver más» pide la página siguiente con su p_offset", async () => {
    const many = Array.from({ length: 30 }, (_, i) => reply({ id: `m${i}`, subject: `Asunto ${i}` }));
    wire({ context: ctx(["unibox"]), inbox: many });
    renderArea();

    expect(await screen.findByText("Asunto 0")).toBeInTheDocument();
    expect(screen.queryByText("Asunto 25")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ver más/ }));
    expect(await screen.findByText("Asunto 25")).toBeInTheDocument();
    expect(calls.filter((c) => c.fn === "client_inbox").map((c) => c.args?.p_offset)).toEqual([0, 25]);
  });

  it("las estadísticas dibujan los 30 días cuando hay movimiento", async () => {
    wire({
      context: ctx(["estadisticas"]),
      daily: [
        { dia: "2026-09-10", enviados: 120, respuestas: 4 },
        { dia: "2026-09-11", enviados: 90, respuestas: 2 },
      ],
    });
    renderArea();

    expect(await screen.findByText(/últimos 30 días/)).toBeInTheDocument();
    expect(screen.getByText("210 envíos")).toBeInTheDocument();
    expect(screen.getByText("6 respuestas")).toBeInTheDocument();
    expect(calls.find((c) => c.fn === "client_daily_stats")?.args).toEqual({ p_client_id: "c1", p_days: 30 });
  });

  it("la IA reparte las respuestas por categoría con su porcentaje", async () => {
    wire({
      context: ctx(["ia"]),
      ai: [
        { categoria: "Interesado", total: 6 },
        { categoria: "No interesado", total: 2 },
        { categoria: "Pregunta", total: 2 },
      ],
    });
    renderArea();

    expect(await screen.findByText("Interesado")).toBeInTheDocument();
    expect(screen.getByText(/La IA lee cada respuesta/)).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/· 60%/)).toBeInTheDocument();
    expect(screen.getByText(/10 respuestas clasificadas en total/)).toBeInTheDocument();
  });

  it("cuando una sección no tiene datos lo dice en vez de inventarlos", async () => {
    wire({ context: ctx(["unibox"]), inbox: [] });
    renderArea();
    expect(await screen.findByText("Todavía no ha contestado nadie")).toBeInTheDocument();

    fireEvent.click(tab("Unibox")); // sigue siendo la única
    expect(screen.queryByRole("button", { name: /Ver más/ })).not.toBeInTheDocument();
  });

  it("sin movimiento en 30 días no dibuja una gráfica vacía: lo explica", async () => {
    wire({
      context: ctx(["estadisticas"]),
      daily: [{ dia: "2026-09-10", enviados: 0, respuestas: 0 }],
    });
    renderArea();
    expect(await screen.findByText("Todavía no hay movimiento que dibujar")).toBeInTheDocument();
  });

  it("ignora una sección que no está en la lista blanca", async () => {
    wire({ context: ctx(["dashboard", "facturacion"]), campaigns: [] });
    renderArea();

    expect(await screen.findByRole("heading", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.queryByText(/facturacion/i)).not.toBeInTheDocument();
  });

  it("sólo viaja el client_id que devolvió my_client_context()", async () => {
    wire({ context: ctx(["dashboard", "campanas", "unibox", "estadisticas", "ia"]), campaigns: [campaign()] });
    renderArea();
    await screen.findByText("Vera Salud S.L.");

    fireEvent.click(tab("Estadísticas"));
    fireEvent.click(tab("IA"));
    await waitFor(() => expect(calls.some((c) => c.fn === "client_ai_stats")).toBe(true));

    for (const c of calls) {
      if (c.fn === "my_client_context") continue;
      expect(c.args?.p_client_id).toBe("c1");
    }
  });

  it("una cuenta que NO es el acceso de un cliente se va al panel normal", async () => {
    wire({ context: null });
    renderArea();
    expect(await screen.findByText("Panel de la agencia")).toBeInTheDocument();
  });

  it("si el servidor falla al abrir, lo dice y deja reintentar (no finge un área vacía)", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    renderArea();
    expect(await screen.findByText("No pudimos cargar tu área")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("si falla UNA sección, lo dice ahí mismo y deja reintentarla", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "my_client_context")
        return Promise.resolve({ data: [ctx(["campanas"])], error: null });
      return Promise.resolve({ data: null, error: { message: "se cayó" } });
    });
    renderArea();
    expect(await screen.findByText("No pudimos cargar esta sección")).toBeInTheDocument();
    expect(screen.getByText("se cayó")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("no ofrece ninguna acción de crear, editar o borrar", async () => {
    wire({
      context: ctx(["dashboard", "campanas", "unibox", "estadisticas", "ia"]),
      campaigns: [campaign()],
      inbox: [reply()],
    });
    renderArea();
    await screen.findByText("Vera Salud S.L.");
    for (const name of [/crear/i, /editar/i, /borrar/i, /eliminar/i, /guardar/i, /nueva/i, /responder/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
