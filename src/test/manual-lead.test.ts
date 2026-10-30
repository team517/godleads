import { describe, expect, it, vi, beforeEach } from "vitest";

/* Alta manual cuando Bloqueados descarta el lead (el trigger devuelve 0 filas). */
const state: { existing: { id: string }[]; inserted: { id: string } | null; blocklist: { value: string; entry_type: string }[] } = { existing: [], inserted: null, blocklist: [] };
vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: () => unknown) => {
    const c: any = {};
    for (const m of ["select", "eq", "in", "limit", "insert"]) c[m] = () => c;
    c.maybeSingle = async () => result();
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return c;
  };
  return { supabase: { from: (t: string) => {
    if (t === "blocklist") return chain(() => ({ data: state.blocklist, error: null }));
    let inserting = false;
    const c: any = chain(() => (inserting ? { data: state.inserted, error: null } : { data: state.existing, error: null }));
    c.insert = () => { inserting = true; return c; };
    return c;
  } } };
});
import { addManualLead, blockedMessage } from "@/lib/manual-lead";

describe("addManualLead", () => {
  beforeEach(() => { state.existing = []; state.inserted = null; state.blocklist = []; });

  it("dominio bloqueado → dice cuál, sin el error técnico", async () => {
    state.blocklist = [{ value: "gmail.com", entry_type: "domain" }];
    const r = await addManualLead("u1", "Xaviriera03@gmail.com", {}, { reuseExisting: true });
    expect(r).toEqual({ kind: "blocked", by: "el dominio gmail.com" });
    expect(blockedMessage("xaviriera03@gmail.com", "el dominio gmail.com")).toContain("Bloqueados");
  });

  it("si ya existe en la cuenta, reutiliza ese lead", async () => {
    state.existing = [{ id: "L1" }];
    expect(await addManualLead("u1", "a@b.com", {}, { reuseExisting: true })).toEqual({ kind: "ok", id: "L1", existed: true });
  });

  it("alta normal", async () => {
    state.inserted = { id: "L2" };
    expect(await addManualLead("u1", "a@b.com", {}, { reuseExisting: true })).toEqual({ kind: "ok", id: "L2", existed: false });
  });
});
