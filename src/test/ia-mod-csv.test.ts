import { describe, expect, it } from "vitest";
import { decodificarArchivo, prepararCsv, trozos } from "@/lib/ia-mod-csv";

describe("CSV adjunto en PulseBot", () => {
  it("leads: cabeceras normalizadas, email obligatorio y válido", () => {
    const r = prepararCsv("First Name,Company Name,Email\nAna,Acme,ANA@acme.com\nLuis,Beta,no-es-email\n,,\nEva,Gamma,eva@gamma.es\n");
    if ("error" in r) throw new Error(r.error);
    expect(r.kind).toBe("leads");
    expect(r.headers).toEqual(["first_name", "company_name", "email"]);
    expect(r.rows.map((x) => x.email)).toEqual(["ana@acme.com", "eva@gamma.es"]);
    expect(r.rows[0].first_name).toBe("Ana");
    expect(r.descartadas).toBe(1);
  });
  it("reconoce el email aunque la columna se llame Correo o Work Email, y el ';' de Excel", () => {
    const r = prepararCsv("Nombre;Correo\nAna;ana@acme.com\n");
    if ("error" in r) throw new Error(r.error);
    expect(r.headers).toEqual(["nombre", "email"]);
    expect(r.rows).toEqual([{ nombre: "Ana", email: "ana@acme.com" }]);
    const w = prepararCsv("Work Email,Name\nx@y.com,X\n");
    if ("error" in w) throw new Error(w.error);
    expect(w.kind).toBe("leads");
  });
  it("sin columna de email se acepta como tabla para analizar", () => {
    const r = prepararCsv("Mes,Reuniones\nJulio,12\nAgosto,15\n");
    if ("error" in r) throw new Error(r.error);
    expect(r.kind).toBe("tabla");
    expect(r.rows).toHaveLength(2);
  });
  it("vacío → error claro", () => {
    expect(prepararCsv("email\n")).toEqual({ error: "El archivo está vacío o sólo tiene la cabecera" });
  });
  it("Excel en español guardado en Windows-1252 se lee con sus tildes", () => {
    const bytes = new Uint8Array([0x4e, 0x6f, 0x6d, 0x62, 0x72, 0x65, 0x0a, 0x4d, 0x61, 0x72, 0xed, 0x61]); // "Nombre\nMaría" en cp1252
    expect(decodificarArchivo(bytes.buffer)).toBe("Nombre\nMaría");
    expect(decodificarArchivo(new TextEncoder().encode("Nombre\nMaría").buffer)).toBe("Nombre\nMaría");
  });
  it("trozos para subir", () => {
    expect(trozos([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
