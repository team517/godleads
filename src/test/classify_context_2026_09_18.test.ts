import { describe, expect, it } from "vitest";
import { classifyMessage } from "@/lib/classify";
import { evidenceSupported, normalizeForEvidence } from "../../supabase/functions/_shared/ai-classify";

/* Casos REALES del Unibox (17–18 sept 2026) que el propietario señaló: respuestas que salían como
 * "Interesado" sin estarlo, y derivaciones contadas como interés. Aquí se fija lo que deben decir
 * las REGLAS (el suelo, y lo que se usa si el modelo falla); el matiz fino lo decide la IA con su
 * nuevo prompt, y la cita obligatoria es la red de seguridad probada más abajo. */

const NUNCA_INTERESADO = "no puede salir como Interesado";

describe("sin encaje: un no razonado y educado", () => {
  it("«somos otra cosa, no le veo mucho encaje» es un rechazo", () => {
    const t = "Gracias por tu mail, sin embargo, nosotros somos un forwarder para envíos aéreos y marítimos. Con esto quiero decir que no le veo mucho encaje, puesto que nuestro trabajo es más de búsqueda y compra venta de espacio.";
    expect(classifyMessage(null, t)).toBe("not_interested");
  });
  it("«no tiene sentido en nuestro negocio» también", () => {
    expect(classifyMessage(null, "Apostaría a que no tiene sentido para nosotros porque nuestras roturas de stock son de chapas en toneladas.")).toBe("not_interested");
  });
  it("«ahora mismo no es prioridad» es un no, no una duda", () => {
    const t = "Disculpad, estamos con mil frentes y ya trabajamos el SEO con un partner integral, por lo que ahora mismo no es prioridad para nosotros. Contactamos en un par de meses si te parece.";
    expect(classifyMessage(null, t)).toBe("not_interested");
  });
  it("pero si abren la puerta, la apertura sigue ganando (invariante del propietario)", () => {
    expect(classifyMessage(null, "No le veo mucho encaje, pero si quieres podemos hacer una llamada la semana que viene.")).toBe("interested");
  });
});

describe("el archivado educado: piden info para guardarla, no para valorarla", () => {
  it("«tenemos cubierta esa necesidad… mándame info y os tenemos en cuenta» NO es interés", () => {
    const t = "Muchas gracias por tu interés. En estos momentos tenemos cubierta esa necesidad. No obstante, si me mandas info o algún dossier, os tenemos en cuenta para futuras oportunidades.";
    expect(classifyMessage(null, t), NUNCA_INTERESADO).toBe("not_interested");
  });
  it("«me guardo tu contacto y ya te escribiré cuando lo necesitemos» tampoco", () => {
    const t = "Ya trabajamos con otro proveedor. Me guardo tu contacto y cuando tengamos necesidad te escribo.";
    expect(classifyMessage(null, t), NUNCA_INTERESADO).toBe("not_interested");
  });
  it("una reunión aceptada DE VERDAD sí gana al archivado", () => {
    const t = "Ahora lo tenemos cubierto y os tenemos en cuenta para el futuro, pero si te parece hacemos una reunión la semana que viene.";
    expect(classifyMessage(null, t)).toBe("interested");
  });
  it("pedir precio para valorarlo AHORA sigue siendo interés", () => {
    expect(classifyMessage(null, "Pásame la lista de precios y lo hablo con dirección; si me lo aceptan podemos tener una reunión.")).toBe("interested");
  });
});

describe("derivaciones que no son interés", () => {
  it("«se lo he pasado al responsable» es Derivado", () => {
    expect(classifyMessage(null, "Gracias, se lo he pasado al responsable del departamento de compras para que lo valore.")).toBe("derivado");
  });
  it("la persona NUEVA que propone una llamada sí es Interesado", () => {
    const t = "Buenos días: Xavier me ha hecho llegar tu correo, ya que soy la persona responsable de estos temas. ¿Cuándo te iría bien que concretáramos una llamada para comentar vuestra propuesta?";
    expect(classifyMessage(null, t)).toBe("interested");
  });
});

describe("la cita obligatoria del modelo (red de seguridad del «Interesado»)", () => {
  const texto = "Muchas gracias por escribirme. La verdad es que ahora mismo voy fatal de tiempo y me resulta muy complicado garantizarte que pueda encontrar un hueco.";

  it("acepta la cita literal", () => {
    expect(evidenceSupported("voy fatal de tiempo", texto)).toBe(true);
  });
  it("acepta acentos, mayúsculas y puntuación distintos", () => {
    expect(evidenceSupported("VOY FATAL DE TIEMPO,", texto)).toBe(true);
    expect(evidenceSupported("me resulta muy complicado garantizarte", texto)).toBe(true);
  });
  it("RECHAZA una frase que el modelo se ha inventado", () => {
    expect(evidenceSupported("podemos agendar una reunión la semana que viene", texto)).toBe(false);
    expect(evidenceSupported("me interesa mucho vuestra propuesta", texto)).toBe(false);
  });
  it("rechaza una cita vacía, de una palabra suelta o sin texto", () => {
    expect(evidenceSupported("", texto)).toBe(false);
    expect(evidenceSupported("gracias", texto)).toBe(false);
    expect(evidenceSupported("voy fatal de tiempo", "")).toBe(false);
  });
  it("no se deja engañar por palabras sueltas repartidas por el texto", () => {
    // Todas las palabras existen, pero nunca juntas: no hay tal frase.
    expect(evidenceSupported("tiempo hueco gracias complicado", texto)).toBe(false);
  });
  it("normaliza para comparar", () => {
    expect(normalizeForEvidence("  Mañana, lo vemos… ")).toBe("manana lo vemos");
  });
});
