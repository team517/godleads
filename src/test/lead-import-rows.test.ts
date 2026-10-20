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

import { dedupeImportRows, importInChunks } from "@/lib/lead-import-rows";

describe("Subida rápida de leads (20-10-2026)", () => {
  it("une los emails repetidos del CSV (columnas juntas, gana la última)", () => {
    const out = dedupeImportRows([
      { email: "A@x.es", custom_fields: { first_name: "Ana", city: "Madrid" } },
      { email: "b@x.es", custom_fields: { first_name: "Bea" } },
      { email: "a@x.es ", custom_fields: { city: "Bilbao", company_name: "X" }, verification_status: "valid" },
      { email: "sin-arroba", custom_fields: {} },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ email: "a@x.es", custom_fields: { first_name: "Ana", city: "Bilbao", company_name: "X" }, verification_status: "valid" });
  });

  it("sube por tandas a la vez y no se deja nada aunque fallen tandas", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const seen = new Set<number>();
    let calls = 0;
    const progress: number[] = [];
    const res = await importInChunks(rows, async (chunk) => {
      calls++;
      // La primera vez que llega una tanda grande falla (tiempo agotado); sus mitades entran.
      if (chunk.length > 600 && calls <= 2) throw new Error("statement timeout");
      for (const x of chunk) seen.add(x);
      return { added: chunk.length, updated: 0 };
    }, { chunkSize: 1000, concurrency: 3, onProgress: (d) => progress.push(d) });
    expect(res.failed).toEqual([]);
    expect(res.added).toBe(2500);
    expect(seen.size).toBe(2500);
    expect(progress[progress.length - 1]).toBe(2500);
  });

  it("una fila que falla sola se informa y las demás entran", async () => {
    const res = await importInChunks([1, 2, 3, 4, 5], async (chunk) => {
      if (chunk.includes(3)) throw new Error("dato inválido");
      return { added: chunk.length, updated: 0 };
    }, { chunkSize: 5, concurrency: 1 });
    expect(res.failed).toEqual([3]);
    expect(res.added).toBe(4);
    expect(res.error).toBe("dato inválido");
  });
});
