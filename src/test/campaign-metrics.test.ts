import { describe, expect, it, vi } from "vitest";
import { fetchCampaignMetrics, formatResetAt, normalizeLeadQuery } from "@/lib/campaign-metrics";

describe("métricas de campaña (con «Reiniciar analíticas»)", () => {
  it("usa la función que respeta el reinicio", async () => {
    const rpc = vi.fn(async (fn: string) => (fn === "campaign_metrics_v2" ? { data: [{ campaign_id: "c1", sent: 3 }], error: null } : { data: [], error: null }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res.data).toEqual([{ campaign_id: "c1", sent: 3 }]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("campaign_metrics_v2", { p_user_id: "u1" });
  });

  it("si la nueva no existe, cae a la de siempre en vez de enseñar ceros", async () => {
    const rpc = vi.fn(async (fn: string) => (fn === "campaign_metrics_v2"
      ? { data: null, error: { message: "function does not exist" } }
      : { data: [{ campaign_id: "c1", sent: 3977 }], error: null }));
    const res = await fetchCampaignMetrics({ rpc }, "u1");
    expect(res.error).toBeNull();
    expect(res.data?.[0].sent).toBe(3977);
    expect(rpc).toHaveBeenLastCalledWith("campaign_metrics_for_user", { p_user_id: "u1" });
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
