import { describe, expect, it } from "vitest";
import { readSavedUniboxTab, saveUniboxTab } from "@/lib/unibox-tab";

/* El Unibox se abre en Campaigns y recuerda la última pestaña (06-10-2026). */
describe("pestaña inicial del Unibox", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  it("sin nada guardado: Campaigns", () => {
    expect(readSavedUniboxTab(mem())).toBe("campaigns");
    expect(readSavedUniboxTab(null)).toBe("campaigns");
  });
  it("recuerda la última pestaña usada", () => {
    const st = mem();
    saveUniboxTab("all_mailboxes", st);
    expect(readSavedUniboxTab(st)).toBe("all_mailboxes");
  });
  it("un valor raro guardado no rompe nada", () => {
    const st = mem();
    st.setItem("op_unibox_tab", "loquesea");
    expect(readSavedUniboxTab(st)).toBe("campaigns");
  });
  it("si el almacenamiento falla, Campaigns", () => {
    expect(readSavedUniboxTab({ getItem: () => { throw new Error("bloqueado"); } })).toBe("campaigns");
    expect(() => saveUniboxTab("sent", { setItem: () => { throw new Error("bloqueado"); } })).not.toThrow();
  });
});
