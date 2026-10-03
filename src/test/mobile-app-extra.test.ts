import { describe, expect, it } from "vitest";
import { templatePreview } from "@/pages/mobile/Templates";
import { iosBottomShim } from "@/lib/mobile-app";
import { campaignMatchCounts } from "@/lib/inbox-filters";

describe("vista previa de una plantilla", () => {
  it("sin etiquetas, con el texto del enlace y en una línea", () => {
    expect(templatePreview('Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso">Reservar llamada</a>'))
      .toBe("Buenas, te paso mi calendario Reservar llamada");
    expect(templatePreview("")).toBe("");
  });
});

describe("hueco de abajo en iPhone (app instalada)", () => {
  const base = { safeTop: 59, portrait: true, screenW: 393, screenH: 852 };
  it("barra de estado transparente y página 59 pt más corta → se alarga esa cantidad", () => {
    expect(iosBottomShim({ ...base, pageH: 793 })).toBe(59);
  });
  it("página ya completa → nada", () => {
    expect(iosBottomShim({ ...base, pageH: 852 })).toBe(0);
  });
  it("barra de estado normal (sin zona segura arriba) → nada aunque la página sea más corta", () => {
    expect(iosBottomShim({ ...base, safeTop: 0, pageH: 793 })).toBe(0);
  });
  it("diferencias raras (teclado, pantalla partida) → nada", () => {
    expect(iosBottomShim({ ...base, pageH: 500 })).toBe(0);
  });
  it("en horizontal usa el lado corto", () => {
    expect(iosBottomShim({ ...base, portrait: false, pageH: 360 })).toBe(33);
  });
});

describe("regla de campaña (campaignMatchCounts)", () => {
  it("cita un envío nuestro de campaña: siempre cuenta", () => {
    expect(campaignMatchCounts({ in_campaign: true, match_why: "hilo", subject: "RE: Project Plan" })).toBe(true);
  });
  it("lead o dominio: cuenta, salvo un hilo del pool en inglés", () => {
    expect(campaignMatchCounts({ in_campaign: true, match_why: "lead", subject: "Re: Mario - BeShiny" })).toBe(true);
    expect(campaignMatchCounts({ in_campaign: true, match_why: "dominio", subject: "RE: Travel Expenses" })).toBe(false);
    expect(campaignMatchCounts({ in_campaign: true, match_why: "lead", subject: "Re: te dejaste esto en Identify Travel" })).toBe(true);
    expect(campaignMatchCounts({ in_campaign: true, match_why: "lead", subject: "Out of office Re: Samuel - IRISBOND" })).toBe(true);
  });
  it("responde a un buzón nuestro (otra plataforma): cuenta si no tiene forma de warm-up", () => {
    expect(campaignMatchCounts({ in_campaign: true, match_why: "responde", subject: "Re: XAVI - Urban Green Club" })).toBe(true);
    expect(campaignMatchCounts({ in_campaign: true, match_why: "responde", subject: "Baja" })).toBe(true);
    expect(campaignMatchCounts({ in_campaign: true, match_why: "responde", subject: "RE: Book Recommendation" })).toBe(false);
    expect(campaignMatchCounts({ in_campaign: true, match_why: "responde", subject: "RE: Volunteer Day Participation" })).toBe(false);
  });
  it("etiqueta del warm-up, buzón propio o nada: no cuenta", () => {
    expect(campaignMatchCounts({ in_campaign: false, match_why: "warmup", subject: "Lucy - coffee? | KK5XRDN 0396QKE" })).toBe(false);
    expect(campaignMatchCounts({ in_campaign: false, match_why: "propio", subject: "Hola" })).toBe(false);
    expect(campaignMatchCounts({ in_campaign: false, match_why: null, subject: "RE: Would this be useful?" })).toBe(false);
  });
});
