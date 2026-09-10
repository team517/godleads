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

  it("'más adelante' no es '¡adelante!'", () => {
    // El cortés "me lo guardo por si acaso" salía Interesado y habría hecho sonar el móvil.
    expect(classifyMessage("Re: XAVI", "Me guardo el contacto en caso de necesitarlo más adelante.")).toBe("neutral");
    expect(classifyMessage("Re: XAVI", "Lo hablamos más adelante, ahora no es el momento.")).not.toBe("interested");
    // …pero el "adelante" de verdad sigue siendo un sí.
    expect(classifyMessage("Re: propuesta", "Sí, adelante. ¿Cuándo lo vemos?")).toBe("interested");
    expect(classifyMessage("Re: propuesta", "Adelante, cuéntame más.")).toBe("interested");
  });

  it("corta la cita cuando la cabecera va en varias líneas", () => {
    // Una cabecera "De: / Fecha: / Para: / Asunto:" repartida en varias líneas dejaba NUESTRO
    // propio correo dentro del texto atribuido al lead.
    const cuerpo = [
      "Hola Xavi, te agradezco la información.",
      "En estos momentos trabajamos con una empresa similar a la tuya y tenemos los servicios cubiertos.",
      "",
      "De: xavi Lopez",
      "Fecha: jueves, 10 de septiembre de 2026, 18:08",
      "Para: Josep Vicent Ferre",
      "Asunto: XAVI - Ferre&Ferre",
      "",
      "te he preparado una demo personalizada, ¿te va bien verlo 10 minutos esta semana?",
    ].join("\n");
    expect(classifyMessage("Re: XAVI - Ferre&Ferre", cuerpo)).toBe("neutral");
  });

  it("un adjunto sin descodificar no es una pregunta", () => {
    expect(classifyMessage("RE: XAVI - Beroni", "JFIFC   C k\" }!1AQa\"q2#BR$3br %&'()*456789:?????")).toBe("neutral");
    expect(classifyMessage("RE: STV", "ExifII*Ducky &Adobed Wa 0\"41!\"A2BR3Cs0!10aAQ^hgxjl[=x???dU^2f")).toBe("neutral");
  });
});
