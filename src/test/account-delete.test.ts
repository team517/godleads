import { describe, expect, it } from "vitest";
import { campanasActivasQueUsan, mensajeBloqueo } from "@/lib/account-delete";

const cuentas = [
  { id: "a", tags: ["MARIO tunuevolead"] },
  { id: "b", tags: ["MARIO tunuevolead"] },
  { id: "c", tags: [] },
  { id: "d", tags: ["mario tunuevolead"] },
];

describe("borrar cuentas sólo con la campaña pausada", () => {
  it("bloquea si la campaña activa las usa por etiqueta o a mano", () => {
    const r = campanasActivasQueUsan(["a", "b", "c"], cuentas, [
      { id: "m", name: "mario SOFTWARE", status: "active", account_tags: ["MARIO tunuevolead"] },
      { id: "x", name: "xavi", status: "active", account_tags: [] },
    ], [{ campaign_id: "x", account_id: "c" }]);
    expect(r).toEqual([{ campana: "mario SOFTWARE", cuentas: 2 }, { campana: "xavi", cuentas: 1 }]);
    expect(mensajeBloqueo(r)).toContain("Pausa esas campañas");
  });

  it("con la campaña pausada deja borrar", () => {
    expect(campanasActivasQueUsan(["a", "b"], cuentas, [
      { id: "m", name: "mario SOFTWARE", status: "paused", account_tags: ["MARIO tunuevolead"] },
    ], [{ campaign_id: "m", account_id: "a" }])).toEqual([]);
  });

  it("la etiqueta tiene que coincidir exacta (como el motor)", () => {
    expect(campanasActivasQueUsan(["d"], cuentas, [
      { id: "m", name: "mario", status: "active", account_tags: ["MARIO tunuevolead"] },
    ], [])).toEqual([]);
  });
});
