import { describe, expect, it } from "vitest";
import {
  correoPeticion, quiereHablarConElEquipo, tituloDeConversacion, validarPeticion,
  visitanteDentroDeLimites, VISITOR_MAX_PER_CONVERSATION, VISITOR_MAX_PER_DAY,
} from "../../supabase/functions/_shared/chat-hub-rules";

/* Chatbot (10-11-2026): reglas puras de chat-hub. */

describe("quiereHablarConElEquipo", () => {
  it("detecta demo, llamada, persona real, presupuesto y precio a medida (ES e EN)", () => {
    for (const t of [
      "Quiero una demo", "¿Puedo hablar con una persona?", "Me gustaría agendar una llamada",
      "Necesito un presupuesto para 40 buzones", "¿Tenéis un plan a medida?", "Quiero hablar con el equipo",
      "Can I talk to a human?", "I'd like to book a call", "custom pricing for enterprise",
    ]) expect(quiereHablarConElEquipo(t), t).toBe(true);
  });
  it("no salta con preguntas normales ni negaciones", () => {
    for (const t of ["¿Qué es Funnyleads?", "¿Cuánto cuesta el plan Growth?", "no quiero una llamada, solo info", "ok", ""]) {
      expect(quiereHablarConElEquipo(t), t).toBe(false);
    }
  });
});

describe("validarPeticion", () => {
  it("normaliza y acepta una petición completa", () => {
    const r = validarPeticion({ name: "  Ana García ", email: "ANA@Empresa.es", company: "Empresa SL", message: "Quiero una demo para mi equipo", topic: "demo" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("ana@empresa.es");
      expect(r.value.name).toBe("Ana García");
      expect(r.value.phone).toBeNull();
    }
  });
  it("rechaza nombre corto, correo mal formado, mensaje vacío o demasiado largo", () => {
    expect(validarPeticion({ name: "A", email: "a@b.es", message: "hola que tal" }).ok).toBe(false);
    expect(validarPeticion({ name: "Ana", email: "no-es-un-correo", message: "hola que tal" }).ok).toBe(false);
    expect(validarPeticion({ name: "Ana", email: "a@b.es", message: "" }).ok).toBe(false);
    expect(validarPeticion({ name: "Ana", email: "a@b.es", message: "x".repeat(2001) }).ok).toBe(false);
  });
});

describe("visitanteDentroDeLimites", () => {
  it("deja pasar dentro de los topes y corta al llegar", () => {
    expect(visitanteDentroDeLimites(0, 1, 1).ok).toBe(true);
    expect(visitanteDentroDeLimites(VISITOR_MAX_PER_CONVERSATION - 1, 10, 10).ok).toBe(true);
    expect(visitanteDentroDeLimites(VISITOR_MAX_PER_CONVERSATION, 10, 10).ok).toBe(false);
    expect(visitanteDentroDeLimites(3, VISITOR_MAX_PER_DAY + 1, 10).ok).toBe(false);
    expect(visitanteDentroDeLimites(3, 10, VISITOR_MAX_PER_DAY + 1).ok).toBe(false);
  });
});

describe("correoPeticion y tituloDeConversacion", () => {
  it("el aviso a team@ lleva asunto con nombre y empresa, los datos y la transcripción escapada", () => {
    const v = validarPeticion({ name: "Ana", email: "ana@empresa.es", company: "Empresa <SL>", message: "Quiero <b>demo</b>" });
    if (!v.ok) throw new Error("fixture");
    const c = correoPeticion(v.value, { source: "visitor", transcript: [{ role: "user", content: "hola <script>" }, { role: "assistant", content: "¡Hola!" }], appUrl: "https://app.test" });
    expect(c.subject).toBe("Nueva petición desde el chat: Ana (Empresa <SL>)");
    expect(c.html).toContain("Empresa &lt;SL&gt;");
    expect(c.html).toContain("Quiero &lt;b&gt;demo&lt;/b&gt;");
    expect(c.html).toContain("hola &lt;script&gt;");
    expect(c.html).toContain("https://app.test/peticiones");
    expect(c.html).toContain("Visitante de la landing");
  });
  it("título = primer mensaje recortado", () => {
    expect(tituloDeConversacion("  ¿Qué   es Funnyleads?  ")).toBe("¿Qué es Funnyleads?");
    expect(tituloDeConversacion("a".repeat(100)).length).toBe(60);
    expect(tituloDeConversacion("")).toBe("Nueva conversación");
  });
});
