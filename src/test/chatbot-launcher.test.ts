import { describe, it, expect } from "vitest";
import { chatbotHiddenAt } from "@/components/ChatbotLauncher";

describe("chatbotHiddenAt — dónde no se pinta el botón de PulseBot", () => {
  it("se esconde en la Unibox, la bienvenida, Modificaciones IA y la app del móvil", () => {
    expect(chatbotHiddenAt("/unibox")).toBe(true);
    expect(chatbotHiddenAt("/unibox/123")).toBe(true);
    expect(chatbotHiddenAt("/bienvenida")).toBe(true);
    expect(chatbotHiddenAt("/modificaciones-ia")).toBe(true);
    expect(chatbotHiddenAt("/m")).toBe(true);
    expect(chatbotHiddenAt("/m/cuenta")).toBe(true);
  });
  it("se ve en el resto del panel (y /metrics no es la app del móvil)", () => {
    expect(chatbotHiddenAt("/dashboard")).toBe(false);
    expect(chatbotHiddenAt("/campaigns")).toBe(false);
    expect(chatbotHiddenAt("/metrics")).toBe(false);
    expect(chatbotHiddenAt("/")).toBe(false);
  });
});
