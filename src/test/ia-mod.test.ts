import { describe, expect, it } from "vitest";
import {
  IA_MOD_TOOLS, ESCRITURAS, historialParaModelo, leerArgs, paraModelo, puedeUsarIaMod, sistemaIaMod, slotDeLetra, variantesDePaso, entero,
} from "../../supabase/functions/_shared/ia-mod";
import { CAMPAIGN_EXAMPLES } from "../../supabase/functions/_shared/campaign-copy";

describe("quién puede usar Modificaciones IA", () => {
  it("sólo hello@, support@ y equipo@", () => {
    expect(puedeUsarIaMod("hello@onepulso.blog")).toBe(true);
    expect(puedeUsarIaMod(" Support@OnePulso.online ")).toBe(true);
    expect(puedeUsarIaMod("equipo@onepulso.online")).toBe(true);
    expect(puedeUsarIaMod("team@onepulso.online")).toBe(false);
    expect(puedeUsarIaMod("oliver@tiarecrew.com")).toBe(false);
    expect(puedeUsarIaMod(null)).toBe(false);
  });
});

describe("herramientas", () => {
  const nombres = IA_MOD_TOOLS.map((t) => t.function.name);
  it("todas las de escritura existen como herramienta", () => {
    for (const n of ESCRITURAS) expect(nombres).toContain(n);
  });
  it("no hay herramientas para activar campañas ni tocar leads o cuentas", () => {
    expect(nombres.some((n) => /activar|pausar|lead|cuenta/.test(n))).toBe(false);
  });
});

describe("instrucciones del chat", () => {
  const s = sistemaIaMod({
    nombre: "Simone", empresa: "Energika", email: "simone@energika.es", notas: "- vende placas solares",
    instruccionesRespuestas: "", skills: "", enlaceReserva: "https://cal.com/x",
    campanas: [{ id: "c1", name: "Industria", status: "active" }], hoy: "sábado, 27 de septiembre de 2026",
  });
  it("lleva el molde de los EJEMPLOS QUE FUNCIONAN y el formato de texto plano", () => {
    expect(s).toContain(CAMPAIGN_EXAMPLES);
    expect(s).toContain("TEXTO PLANO");
  });
  it("lleva el cliente, su memoria, su enlace y sus campañas", () => {
    expect(s).toContain("Energika");
    expect(s).toContain("vende placas solares");
    expect(s).toContain("https://cal.com/x");
    expect(s).toContain("Industria (active) · id c1");
  });
  it("prohíbe inventar números y exige confirmación para borrar", () => {
    expect(s).toMatch(/Nunca inventes datos/);
    expect(s).toMatch(/Confirmar/);
  });
});

describe("variantes con las mismas letras que el editor", () => {
  it("B encendida, C apagada en su hueco", () => {
    const v = variantesDePaso({ variants: [{ subject: "b", body: "B" }], variants_off: [{ subject: "c", body: "C", off_slot: 2 }] });
    expect(v.map((x) => `${x.letra}:${x.encendida}:${x.cuerpo}`)).toEqual(["B:true:B", "C:false:C"]);
  });
  it("letra → hueco", () => {
    expect(slotDeLetra("b")).toBe(1);
    expect(slotDeLetra("C")).toBe(2);
    expect(slotDeLetra("A")).toBeNull();
    expect(slotDeLetra("BB")).toBeNull();
  });
});

describe("utilidades", () => {
  it("historial: los últimos, empezando por el usuario, sin vacíos", () => {
    const filas = [
      { role: "assistant", content: "hola" }, { role: "user", content: "a" }, { role: "assistant", content: "" },
      { role: "assistant", content: "b" }, { role: "user", content: "c" },
    ];
    expect(historialParaModelo(filas)).toEqual([
      { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" },
    ]);
    expect(historialParaModelo(filas, 2).map((x) => x.content)).toEqual(["c"]);
  });
  it("argumentos rotos → objeto vacío; enteros acotados", () => {
    expect(leerArgs("{mal")).toEqual({});
    expect(leerArgs('{"a":1}')).toEqual({ a: 1 });
    expect(entero("99", 3, 0, 60)).toBe(60);
    expect(entero("x", 3, 0, 60)).toBe(3);
  });
  it("resultados largos se recortan", () => {
    expect(paraModelo({ t: "x".repeat(50) }, 20)).toMatch(/recortado/);
  });
});
