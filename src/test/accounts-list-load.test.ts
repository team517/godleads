import { describe, expect, it } from "vitest";
import { loadAccountsPaged, PAGE_SIZE } from "@/lib/accounts-list-load";

/* 04-11-2026: la pantalla Cuentas de correo salía como "Conecta una cuenta de envío" cuando la consulta
   fallaba. La carga reintenta una vez y, si no, devuelve el error (nunca una lista vacía "buena"). */
const noSleep = async () => {};

describe("loadAccountsPaged", () => {
  it("pagina de 1000 en 1000 hasta la última página corta", async () => {
    const pages = [Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `a${i}` })), [{ id: "z" }]];
    const r = await loadAccountsPaged(async (off) => ({ data: pages[off / PAGE_SIZE] ?? [], error: null }), { sleep: noSleep });
    expect(r.error).toBeNull();
    expect(r.accounts).toHaveLength(PAGE_SIZE + 1);
    expect(r.attempts).toBe(1);
  });

  it("si la consulta falla una vez, reintenta y devuelve las cuentas", async () => {
    let calls = 0;
    const r = await loadAccountsPaged(async () => {
      calls++;
      if (calls === 1) return { data: null, error: { message: "canceling statement due to statement timeout" } };
      return { data: [{ id: "a1" }, { id: "a2" }], error: null };
    }, { sleep: noSleep });
    expect(r.accounts.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(r.error).toBeNull();
    expect(r.attempts).toBe(2);
  });

  it("si falla dos veces, devuelve el error y ninguna cuenta (la pantalla no enseña el vacío)", async () => {
    const r = await loadAccountsPaged(async () => ({ data: null, error: { message: "column email_accounts_safe.backoff_until does not exist" } }), { sleep: noSleep });
    expect(r.accounts).toEqual([]);
    expect(r.error).toContain("backoff_until");
    expect(r.attempts).toBe(2);
  });

  it("una excepción de red cuenta como fallo y también se reintenta", async () => {
    let calls = 0;
    const r = await loadAccountsPaged(async () => {
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { data: [{ id: "a1" }], error: null };
    }, { sleep: noSleep });
    expect(r.accounts).toHaveLength(1);
    expect(r.error).toBeNull();
  });
});
