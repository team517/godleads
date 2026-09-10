import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// push-notifications importa el cliente de Supabase, que exige variables de entorno.
// getPushState no toca la BD, así que basta con un doble vacío.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { getPushState } from "@/lib/push-notifications";

/** La misma clave VAPID que firma el servidor (y que usa el módulo). */
const VAPID_PUBLIC_KEY =
  "BBdtQ9OiGX_-rvcYuoGsok-A_qPTw-cRoHEJAXIIY5agCK_dDhP0rLlqJXboSY3TK6hfyBQsTfVQksEs0RMs8us";
/** Una clave antigua: la suscripción existe pero el push service respondería 403. */
const OTHER_KEY =
  "BApXBHYy1TSOa4LTfeRPTZlA5X8vFHNRJIQXwGwIuLMHb0KGnaCVFDvGYYPS9OjHFhCwn0dSVWEwGRXk4t0EJ8s";

function keyBuffer(base64url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function setPermission(permission: NotificationPermission) {
  vi.stubGlobal("Notification", { permission });
}

/** jsdom no trae service workers: montamos el mínimo que lee getPushState. */
function setSubscription(subscription: unknown) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: async () => subscription },
      }),
    },
  });
}

describe("getPushState", () => {
  beforeEach(() => {
    vi.stubGlobal("PushManager", class {});
    setPermission("granted");
    setSubscription(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  it("dice 'unsupported' cuando el navegador no tiene push", async () => {
    // stubGlobal(undefined) dejaría la clave presente, y el módulo comprueba `in window`.
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    expect(await getPushState()).toBe("unsupported");
  });

  it("dice 'denied' cuando el usuario bloqueó los avisos", async () => {
    setPermission("denied");
    expect(await getPushState()).toBe("denied");
  });

  it("dice 'off' con permiso concedido pero sin suscripción", async () => {
    // El caso que rompía el botón: el permiso sigue en "granted" tras desactivar.
    expect(await getPushState()).toBe("off");
  });

  it("dice 'off' si la suscripción usa otra clave VAPID", async () => {
    setSubscription({ options: { applicationServerKey: keyBuffer(OTHER_KEY) } });
    expect(await getPushState()).toBe("off");
  });

  it("dice 'on' solo con una suscripción de la clave actual", async () => {
    setSubscription({ options: { applicationServerKey: keyBuffer(VAPID_PUBLIC_KEY) } });
    expect(await getPushState()).toBe("on");
  });

  it("dice 'off' si el service worker falla", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.reject(new Error("sin SW")) },
    });
    expect(await getPushState()).toBe("off");
  });
});
