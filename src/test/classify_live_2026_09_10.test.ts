import { describe, it, expect } from "vitest";
import { classifyMessage } from "@/lib/classify";

/**
 * Real replies pulled from the live Unibox on 2026-09-10 that were being filed wrong.
 * Every one of these is a mistake a person noticed, so they get a permanent test.
 */
describe("clasificaciones en vivo 2026-09-10", () => {
  it("un acuse de recibo automático es Fuera / Auto, no una Pregunta", () => {
    expect(classifyMessage(
      "A su disposición",
      "Estimada o estimado, Agradezco su interés: el presente email ha sido recibido: y al mismo se le dará respuesta en 48 horas o menos (días hábiles según calendario).",
    )).toBe("out_of_office");
  });

  it("'no forma parte de nuestra estrategia' es un rechazo, no que la persona se haya ido", () => {
    expect(classifyMessage(
      "Maria - This is Libre",
      "Hola María, Si la ayuda comercial es con la búsqueda de leads via cold email, no forma parte de nuestra estrategia. Ya me dices. Gracias por ponerte en contacto",
    )).toBe("not_interested");
  });

  it("sigue detectando que alguien dejó la empresa", () => {
    expect(classifyMessage("Re: propuesta", "Buenos días, Juan ya no forma parte de la empresa. Un saludo."))
      .toBe("out_of_office");
    expect(classifyMessage("Re: propuesta", "Ana ya no trabaja con nosotros, escribe a compras@empresa.com."))
      .toBe("derivado");
  });

  it("pedir casos concretos antes de avanzar con la demo es Interesado", () => {
    expect(classifyMessage(
      "RE: Maria - MoonLoop",
      "Hola Maria, Gracias por contactarme. Antes de avanzar con una demo, ¿podrías compartir algún caso concreto trabajando con empresas de servicios profesionales?",
    )).toBe("interested");
  });

  it("un cuerpo binario sin decodificar no inventa una categoría", () => {
    expect(classifyMessage("RE: XAVI - Beroni", 'JFIFC C k" }!1AQa"q2#BR$3br %&\'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz'))
      .toBe("neutral");
  });

  it("'tenemos los servicios cubiertos' sin apertura se queda en revisión", () => {
    // §7: "ya tenemos proveedor" a secas NO es un rechazo — se revisa, no se etiqueta.
    expect(classifyMessage(
      "Re: XAVI - Ferre&Ferre",
      "Hola Xavi, te agradezco la información. En estos momentos trabajamos con una empresa similar a la tuya y tenemos los servicios cubiertos. Me guardo el contacto por si en el futuro lo necesitamos.",
    )).toBe("neutral");
  });

  it("una aceptación breve sigue siendo Interesado", () => {
    expect(classifyMessage("Re: una idea", "Sí nos viene bien verlo mañana. Qué te parece?")).toBe("interested");
  });
});
