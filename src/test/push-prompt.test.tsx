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

/** The prompt only appears when the app runs from the home screen. */
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

  it("asks to enable notifications when installed and undecided", async () => {
    await renderAndSettle();
    expect(screen.getByText("Activar notificaciones")).toBeInTheDocument();
  });

  it("stays hidden in a normal browser tab", async () => {
    setStandalone(false);
    await renderAndSettle();
    expect(screen.queryByText("Activar notificaciones")).toBeNull();
  });

  it("stays hidden once permission was already decided", async () => {
    push.getPushPermission.mockResolvedValue("granted");
    await renderAndSettle();
    expect(screen.queryByText("Activar notificaciones")).toBeNull();

    push.getPushPermission.mockResolvedValue("denied");
    await renderAndSettle();
    expect(screen.queryByText("Activar notificaciones")).toBeNull();
  });

  it("stays hidden while snoozed, and comes back after the snooze expires", async () => {
    localStorage.setItem("push-prompt-snoozed-until", String(Date.now() + 86_400_000));
    await renderAndSettle();
    expect(screen.queryByText("Activar notificaciones")).toBeNull();

    localStorage.setItem("push-prompt-snoozed-until", String(Date.now() - 1000));
    await renderAndSettle();
    expect(screen.getByText("Activar notificaciones")).toBeInTheDocument();
  });

  it("stays hidden where push is not supported at all", async () => {
    push.isPushSupported.mockReturnValue(false);
    await renderAndSettle();
    expect(screen.queryByText("Activar notificaciones")).toBeNull();
  });
});
