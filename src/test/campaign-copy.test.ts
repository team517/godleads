import { describe, it, expect } from "vitest";
import { CAMPAIGN_EXAMPLES, CAMPAIGN_COPY_RULES, CAMPAIGN_COPY_SYSTEM } from "@/lib/campaign-copy";

/** The mould is a contract with the owner: the sentences that get replies must survive any
 *  future "improvement" of the prompt. If one of these disappears, the test says so. */
describe("molde de campañas (EJEMPLOS QUE FUNCIONAN)", () => {
  const anclas = [
    "Buenas {{first_name}}",
    "Investigando {{company_name}} en Linkedin",
    "y no, esto no es una plantilla",
    "estoy seguro que recibes muchos correos como este",
    "realmente me hace mucha ilusion poder trabajar con una empresa como {{company_name}}",
    "¿te va bien verlo 10 minutos esta semana?",
    "quedo atento",
    "Quería hacerte seguimiento porque creo que puede ser especialmente interesante para {{company_name}}",
    "¿Te encaja esta semana?",
    "Te hago un pequeño seguimiento porque quería compartirte un dato",
    "¿Lo vemos?",
  ];
  it("los tres ejemplos están enteros, con sus frases-ancla", () => {
    for (const a of anclas) expect(CAMPAIGN_EXAMPLES, a).toContain(a);
    expect(CAMPAIGN_EXAMPLES).toContain("EJEMPLO — STEP 1");
    expect(CAMPAIGN_EXAMPLES).toContain("EJEMPLO — STEP 2");
    expect(CAMPAIGN_EXAMPLES).toContain("EJEMPLO — STEP 3");
  });
  it("las reglas exigen calcar y dicen qué se cambia y qué no", () => {
    expect(CAMPAIGN_COPY_RULES).toContain("LOS EJEMPLOS SON EL MOLDE");
    expect(CAMPAIGN_COPY_RULES).toContain("LO QUE CAMBIAS");
    expect(CAMPAIGN_COPY_RULES).toContain("LO QUE NO CAMBIAS");
    expect(CAMPAIGN_COPY_RULES).toMatch(/enlace de reserva: SOLO si el briefing da uno/);
  });
  it("usa las variables que el motor sustituye y no las de otra convención", () => {
    expect(CAMPAIGN_EXAMPLES).not.toMatch(/\{\{firstName\}\}|\{\{companyName\}\}/);
    expect(CAMPAIGN_COPY_SYSTEM.startsWith(CAMPAIGN_EXAMPLES)).toBe(true);
  });
});
