import { describe, expect, it } from "vitest";
import { applySettled, errorText, initialWidget, isMissingRpc, num, settle } from "@/lib/widget-state";

describe("estado de un widget (carga por tarjeta, nunca la página entera en blanco)", () => {
  it("empieza con lo cacheado y cargando", () => {
    expect(initialWidget({ sent: 3 })).toEqual({ data: { sent: 3 }, error: null, loading: true });
    expect(initialWidget()).toEqual({ data: undefined, error: null, loading: true });
  });

  it("una carga buena sustituye el dato y borra el error", () => {
    const prev = { data: { sent: 1 }, error: "antes falló", loading: true };
    expect(applySettled(prev, { status: "fulfilled", value: { data: { sent: 9 }, error: null } }))
      .toEqual({ data: { sent: 9 }, error: null, loading: false });
  });

  it("un { error } de supabase-js NO es «no hay datos»: conserva lo anterior y lo dice", () => {
    const prev = { data: { sent: 1 }, error: null, loading: true };
    const next = applySettled(prev, { status: "fulfilled", value: { data: null, error: { message: "canceling statement due to statement timeout" } } });
    expect(next.data).toEqual({ sent: 1 });
    expect(next.error).toMatch(/statement timeout/);
    expect(next.loading).toBe(false);
  });

  it("una promesa rechazada (red) tampoco borra lo que había", () => {
    const prev = { data: [1, 2], error: null, loading: true };
    const next = applySettled(prev, { status: "rejected", reason: new TypeError("Failed to fetch") });
    expect(next).toEqual({ data: [1, 2], error: "Failed to fetch", loading: false });
  });

  it("settle nunca rechaza", async () => {
    await expect(settle(Promise.reject(new Error("boom")))).resolves.toMatchObject({ status: "rejected" });
    await expect(settle(Promise.resolve({ data: 1, error: null }))).resolves.toEqual({ status: "fulfilled", value: { data: 1, error: null } });
  });

  it("texto del error para cualquier forma", () => {
    expect(errorText(new Error("x"))).toBe("x");
    expect(errorText({ message: "" })).toBe("Error desconocido");
    expect(errorText("plano")).toBe("plano");
    expect(errorText(null)).toBe("Error desconocido");
  });

  it("detecta «la función aún no existe» (migración sin aplicar) y nada más", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "Could not find the function public.campaign_lead_counts" })).toBe(true);
    expect(isMissingRpc({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingRpc({ message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
  });

  it("num: los bigint llegan como texto", () => {
    expect(num("41013")).toBe(41013);
    expect(num(null)).toBe(0);
    expect(num("x")).toBe(0);
  });
});
