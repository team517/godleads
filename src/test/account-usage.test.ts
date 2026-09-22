import { describe, expect, it } from "vitest";
import { campaignsUsingAccounts } from "@/lib/account-usage";

describe("buzones que ya envían en otras campañas", () => {
  const accounts = [
    { id: "a1", tags: ["lluert"] },
    { id: "a2", tags: [] },
    { id: "a3", tags: ["tcx"] },
  ];
  const others = [
    { id: "c2", name: "lluert 2", account_tags: [] },
    { id: "c3", name: "lluert 3", account_tags: [] },
    { id: "c5", name: "lluert 5", account_tags: ["lluert"] },
  ];
  const links = [
    { campaign_id: "c2", account_id: "a1" },
    { campaign_id: "c3", account_id: "a1" },
    { campaign_id: "c2", account_id: "a2" },
    { campaign_id: "cX", account_id: "a2" }, // campaña que no es del usuario / ya no existe
  ];

  it("directo + por etiqueta, ordenado y sin repetir", () => {
    expect(campaignsUsingAccounts(accounts, others, links)).toEqual({
      a1: ["lluert 2", "lluert 3", "lluert 5"],
      a2: ["lluert 2"],
    });
  });

  it("un buzón libre no aparece", () => {
    expect(campaignsUsingAccounts(accounts, others, links).a3).toBeUndefined();
  });

  it("sin otras campañas, nada", () => {
    expect(campaignsUsingAccounts(accounts, [], links)).toEqual({});
  });
});
