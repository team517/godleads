import { describe, expect, it } from "vitest";
import {
  planCalls, parseRetryAfter, cooldownAfterLimit, pacingGapMs,
  CALLS_PER_MINUTE, BASE_COOLDOWN_MS, MAX_COOLDOWN_MS,
} from "../../supabase/functions/_shared/ai-throttle";

const T0 = Date.parse("2026-09-18T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("cuántas llamadas caben ahora", () => {
  it("sin estado previo, caben todas las pedidas (hasta el tope del minuto)", () => {
    expect(planCalls(null, 40, T0).allowed).toBe(40);
    expect(planCalls(null, 500, T0).allowed).toBe(CALLS_PER_MINUTE);
  });
  it("dentro del mismo minuto sólo cabe lo que queda", () => {
    const st = { window_started_at: iso(T0 - 20_000), calls_in_window: 55, cooldown_until: null, consecutive_limits: 0 };
    const p = planCalls(st, 60, T0);
    expect(p.allowed).toBe(5);
    expect(p.windowStart).toBe(st.window_started_at);   // la ventana NO se reinicia
    expect(p.callsInWindow).toBe(55);
  });
  it("pasado el minuto la ventana se reinicia sola", () => {
    const st = { window_started_at: iso(T0 - 61_000), calls_in_window: 60, cooldown_until: null, consecutive_limits: 0 };
    const p = planCalls(st, 60, T0);
    expect(p.allowed).toBe(60);
    expect(p.callsInWindow).toBe(0);
    expect(p.windowStart).toBe(iso(T0));
  });
  it("en enfriamiento NO se llama al modelo, y dice cuánto queda", () => {
    const st = { window_started_at: iso(T0), calls_in_window: 0, cooldown_until: iso(T0 + 45_000), consecutive_limits: 2 };
    const p = planCalls(st, 60, T0);
    expect(p.allowed).toBe(0);
    expect(p.cooldownMs).toBe(45_000);
  });
  it("un enfriamiento ya vencido no estorba", () => {
    const st = { window_started_at: iso(T0 - 90_000), calls_in_window: 60, cooldown_until: iso(T0 - 1_000), consecutive_limits: 3 };
    expect(planCalls(st, 30, T0).allowed).toBe(30);
  });
});

describe("Retry-After de la API", () => {
  it("entiende los segundos", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter(" 5 ")).toBe(5_000);
  });
  it("entiende una fecha", () => {
    const h = new Date(Date.now() + 40_000).toUTCString();
    expect(parseRetryAfter(h)).toBeGreaterThan(30_000);
    expect(parseRetryAfter(h)).toBeLessThanOrEqual(45_000);
  });
  it("sin cabecera o con basura, 0", () => {
    expect(parseRetryAfter(null)).toBe(0);
    expect(parseRetryAfter("")).toBe(0);
    expect(parseRetryAfter("pronto")).toBe(0);
  });
  it("nunca pide esperar más del tope", () => {
    expect(parseRetryAfter("99999")).toBe(MAX_COOLDOWN_MS);
  });
});

describe("cuánto esperar tras un 429", () => {
  const sinAzar = () => 0;
  it("el primero espera la base; luego el doble cada vez", () => {
    expect(cooldownAfterLimit(1, 0, sinAzar)).toBe(BASE_COOLDOWN_MS);
    expect(cooldownAfterLimit(2, 0, sinAzar)).toBe(BASE_COOLDOWN_MS * 2);
    expect(cooldownAfterLimit(3, 0, sinAzar)).toBe(BASE_COOLDOWN_MS * 4);
  });
  it("respeta lo que pida la API si es mayor", () => {
    expect(cooldownAfterLimit(1, 120_000, sinAzar)).toBe(120_000);
  });
  it("tiene tope y añade un pellizco aleatorio para no volver todos a la vez", () => {
    expect(cooldownAfterLimit(9, 0, sinAzar)).toBeLessThanOrEqual(MAX_COOLDOWN_MS);
    expect(cooldownAfterLimit(1, 0, () => 1)).toBeGreaterThan(BASE_COOLDOWN_MS);
    expect(cooldownAfterLimit(1, 0, () => 1)).toBeLessThanOrEqual(BASE_COOLDOWN_MS * 1.25);
  });
});

describe("pausa entre tandas", () => {
  it("reparte las llamadas dentro del minuto en vez de soltarlas de golpe", () => {
    expect(pacingGapMs(4)).toBeGreaterThan(0);
    expect(pacingGapMs(4)).toBeLessThanOrEqual(2000);
  });
  it("con poca concurrencia no hace falta frenar", () => {
    expect(pacingGapMs(1)).toBe(0);
  });
});
