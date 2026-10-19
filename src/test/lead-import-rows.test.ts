import { describe, expect, it } from "vitest";
import { leadFieldsFromRow, templateRows } from "@/lib/lead-import-rows";
import { PLANTILLA_COLUMNAS, aliasPlantilla } from "@/lib/variable-resolver";
import { findEmailStatusColumn } from "@/lib/email-status";

/* Importar con «Plantilla» un CSV de Apollo con email_status (19-10-2026). */
const headers = ["id", "first_name", "email", "email_status", "organization_name", "city"];
const rows = [
  { id: "1", first_name: "Javier", email: "javier@ocaglobal.com", email_status: "VALID", organization_name: "Oca Global", city: "Barcelona" },
  { id: "2", first_name: "Ana", email: "ana@nadie.es", email_status: "UNAVAILABLE", organization_name: "Nadie SL", city: "Madrid" },
  { id: "3", first_name: "Luis", email: "luis@quizas.es", email_status: "GUESSED", organization_name: "Quizas SA", city: "" },
  { id: "4", first_name: "Sin", email: "", email_status: "VALID", organization_name: "x", city: "" },
];

describe("Importación con plantilla + estado del email", () => {
  it("la plantilla conserva email_status aparte y quita filas sin email", () => {
    const out = templateRows(headers, rows, PLANTILLA_COLUMNAS, aliasPlantilla);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ email: "javier@ocaglobal.com", first_name: "Javier", organization_name: "Oca Global", city: "Barcelona", email_status: "VALID" });
    expect(Object.keys(out[0])).not.toContain("id");
  });

  it("se guarda en verification_status y NO como variable", () => {
    const out = templateRows(headers, rows, PLANTILLA_COLUMNAS, aliasPlantilla);
    const statusCol = findEmailStatusColumn([...new Set(out.flatMap((r) => Object.keys(r)))]);
    const saved = out.map((r) => leadFieldsFromRow(r, { statusCol, importAllColumns: true }));
    expect(saved.map((s) => s.verification_status)).toEqual(["valid", "invalid", "risky"]);
    for (const s of saved) expect(s.custom_fields.email_status).toBeUndefined();
    expect(saved[0].custom_fields).toMatchObject({ first_name: "Javier", organization_name: "Oca Global" });
  });

  it("importación normal con columnas elegidas: el estado se guarda aunque no esté marcada", () => {
    const r = rows[1];
    const res = leadFieldsFromRow(r, { statusCol: "email_status", importAllColumns: false, selectedCols: new Set(["first_name"]) });
    expect(res.custom_fields).toEqual({ first_name: "Ana" });
    expect(res.verification_status).toBe("invalid");
  });

  it("sin columna de estado todo sigue como antes", () => {
    const res = leadFieldsFromRow({ email: "a@b.es", first_name: "A" }, { statusCol: null, importAllColumns: true });
    expect(res).toEqual({ custom_fields: { first_name: "A" }, verification_status: null });
  });
});
