import { describe, expect, it } from "vitest";
import { sentBodyHtml } from "@/lib/sent-body";

// Cuerpo tal y como lo guarda una campaña "solo texto" (el seguimiento de CHIPSFINDER FRANCE).
const SEGUIMIENTO = `Bonjour Oceane,

Je voulais simplement revenir vers vous au cas ou mon precedent message se serait perdu.

Nous travaillons actuellement avec plusieurs entreprises similaires a Bcauto Encheres.

Bien cordialement,
John
ChipsFinder`;

describe("sentBodyHtml", () => {
  it("un seguimiento de solo texto se pinta con párrafos, no como un ladrillo", () => {
    const html = sentBodyHtml(SEGUIMIENTO);
    expect((html.match(/<p[ >]/g) || []).length).toBe(4);
    expect(html).toContain("Bien cordialement,<br>John<br>ChipsFinder");
  });
  it("un cuerpo que ya trae HTML se respeta", () => {
    const html = sentBodyHtml('<p style="margin:0 0 14px">Hola</p><p style="margin:0 0 14px">Adiós</p>');
    expect((html.match(/<p[ >]/g) || []).length).toBe(2);
  });
  it("el texto se escapa: un '<2 horas' no se come la frase", () => {
    expect(sentBodyHtml("Respondemos en <2 horas siempre")).toContain("&lt;2 horas siempre");
  });
  it("vacío devuelve vacío", () => {
    expect(sentBodyHtml(null)).toBe("");
    expect(sentBodyHtml("   ")).toBe("");
  });
});
