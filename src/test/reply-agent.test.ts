import { describe, it, expect } from "vitest";
import {
  buildReplyAgentSystemPrompt,
  buildReplyAgentUserPrompt,
  REPLY_LENGTH_WORDS,
  type ReplyAgentConfig,
} from "@/lib/reply-agent";

// The Reply Agent writes email that goes to real prospects. These tests pin the instructions a
// silent prompt edit could drop: the goal, the length, the tone, and above all the safety rules
// (__SKIP__ on robots/rejections, answer in the lead's language, never invent facts).

const base: ReplyAgentConfig = {
  primary_goal: "book_meeting",
  custom_goal: "",
  tone: "professional",
  length: "medium",
  style_prompt: "",
  business_context: "",
  objection_handling: "",
  resources: [],
  signature_name: "Marta",
  company: "OnePulso",
};

const cfg = (over: Partial<ReplyAgentConfig> = {}): ReplyAgentConfig => ({ ...base, ...over });

describe("buildReplyAgentSystemPrompt — objetivo", () => {
  it("book_meeting pide siempre la llamada de 10-15 minutos", () => {
    const p = buildReplyAgentSystemPrompt(cfg({ primary_goal: "book_meeting" }));
    expect(p).toContain("OBJETIVO: conseguir una reunión");
    expect(p).toContain("10-15 minutos");
  });

  it("share_info responde y ofrece el recurso relevante", () => {
    const p = buildReplyAgentSystemPrompt(cfg({ primary_goal: "share_info" }));
    expect(p).toContain("OBJETIVO: informar");
    expect(p).toContain("recurso más relevante");
  });

  it("qualify hace UNA sola pregunta", () => {
    const p = buildReplyAgentSystemPrompt(cfg({ primary_goal: "qualify" }));
    expect(p).toContain("OBJETIVO: cualificar");
    expect(p).toContain("UNA sola pregunta de cualificación");
  });

  it("custom usa el objetivo escrito por el operador", () => {
    const p = buildReplyAgentSystemPrompt(cfg({ primary_goal: "custom", custom_goal: "Conseguir que prueben la demo" }));
    expect(p).toContain("OBJETIVO: Conseguir que prueben la demo");
    expect(p).not.toContain("OBJETIVO: conseguir una reunión");
  });

  it("con book_meeting incluye el enlace de agenda tal cual", () => {
    const p = buildReplyAgentSystemPrompt(cfg({
      primary_goal: "book_meeting",
      resources: [{ name: "Web", url: "https://onepulso.io" }, { name: "Agenda", url: "https://calendly.com/marta/15min" }],
    }));
    expect(p).toContain("Incluye el enlace de agenda TAL CUAL");
    expect(p).toContain("https://calendly.com/marta/15min");
  });

  it("sin recurso de agenda no inventa la instrucción del enlace", () => {
    const p = buildReplyAgentSystemPrompt(cfg({ primary_goal: "book_meeting", resources: [{ name: "Web", url: "https://onepulso.io" }] }));
    expect(p).not.toContain("Incluye el enlace de agenda TAL CUAL");
  });
});

describe("buildReplyAgentSystemPrompt — longitud", () => {
  it.each([
    ["short", 30, 50],
    ["medium", 80, 120],
    ["long", 150, 200],
  ])("%s exige el rango de palabras", (length, min, max) => {
    const p = buildReplyAgentSystemPrompt(cfg({ length: String(length) }));
    expect(p).toContain(`entre ${min} y ${max} palabras`);
    expect(REPLY_LENGTH_WORDS[String(length)]).toEqual([min, max]);
  });

  it("una longitud desconocida cae en medium", () => {
    expect(buildReplyAgentSystemPrompt(cfg({ length: "gigante" }))).toContain("entre 80 y 120 palabras");
  });
});

describe("buildReplyAgentSystemPrompt — tono", () => {
  it.each([
    ["professional", "TONO profesional"],
    ["casual", "TONO casual"],
    ["friendly", "TONO cercano y amable"],
    ["direct", "TONO directo"],
  ])("%s lleva su guía concreta", (tone, marker) => {
    expect(buildReplyAgentSystemPrompt(cfg({ tone: String(tone) }))).toContain(String(marker));
  });
});

