import { describe, expect, it } from "vitest";
import {
  aProbar, esTransitorio, esperaSiguiente, olvidables, trasIntento, OLVIDAR_TRAS_MS, POR_PASADA,
} from "../../supabase/functions/_shared/reconnect";

const MIN = 60_000;
const T0 = Date.parse("2026-09-28T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("reconexión automática de cuentas", () => {
  it("espera cada vez más tras cada fallo y se queda en 6 h", () => {
    expect([1, 2, 3, 4, 5, 20].map((n) => esperaSiguiente(n, false) / MIN)).toEqual([15, 60, 180, 360, 360, 360]);
    expect(esperaSiguiente(7, true)).toBe(15 * MIN);
  });

  it("distingue un fallo de red de un rechazo de la cuenta", () => {
    expect(esTransitorio("SMTP error: SMTP TLS connect timeout after 15000ms")).toBe(true);
    expect(esTransitorio("SMTP auth failed: 421 Service not available")).toBe(true);
    expect(esTransitorio("SMTP auth failed: 535 Authentication credentials invalid")).toBe(false);
  });

  it("prueba primero las recién caídas y luego las que llevan más esperando; nunca antes de su hora", () => {
    const seg = [
      { account_id: "b", intentos: 2, next_at: iso(T0 - 30 * MIN) },
      { account_id: "c", intentos: 1, next_at: iso(T0 + 5 * MIN) },
      { account_id: "d", intentos: 3, next_at: iso(T0 - 90 * MIN) },
    ];
    expect(aProbar(["b", "c", "d", "a"], seg, T0)).toEqual(["a", "d", "b"]);
  });

  it("no prueba más de las permitidas por pasada", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `x${i}`);
    expect(aProbar(ids, [], T0)).toHaveLength(POR_PASADA);
  });

  it("un 535 cuenta como intento; un tiempo agotado no", () => {
    const f1 = trasIntento(undefined, "a", false, "SMTP auth failed: 535 Authentication credentials invalid", T0);
    expect(f1.intentos).toBe(1);
    expect(Date.parse(f1.next_at) - T0).toBe(15 * MIN);
    const f2 = trasIntento({ account_id: "a", intentos: 1, next_at: f1.next_at }, "a", false, "535 again", T0);
    expect(f2.intentos).toBe(2);
    expect(Date.parse(f2.next_at) - T0).toBe(60 * MIN);
    const t = trasIntento({ account_id: "a", intentos: 2, next_at: null }, "a", false, "SMTP error: read timeout after 5000ms", T0);
    expect(t.intentos).toBe(2);
    expect(Date.parse(t.next_at) - T0).toBe(15 * MIN);
  });

  it("al reconectar deja puesta la espera: si se vuelve a caer enseguida no entra en bucle", () => {
    const ok = trasIntento({ account_id: "a", intentos: 3, next_at: null }, "a", true, null, T0);
    expect(ok.last_error).toBeNull();
    expect(ok.reconectada_at).toBe(iso(T0));
    expect(Date.parse(ok.next_at) - T0).toBe(180 * MIN);
    // cae 10 minutos después → todavía no toca
    expect(aProbar(["a"], [ok], T0 + 10 * MIN)).toEqual([]);
    expect(aProbar(["a"], [ok], T0 + 181 * MIN)).toEqual(["a"]);
  });

  it("olvida el historial de las cuentas que llevan días bien", () => {
    const seg = [
      { account_id: "vieja", intentos: 4, next_at: null, reconectada_at: iso(T0 - OLVIDAR_TRAS_MS - MIN) },
      { account_id: "reciente", intentos: 4, next_at: null, reconectada_at: iso(T0 - 60 * MIN) },
      { account_id: "manual", intentos: 2, next_at: null, reconectada_at: null, updated_at: iso(T0 - OLVIDAR_TRAS_MS - MIN) },
      { account_id: "caida", intentos: 5, next_at: null, reconectada_at: iso(T0 - OLVIDAR_TRAS_MS - MIN) },
    ];
    expect(olvidables(seg, new Set(["vieja", "reciente", "manual"]), T0)).toEqual(["vieja", "manual"]);
  });
});
