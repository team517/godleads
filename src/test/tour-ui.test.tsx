import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { openTour, type TourStep } from "@/lib/tour";

/* Tutorial guiado en la interfaz: la pregunta (sí / ahora no) guarda la respuesta; el recorrido va
 * de verdad por las pantallas, señala lo que existe, explica lo que falta, y se maneja con botones,
 * teclado y en el móvil como hoja inferior. */

let row: any = { tour_state: null };
let selectError: any = null;
const updates: any[] = [];
let status = "trialing";
let welcome = "done";
const mobile = { value: false };

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
vi.mock("framer-motion", async () => {
  const real = await vi.importActual<any>("framer-motion");
  return { ...real, useReducedMotion: () => true }; // sin animaciones: las pruebas van al grano
});

import { ProductTour, OFFER_DELAY_MS } from "@/components/tour/ProductTour";
import GuidedTour from "@/components/tour/GuidedTour";
import { __resetTourStateCache } from "@/hooks/useTourState";

const renderHost = () => render(<MemoryRouter initialEntries={["/dashboard"]}><ProductTour /></MemoryRouter>);

beforeEach(() => {
  row = { tour_state: null };
  selectError = null;
  updates.length = 0;
  status = "trialing";
  welcome = "done";
  mobile.value = false;
  __resetTourStateCache();
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe("la pregunta del tutorial", () => {
  vi.setConfig({ testTimeout: 20_000 });

  it('"Ahora no" lo apunta como saltado y no vuelve a salir', async () => {
    renderHost();
    const no = await screen.findByRole("button", { name: "Ahora no" }, { timeout: OFFER_DELAY_MS + 2000 });
    expect(screen.getByText(/¿Te enseñamos Funnyleads en/)).toBeTruthy();
    fireEvent.click(no);
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ tour_state: "skipped", id: "u-tour" });
    await waitFor(() => expect(screen.queryByText(/¿Te enseñamos Funnyleads en/)).toBeNull());
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
    expect(screen.queryByText(/¿Te enseñamos Funnyleads en/)).toBeNull();
    a.unmount();

    __resetTourStateCache(); row = { tour_state: null }; status = "free";
    const b = renderHost();
    await new Promise((r) => setTimeout(r, OFFER_DELAY_MS + 300));
    expect(screen.queryByText(/¿Te enseñamos Funnyleads en/)).toBeNull();
    b.unmount();

    __resetTourStateCache(); status = "active"; selectError = { message: "fallo de red" };
    renderHost();
    await new Promise((r) => setTimeout(r, OFFER_DELAY_MS + 300));
    expect(screen.queryByText(/¿Te enseñamos Funnyleads en/)).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it('"Ver el tutorial" (menú de la cuenta) lo abre sin tocar lo guardado', async () => {
    row = { tour_state: "skipped" };
    renderHost();
    act(() => { openTour(); });
    expect(await screen.findByRole("dialog", { name: "Tutorial de Funnyleads" })).toBeTruthy();
    expect(updates).toHaveLength(0);
  });
});

/* ── El recorrido sobre pantallas de verdad (de mentira para la prueba) ───────────────────── */

const STEPS: TourStep[] = [
  { id: "hola", short: "Hola", route: "/dashboard", targets: [], title: "Hola", text: "Te enseño todo." },
  { id: "leads", short: "Leads", route: "/leads", targets: [{ sel: "main button", text: /Importar/ }], title: "Leads", text: "Sube tu CSV." },
  { id: "variants", short: "Variantes", route: null, targets: [{ sel: '[aria-label="Añadir variante"]' }], title: "Variantes", text: "Con este botón añades una B.", missing: "Cuando tengas una campaña, aquí añadirás variantes." },
  { id: "fin", short: "Listo", route: "/dashboard", targets: [], title: "¡Listo! Ya vas por libre", text: "A por ello." },
];

function Pantallas() {
  const loc = useLocation();
  return (
    <>
      <aside><a href="/dashboard">Dashboard</a><a href="/leads">Leads</a></aside>
      <main data-testid="ruta" data-path={loc.pathname}>
        {loc.pathname === "/leads" && <button onClick={() => { throw new Error("no se debe pulsar"); }}>Importar CSV</button>}
      </main>
    </>
  );
}

/** El bocadillo ya dice este texto (entero). */
const dice = (t: string) => waitFor(() => expect(screen.getByTestId("tour-text").textContent).toBe(t), { timeout: 5000 });

const renderTour = (onClose = vi.fn()) => render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <Routes><Route path="*" element={<><Pantallas /><GuidedTour steps={STEPS} onClose={onClose} /></>} /></Routes>
  </MemoryRouter>,
);

describe("el recorrido", () => {
  vi.setConfig({ testTimeout: 20_000 });

  it("va a la pantalla real, señala lo que existe y no pulsa nada de la página", async () => {
    renderTour();
    await dice("Te enseño todo.");
    expect(screen.getByTestId("tour-progress").textContent).toBe("1/4");
    fireEvent.click(screen.getByRole("button", { name: "Paso siguiente" }));
    await waitFor(() => expect(screen.getByTestId("ruta").getAttribute("data-path")).toBe("/leads"));
    await dice("Sube tu CSV.");
    expect(screen.getByTestId("tour-spotlight")).toBeTruthy();
    // La capa protectora está por encima: un clic no llega a la página.
    fireEvent.click(screen.getByTestId("tour-shield"));
  });

  it("si en esta cuenta aún no existe lo que iba a señalar, lo explica igual (sin foco)", async () => {
    renderTour();
    await dice("Te enseño todo.");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await dice("Sube tu CSV.");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await dice("Cuando tengas una campaña, aquí añadirás variantes.");
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await dice("Sube tu CSV.");
  });

  it("al final, «Empezar» vuelve al panel y cierra; Esc, la X y «Saltar tutorial» cierran", async () => {
    const onClose = vi.fn();
    renderTour(onClose);
    await dice("Te enseño todo.");
    fireEvent.click(screen.getByRole("button", { name: "Saltar tutorial" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el tutorial" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Paso siguiente" }));
    await dice("A por ello.");
    fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
    expect(onClose).toHaveBeenCalledTimes(4);
    await waitFor(() => expect(screen.getByTestId("ruta").getAttribute("data-path")).toBe("/dashboard"));
  });

  it("en el móvil: sin cursor, con Funny y el bocadillo como hoja inferior", async () => {
    mobile.value = true;
    renderTour();
    await dice("Te enseño todo.");
    expect(screen.queryByTestId("tour-cursor")).toBeNull();
    expect(screen.getByTestId("funny-guide")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paso siguiente" }));
    await waitFor(() => expect(screen.getByTestId("ruta").getAttribute("data-path")).toBe("/leads"));
    await dice("Sube tu CSV.");
  });
});
