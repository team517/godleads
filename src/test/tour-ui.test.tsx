import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { openTour, saveTourRun, readTourRun, clearTourRun, type TourStep } from "@/lib/tour";

/* Tutorial práctico en la interfaz: la pregunta (sí / ahora no) guarda la respuesta; el guía pulsa y
 * escribe DE VERDAD sólo lo de la lista cerrada; en «Ahora tú» el cliente lo hace; al terminar o
 * saltar pregunta si se conserva la campaña de ejemplo; se sigue tras recargar; móvil = hoja. */

let row: any = { tour_state: null };
let selectError: any = null;
const updates: any[] = [];
let status = "trialing";
let welcome = "done";
const mobile = { value: false };
const deleted: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: selectError ? null : row, error: selectError }) }) }),
      update: (patch: any) => ({ eq: (_c: string, id: string) => { updates.push({ ...patch, id }); return Promise.resolve({ error: null }); } }),
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-tour", email: "nuevo@empresa-ejemplo.com" }, loading: false }) }));
vi.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => ({ status, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useWelcomeGate", () => ({ useWelcomeGate: () => welcome }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/lib/mobile-app", async () => ({ ...(await vi.importActual<any>("@/lib/mobile-app")), isPhoneDevice: () => false }));
vi.mock("@/components/tour/tour-campaign", () => ({
  exampleIds: async () => new Set<string>(),
  captureNewExample: async () => CAMP,
  deleteExample: async (_sb: unknown, id: string, expected: string | null) => { if (id !== expected) return "otra"; deleted.push(id); return null; },
}));
vi.mock("framer-motion", async () => {
  const real = await vi.importActual<any>("framer-motion");
  return { ...real, useReducedMotion: () => true }; // sin animaciones: las pruebas van al grano
});

const CAMP = "11111111-2222-3333-4444-555555555555";

import { ProductTour, OFFER_DELAY_MS } from "@/components/tour/ProductTour";
import GuidedTour from "@/components/tour/GuidedTour";
import { __resetTourStateCache } from "@/hooks/useTourState";

const renderHost = (path = "/dashboard") => render(<MemoryRouter initialEntries={[path]}><ProductTour /></MemoryRouter>);

beforeEach(() => {
  row = { tour_state: null };
  selectError = null;
  updates.length = 0;
  deleted.length = 0;
  status = "trialing";
  welcome = "done";
  mobile.value = false;
  __resetTourStateCache();
  localStorage.clear();
  clearTourRun();
});
afterEach(() => { vi.useRealTimers(); clearTourRun(); });

describe("la pregunta del tutorial", () => {
  vi.setConfig({ testTimeout: 20_000 });

  it('"Ahora no" lo apunta como saltado y no vuelve a salir', async () => {
    renderHost();
    const no = await screen.findByRole("button", { name: "Ahora no" }, { timeout: OFFER_DELAY_MS + 2000 });
    expect(screen.getByText(/¿Te enseño Funnyleads usándolo de verdad\?/)).toBeTruthy();
    expect(screen.getByText("Crear una campaña")).toBeTruthy(); // capítulos
    fireEvent.click(no);
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ tour_state: "skipped", id: "u-tour" });
  });

  it('"Sí" lo apunta como visto y Funny empieza el recorrido', async () => {
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: /Sí, enséñamelo/ }, { timeout: OFFER_DELAY_MS + 2000 }));
    await waitFor(() => expect(updates[0]).toMatchObject({ tour_state: "done" }));
    expect(await screen.findByRole("dialog", { name: "Tutorial de Funnyleads" })).toBeTruthy();
    expect(await screen.findByText("¡Hola! Soy Funny")).toBeTruthy();
  });

  it("no se pregunta si ya contestó, a cuentas del portal de la agencia, ni si la consulta falla", async () => {
    row = { tour_state: "skipped" };
    const a = renderHost();
    await new Promise((r) => setTimeout(r, OFFER_DELAY_MS + 300));
    expect(screen.queryByText(/¿Te enseño Funnyleads/)).toBeNull();
    a.unmount();
    __resetTourStateCache(); row = { tour_state: null }; status = "free";
    const b = renderHost();
    await new Promise((r) => setTimeout(r, OFFER_DELAY_MS + 300));
    expect(screen.queryByText(/¿Te enseño Funnyleads/)).toBeNull();
    b.unmount();
    __resetTourStateCache(); status = "active"; selectError = { message: "fallo de red" };
    renderHost();
    await new Promise((r) => setTimeout(r, OFFER_DELAY_MS + 300));
    expect(screen.queryByText(/¿Te enseño Funnyleads/)).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it('"Ver el tutorial" (menú de la cuenta) lo abre sin tocar lo guardado', async () => {
    row = { tour_state: "skipped" };
    renderHost();
    act(() => { openTour(); });
    expect(await screen.findByRole("dialog", { name: "Tutorial de Funnyleads" })).toBeTruthy();
    expect(updates).toHaveLength(0);
  });

  it("un recorrido a medias (recarga) ofrece «Seguir el tutorial» y sigue por ese paso", async () => {
    row = { tour_state: "done" };
    saveTourRun({ index: 2, stepId: "dashboard", campaignId: null, at: Date.now() });
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: "Seguir el tutorial" }));
    expect(await screen.findByRole("heading", { name: "Tu panel" })).toBeTruthy();
    expect(screen.getByTestId("guided-tour").getAttribute("data-step")).toBe("dashboard");
  });
});

