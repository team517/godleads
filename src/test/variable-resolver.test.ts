import { describe, expect, it } from "vitest";
import { contarColumnas, corregirVariablesEnTexto, resolverVariable, type EstadisticaColumna } from "@/lib/variable-resolver";

// Columnas típicas de un CSV general (tipo Apollo) ya importado: hay varias de "nombre" y de
// "empresa", y no todas tienen datos.
const APOLLO: EstadisticaColumna[] = [
  { key: "first_name", llenos: 980 },
  { key: "last_name", llenos: 975 },
  { key: "full_name", llenos: 990 },
  { key: "name", llenos: 990 },                 // nombre COMPLETO: nunca para {{first_name}}
  { key: "company_name", llenos: 40 },          // casi vacía
  { key: "organization_name", llenos: 960 },    // la buena
  { key: "company_website", llenos: 900 },
  { key: "company_linkedin", llenos: 700 },
  { key: "city", llenos: 800 },
  { key: "industry", llenos: 950 },
  { key: "email", llenos: 1000 },
];

describe("resolverVariable", () => {
  it("{{name}} va al nombre de pila, no a la columna con el nombre completo", () => {
    expect(resolverVariable("name", APOLLO)).toBe("first_name");
  });
  it("{{nombre}} va al nombre de pila (antes acababa en {{email}} por parecido de letras)", () => {
    expect(resolverVariable("nombre", APOLLO)).toBe("first_name");
  });
  it("{{firstName}} y {{First Name}} van a first_name", () => {
    expect(resolverVariable("firstName", APOLLO)).toBe("first_name");
    expect(resolverVariable("First Name", APOLLO)).toBe("first_name");
  });
  it("{{first_name}} que ya es la buena se deja igual", () => {
    expect(resolverVariable("first_name", APOLLO)).toBeNull();
  });
  it("la empresa va a la columna QUE TIENE DATOS, aunque haya otra con el nombre exacto", () => {
    expect(resolverVariable("company_name", APOLLO)).toBe("organization_name");
    expect(resolverVariable("empresa", APOLLO)).toBe("organization_name");
    expect(resolverVariable("companyName", APOLLO)).toBe("organization_name");
  });
  it("{{company}} nunca va a la web ni al LinkedIn de la empresa", () => {
    const r = resolverVariable("company", APOLLO);
    expect(r).not.toBe("company_website");
    expect(r).not.toBe("company_linkedin");
  });
  it("ciudad, sector y apellido", () => {
    expect(resolverVariable("ciudad", APOLLO)).toBe("city");
    expect(resolverVariable("sector", APOLLO)).toBe("industry");
    expect(resolverVariable("apellido", APOLLO)).toBe("last_name");
  });
  it("las variables del remitente no se tocan nunca", () => {
    expect(resolverVariable("SenderFirstName", APOLLO)).toBeNull();
    expect(resolverVariable("Email", APOLLO)).toBeNull();
  });
  it("si no hay ninguna columna de nombre de pila, {{name}} se deja (no se pone el nombre completo)", () => {
    const sinNombre: EstadisticaColumna[] = [{ key: "full_name", llenos: 500 }, { key: "company_name", llenos: 500 }];
    expect(resolverVariable("name", sinNombre)).toBeNull();
  });
  it("una variable propia (icebreaker) que existe se deja; mal escrita en mayúsculas se arregla", () => {
    const cols: EstadisticaColumna[] = [{ key: "icebreaker", llenos: 300 }];
    expect(resolverVariable("icebreaker", cols)).toBeNull();
    expect(resolverVariable("IceBreaker", cols)).toBe("icebreaker");
  });
  it("una variable desconocida no se cambia por algo que no tiene nada que ver", () => {
    expect(resolverVariable("zzz", APOLLO)).toBeNull();
  });
  it("si la columna actual tiene casi tantos datos como la mejor, se respeta", () => {
    const cols: EstadisticaColumna[] = [{ key: "company_name", llenos: 950 }, { key: "organization_name", llenos: 960 }];
    expect(resolverVariable("company_name", cols)).toBeNull();
  });
});

describe("contarColumnas", () => {
  it("cuenta sólo las celdas con algo escrito", () => {
    const r = contarColumnas([{ first_name: "Ana", company_name: "" }, { first_name: "Luis", company_name: "Acme" }, null]);
    expect(r.find((x) => x.key === "first_name")?.llenos).toBe(2);
    expect(r.find((x) => x.key === "company_name")?.llenos).toBe(1);
  });
});

describe("corregirVariablesEnTexto", () => {
  it("corrige un correo entero y dice qué ha cambiado", () => {
    const { text, changes } = corregirVariablesEnTexto(
      "Hola {{nombre}}, vi {{empresa}} en {{ciudad}}. {{SenderFirstName}}", APOLLO);
    expect(text).toBe("Hola {{first_name}}, vi {{organization_name}} en {{city}}. {{SenderFirstName}}");
    expect(changes.map((c) => `${c.from}>${c.to}`)).toEqual(["nombre>first_name", "empresa>organization_name", "ciudad>city"]);
  });
});

import { elegirColumnasPlantilla } from "@/lib/variable-resolver";

describe("elegirColumnasPlantilla (importar CSV general con la plantilla)", () => {
  const PLANTILLA = ["first_name", "industry", "city", "company_short_description", "company_name", "organization_name", "website", "personalized_message", "personalized_intro", "icebreaker"];
  const alias = (h: string) => ({ description: "company_short_description", company_short_description: "company_short_description", icebreaker: "icebreaker" } as Record<string, string>)[h] || h;

  // Cabeceras como las deja el lector de CSV (minúsculas y guiones bajos), tipo export de Apollo.
  const cabeceras = ["name", "first_name", "last_name", "company", "company_name_for_emails", "company_website", "email", "personal_email", "city", "industry", "description"];
  const filas = Array.from({ length: 10 }, (_, i) => ({
    name: `Ana Ruiz ${i}`, first_name: `Ana${i}`, last_name: "Ruiz",
    company: i < 2 ? "Acme" : "",                         // casi vacía
    company_name_for_emails: `Acme ${i}`,                  // la buena
    company_website: `acme${i}.com`, email: `ana${i}@acme.com`, personal_email: i < 3 ? `ana${i}@gmail.com` : "",
    city: "Madrid", industry: "Software", description: "Hacemos software",
  }));

  const r = elegirColumnasPlantilla(cabeceras, filas, PLANTILLA, alias);

  it("first_name sale de la columna de nombre de pila, no de 'name' (nombre completo)", () => {
    expect(r.first_name).toBe("first_name");
  });
  it("la empresa sale de la columna con más datos, no de la vacía ni de la web", () => {
    expect(r.company_name).toBe("company_name_for_emails");
    expect(r.organization_name).toBe("company_name_for_emails");
  });
  it("el correo de trabajo gana al personal", () => {
    expect(r.email).toBe("email");
  });
  it("ciudad, sector y web", () => {
    expect(r.city).toBe("city");
    expect(r.industry).toBe("industry");
    expect(r.website).toBe("company_website");
  });
  it("las columnas sin concepto siguen sus alias (description → company_short_description)", () => {
    expect(r.company_short_description).toBe("description");
    expect(r.icebreaker).toBeNull();
  });
});
