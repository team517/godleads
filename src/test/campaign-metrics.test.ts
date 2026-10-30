import { describe, expect, it, vi } from "vitest";
import { fetchCampaignMetrics, formatResetAt, normalizeLeadQuery } from "@/lib/campaign-metrics";

// Sin la caché del servidor (cached_rpc aún no existe): el camino de siempre.
const NO_CACHE = { data: null, error: { code: "PGRST202", message: "Could not find the function public.cached_rpc" } };
const sinCache = (f: (fn: string) => Promise<unknown>) => vi.fn(async (fn: string) => (fn === "cached_rpc" ? NO_CACHE : f(fn)));

describe("métricas de campaña: copia precalculada en el servidor (cached_rpc)", () => {
  it("lee la copia: una sola llamada, sin recalcular", async () => {
    const rpc = vi.fn(async (fn: string) => (fn === "cached_rpc" ? { data: [{ campaign_id: "c1", sent: 8210, sequences: 4 }], error: null } : { data: null, error: { message: "no debería llamarse" } }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res).toEqual({ data: [{ campaign_id: "c1", sent: 8210, sequences: 4 }], error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("cached_rpc", { p_key: "campaign_metrics_v2", p_force: false });
  });
  it("tras «Reiniciar analíticas» (force) pide recalcular ya", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await fetchCampaignMetrics({ rpc }, "u1", { force: true });
    expect(rpc).toHaveBeenCalledWith("cached_rpc", { p_key: "campaign_metrics_v2", p_force: true });
  });
  it("si la copia falla (p. ej. timeout al calcularla por primera vez), prueba la función de siempre", async () => {
    const rpc = vi.fn(async (fn: string) => (fn === "cached_rpc" ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: [{ campaign_id: "c1", sent: 3 }], error: null }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res.data).toEqual([{ campaign_id: "c1", sent: 3 }]);
    expect(rpc).toHaveBeenLastCalledWith("campaign_metrics_v2", { p_user_id: "u1" });
  });
});

describe("métricas de campaña (con «Reiniciar analíticas»)", () => {
  it("usa la función que respeta el reinicio", async () => {
    const rpc = sinCache(async (fn: string) => (fn === "campaign_metrics_v2" ? { data: [{ campaign_id: "c1", sent: 3 }], error: null } : { data: [], error: null }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res.data).toEqual([{ campaign_id: "c1", sent: 3 }]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("campaign_metrics_v2", { p_user_id: "u1" });
  });

  it("si la nueva no existe (PGRST202), cae a la de siempre en vez de enseñar ceros", async () => {
    const rpc = sinCache(async (fn: string) => (fn === "campaign_metrics_v2"
      ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.campaign_metrics_v2" } }
      : { data: [{ campaign_id: "c1", sent: 3977 }], error: null }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res.error).toBeNull();
    expect(res.data?.[0].sent).toBe(3977);
    expect(rpc).toHaveBeenLastCalledWith("campaign_metrics_for_user", { p_user_id: "u1" });
  });

  it("un timeout de la nueva NO cae a la vieja (enseñaría números de antes del reinicio): devuelve el error", async () => {
    const rpc = sinCache(async (fn: string) => (fn === "campaign_metrics_v2"
      ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
      : { data: [{ campaign_id: "c1", sent: 3977 }], error: null }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res.data).toBeNull();
    expect(res.error?.message).toMatch(/statement timeout/);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("si fallan las dos, devuelve el error (la pantalla conserva lo que tenía)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "JWT expired" } }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("JWT expired");
  });

  it("formatea desde cuándo se cuenta; una fecha rota no pinta «Invalid Date»", () => {
    expect(formatResetAt("2026-09-21T18:15:00Z")).toMatch(/21 sept?/);
    expect(formatResetAt(null)).toBe("");
    expect(formatResetAt("no-es-fecha")).toBe("");
  });
});

describe("búsqueda de leads", () => {
  it("menos de 2 letras no busca en el servidor", () => {
    expect(normalizeLeadQuery("")).toBe("");
    expect(normalizeLeadQuery(" a ")).toBe("");
    expect(normalizeLeadQuery("%")).toBe("");
  });
  it("limpia espacios y deja pasar emails, empresas y nombres de campaña", () => {
    expect(normalizeLeadQuery("  javier@aciturri.es ")).toBe("javier@aciturri.es");
    expect(normalizeLeadQuery("CAMPAÑA   ONEPULSO")).toBe("CAMPAÑA ONEPULSO");
  });
});