/* ── El recorrido sobre pantallas de prueba ───────────────────────────────────────────────── */

const pulsados: string[] = [];

function Pantallas() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [abierta, setAbierta] = useState(false);
  const [nombre, setNombre] = useState("");
  return (
    <>
      <aside><a href="/dashboard">Dashboard</a><a href="/campaigns">Campañas</a></aside>
      <main data-testid="ruta" data-path={loc.pathname}>
        <h1>{loc.pathname}</h1>
        {loc.pathname === "/campaigns" && (
          <>
            <button onClick={() => { pulsados.push("crear-campaña"); setAbierta(true); }}>Crear campaña</button>
            <button data-tour="campaign-launch" onClick={() => pulsados.push("LANZAR")}>Lanzar</button>
            <button onClick={() => navigate("/dashboard")}>Salir de aquí</button>
          </>
        )}
      </main>
      {abierta && (
        <div role="dialog">
          <h2>Crear campaña</h2>
          <input placeholder="Prospección Q1" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <button onClick={() => { pulsados.push(`crear:${nombre}`); setAbierta(false); }}>Crear</button>
          <button onClick={() => setAbierta(false)}><span>Close</span></button>
        </div>
      )}
    </>
  );
}

const STEPS: TourStep[] = [
  { id: "hola", chapter: "inicio", route: "/dashboard", point: [], title: "Hola", text: "Te enseño todo usando tu cuenta de verdad." },
  {
    id: "abrir", chapter: "crear", route: "/campaigns", point: [{ sel: "main button", text: /^Crear campaña$/ }],
    user: { target: [{ sel: "main button", text: /^Crear campaña$/ }], safe: "create-open", skipIfCampaign: true },
    title: "Ahora tú: crea una campaña", text: "Pulsa «Crear campaña» para empezar tu campaña de ejemplo.",
  },
  {
    id: "nombre", chapter: "crear", route: "/campaigns",
    actions: [{ do: "type", target: [{ sel: '[role="dialog"]:not([data-testid="guided-tour"]) input[placeholder="Prospección Q1"]' }], safe: "create-name", text: "Ejemplo", cps: 0 }],
    point: [{ sel: '[role="dialog"]:not([data-testid="guided-tour"])' }], title: "Ponle un nombre", text: "Un nombre que te diga para quién es; tus leads no lo ven.",
  },
  {
    id: "crear", chapter: "crear", route: "/campaigns", captureCampaign: true,
    actions: [
      { do: "click", target: [{ sel: '[role="dialog"]:not([data-testid="guided-tour"]) button', text: /^Crear$/ }], safe: "create-submit", skipIfCampaign: true },
      // Una acción con una clave que NO es la suya: nunca se ejecuta.
      { do: "click", target: [{ sel: "main button", text: /^Lanzar$/ }], safe: "create-open" },
    ],
    point: [{ sel: "main h1" }], title: "Creada", text: "Ya tienes la campaña de ejemplo, en borrador: no envía nada.",
  },
  { id: "fin", chapter: "fin", route: "/dashboard", point: [], title: "¡Listo! Ya vas por libre", text: "A por ello, ya lo sabes todo." },
];

/** El bocadillo ya dice este texto (entero). */
const dice = (t: string) => waitFor(() => expect(screen.getByTestId("tour-text").textContent).toBe(t), { timeout: 6000 });
const listo = () => waitFor(() => expect(screen.getByTestId("guided-tour").getAttribute("data-phase")).toBe("showing"), { timeout: 8000 });

