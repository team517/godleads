import { describe, it, expect } from "vitest";
import {
  detectLangHeuristic,
  hasWarmupCodes,
  isBounceOrFailure,
  isWarmupCode,
  shouldHideMessage,
} from "@/lib/inbox-filters";

describe("language gate (only Spanish/Catalan pass)", () => {
  const esSamples = [
    "Hola, muchas gracias por tu mensaje. Me interesa mucho vuestra propuesta, ¿podríamos agendar una reunión la próxima semana? Un saludo.",
    "Buenos días, estoy interesado en el producto. ¿Me podéis pasar el precio y el presupuesto, por favor? Quedo a la espera. Gracias.",
    "Perfecto, me parece muy bien. Cuéntame más sobre cómo funciona y qué incluye el servicio para nuestra empresa.",
  ];
  const caSamples = [
    "Bon dia, moltes gràcies pel vostre missatge. Estic interessat en la vostra proposta, podríem fer una reunió aviat? Salutacions cordials.",
    "Hola, perdoneu però ara mateix no tenim disponibilitat. Tot i així, podeu enviar-nos més informació sobre el preu? Gràcies.",
  ];
  const otherSamples = [
    "Hello, thank you for reaching out. I would love to know more about your product and pricing. Could we schedule a meeting next week? Best regards.",
    "Guten Tag, vielen Dank für Ihre Nachricht. Wir sind sehr interessiert an Ihrem Produkt und würden gerne mehr erfahren. Mit freundlichen Grüßen.",
    "Bonjour, merci beaucoup pour votre message. Nous sommes intéressés par votre offre, pourrions-nous fixer un rendez-vous? Cordialement.",
  ];

  it("keeps Spanish (never 'other')", () => {
    for (const s of esSamples) expect(detectLangHeuristic(s)).toBe("es");
  });
  it("keeps Catalan (never 'other')", () => {
    for (const s of caSamples) expect(["ca", "es"]).toContain(detectLangHeuristic(s));
  });
  it("flags English/German/French as 'other'", () => {
    for (const s of otherSamples) expect(detectLangHeuristic(s)).toBe("other");
  });
  it("never hides very short/ambiguous text", () => {
    expect(detectLangHeuristic("ok")).toBe("uncertain");
    expect(detectLangHeuristic("Re: ✅")).toBe("uncertain");
  });
});

describe("shouldHideMessage end-to-end", () => {
  it("keeps a Spanish reply", () => {
    const r = shouldHideMessage({
      subject: "Re: propuesta",
      body: "Hola, me interesa mucho. ¿Podemos hablar mañana? Gracias y un saludo.",
      fromEmail: "cliente@empresa.es",
      accountTags: [],
    });
    expect(r.hide).toBe(false);
  });
  it("hides an English reply on a normal account", () => {
    const r = shouldHideMessage({
      subject: "Re: proposal",
      body: "Hello, thanks for reaching out. We are interested and would like to know more about pricing.",
      fromEmail: "client@company.com",
      accountTags: [],
    });
    expect(r.hide).toBe(true);
    expect(r.reason).toBe("language");
  });
  it("keeps the same English reply on a 'tcx'-tagged account", () => {
    const r = shouldHideMessage({
      subject: "Re: proposal",
      body: "Hello, thanks for reaching out. We are interested and would like to know more about pricing.",
      fromEmail: "client@company.com",
      accountTags: ["tcx"],
    });
    expect(r.hide).toBe(false);
  });
  it("hides bounce/noise regardless of language", () => {
    expect(shouldHideMessage({ subject: "x", body: "hola que tal todo bien gracias", fromEmail: "mailer-daemon@x.com" }).reason).toBe("bounce");
  });
  it("hides warmup codes even in Spanish", () => {
    const r = shouldHideMessage({
      subject: "Hola | GH2RZD5 CHBV6J7",
      body: "texto de calentamiento",
      fromEmail: "a@b.com",
      accountTags: [],
    });
    expect(r.hide).toBe(true);
    expect(r.reason).toBe("warmup");
  });
});

describe("warmup whitelist", () => {
  it("hides real warmup codes", () => {
    expect(isWarmupCode("GH2RZD5")).toBe(true);
    expect(isWarmupCode("9XAT619")).toBe(true);
    expect(hasWarmupCodes("Quick question | GH2RZD5", null)).toBe(true);
  });
  it("never hides whitelisted brands/acronyms or plain words/years", () => {
    expect(isWarmupCode("TCX")).toBe(false);
    expect(isWarmupCode("GDPR")).toBe(false);
    expect(isWarmupCode("B2B")).toBe(false);
    expect(isWarmupCode("2026")).toBe(false);       // plain year
    expect(isWarmupCode("REUNION")).toBe(false);     // plain word
    expect(hasWarmupCodes("Nuestra propuesta B2B SaaS con API", null)).toBe(false);
    expect(hasWarmupCodes("Meeting 2026 sobre el proyecto", null)).toBe(false);
  });
});

describe("bounce / noise senders", () => {
  const hidden = [
    "mailer-daemon@anything.com", "postmaster@x.es", "bounces@list.io",
    "delivery@foo.com", "abuse@bar.net", "failure-notice@z.org",
    "no-reply@calendly.com", "events@calendly.com",
    "billing@ionos.es", "noreply@ionos.com", "support@ionos.de",
    "outreach@1stcontact.ai", "anything@1stcontact.ai",
    "support@instantly.ai", "billing@instantly.ai",
  ];
  const kept = [
    "cliente@empresa.es", "juan.perez@gmail.com", "ventas@miempresa.com",
    "info@empresacliente.es", // info@ only blocked for ionos/instantly, not generic
  ];
  it("hides known bounce/noise senders", () => {
    for (const e of hidden) expect(isBounceOrFailure(e)).toBe(true);
  });
  it("keeps normal senders", () => {
    for (const e of kept) expect(isBounceOrFailure(e)).toBe(false);
  });
});
