import { describe, it, expect } from "vitest";
import { replaceVariables, cleanupGaps, variablesUsed, VARIABLE_FALLBACKS } from "@/lib/personalize";

describe("replaceVariables — values present", () => {
  it("substitutes a plain variable", () => {
    expect(replaceVariables("Hola {{first_name}},", { first_name: "Javier" })).toBe("Hola Javier,");
  });

  it("is case/underscore/space insensitive", () => {
    const f = { first_name: "Ana" };
    expect(replaceVariables("{{firstName}}", f)).toBe("Ana");
    expect(replaceVariables("{{ First Name }}", f)).toBe("Ana");
    expect(replaceVariables("{{FIRST-NAME}}", f)).toBe("Ana");
  });

  it("trims the stored value", () => {
    expect(replaceVariables("de {{city}}", { city: "  Barcelona " })).toBe("de Barcelona");
  });

  it("prefers a filled spelling over a blank one", () => {
    expect(replaceVariables("{{company_name}}", { company_name: "", companyName: "Deitta" })).toBe("Deitta");
  });

  it("leaves text with no variables untouched, HTML included", () => {
    const html = "<p>Hola  Javier</p>\n<p>Un saludo</p>";
    expect(replaceVariables(html, {})).toBe(html);
  });
});

describe("replaceVariables — the live bug: no placeholder may ever be sent", () => {
  // Real sentences taken from the campaigns that leaked "{{city}}" on 2026-09-11.
  it("keeps the sentence readable when city is missing", () => {
    const t = "esos clientes de {{city}} acaban llamando a otro.";
    expect(replaceVariables(t, {})).toBe("esos clientes de tu zona acaban llamando a otro.");
  });

  it("keeps the sentence readable when industry is missing", () => {
    const t = "mirando a Aciturri Tech dentro de {{industry}}, vi un encaje claro.";
    expect(replaceVariables(t, { company_name: "Aciturri Tech" }))
      .toBe("mirando a Aciturri Tech dentro de tu sector, vi un encaje claro.");
  });

  it("treats an empty string as missing", () => {
    expect(replaceVariables("en {{city}} hoy", { city: "   " })).toBe("en tu zona hoy");
  });

  it("never returns a literal placeholder", () => {
    const t = "Hola {{first_name}}, sobre {{company_name}} en {{city}} ({{industry}}) — {{unknown_thing}}";
    const out = replaceVariables(t, {});
    expect(out).not.toMatch(/\{\{|\}\}/);
  });

  it("drops an unknown variable and tidies the gap", () => {
    expect(replaceVariables("Hola {{nickname}}, un saludo", {})).toBe("Hola, un saludo");
    expect(replaceVariables("A {{x}} B", {})).toBe("A B");
  });

  it("keeps newlines and only collapses horizontal gaps", () => {
    expect(replaceVariables("linea1 {{x}}\nlinea2", {})).toBe("linea1\nlinea2");
  });

  it("tidies a dropped variable inside HTML without breaking tags", () => {
    expect(replaceVariables("<p>Hola {{nickname}}</p>", {})).toBe("<p>Hola</p>");
  });
});

describe("cleanupGaps", () => {
  it("collapses double spaces and space-before-punctuation", () => {
    expect(cleanupGaps("Hola  ,  que tal .")).toBe("Hola, que tal.");
  });
  it("removes an empty parenthesis pair", () => {
    expect(cleanupGaps("sector ( ) hoy")).toBe("sector hoy");
  });
});

describe("variablesUsed", () => {
  it("lists each variable once, in order", () => {
    expect(variablesUsed("{{first_name}} y {{city}} y {{first_name}}")).toEqual(["first_name", "city"]);
  });
  it("returns an empty list for plain text", () => {
    expect(variablesUsed("sin variables")).toEqual([]);
  });
});

describe("VARIABLE_FALLBACKS", () => {
  it("covers the variables our templates actually use", () => {
    for (const k of ["city", "industry", "companyname", "sector", "empresa"]) {
      expect(VARIABLE_FALLBACKS[k]).toBeTruthy();
    }
  });
  it("has no fallback for a person's name (it is dropped instead)", () => {
    expect(VARIABLE_FALLBACKS["firstname"]).toBeUndefined();
  });
});