const renderTour = (onClose = vi.fn(), props: Partial<React.ComponentProps<typeof GuidedTour>> = {}) => render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <Routes><Route path="*" element={<><Pantallas /><GuidedTour steps={STEPS} onClose={onClose} {...props} /></>} /></Routes>
  </MemoryRouter>,
);

describe("el recorrido práctico", () => {
  vi.setConfig({ testTimeout: 25_000 });
  beforeEach(() => { pulsados.length = 0; });

  it("«Ahora tú»: sólo avanza cuando el cliente pulsa (o «Hazlo tú por mí»); el guía escribe y crea", async () => {
    renderTour();
    await dice("Te enseño todo usando tu cuenta de verdad.");
    fireEvent.click(screen.getByRole("button", { name: "Pausar el avance automático" }));
    fireEvent.click(screen.getByRole("button", { name: "Paso siguiente" }));
    await waitFor(() => expect(screen.getByTestId("ruta").getAttribute("data-path")).toBe("/campaigns"));
    await listo();
    expect(screen.getByTestId("tour-do-it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Paso siguiente" })).toBeNull(); // espera al cliente
    // El cliente pulsa lo señalado.
    fireEvent.click(screen.getByRole("button", { name: "Crear campaña" }));
    expect(pulsados).toContain("crear-campaña");
    await dice("Un nombre que te diga para quién es; tus leads no lo ven.");
    await listo();
    expect((screen.getByPlaceholderText("Prospección Q1") as HTMLInputElement).value).toBe("Ejemplo");
    fireEvent.click(screen.getByRole("button", { name: "Paso siguiente" }));
    await dice("Ya tienes la campaña de ejemplo, en borrador: no envía nada.");
    await listo();
    expect(pulsados).toContain("crear:Ejemplo");
    expect(pulsados).not.toContain("LANZAR"); // la acción con la clave equivocada no se ejecutó
    expect(readTourRun()?.campaignId).toBe(CAMP); // recuerda su campaña de ejemplo
  });

  it("al saltar con la campaña de ejemplo creada, pregunta: «Conservarla» no borra nada", async () => {
    const onClose = vi.fn();
    renderTour(onClose, { initialCampaignId: CAMP });
    await dice("Te enseño todo usando tu cuenta de verdad.");
    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));
    expect(await screen.findByText("¿Conservas la campaña de ejemplo?")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tour-keep-example"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([]);
    expect(readTourRun()).toBeNull();
  });

  it("«Borrarla» borra sólo la campaña de ejemplo de este tutorial", async () => {
    const onClose = vi.fn();
    renderTour(onClose, { initialCampaignId: CAMP, startIndex: STEPS.length - 1 });
    await dice("A por ello, ya lo sabes todo.");
    fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
    fireEvent.click(await screen.findByTestId("tour-delete-example"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(deleted).toEqual([CAMP]);
  });

  it("sin campaña de ejemplo, Esc / X / Saltar cierran sin preguntar", async () => {
    const onClose = vi.fn();
    renderTour(onClose);
    await dice("Te enseño todo usando tu cuenta de verdad.");
    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el tutorial" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("¿Conservas la campaña de ejemplo?")).toBeNull();
  });

  it("si el cliente se va por su cuenta, se para y ofrece seguir", async () => {
    renderTour(vi.fn(), { startIndex: 3, initialCampaignId: CAMP });
    await dice("Ya tienes la campaña de ejemplo, en borrador: no envía nada.");
    await listo();
    // Navegación ajena al tutorial (por ejemplo, el botón Atrás del navegador).
    fireEvent.click(screen.getByRole("button", { name: "Salir de aquí" }));
    expect(await screen.findByText("Te has ido por tu cuenta")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tour-resume"));
    await waitFor(() => expect(screen.getByTestId("ruta").getAttribute("data-path")).toBe("/campaigns"));
  });

  it("capítulos: se salta a cualquiera desde el menú", async () => {
    renderTour();
    await dice("Te enseño todo usando tu cuenta de verdad.");
    fireEvent.click(screen.getByRole("button", { name: "Capítulos del tutorial" }));
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    await dice("A por ello, ya lo sabes todo.");
  });

  it("en el móvil: sin cursor, con Funny y el bocadillo como hoja", async () => {
    mobile.value = true;
    renderTour();
    await dice("Te enseño todo usando tu cuenta de verdad.");
    expect(screen.queryByTestId("tour-cursor")).toBeNull();
    expect(screen.getByTestId("funny-guide")).toBeTruthy();
    expect(document.querySelector("[data-sheet]")?.getAttribute("data-sheet")).toBe("bottom");
  });
});
