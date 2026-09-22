import { describe, it, expect } from "vitest";
import { replaceVariables, cleanupGaps, variablesUsed, VARIABLE_FALLBACKS } from "@/lib/personalize";
import { detectTemplateLanguage } from "@/lib/personalize";

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

describe("respaldos en el idioma de la plantilla (22-09-2026: 93 correos FR/IT/PT con «tu empresa»)", () => {
  it("detecta el idioma del cuerpo", () => {
    expect(detectTemplateLanguage("Bonjour Guy, je m’appelle John. En découvrant {{company_name}} et votre activité, j’ai pensé que notre service pourrait être utile à votre équipe.")).toBe("fr");
    expect(detectTemplateLanguage("Buongiorno Marco, sono John. Guardando {{company_name}} e la vostra attività nel settore, ho pensato che il nostro servizio potrebbe essere utile.")).toBe("it");
    expect(detectTemplateLanguage("Olá Pedro, sou o John. Ao ver {{company_name}} e a sua atividade, pensei que o nosso serviço poderia ser útil para a sua equipa.")).toBe("pt");
    expect(detectTemplateLanguage("Hi Mark, I'm John. Looking at {{company_name}} and your work, I thought our service could help your team.")).toBe("en");
    expect(detectTemplateLanguage("Hola Marta, soy John. Al ver {{company_name}} y vuestra actividad, pensé que os podría ayudar.")).toBe("es");
    expect(detectTemplateLanguage("john - {{company_name}}")).toBe("es"); // demasiado corto → español, como siempre
  });

  it("una empresa que falta se rellena en el idioma del correo, no en español", () => {
    expect(replaceVariables("En découvrant {{company_name}} et votre activité, j’ai pensé que notre service pourrait vous aider.", {}))
      .toBe("En découvrant votre entreprise et votre activité, j’ai pensé que notre service pourrait vous aider.");
    expect(replaceVariables("Guardando {{company_name}} e la vostra attività, siamo qui per aiutarvi con i componenti.", {}))
      .toBe("Guardando la vostra azienda e la vostra attività, siamo qui per aiutarvi con i componenti.");
    expect(replaceVariables("Ao ver {{company_name}} e a sua atividade, pensei que o nosso serviço poderia ser útil para você.", {}))
      .toBe("Ao ver a sua empresa e a sua atividade, pensei que o nosso serviço poderia ser útil para você.");
  });

  it("el asunto usa el idioma que se le pasa (el del cuerpo)", () => {
    expect(replaceVariables("Disponibilité pour {{company_name}}", {}, "fr")).toBe("Disponibilité pour votre entreprise");
    expect(replaceVariables("john - {{company_name}}", {}, "it")).toBe("john - la vostra azienda");
    expect(replaceVariables("john - {{company_name}}", {})).toBe("john - tu empresa"); // sin pista: español, como siempre
  });

  it("contrae la preposición delante del respaldo en italiano y portugués", () => {
    expect(replaceVariables("Ho dato un'occhiata a {{company_name}} e alla vostra attività, sono qui per aiutarvi.", {}))
      .toBe("Ho dato un'occhiata alla vostra azienda e alla vostra attività, sono qui per aiutarvi.");
    expect(replaceVariables("Podemos ser úteis à {{company_name}} quando surgir uma necessidade, não hesite.", {}))
      .toBe("Podemos ser úteis à sua empresa quando surgir uma necessidade, não hesite.");
    expect(replaceVariables("Ao pesquisar sobre a {{company_name}}, vi a vossa atividade e achei que faria sentido.", {}))
      .toBe("Ao pesquisar sobre a sua empresa, vi a vossa atividade e achei que faria sentido.");
  });

  it("las plantillas en español siguen exactamente igual", () => {
    expect(replaceVariables("la idea es que {{company_name}} reciba más oportunidades en {{city}}", {})).toBe("la idea es que tu empresa reciba más oportunidades en tu zona");
  });
});
