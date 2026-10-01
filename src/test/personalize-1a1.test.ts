import { describe, expect, it } from "vitest";
import { applyMapping, datosUsados, promptForLead } from "../../supabase/functions/_shared/personalize-ai";

/* La personalización es 1 a 1: el prompt que recibe la IA para un lead lleva SIEMPRE datos de ese
   lead y sólo de ese lead. */

const ana = { __x: "", first_name: "Ana", organization_name: "Acme SL", city: "Vigo", id: "77" };
const luis = { first_name: "Luis", organization_name: "Posimat", city: "Reus", id: "78" };

describe("personalización 1 a 1", () => {
  it("con variables, cada lead recibe su propio prompt y nada más", () => {
    const p = "Escribe a {first_name} de {{organization_name}}.";
    expect(promptForLead(p, ana)).toBe("Escribe a Ana de Acme SL.");
    expect(promptForLead(p, luis)).toBe("Escribe a Luis de Posimat.");
    expect(promptForLead(p, ana)).toBe(applyMapping(p, ana));
  });

  it("las variables se reconocen aunque cambien mayúsculas, espacios o guiones", () => {
    expect(datosUsados("Hola {First Name} de { organization-name }", ana)).toBe(2);
  });

  it("un prompt sin variables no deja al lead sin datos: se le añaden los suyos", () => {
    const out = promptForLead("Escribe una apertura breve y cercana.", ana);
    expect(out).toContain("Escribe una apertura breve y cercana.");
    expect(out).toContain("DATOS DE ESTE LEAD");
    expect(out).toContain("- first_name: Ana");
    expect(out).toContain("- organization_name: Acme SL");
    expect(out).not.toContain("- id:");            // columnas técnicas fuera
    expect(out).not.toContain("Luis");             // nunca datos de otro lead
  });

  it("si el lead tiene vacías las variables del prompt, se usan los datos que sí tiene", () => {
    const out = promptForLead("Saluda a {first_name}.", { first_name: "", organization_name: "Acme SL" });
    expect(out.startsWith("Saluda a .")).toBe(true);
    expect(out).toContain("- organization_name: Acme SL");
  });

  it("dos leads distintos nunca reciben el mismo prompt", () => {
    for (const p of ["Escribe a {first_name}.", "Escribe una apertura."]) {
      expect(promptForLead(p, ana)).not.toBe(promptForLead(p, luis));
    }
  });
});
