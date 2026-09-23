import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PushPrompt } from "@/components/PushPrompt";

const push = vi.hoisted(() => ({
  isPushSupported: vi.fn(() => true),
  getPushPermission: vi.fn(async () => "default" as NotificationPermission),
  subscribeToPush: vi.fn(async () => true),
}));

vi.mock("@/lib/push-notifications", () => push);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** ¿Corre desde el icono de la pantalla de inicio o desde una pestaña del navegador? */
function setStandalone(on: boolean) {
  (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = ((q: string) => ({
    matches: on && /display-mode:\s*standalone/.test(q),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as (q: string) => MediaQueryList;
}

async function renderAndSettle() {
  render(<PushPrompt />);
  // The banner is deliberately delayed so it doesn't fight the first paint.
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
}

describe("PushPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    push.isPushSupported.mockReturnValue(true);
    push.getPushPermission.mockResolvedValue("default");
    setStandalone(true);
  });
  afterEach(() => vi.useRealTimers());

  it("lo ofrece con la app instalada y sin decidir", async () => {
    await renderAndSettle();
    expect(screen.getByText("Activar avisos")).toBeInTheDocument();
  });

  it("también lo ofrece en una pestaña normal del navegador (23-09-2026)", async () => {
    setStandalone(false);
    await renderAndSettle();
    expect(screen.getByText("Activar avisos")).toBeInTheDocument();
  });

  it("en iPhone sin instalar explica cómo instalar, en vez de callarse", async () => {
    setStandalone(false);
    push.isPushSupported.mockReturnValue(false);
    Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", configurable: true });
    await renderAndSettle();
    expect(screen.getByText(/Añadir a pantalla de inicio/)).toBeInTheDocument();
    Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (Windows NT 10.0)", configurable: true });
  });

  it("no molesta si ya están activados o bloqueados", async () => {
    push.getPushPermission.mockResolvedValue("granted");
    await renderAndSettle();
    expect(screen.queryByText("Activar avisos")).toBeNull();

    push.getPushPermission.mockResolvedValue("denied");
    await renderAndSettle();
    expect(screen.queryByText("Activar avisos")).toBeNull();
  });

  it("aplazado una semana: vuelve cuando pasa", async () => {
    localStorage.setItem("push-prompt-snoozed-until", String(Date.now() + 86_400_000));
    await renderAndSettle();
    expect(screen.queryByText("Activar avisos")).toBeNull();

    localStorage.setItem("push-prompt-snoozed-until", String(Date.now() - 1000));
    await renderAndSettle();
    expect(screen.getByText("Activar avisos")).toBeInTheDocument();
  });

  it("no ofrece nada donde el navegador no admite avisos", async () => {
    push.isPushSupported.mockReturnValue(false);
    await renderAndSettle();
    expect(screen.queryByText("Activar avisos")).toBeNull();
  });
});
