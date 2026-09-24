import { describe, expect, it } from "vitest";
import { otrosDestinatarios } from "@/pages/Unibox";

// Caso real (23-09-2026, seoinnova): Alimentos Delcasino respondió sumando a un compañero en el
// "Para". En el Unibox no se veía por ningún lado y parecía que escribían sólo a nuestro buzón.
const TO_REAL = '"juanjo@seoinnova-online.es" <juanjo@seoinnova-online.es>, ANDRES LOSADA <andreslostor@gmail.com>';

describe("otrosDestinatarios", () => {
  it("enseña al compañero que va en el Para y no repite nuestro buzón", () => {
    const r = otrosDestinatarios(TO_REAL, null, "juanjo@seoinnova-online.es");
    expect(r.para).toEqual(["ANDRES LOSADA <andreslostor@gmail.com>"]);
    expect(r.copia).toEqual([]);
  });
  it("enseña las copias", () => {
    const r = otrosDestinatarios("yo@midominio.es", "Ana <ana@cliente.com>, luis@cliente.com", "yo@midominio.es");
    expect(r.para).toEqual([]);
    expect(r.copia).toEqual(["Ana <ana@cliente.com>", "luis@cliente.com"]);
  });
  it("si sólo nos escriben a nosotros, no hay nada que enseñar", () => {
    const r = otrosDestinatarios("<juanjo@seoinnova-online.es>", null, "juanjo@seoinnova-online.es");
    expect(r.para).toEqual([]);
    expect(r.copia).toEqual([]);
  });
  it("una coma dentro del nombre no parte la dirección", () => {
    const r = otrosDestinatarios('"Losada, Andres" <andreslostor@gmail.com>', null, "otro@buzon.es");
    expect(r.para).toEqual(['"Losada, Andres" <andreslostor@gmail.com>']);
  });
  it("sin datos no falla", () => {
    expect(otrosDestinatarios(null, undefined, null)).toEqual({ para: [], copia: [] });
  });
});