describe("buildReplyAgentSystemPrompt — bloques opcionales", () => {
  it("incluye estilo, contexto, objeciones y recursos cuando existen", () => {
    const p = buildReplyAgentSystemPrompt(cfg({
      style_prompt: "Frases de una línea, sin adjetivos.",
      business_context: "Vendemos cold email gestionado desde 900 € al mes.",
      objection_handling: "Si dicen que ya tienen agencia: propón una prueba de un mes.",
      resources: [{ name: "Casos", url: "https://onepulso.io/casos" }],
    }));
    expect(p).toContain("ESTILO DE COMUNICACIÓN");
    expect(p).toContain("Frases de una línea, sin adjetivos.");
    expect(p).toContain("CONTEXTO Y LÓGICA DE NEGOCIO");
    expect(p).toContain("900 € al mes");
    expect(p).toContain("MANEJO DE OBJECIONES");
    expect(p).toContain("Si dicen que ya tienen agencia");
    expect(p).toContain("Aplica la pauta que corresponda");
    expect(p).toContain("RECURSOS:");
    expect(p).toContain("- Casos: https://onepulso.io/casos");
    expect(p).toContain("SOLO cuando sea relevante");
  });

  it("omite los bloques vacíos", () => {
    const p = buildReplyAgentSystemPrompt(cfg());
    expect(p).not.toContain("ESTILO DE COMUNICACIÓN");
    expect(p).not.toContain("CONTEXTO Y LÓGICA DE NEGOCIO");
    expect(p).not.toContain("MANEJO DE OBJECIONES");
    expect(p).not.toContain("RECURSOS:");
  });

  it("ignora recursos sin URL", () => {
    const p = buildReplyAgentSystemPrompt(cfg({ resources: [{ name: "Vacío", url: "  " }] }));
    expect(p).not.toContain("RECURSOS:");
  });
});

describe("buildReplyAgentSystemPrompt — reglas de seguridad", () => {
  const p = buildReplyAgentSystemPrompt(cfg());

  it("responde en el idioma del lead", () => {
    expect(p).toContain("MISMO IDIOMA que el mensaje del lead");
  });

  it("contesta __SKIP__ ante robots, rechazos y rebotes", () => {
    expect(p).toContain("__SKIP__");
    expect(p).toContain("respuesta automática");
    expect(p).toContain("rebote");
  });

  it("solo el cuerpo del correo, sin inventar y sin emojis", () => {
    expect(p).toContain('sin "Asunto:"');
    expect(p).toContain("No inventes precios");
    expect(p).toContain("Sin emojis");
    expect(p).toContain("Un único siguiente paso claro");
  });

  it("firma con el nombre configurado y nombra a la empresa", () => {
    expect(p).toContain("Firma como Marta");
    expect(p).toContain("OnePulso");
  });
});

describe("buildReplyAgentUserPrompt", () => {
  it("lleva el texto del lead, nuestro último correo y la orden final", () => {
    const p = buildReplyAgentUserPrompt({
      fromName: "Juan Pérez",
      fromEmail: "juan@acme.com",
      subject: "Re: propuesta",
      replyText: "¿Cuánto costaría para 200 leads al mes?",
      ourLastEmail: "Hola Juan, te escribo porque trabajamos con distribuidoras como Acme.",
      senderName: "Marta",
    });
    expect(p).toContain("Juan Pérez <juan@acme.com>");
    expect(p).toContain("Re: propuesta");
    expect(p).toContain("LO QUE LE ENVIAMOS NOSOTROS");
    expect(p).toContain("trabajamos con distribuidoras como Acme");
    expect(p).toContain("¿Cuánto costaría para 200 leads al mes?");
    expect(p).toContain("Firmas como: Marta");
    expect(p).toContain("Responde a este correo.");
  });

  it("omite el bloque del hilo cuando no hay correo previo", () => {
    const p = buildReplyAgentUserPrompt({
      fromEmail: "juan@acme.com", subject: "", replyText: "Me interesa", senderName: "Marta",
    });
    expect(p).not.toContain("LO QUE LE ENVIAMOS NOSOTROS");
    expect(p).toContain("(sin asunto)");
    expect(p).toContain("Me interesa");
  });

  it("recorta nuestro último correo a 1200 caracteres", () => {
    const p = buildReplyAgentUserPrompt({
      fromEmail: "juan@acme.com", subject: "x", replyText: "ok",
      ourLastEmail: "a".repeat(3000), senderName: "Marta",
    });
    expect(p).toContain("a".repeat(1200));
    expect(p).not.toContain("a".repeat(1201));
  });
});
