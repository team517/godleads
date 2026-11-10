import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));

import { fechaCorta, rememberVisitorConversation, visitorConversation, visitorId } from "@/lib/chat-hub-client";

/* Chatbot (10-11-2026): id de visitante estable en el navegador y fechas cortas del historial. */
describe("chat-hub-client", () => {
  beforeEach(() => { localStorage.clear(); });

  it("el id de visitante se crea una vez y se reutiliza (formato aceptado por chat-hub)", () => {
    const a = visitorId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(visitorId()).toBe(a);
  });

  it("la conversación del visitante se recuerda y se olvida", () => {
    expect(visitorConversation()).toBeNull();
    rememberVisitorConversation("11111111-2222-3333-4444-555555555555");
    expect(visitorConversation()).toBe("11111111-2222-3333-4444-555555555555");
    rememberVisitorConversation(null);
    expect(visitorConversation()).toBeNull();
  });

  it("fechaCorta: hora si es hoy, día y mes si no; vacío si la fecha no vale", () => {
    expect(fechaCorta(new Date().toISOString())).toMatch(/^\d{2}:\d{2}$/);
    expect(fechaCorta("2026-03-05T10:00:00Z")).toMatch(/5/);
    expect(fechaCorta("nada")).toBe("");
  });
});
