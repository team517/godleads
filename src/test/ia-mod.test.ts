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
  it("nunca activa/pausa campañas, ni borra leads o cuentas, ni toca contraseñas", () => {
    expect(nombres.some((n) => /activar_campana|pausar|borrar_lead|eliminar_lead|borrar_cuenta|eliminar_cuenta|password|contrasena/.test(n))).toBe(false);
    // Ningún parámetro de ninguna herramienta permite cambiar credenciales ni el estado de una campaña.
    const params = IA_MOD_TOOLS.flatMap((t) => Object.keys((t.function.parameters as any).properties || {}));
    expect(params.some((p) => /password|imap|smtp|status|estado/.test(p))).toBe(false);
    // Leer cuentas y respuestas no escribe nada.
    expect(ESCRITURAS.has("ver_cuentas")).toBe(false);
    expect(ESCRITURAS.has("revisar_respuestas")).toBe(false);
  });
  it("organizar cuentas, conectarlas, slow ramp y ajustes son de escritura (con Deshacer / Confirmar)", () => {
    for (const n of ["organizar_cuentas", "conectar_cuentas_campana", "slow_ramp_cuentas", "ajustar_campana"]) expect(ESCRITURAS.has(n)).toBe(true);
  });
  it("importar leads es de escritura (pasa por Confirmar)", () => {
    expect(ESCRITURAS.has("importar_leads")).toBe(true);
    expect(nombres).toContain("ver_archivo");
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

import { planImportacion, variablesUsadas } from "../../supabase/functions/_shared/ia-mod";
describe("importar leads de un CSV adjunto", () => {
  it("email válido y en minúsculas, sin repetidos, columnas vacías fuera", () => {
    const p = planImportacion([
      { email: "Ana@Acme.com", nombre: "Ana", empresa: "Acme", ciudad: "" },
      { email: "ana@acme.com", nombre: "Otra" },
      { email: "no-es-email", nombre: "X" },
      { email: "luis@beta.es", Nombre: "Luis" },
    ]);
    expect(p.filas).toEqual([
      { email: "ana@acme.com", custom_fields: { nombre: "Ana", empresa: "Acme" } },
      { email: "luis@beta.es", custom_fields: { nombre: "Luis" } },
    ]);
    expect(p.duplicados).toBe(1);
    expect(p.invalidos).toBe(1);
  });
  it("renombra columnas a las variables de los mensajes, sin pisar el email", () => {
    const p = planImportacion([{ email: "a@b.es", nombre: "Ana", empresa: "Acme" }], { nombre: "first_name", Empresa: "company_name", email: "x" });
    expect(p.filas[0].custom_fields).toEqual({ first_name: "Ana", company_name: "Acme" });
    expect(p.columnas).toEqual(["company_name", "first_name"]);
  });
  it("variables que usan los mensajes, sin las del motor", () => {
    expect(variablesUsadas(["Buenas {{first_name}}", "Soy {{SenderFirstName}}, vi {{ company_name }} y {{first_name}}"])).toEqual(["company_name", "first_name"]);
  });
});

describe("PulseBot estilo ChatGPT", () => {
  const s = sistemaIaMod({ nombre: "", empresa: "X", email: "x@x.es", notas: "", instruccionesRespuestas: "", skills: "", enlaceReserva: "", campanas: [], hoy: "hoy" });
  it("respuestas cortas y sin ofrecer opciones cuando la orden es clara", () => {
    expect(s).toMatch(/máximo ~90 palabras/);
    expect(s).toMatch(/no ofrezcas opciones A\/B/);
  });
  it("si piden importar leads, importa ya con la plantilla", () => {
    expect(s).toMatch(/llama YA a importar_leads \(formato "plantilla"/);
  });
});
