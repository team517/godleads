import { describe, expect, it } from "vitest";
import { contextoParaPulseBot, esPeticionDeCambio, siguePulseBot } from "@/lib/chatbot-intent";

describe("chatbot flotante: ¿pide cambiar algo de sus campañas?", () => {
  it("peticiones de cambio → PulseBot", () => {
    for (const t of [
      "cambia el asunto del primer correo de mi campaña",
      "Modifica el segundo mensaje de la campaña Agencias Madrid, que sea más corto",
      "pon 3 días de espera en el follow up",
      "quita el enlace de calendly del tercer paso",
      "Añade un cuarto mensaje a la secuencia",
      "crea una campaña nueva para clínicas dentales",
      "reescribe el follow-up 2 con un tono más directo",
      "aplícalo en la campaña de juan",
      "mete estos leads a la campaña PYMES",
    ]) expect(esPeticionDeCambio(t), t).toBe(true);
  });
  it("consejo, análisis y preguntas → consultor", () => {
    for (const t of [
      "¿Cómo mejoro mi tasa de respuesta?",
      "Analiza mis campañas con gráficos",
      "Dame 5 asuntos de email con alto open rate",
      "qué te parece este mensaje",
      "explícame por qué rebotan tantos correos de la campaña",
      "hola",
    ]) expect(esPeticionDeCambio(t), t).toBe(false);
  });
  it("tras un turno de PulseBot, una respuesta corta sigue con PulseBot", () => {
    expect(siguePulseBot("sí, aplícalo", true)).toBe(true);
    expect(siguePulseBot("el segundo", true)).toBe(true);
    expect(siguePulseBot("mejor quita la última frase", true)).toBe(true);
    expect(siguePulseBot("sí", false)).toBe(false);
    expect(siguePulseBot("¿cómo mejoro mi tasa de respuesta en general, qué consejos me das?", true)).toBe(false);
  });
  it("contexto de un solo uso: últimos mensajes, recortados", () => {
    const c = contextoParaPulseBot([
      { role: "user", content: "hola" }, { role: "assistant", content: "¡Hola! " + "x".repeat(600) }, { role: "charts", content: "" },
    ]);
    expect(c.startsWith("Usuario: hola\nConsultor: ¡Hola! ")).toBe(true);
    expect(c.length).toBeLessThan(460);
    expect(contextoParaPulseBot([])).toBe("");
  });
});
