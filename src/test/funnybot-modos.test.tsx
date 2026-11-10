import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* FunnyBot (10-11-2026): en la landing el visitante NO ve el selector de modos ni el Modo
   edición; con sesión, sí. El nombre visible es FunnyBot, nunca PulseBot, y sin emojis-icono. */
const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/contexts/ProfileContext", () => ({ useProfile: () => ({ profile: null }) }));
vi.mock("@/integrations/supabase/client", () => {
  const q: any = {}; for (const k of ["select", "eq", "order", "limit", "in", "insert", "update", "delete"]) q[k] = () => q;
  q.then = (r: any) => Promise.resolve({ data: [], error: null }).then(r);
  return { supabase: { from: () => q, functions: { invoke: async () => ({ data: {}, error: null }) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/lib/chat-hub-client", () => ({
  DEMO_URL: "https://cal.com/x/15min",
  callChatHub: vi.fn(async () => ({ conversations: [], messages: [] })),
  createConversation: vi.fn(async () => "c1"), deleteConversation: vi.fn(), listConversations: vi.fn(async () => []),
  loadMessages: vi.fn(async () => []), rememberVisitorConversation: vi.fn(), saveMessage: vi.fn(),
  visitorConversation: () => null, visitorId: () => "v1",
  rememberTeamThread: vi.fn(), teamPoll: vi.fn(async () => ({ messages: [], team_status: "none" })),
  teamSend: vi.fn(), teamUnread: vi.fn(async () => ({ unread: 0 })), teamContact: vi.fn(),
}));

import { ColdEmailChatbot, textoSinMarcas } from "@/components/ColdEmailChatbot";
import * as hub from "@/lib/chat-hub-client";

const pinta = () => render(<MemoryRouter initialEntries={["/"]}><ColdEmailChatbot initialOpen /></MemoryRouter>);

describe("FunnyBot — modos según haya sesión", () => {
  beforeEach(() => { auth.user = null; });

  it("visitante en la landing: sin selector de modos, sin Modo edición, se presenta como FunnyBot", async () => {
    pinta();
    expect(await screen.findAllByText("FunnyBot")).not.toHaveLength(0);
    expect(screen.queryByRole("tablist", { name: "Modo del asistente" })).toBeNull();
    expect(screen.queryByText(/Modo edición/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/PulseBot/);
    expect(screen.getByText("¿Cuánto cuesta?")).toBeTruthy();
  });

  it("con sesión: Conversación y Modo edición, y las sugerencias sin emoji", async () => {
    auth.user = { id: "u1", email: "ana@acme.com" };
    pinta();
    const tabs = await screen.findByRole("tablist", { name: "Modo del asistente" });
    expect(tabs.textContent).toContain("Conversación");
    expect(tabs.textContent).toContain("Modo edición");
    expect(screen.getByText("Analiza mis campañas con gráficos")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(document.body.textContent).not.toMatch(/PulseBot/);
  });
});

describe("textoSinMarcas — lo que se ve mientras carga el formato", () => {
  it("quita negritas, almohadillas y guiones de lista", () => {
    expect(textoSinMarcas("**Starter:** 21 €\n## Planes\n- uno")).toBe("Starter: 21 €\nPlanes\n• uno");
  });
});

describe("Hablar con el equipo — chat en directo, sin formulario", () => {
  beforeEach(() => { auth.user = null; vi.clearAllMocks(); });

  it("el mensaje va al equipo (no a la IA) y al visitante se le pide el correo en una línea", async () => {
    (hub.teamSend as any).mockResolvedValue({
      conversation_id: "c9", team_status: "open", contact_email: null, needs_email: true,
      message: { id: "m1", role: "user", content: "hola equipo", via: "cliente_equipo", created_at: "2026-11-10T12:00:00Z" },
    });
    pinta();
    fireEvent.click(await screen.findByRole("button", { name: "Hablar con el equipo" }));
    expect(screen.getByText(/te responde una persona del equipo en este mismo chat/i)).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    const input = screen.getByPlaceholderText("Escribe al equipo…");
    fireEvent.change(input, { target: { value: "hola equipo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(hub.teamSend).toHaveBeenCalledWith(expect.objectContaining({ message: "hola equipo", visitorId: "v1" })));
    expect(hub.callChatHub).not.toHaveBeenCalledWith(expect.objectContaining({ action: "visitor_chat" }));
    expect(await screen.findByText(/A qué correo te avisamos/)).toBeTruthy();
    expect(screen.getByPlaceholderText("tu@empresa.com")).toBeTruthy();
    expect(screen.getByText("Volver a FunnyBot")).toBeTruthy();
  });
});
