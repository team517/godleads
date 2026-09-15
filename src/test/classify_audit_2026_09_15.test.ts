import { describe, expect, it } from "vitest";
import { authorText, classifyMessage } from "@/lib/classify";
import { isWarmupMessage, looksLikeWarmupSubject, refersToOwnDomain, warmupPairCount } from "@/lib/inbox-filters";
import { isCampaignRelevant } from "@/lib/inbox-visibility";

// 125 of 168 "Interesado" labels in a week were warm-up pool threads with realistic English office
// subjects that the short subject list missed; 99 of them pushed a phone. Real subjects seen:
const POOL_SUBJECTS = [
  "RE: Workshop Confirmation", "RE: Quarterly Goals Review", "RE: Health and Wellness Initiative",
  "RE: Update on Vendor Negotiations", "RE: Book Club Event", "RE: Finance Updates", "RE: Project Timeline",
  "RE: Company Newsletter Contribution", "RE: Upcoming Industry Conference", "RE: Productivity Tips",
  "RE: Volunteers for Community Service", "RE: Sales Performance", "Re: Travel Reimbursement Process",
  "RE: New Employee Orientation", "RE: Annual Company Retreat", "RE: Investment Portfolio Review",
  "Re: Bug Fix Progress", "Re: Staff Wellness Program", "RE: Work Update", "RE: Project Deadline",
  "RE: New Technology Implementation", "RE: Task Update: UI Design", "RE: New Tool Adoption", "RE: Year-End Celebration Plans",
];
// …and what a real prospect answers: OUR subject, personalised, usually Spanish or with a name/brand.
const REAL_SUBJECTS = [
  "RE: idea para PASEK", "Re: Maria - HireTop", "RE: XAVI - SocialPubli", "Re: no te olvides de esto Ernesto",
  "RE: GRUPO GISMA + CRM", "Re: una idea para Light and Studio", "RE: Juan - Cellect Energy",
  "Re: Viste esto de Avanze Nuevas Tecnologias", "RE: Marketing Strategy - Acme Ltd", "Re: Meeting tomorrow?",
  "RE: Alfons - EGA Master", "Respuesta automática: Maria - IPRoom", "(sin asunto)", "Re: Acquisition?",
];

describe("warm-up — asuntos genéricos de oficina en inglés (pools)", () => {
  it("reconoce los asuntos reales de los pools", () => {
    for (const s of POOL_SUBJECTS) expect(looksLikeWarmupSubject(s), s).toBe(true);
  });
  it("nunca marca un asunto de campaña real", () => {
    for (const s of REAL_SUBJECTS) expect(looksLikeWarmupSubject(s), s).toBe(false);
  });
  it("un hilo de pool no enlazado es warm-up; el mismo asunto enlazado a un lead no lo es", () => {
    expect(isWarmupMessage({ subject: "RE: Workshop Confirmation", body: "Sounds good, let's confirm.", fromEmail: "x@pool.com", ownMailboxes: new Set(), linked: false })).toBe(true);
    expect(isWarmupMessage({ subject: "RE: Workshop Confirmation", body: "Sounds good, let's confirm.", fromEmail: "x@pool.com", ownMailboxes: new Set(), linked: true })).toBe(false);
  });
  it("la regla «responde a nuestro correo» no rescata un hilo de pool aunque referencie nuestro dominio", () => {
    const own = new Set(["onnepulssogrowth.store"]);
    expect(isCampaignRelevant({ from_email: "x@pool.com", subject: "RE: Workshop Confirmation", ref_chain: "<1@onnepulssogrowth.store>" }, new Set(), own)).toBe(false);
    expect(isCampaignRelevant({ from_email: "hello@hiretop.com", subject: "Re: Maria - HireTop", ref_chain: "<1@onnepulssogrowth.store>" }, new Set(), own)).toBe(true);
  });
});

// Real cases from the 2026-09-15 audit of 700 replies (21 days, all accounts). Each one was
// wrongly labelled in production; the text is the author-only text the classifier receives.

