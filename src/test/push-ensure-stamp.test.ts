import { describe, it, expect, vi } from "vitest";

// push-notifications importa el cliente de Supabase, que exige variables de entorno.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { PUSH_ENSURE_TTL_MS, pushEnsureIsFresh } from "@/lib/push-notifications";

const now = { at: 1_000_000_000, userId: "u1", endpoint: "https://push/abc", permission: "granted" };
const stamp = { at: now.at - 60_000, userId: "u1", endpoint: "https://push/abc", permission: "granted" };

describe("pushEnsureIsFresh — cuándo se salta la escritura de push_subscriptions", () => {
  it("sin sello se repara (como siempre)", () => {
    expect(pushEnsureIsFresh(null, now)).toBe(false);
    expect(pushEnsureIsFresh(undefined, now)).toBe(false);
    expect(pushEnsureIsFresh({} as never, now)).toBe(false);
  });
  it("sello de hace un minuto, mismo usuario/endpoint/permiso: se salta", () => {
    expect(pushEnsureIsFresh(stamp, now)).toBe(true);
  });
  it("pasadas 24 h vuelve a escribir", () => {
    expect(pushEnsureIsFresh({ ...stamp, at: now.at - PUSH_ENSURE_TTL_MS }, now)).toBe(false);
    expect(pushEnsureIsFresh({ ...stamp, at: now.at - PUSH_ENSURE_TTL_MS + 1 }, now)).toBe(true);
  });
  it("otro usuario en el mismo navegador: la fila es por usuario, se escribe", () => {
    expect(pushEnsureIsFresh(stamp, { ...now, userId: "u2" })).toBe(false);
  });
  it("el endpoint cambió (token rotado): se escribe para sustituir el zombi", () => {
    expect(pushEnsureIsFresh(stamp, { ...now, endpoint: "https://push/nuevo" })).toBe(false);
    expect(pushEnsureIsFresh({ ...stamp, endpoint: "" }, { ...now, endpoint: "" })).toBe(false);
  });
  it("el permiso cambió: se escribe", () => {
    expect(pushEnsureIsFresh({ ...stamp, permission: "default" }, now)).toBe(false);
  });
  it("un sello del futuro (reloj cambiado) no vale", () => {
    expect(pushEnsureIsFresh({ ...stamp, at: now.at + 5_000 }, now)).toBe(false);
  });
});
