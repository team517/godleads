import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TOUR_CHAPTERS, openTour } from "@/lib/tour";

/* Mini tutorial en la interfaz: la pregunta (sí / ahora no) guarda la respuesta en la base de
 * datos y el reproductor avanza por capítulos hasta "¡Listo! Ya vas por libre". */

let row: any = { tour_state: null };
let selectError: any = null;
const updates: any[] = [];
let status = "trialing";
let welcome = "done";

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

import { ProductTour, OFFER_DELAY_MS } from "@/components/tour/ProductTour";
import TourPlayer from "@/components/tour/TourPlayer";
import { __resetTourStateCache } from "@/hooks/useTourState";

const renderHost = () => render(<MemoryRouter initialEntries={["/dashboard"]}><ProductTour /></MemoryRouter>);

beforeEach(() => {
  row = { tour_state: null };
  selectError = null;
  updates.length = 0;
  status = "trialing";
  welcome = "done";
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
    expect(updates[0].tour_answered_at).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/¿Te enseñamos Funnyleads en/)).toBeNull());
  });

  it('"Sí" lo apunta como visto y abre el reproductor', async () => {
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: /Sí, enséñamelo/ }, { timeout: OFFER_DELAY_MS + 2000 }));
    await waitFor(() => expect(updates[0]).toMatchObject({ tour_state: "done" }));
    expect(await screen.findByRole("dialog", { name: "Tutorial de Funnyleads" })).toBeTruthy();
    expect(screen.getByText(TOUR_CHAPTERS[0].title)).toBeTruthy();
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

describe("el reproductor", () => {
  it("avanza solo de capítulo con el tiempo", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance", "Date"] });
    render(<TourPlayer onClose={() => {}} />);
    expect(screen.getByText(TOUR_CHAPTERS[0].title)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(TOUR_CHAPTERS[0].ms + 200); });
    expect(screen.getByText(TOUR_CHAPTERS[1].title)).toBeTruthy();
    // En pausa no avanza.
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    act(() => { vi.advanceTimersByTime(TOUR_CHAPTERS[1].ms + 500); });
    expect(screen.getByText(TOUR_CHAPTERS[1].title)).toBeTruthy();
  });

  it("siguiente / anterior recorren los capítulos y al final sale «¡Listo! Ya vas por libre» con Empezar", () => {
    const onClose = vi.fn();
    render(<TourPlayer onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Capítulo siguiente" }));
    expect(screen.getByText(TOUR_CHAPTERS[1].title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Capítulo anterior" }));
    expect(screen.getByText(TOUR_CHAPTERS[0].title)).toBeTruthy();
    for (let i = 0; i < TOUR_CHAPTERS.length; i++) fireEvent.click(screen.getByRole("button", { name: "Capítulo siguiente" }));
    expect(screen.getAllByText("¡Listo! Ya vas por libre").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saltar a un capítulo desde la barra, y Esc o la X cierran", () => {
    const onClose = vi.fn();
    render(<TourPlayer onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Ir al capítulo 5/ }));
    expect(screen.getByText(TOUR_CHAPTERS[4].title)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el tutorial" }));
    fireEvent.click(screen.getByRole("button", { name: "Saltar tutorial" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
