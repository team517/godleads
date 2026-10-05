import { describe, expect, it } from "vitest";
import { templatePreview } from "@/pages/mobile/Templates";
import { iosBottomShim, mobileAppAllowed } from "@/lib/mobile-app";
import { campaignMatchCounts, hasWarmupSubjectTag, isDeliveryFailureMessage, isWarmupMessage } from "@/lib/inbox-filters";
import { buildConversations } from "@/lib/mobile-inbox";

describe("vista previa de una plantilla", () => {
  it("sin etiquetas, con el texto del enlace y en una línea", () => {
    expect(templatePreview('Buenas, te paso mi calendario\n<a href="https://calendly.com/onepulso">Reservar llamada</a>'))
      .toBe("Buenas, te paso mi calendario Reservar llamada");
    expect(templatePreview("")).toBe("");
  });
});

describe("cuenta de cliente acotada: ¿puede abrir la app del móvil? (ProtectedRoute)", () => {
  it("con la Unibox entre sus secciones, /m está permitida (si no, bucle /m ↔ /unibox)", () => {
    expect(mobileAppAllowed("/m", ["/unibox", "/campaigns"])).toBe(true);
    expect(mobileAppAllowed("/m", ["/campaigns", "/unibox"])).toBe(true);
    expect(mobileAppAllowed("/m/", ["/unibox"])).toBe(true);
    expect(mobileAppAllowed("/m", ["/unibox/"])).toBe(true);
  });
  it("sin la Unibox, no (MobileGate la manda a su primera sección)", () => {
    expect(mobileAppAllowed("/m", ["/campaigns"])).toBe(false);
    expect(mobileAppAllowed("/m", ["/campaigns", "/leads"])).toBe(false);
  });
  it("sin restricciones, sí", () => {
    expect(mobileAppAllowed("/m", null)).toBe(true);
    expect(mobileAppAllowed("/m", [])).toBe(true);
  });
  it("sólo vale para /m: otras rutas siguen con la regla normal de allowed_routes", () => {
    expect(mobileAppAllowed("/metrics", ["/unibox"])).toBe(false);
    expect(mobileAppAllowed("/modificaciones-ia", ["/unibox"])).toBe(false);
    expect(mobileAppAllowed("/unibox", ["/unibox"])).toBe(false);
    expect(mobileAppAllowed("/dashboard", ["/unibox"])).toBe(false);
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
    expect(campaignMatchCounts({ in_campaign: true, match_why: "responde", subject: "RE: Cost Saving Initiatives" })).toBe(false);
  });
  it("etiqueta del warm-up, buzón propio o nada: no cuenta", () => {
    expect(campaignMatchCounts({ in_campaign: false, match_why: "warmup", subject: "Lucy - coffee? | KK5XRDN 0396QKE" })).toBe(false);
    expect(campaignMatchCounts({ in_campaign: false, match_why: "propio", subject: "Hola" })).toBe(false);
    expect(campaignMatchCounts({ in_campaign: false, match_why: null, subject: "RE: Would this be useful?" })).toBe(false);
  });
});

describe("rebotes: a Others aunque vengan de la empresa del lead", () => {
  it("se reconocen por el remitente o por el asunto", () => {
    expect(isDeliveryFailureMessage({ from_email: "postmaster2@rheinschrift.de", subject: "Unzustellbar: Lucy - Rheinschrift" })).toBe(true);
    expect(isDeliveryFailureMessage({ from_email: "security@quint.co.uk", subject: "Your message couldn't be delivered" })).toBe(true);
    expect(isDeliveryFailureMessage({ from_email: "microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@netorgft15653426.onmicrosoft.com", subject: "Undeliverable: Hola" })).toBe(true);
    expect(isDeliveryFailureMessage({ from_email: "it@empresa.es", subject: "No se ha podido entregar el mensaje" })).toBe(true);
  });
  it("una respuesta o un contestador normal no es un rebote", () => {
    expect(isDeliveryFailureMessage({ from_email: "ana@empresa.es", subject: "Re: una idea para Empresa" })).toBe(false);
    expect(isDeliveryFailureMessage({ from_email: "ana@empresa.es", subject: "Fuera de la oficina Re: Juan - Empresa" })).toBe(false);
    expect(isDeliveryFailureMessage({ from_email: "isabel@ideatik.com", subject: "Este correo no está activo" })).toBe(false);
  });
  it("un rebote de la empresa del lead va a Others; la respuesta del lead, a Primary", () => {
    const base = { account_id: "a1", lead_id: null, campaign_id: null, received_at: "2026-10-02T10:00:00Z", is_read: false, labels: [] };
    const [bounce] = buildConversations([{ ...base, id: "b1", from_email: "security@quint.co.uk", subject: "Your message couldn't be delivered", in_campaign: true, match_why: "dominio" }]);
    expect(bounce.tab).toBe("others");
    const [reply] = buildConversations([{ ...base, id: "r1", from_email: "ana@quint.co.uk", subject: "Re: una idea para Quint", in_campaign: true, match_why: "dominio" }]);
    expect(reply.tab).toBe("primary");
  });
});

describe("la etiqueta del warm-up en el asunto", () => {
  it("se reconoce (código de 6-8 mayúsculas y cifras tras una barra)", () => {
    expect(hasWarmupSubjectTag("Success story ads | 36P2ARY 0396QKE")).toBe(true);
    expect(hasWarmupSubjectTag("Lucy - coffee? | KK5XRDN 0396QKE")).toBe(true);
    expect(hasWarmupSubjectTag("how can we help you grow? | blow_coat_avoid_beca 0396QKE")).toBe(true);
  });
  it("un asunto normal con barra no lo es", () => {
    expect(hasWarmupSubjectTag("Re: una idea para RUMAR | Mayorista Dental")).toBe(false);
    expect(hasWarmupSubjectTag("Cambio de dirección de contacto | Change of contact email")).toBe(false);
    expect(hasWarmupSubjectTag("Oferta | 2026")).toBe(false);
    expect(hasWarmupSubjectTag("Re: Juan - TTR Data")).toBe(false);
  });
  it("es warm-up aunque esté atado a una campaña o venga de la empresa de un lead", () => {
    expect(isWarmupMessage({ subject: "Success story ads | 36P2ARY 0396QKE", body: "Hey Vanessa, did you have a customer succeed lately?", fromEmail: "tom_b@leadscale.click", linked: true, senderKnown: true })).toBe(true);
  });
});
