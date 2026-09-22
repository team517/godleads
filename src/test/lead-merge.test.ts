import { describe, expect, it } from "vitest";
import { fieldsChanged, mergeLeadFields, splitRows } from "@/lib/lead-merge";

describe("reimportar un CSV en una campaña", () => {
  it("lo nuevo con valor pisa; lo vacío no borra", () => {
    expect(mergeLeadFields({ first_name: "Guy", city: "Lyon" }, { organization_name: "Renault", city: "" }))
      .toEqual({ first_name: "Guy", city: "Lyon", organization_name: "Renault" });
  });

  it("detecta si hay algo que escribir", () => {
    expect(fieldsChanged({ a: "1" }, { a: "1" })).toBe(false);
    expect(fieldsChanged({ a: "1" }, { a: "1", b: "2" })).toBe(true);
    expect(fieldsChanged(null, { a: "1" })).toBe(true);
  });

  it("los emails ya presentes se actualizan (no se duplican) y los nuevos se insertan", () => {
    const rows = [
      { email: "Guy@Renault.fr", custom_fields: { organization_name: "Renault" } },
      { email: "nuevo@x.es", custom_fields: { organization_name: "X" } },
      { email: "igual@y.es", custom_fields: { first_name: "Ana" } },
    ];
    const existing = new Map([
      ["guy@renault.fr", { id: "l1", custom_fields: { first_name: "Guy" } }],
      ["igual@y.es", { id: "l2", custom_fields: { first_name: "Ana" } }],
    ]);
    const r = splitRows(rows, existing);
    expect(r.toInsert.map((x) => x.email)).toEqual(["nuevo@x.es"]);
    expect(r.toUpdate).toEqual([{ id: "l1", custom_fields: { first_name: "Guy", organization_name: "Renault" } }]);
    expect(r.unchanged).toBe(1);
  });
});
