import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { columnasDe, csvPersonalizado, estadoTrabajo, hayActivas, nombreDescarga, ordenarCola, puestoEnCola, type TrabajoCola } from "@/lib/personalization-queue";

const t = (p: Partial<TrabajoCola> & { id: string; status: string; created_at: string }): TrabajoCola => ({
  filename: `${p.id}.csv`, total: 100, done: 0, ok: 0, failed: 0, ...p,
});

describe("cola de personalizaciones", () => {
  it("estado que se enseña: entre tandas el servidor deja la lista en pending, pero si ya tiene mensajes sigue 'Generando'", () => {
    expect(estadoTrabajo({ status: "pending", done: 0 })).toMatchObject({ txt: "En cola", activo: true, enCola: true });
    expect(estadoTrabajo({ status: "pending", done: 150 })).toMatchObject({ txt: "Generando", activo: true, enCola: false });
    expect(estadoTrabajo({ status: "running", done: 0 })).toMatchObject({ txt: "Generando", activo: true });
    expect(estadoTrabajo({ status: "uploading", done: 0 })).toMatchObject({ txt: "Subiendo leads", activo: false });
    expect(estadoTrabajo({ status: "completed", done: 100 })).toMatchObject({ txt: "Completada", cls: "soft-state-good", activo: false });
    expect(estadoTrabajo({ status: "cancelled", done: 40 })).toMatchObject({ txt: "Parada", activo: false });
    expect(estadoTrabajo({ status: "error", done: 40 })).toMatchObject({ txt: "Con errores", cls: "soft-state-bad" });
  });

  it("orden: las vivas primero, la más antigua antes (es la que va primero); las terminadas después, la más reciente arriba", () => {
    const lista = [
      t({ id: "hecha-vieja", status: "completed", created_at: "2026-10-01T10:00:00Z" }),
      t({ id: "cola-2", status: "pending", created_at: "2026-10-04T10:05:00Z" }),
      t({ id: "hecha-nueva", status: "completed", created_at: "2026-10-04T09:00:00Z" }),
      t({ id: "generando", status: "running", created_at: "2026-10-04T10:00:00Z", done: 300 }),
      t({ id: "cola-1", status: "pending", created_at: "2026-10-04T10:02:00Z" }),
      t({ id: "subiendo", status: "uploading", created_at: "2026-10-04T10:06:00Z" }),
    ];
    expect(ordenarCola(lista).map((h) => h.id)).toEqual(["generando", "cola-1", "cola-2", "subiendo", "hecha-nueva", "hecha-vieja"]);
    expect(puestoEnCola(lista, "cola-1")).toBe(1);
    expect(puestoEnCola(lista, "cola-2")).toBe(2);
    expect(puestoEnCola(lista, "generando")).toBeNull();
    expect(hayActivas(lista)).toBe(true);
    expect(hayActivas([lista[0], lista[2]])).toBe(false);
  });

  it("el CSV sale con las columnas del archivo + personalized_message, en el orden del archivo, aunque las filas lleguen desordenadas", () => {
    const rows = [
      { __idx: 1, nombre: "Carlos", empresa: "Globex", email: "carlos@globex.com" },
      { __idx: 0, nombre: "Ana", empresa: "Acme", email: "ana@acme.com" },
      { __idx: 2, nombre: "Lucía", empresa: "NovaTech", email: "lucia@novatech.com" },
    ];
    const results = { "0": { message: "<p>Hola Ana,</p>\n<p>vi que Acme…</p>" }, "1": { message: "", error: "timeout" } };
    const csv = csvPersonalizado(["nombre", "empresa", "email"], rows, results);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(parsed.meta.fields).toEqual(["nombre", "empresa", "email", "personalized_message"]);
    expect(parsed.data.map((r) => r.nombre)).toEqual(["Ana", "Carlos", "Lucía"]);
    expect(parsed.data[0].personalized_message).toBe("<p>Hola Ana,</p><p>vi que Acme…</p>"); // una sola celda, sin saltos
    expect(parsed.data[1].personalized_message).toBe("[ERROR] timeout");
    expect(parsed.data[2].personalized_message).toBe(""); // aún sin generar
  });

  it("columnas: las del trabajo; si no se guardaron, las de las filas (sin __idx)", () => {
    expect(columnasDe(["a", "b"], [])).toEqual(["a", "b"]);
    expect(columnasDe(null, [{ __idx: 0, b: "1", a: "2" }, { __idx: 1, c: "3" }])).toEqual(["b", "a", "c"]);
    expect(nombreDescarga("Leads 2MKAPITAL.CSV")).toBe("Leads 2MKAPITAL_personalizado.csv");
    expect(nombreDescarga("")).toBe("leads_personalizado.csv");
  });
});
