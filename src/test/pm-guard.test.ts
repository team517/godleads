import { describe, expect, it } from "vitest";
import {
  hasUsablePersonalizedMessage, personalizedMessageOf, sendableVariantIdx, usesPersonalizedMessage,
} from "../../supabase/functions/_shared/pm-guard";

/* Freno del {{personalized_message}}: si el lead no tiene uno válido, se envía otra variante que no
   lo use; si no hay ninguna, nada. Caso real: 32 correos de OnControl salieron con
   "[ERROR: fetch failed]" como cuerpo. */

const BUENO = "Hola Ana,\n\nSoy Alfons. Vi a <b>Acme</b> y me apasionó…\n\nUn saludo,\nAlfons\nOnControl";
const pasoPm = { subject: "Idea para {{company_name}}", body: "{{personalized_message}}" };
const generica = { subject: "Una idea", body: "Buenas {{first_name}},\n\nSoy Alfons…" };

describe("freno del personalized_message", () => {
  it("reconoce la variable como la sustituye el motor", () => {
    expect(usesPersonalizedMessage(pasoPm)).toBe(true);
    expect(usesPersonalizedMessage({ body: "Hola\n\n{{ Personalized_Message }}" })).toBe(true);
    expect(usesPersonalizedMessage({ body: "{{personalised-message}}" })).toBe(true);
    expect(usesPersonalizedMessage({ subject: "{{personalized message}}", body: "x" })).toBe(true);
    expect(usesPersonalizedMessage(generica)).toBe(false);
  });

  it("vacío o error de la IA no vale; un mensaje de verdad sí", () => {
    expect(hasUsablePersonalizedMessage({ personalized_message: BUENO })).toBe(true);
    expect(hasUsablePersonalizedMessage({ personalized_message: "" })).toBe(false);
    expect(hasUsablePersonalizedMessage({ personalized_message: "   " })).toBe(false);
    expect(hasUsablePersonalizedMessage({})).toBe(false);
    expect(hasUsablePersonalizedMessage(null)).toBe(false);
    expect(hasUsablePersonalizedMessage({ personalized_message: "[ERROR: fetch failed]" })).toBe(false);
    expect(hasUsablePersonalizedMessage({ personalized_message: '[ERROR: DeepSeek API 402: {"error":{"message":"Insufficient Balance"}}]' })).toBe(false);
    expect(hasUsablePersonalizedMessage({ personalized_message: "<p>[ERROR: timeout exceeded]</p>" })).toBe(false);
    // Clave escrita de otra forma (la sustituye igual el motor).
    expect(personalizedMessageOf({ "Personalized Message": BUENO })).toBe(BUENO);
    expect(hasUsablePersonalizedMessage({ "Personalized Message": BUENO })).toBe(true);
  });

  it("con mensaje válido se puede enviar cualquier variante elegible", () => {
    expect(sendableVariantIdx([pasoPm, generica], [0, 1], { personalized_message: BUENO })).toEqual([0, 1]);
  });

  it("sin mensaje válido se envía la variante que NO usa la variable", () => {
    expect(sendableVariantIdx([pasoPm, generica], [0, 1], { personalized_message: "[ERROR: fetch failed]" })).toEqual([1]);
    expect(sendableVariantIdx([generica, pasoPm], [0, 1], {})).toEqual([0]);
  });

  it("sin mensaje válido y sin otra variante → nada (lista vacía)", () => {
    expect(sendableVariantIdx([pasoPm], [0], { personalized_message: "" })).toEqual([]);
    // La única variante sin la variable es de otra cuenta (filtro de etiquetas): tampoco vale.
    expect(sendableVariantIdx([pasoPm, generica], [0], {})).toEqual([]);
  });

  it("los pasos que no usan la variable no se ven afectados", () => {
    expect(sendableVariantIdx([generica], [0], {})).toEqual([0]);
  });
});
