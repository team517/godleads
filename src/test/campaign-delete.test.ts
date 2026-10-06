import { describe, expect, it } from "vitest";
import {
  deleteCampaignOnServer,
  isCampaignRemoved,
  markCampaignRemoved,
  restoreCampaignAt,
  unmarkCampaignRemoved,
  withoutRemovedCampaigns,
} from "@/lib/campaign-delete";

type Result = { data?: unknown; error: { message: string } | null };

/** Supabase falso: apunta cada borrado (tabla + filtro) y devuelve lo que diga `results`. */
function fakeSupabase(results: Record<string, Result> = {}) {
  const calls: string[] = [];
  const sb = {
    from(table: string) {
      return {
        delete() {
          return {
            eq(col: string, val: string) {
              calls.push(`${table}.${col}=${val}`);
              const r = results[table] ?? { data: table === "campaigns" ? [{ id: val }] : null, error: null };
              const p: any = Promise.resolve(r);
              p.select = () => { calls.push(`${table}.select`); return Promise.resolve(r); };
              return p;
            },
          };
        },
      };
    },
  };
  return { sb, calls };
}

describe("deleteCampaignOnServer", () => {
  it("borra hijos y campaña en el orden de siempre y devuelve null si todo va bien", async () => {
    const { sb, calls } = fakeSupabase();
    expect(await deleteCampaignOnServer(sb, "c1")).toBeNull();
    expect(calls).toEqual([
      "campaign_steps.campaign_id=c1",
      "campaign_accounts.campaign_id=c1",
      "campaign_leads.campaign_id=c1",
      "campaigns.id=c1",
      "campaigns.select",
    ]);
  });

  it("devuelve el motivo del primer error", async () => {
    const { sb } = fakeSupabase({ campaign_leads: { error: { message: "permiso denegado" } } });
    expect(await deleteCampaignOnServer(sb, "c1")).toBe("permiso denegado");
  });

  it("un borrado que no toca ninguna fila es un fallo, no un éxito", async () => {
    const { sb } = fakeSupabase({ campaigns: { data: [], error: null } });
    expect(await deleteCampaignOnServer(sb, "c1")).toMatch(/ninguna fila/);
  });

  it("una excepción de red se devuelve como motivo", async () => {
    const sb = { from() { throw new Error("Failed to fetch"); } };
    expect(await deleteCampaignOnServer(sb, "c1")).toBe("Failed to fetch");
  });
});

describe("lista de campañas quitadas", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("una recarga no hace reaparecer la campaña quitada; al desmarcarla vuelve", () => {
    markCampaignRemoved("b");
    expect(isCampaignRemoved("b")).toBe(true);
    expect(withoutRemovedCampaigns(list).map((c) => c.id)).toEqual(["a", "c"]);
    unmarkCampaignRemoved("b");
    expect(withoutRemovedCampaigns(list)).toBe(list);
  });

  it("restoreCampaignAt la devuelve a su sitio y no la duplica", () => {
    const without = [{ id: "a" }, { id: "c" }];
    expect(restoreCampaignAt(without, { id: "b" }, 1).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(restoreCampaignAt(list, { id: "b" }, 1)).toBe(list);
    expect(restoreCampaignAt(without, { id: "z" }, 99).map((c) => c.id)).toEqual(["a", "c", "z"]);
  });
});