describe("recorte de cita — respuestas cortas seguidas de la cabecera citada", () => {
  it("«No gracias» + «El 11 sept 2026, a las 14:32, X escribió:» → se corta y es No interesado", () => {
    const t = "No gracias\n\nEl 11 sept 2026, a las 14:32, Enric Lopez escribió:\n\nATENCIÓN: Este correo electrónico se envió desde fuera de la organización. No haga clic en enlaces.\n\nHola Alvaro, Estuvimos viendo CORRECTA y nos apasionó la imagen que dais. ¿Te encaja verlo 10 minutos?";
    expect(authorText(t).trim()).toBe("No gracias");
    expect(classifyMessage("Re: que la IA recomiende a CORRECTA", t)).toBe("not_interested");
  });

  it("«BAJA Sent from my iPhone On 11 Sep 2026, at 17:10, X wrote:» → No contactar", () => {
    const t = "BAJA Sent from my iPhone On 11 Sep 2026, at 17:10, Mario Hernandez <mario@tunuevoleadlogic.store> wrote:\n\nno te olvides de esto Ernesto\n\nBuenas Ernesto, Quería hacerte seguimiento porque creo que puede ser interesante. ¿Te encaja esta semana?";
    expect(authorText(t).trim()).toBe("BAJA");
    expect(classifyMessage("Re: no te olvides de esto Ernesto", t)).toBe("no_contactar");
  });

  it("«No» + firma + cabecera citada → nuestra propuesta no se lee", () => {
    const t = "No José R. Ugarte El 11 sept 2026, a las 15:09, Juan Perez <juan@kingofleadplus.es> escribió:\n\nViste esto de Avanze\n\nBuenas Jose, Te hago un último seguimiento. ¿Hablamos?";
    expect(authorText(t)).not.toMatch(/seguimiento|Hablamos/);
    expect(classifyMessage("Re: Viste esto de Avanze Nuevas Tecnologias", t)).not.toBe("question");
    expect(classifyMessage("Re: Viste esto de Avanze Nuevas Tecnologias", t)).not.toBe("interested");
  });

  it("un «No» / «No, gracias» a secas es No interesado", () => {
    expect(classifyMessage("Re: idea para X", "No")).toBe("not_interested");
    expect(classifyMessage("Re: idea para X", "No, gracias.")).toBe("not_interested");
    expect(classifyMessage("Re: idea para X", "No thanks")).toBe("not_interested");
  });
});

describe("pies de firma que no son intención del autor", () => {
  it("GISMA: «no estoy interesado» + pie LOPD «su dirección figura en nuestros archivos…» → No interesado", () => {
    const t = "Gracias Gema no estoy interesado. Saludos\n\nGorka Sedano Sanz\nCEO\n+34 639460930\ngsedano@wego.eus\n\nRecuerda tu compromiso con el Medio Ambiente. Imprime solamente lo necesario.\nSomos la misma organización anteriormente conocida como GRUPO GISMA. Operamos ahora bajo la marca we|go, manteniendo el mismo equipo y compromiso con nuestra clientela.\nSu dirección de correo electrónico figura en nuestros archivos, para mantener el contacto y comunicación con Ud. y remitirle información sobre nuestras actividades y servicios. Si no desea recibir tal información envíe un e-mail en tal sentido a lopd@wego.eus.";
    expect(authorText(t)).not.toMatch(/remitirle informaci/);
    expect(classifyMessage("RE: GRUPO GISMA + CRM", t)).toBe("not_interested");
  });

  it("SocialPubli: «lo veo con el equipo…» + «Este mensaje se ha enviado en cumplimiento del…» no es No contactar", () => {
    const t = "Hola Xavi,\n\nGracias por la info. Lo veo con el equipo y en caso de estar interesados lo hago llegar.\n\nGracias,\n\n[image: Nicolas Moncada]\nEste mensaje se ha enviado en cumplimiento del Reglamento (UE) 2016/679. Si no desea recibir más comunicaciones, escriba a baja@socialpubli.com.";
    expect(authorText(t)).not.toMatch(/no desea recibir/);
    expect(classifyMessage("Re: XAVI - SocialPubli", t)).not.toBe("no_contactar");
  });

  it("«Enviado desde mi iPhone» corta la firma", () => {
    expect(authorText("Vale, el jueves a las 10. Enviado desde mi iPhone El 14 sept 2026, a las 9:21, Maria escribió: bla").trim()).toBe("Vale, el jueves a las 10.");
  });
});

describe("warm-up — emails y dominios no son «pares»", () => {
  it("tecno-group.eu en la firma no cuenta como par de warm-up", () => {
    const body = "Hola Xavi, te adjunto el contrato de prestación de servicios firmado por nuestra parte.\n\nAlfonso Lombardi\na.lombardi@tecno-group.eu\nwww.tecno-group.eu";
    expect(warmupPairCount(body, false)).toBe(0);
    expect(isWarmupMessage({ subject: "", body, fromEmail: "a.lombardi@tecno-group.eu", ownMailboxes: new Set(), linked: false })).toBe(false);
  });
  it("los pares de verdad siguen contando", () => {
    expect(warmupPairCount("noise-waste and clock-speed", false)).toBe(2);
  });
  it("refersToOwnDomain: la cadena References apunta a nuestro dominio", () => {
    expect(refersToOwnDomain("<134264cd-d39b@onnepulssogrowth.store>", "maria@onnepulssogrowth.store")).toBe(true);
    expect(refersToOwnDomain("<abc@other.com>", "maria@onnepulssogrowth.store")).toBe(false);
    expect(refersToOwnDomain(null, "maria@onnepulssogrowth.store")).toBe(false);
  });
});
