import { describe, expect, it } from "vitest";
import { isWarmupMessage, looksLikeGenericEnglishSubject } from "@/lib/inbox-filters";

// Asuntos REALES de los pools de calentamiento vistos en el Unibox (23-09-2026). Ninguno lleva
// palabra de oficina, por eso se colaban y acababan etiquetados como "Interesado".
const POOL = [
  "RE: Yoga Class",
  "RE: Coffee Meetup",
  "RE: New Hire",
  "RE: Trip to Italy",
  "RE: Recommended Book",
  "RE: Bird Watching Group Excursion",
  "RE: Gym Membership Offer",
  "RE: Fitness Challenge Month",
  "RE: Risk Management Strategies",
  "Engineering Challenge Solution",
  "New Intern Introductions",
  "RE: Improving Work-Life Balance",
];

// Asuntos que SÍ son nuestros o de una persona real: nunca pueden caer en la regla.
const REALES = [
  "Re: Maria - Acme & Partners",          // nuestro molde: lleva " - "
  "RE: idea para Quantion",               // español
  "Re: Viste esto de Tiralineas ?",       // interrogación
  "RE: TCX MICRO - Telice",
  "Automatic reply: Maria - ADEX",
  "Re: Q2 Sales Update",                  // lleva cifra
  "RE: Añadimos más reuniones",           // acentos
  "Quick question",                       // minúscula: no tiene forma de hilo de pool
  "Re: Invoice 2026-114",
];

describe("looksLikeGenericEnglishSubject", () => {
  for (const s of POOL) it(`pool: ${s}`, () => expect(looksLikeGenericEnglishSubject(s)).toBe(true));
  for (const s of REALES) it(`real: ${s}`, () => expect(looksLikeGenericEnglishSubject(s)).toBe(false));
});

describe("isWarmupMessage con remitente desconocido", () => {
  const base = { body: "Sure, sounds good. See you there.", fromEmail: "kim@taskblinkcontacts.com" };
  it("remitente desconocido + asunto con forma de pool → warm-up", () => {
    expect(isWarmupMessage({ ...base, subject: "RE: Yoga Class", linked: false, senderKnown: false })).toBe(true);
  });
  it("si está enlazado a un lead o campaña NUNCA es warm-up", () => {
    expect(isWarmupMessage({ ...base, subject: "RE: Yoga Class", linked: true, senderKnown: false })).toBe(false);
  });
  it("si conocemos al remitente (lead, su empresa o le hemos escrito) NO es warm-up", () => {
    expect(isWarmupMessage({ ...base, subject: "RE: Coffee Meetup", linked: false, senderKnown: true })).toBe(false);
  });
  it("sin saber si conocemos al remitente, se comporta como siempre", () => {
    expect(isWarmupMessage({ ...base, subject: "RE: Yoga Class", linked: false })).toBe(false);
  });
  it("una respuesta real de un desconocido en español no se toca", () => {
    expect(isWarmupMessage({
      subject: "Re: idea para Quantion", body: "Basta de spam por favor.",
      fromEmail: "marta@quantion.com", linked: false, senderKnown: false,
    })).toBe(false);
  });
  it("respuesta a un envío hecho desde otra plataforma (asunto nuestro) tampoco", () => {
    expect(isWarmupMessage({
      subject: "Re: XAVI - Swing Maniacs", body: "Me interesa, llamame.",
      fromEmail: "info@swingmaniacs.com", linked: false, senderKnown: false,
    })).toBe(false);
  });
});

describe("par de palabras sin sentido de los pools", () => {
  const pool = { fromEmail: "sara@teamreadymation.co", linked: false, senderKnown: false };
  it("un solo par y remitente desconocido → warm-up", () => {
    expect(isWarmupMessage({ ...pool, subject: "RE: Q2 Sales Update", body: "Great rhyme-would job, team! Let's keep up the momentum." })).toBe(true);
    expect(isWarmupMessage({ ...pool, subject: "RE: Task update: High priority", body: "Confirmed, judge-cloud tasks are now updated in Jira." })).toBe(true);
  });
  it("con remitente conocido, un solo par NO basta", () => {
    expect(isWarmupMessage({ ...pool, senderKnown: true, subject: "Re: propuesta", body: "Buena relación precio-calidad, lo vemos." })).toBe(false);
  });
  it("respuesta real de un desconocido, sin pares, sigue intacta", () => {
    expect(isWarmupMessage({ ...pool, subject: "Re: XAVI - Swing Maniacs", body: "Me interesa, llamame esta tarde." })).toBe(false);
  });
});
