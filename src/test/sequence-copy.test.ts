import { describe, expect, it } from "vitest";
import {
  asuntoParaPaso, cuerpoATexto, ejemploParaPaso, esperaParaPaso, leerPasos, peticionSecuencia, sistemaSecuencia,
} from "../../supabase/functions/_shared/sequence-copy";
import { CAMPAIGN_EXAMPLES } from "../../supabase/functions/_shared/campaign-copy";

describe("el generador del editor usa el molde de los EJEMPLOS QUE FUNCIONAN", () => {
  const sis = sistemaSecuencia({ variables: ["first_name", "company_name", "city"] });
  it("lleva los tres ejemplos completos y las frases-ancla", () => {
    expect(sis).toContain(CAMPAIGN_EXAMPLES);
    expect(sis).toContain("y no, esto no es una plantilla");
    expect(sis).toContain("¿te va bien verlo 10 minutos esta semana?");
    expect(sis).toContain("¿Lo vemos?");
  });
  it("sin nombre de quien firma, firma cada buzón con {{SenderFirstName}}", () => {
    expect(sis).toContain("Soy {{SenderFirstName}}");
  });
  it("con nombre, firma con ese nombre", () => {
    expect(sistemaSecuencia({ variables: [], firma: "Laura" })).toContain('"Soy Laura, ..."');
  });
  it("pide texto plano (el editor es un cuadro de texto), no HTML", () => {
    expect(sis).toMatch(/TEXTO PLANO/);
    expect(sis).toContain("{{first_name}}, {{company_name}}, {{city}}");
  });
});

describe("posición del correo", () => {
  it("cada posición calca su ejemplo", () => {
    expect(ejemploParaPaso(1)).toMatch(/STEP 1/);
    expect(ejemploParaPaso(2)).toMatch(/STEP 2/);
    expect(ejemploParaPaso(3)).toMatch(/STEP 3/);
    expect(ejemploParaPaso(5)).toMatch(/STEP 3/);
    expect(peticionSecuencia("vendo X", 1, 2)).toContain("posición 2");
    expect(peticionSecuencia("vendo X", 3)).toContain("3) calca el ejemplo STEP 3");
  });
  it("esperas del molde: 0, 2, 3, 3…", () => {
    expect([1, 2, 3, 4].map(esperaParaPaso)).toEqual([0, 2, 3, 3]);
  });
  it("los follow-ups van en el hilo del primero (asunto vacío)", () => {
    expect(asuntoParaPaso(1, "idea para {{company_name}}")).toBe("idea para {{company_name}}");
    expect(asuntoParaPaso(2, "seguimiento")).toBe("");
  });
});

describe("limpieza de la respuesta", () => {
  it("HTML → párrafos separados por línea en blanco, firma en líneas seguidas", () => {
    expect(cuerpoATexto("<p>Buenas {{first_name}}</p><p>Soy Ana &amp; co.</p><p>quedo atento<br>un saludo<br>Ana</p>"))
      .toBe("Buenas {{first_name}}\n\nSoy Ana & co.\n\nquedo atento\nun saludo\nAna");
  });
  it("texto ya bueno se deja igual (sin más de una línea en blanco)", () => {
    expect(cuerpoATexto("Hola\n\n\n\nadiós  ")).toBe("Hola\n\nadiós");
  });
  it("acepta el array suelto, con ```json o dentro de {steps}", () => {
    expect(leerPasos('```json\n[{"subject":"a","body":"<p>x</p>"}]\n```')).toEqual([{ subject: "a", body: "x" }]);
    expect(leerPasos('{"steps":[{"subject":"a","body":"y"},{"subject":"","body":""}]}')).toEqual([{ subject: "a", body: "y" }]);
  });
});
