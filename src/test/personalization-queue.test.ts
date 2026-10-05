import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { colorEtiqueta, columnasDe, csvPersonalizado, estadoTrabajo, etiquetasDe, hayActivas, limpiarEtiqueta, nombreDescarga, ordenarCola, pasaFiltroEtiqueta, puestoEnCola, type TrabajoCola } from "@/lib/personalization-queue";

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

describe("etiquetas de las listas (Lucy, Juan software…)", () => {
  it("se guarda limpia y como mucho de 40 caracteres; vacía = sin etiqueta", () => {
    expect(limpiarEtiqueta("  Lucy   onepulso ")).toBe("Lucy onepulso");
    expect(limpiarEtiqueta("   ")).toBe("");
    expect(limpiarEtiqueta(null)).toBe("");
    expect(limpiarEtiqueta("x".repeat(60))).toHaveLength(40);
  });

  it("el CSV descargado lleva la etiqueta delante (sin caracteres que rompan el nombre del archivo)", () => {
    expect(nombreDescarga("B2B ONEPULSO 10K - Leads.csv", "Lucy")).toBe("Lucy - B2B ONEPULSO 10K - Leads_personalizado.csv");
    expect(nombreDescarga("lista.csv", "Juan/Xavi: software")).toBe("Juan-Xavi- software - lista_personalizado.csv");
    expect(nombreDescarga("lista.csv", "")).toBe("lista_personalizado.csv");
    expect(nombreDescarga("lista.csv", null)).toBe("lista_personalizado.csv");
  });

  it("lista de etiquetas usadas, sin repetir por mayúsculas, con cuántas listas tiene cada una", () => {
    const lista = [{ label: "Lucy" }, { label: "lucy " }, { label: "Juan" }, { label: null }, { label: "" }];
    expect(etiquetasDe(lista)).toEqual([{ label: "Lucy", n: 2 }, { label: "Juan", n: 1 }]);
  });

  it("filtro: null = todas; si no, sólo las de esa etiqueta (sin distinguir mayúsculas)", () => {
    expect(pasaFiltroEtiqueta({ label: "Lucy" }, null)).toBe(true);
    expect(pasaFiltroEtiqueta({ label: null }, null)).toBe(true);
    expect(pasaFiltroEtiqueta({ label: "lucy" }, "Lucy")).toBe(true);
    expect(pasaFiltroEtiqueta({ label: "Juan" }, "Lucy")).toBe(false);
    expect(pasaFiltroEtiqueta({ label: null }, "Lucy")).toBe(false);
  });

  it("la misma etiqueta tiene siempre el mismo color", () => {
    expect(colorEtiqueta("Lucy")).toBe(colorEtiqueta(" lucy"));
    expect(colorEtiqueta("Lucy")).toMatch(/^#[0-9A-F]{6}$/);
  });
});
