import { describe, expect, it } from "vitest";
import { RESPUESTAS_EJEMPLO, construirPrompt, detectarColumnas, validarRespuestas, type RespuestasPrompt } from "@/lib/personalization-prompt";
import { applyMapping } from "../../supabase/functions/_shared/personalize-ai";

/* El prompt que escribe el asistente está calcado del de PubliUp: con sus mismas respuestas tienen
   que salir sus mismas líneas clave, en el mismo orden. */

const publiup: RespuestasPrompt = {
  ...RESPUESTAS_EJEMPLO,
  empresa: "PubliUp", firmante: "Nacho", idioma: "es-ES",
  colNombre: "first_name", colEmpresa: "organization_name", colDescripcion: "organization_linkedin_description",
};

describe("asistente de prompt de personalización", () => {
  it("con las respuestas de PubliUp salen las líneas de su prompt", () => {
    const p = construirPrompt(publiup);
    for (const linea of [
      "Actúa como un copywriter experto en prospección comercial B2B y correos en frío altamente personalizados.",
      "{first_name}\n{organization_name}\n{organization_linkedin_description}",
      "El 100% del correo debe estar escrito en español de España.",
      "El correo debe parecer escrito manualmente por Nacho después de investigar específicamente a {organization_name}.",
      "Hola {first_name}, soy Nacho.",
      "Vi a {organization_name} y me apasionó...",
      'NO escribas literalmente:\n\n"Vi a {organization_name} y me apasionó {organization_linkedin_description}"',
      "PRESENTACIÓN DE PUBLIUP",
      "50% sobre {organization_name} y su actividad.",
      "TODOS los correos deben proponer una conversación de 15 minutos.",
      "Entre 140 y 160 palabras.",
      "NUNCA más de 160 palabras.",
      "Objetivo aproximado: 150 palabras.",
      "Saludos,\nNacho\nPubliUp",
      'No utilices el símbolo "-".',
      "Devuelve ÚNICAMENTE el correo final.",
    ]) expect(p).toContain(linea);
    expect(p).toContain("CONSEGUIR NUEVOS CLIENTES + OPORTUNIDADES COMERCIALES RECURRENTES + MAYOR ESTABILIDAD COMERCIAL.");
  });

  it("las secciones van en el mismo orden que la plantilla", () => {
    const p = construirPrompt(publiup);
    const secciones = ["IDIOMA OBLIGATORIO", "OBJETIVO PRINCIPAL", "INICIO OBLIGATORIO", "PERSONALIZACIÓN", "PRESENTACIÓN DE", "CÓMO LO HACEMOS", "BENEFICIO PERSONALIZADO", "EMPRESAS SIMILARES", "DEMOSTRACIÓN PERSONALIZADA OBLIGATORIA", "LLAMADA A LA ACCIÓN OBLIGATORIA", "ESTRUCTURA OBLIGATORIA", "CIERRE OBLIGATORIO", "ESTILO OBLIGATORIO", "LONGITUD OBLIGATORIA", "COMPROBACIÓN FINAL OBLIGATORIA", "SALIDA FINAL"];
    const pos = secciones.map((x) => p.indexOf(`\n\n${x}`));
    expect(pos.every((n) => n > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it("se adapta a otra empresa, otro idioma y otras columnas", () => {
    const p = construirPrompt({
      ...publiup, empresa: "Acme Labs", firmante: "Laura", idioma: "en",
      promesa: "reducir sus costes de energía", beneficios: ["ahorro desde el primer mes"], minutos: 20, palabrasMin: 90, palabrasMax: 120,
      colNombre: "Nombre", colEmpresa: "Empresa", colDescripcion: "",
    });
    expect(p).toContain("El 100% del correo debe estar escrito en inglés.");
    expect(p).toContain("Hi {Nombre}, I'm Laura.");
    expect(p).toContain("I came across {Empresa} and I loved...");
    expect(p).toContain("Best regards,\nLaura\nAcme Labs");
    expect(p).toContain("REDUCIR SUS COSTES DE ENERGÍA + AHORRO DESDE EL PRIMER MES.");
    expect(p).toContain("una conversación de 20 minutos");
    expect(p).toContain("Objetivo aproximado: 105 palabras.");
    expect(p).not.toContain("PubliUp");
    expect(p).not.toContain("Nacho");
    expect(p).not.toContain('"lead"');           // las reglas de anglicismos son para el español
    expect(p).not.toMatch(/\{\}/);               // ninguna variable vacía
  });

  it("las variables del prompt son las que el motor de personalización sustituye", () => {
    const out = applyMapping(construirPrompt(publiup), { first_name: "Marta", organization_name: "Posimat", organization_linkedin_description: "Fabrican desencajonadoras" });
    expect(out).toContain("Hola Marta, soy Nacho.");
    expect(out).toContain("Vi a Posimat y me apasionó...");
    expect(out).not.toMatch(/\{[^}]*\}/);
  });

  it("encuentra las columnas del CSV y avisa de lo que falta", () => {
    expect(detectarColumnas(["id", "first_name", "email", "organization_name", "organization_linkedin_description", "city"]))
      .toEqual({ colNombre: "first_name", colEmpresa: "organization_name", colDescripcion: "organization_linkedin_description" });
    expect(detectarColumnas(["Nombre", "Empresa", "Email"])).toEqual({ colNombre: "Nombre", colEmpresa: "Empresa", colDescripcion: "" });
    expect(validarRespuestas({ ...publiup, empresa: " " })).toMatch(/empresa/);
    expect(validarRespuestas({ ...publiup, colNombre: "" })).toMatch(/nombre/);
    expect(validarRespuestas(publiup)).toBeNull();
  });
});
