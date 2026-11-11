import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* Chat flotante (rediseño 11-11-2026, calcado de las capturas del dueño): Inicio con tres tarjetas,
   barra de abajo Inicio / Mensajes / Ayuda y la conversación con el menú "⋯". El nombre visible es
   "Asistente IA" (nunca PulseBot). En la landing el visitante NO ve el Modo edición ni las
   analíticas; con sesión, sí (en el menú "⋯"). Sin emojis-icono, salvo el 👋 del saludo del diseño. */
const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
const perfil = vi.hoisted(() => ({ profile: null as null | { full_name: string | null } }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/contexts/ProfileContext", () => ({ useProfile: () => ({ profile: perfil.profile }) }));
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
  haceCuanto: () => "ahora",
}));

import { ColdEmailChatbot, textoSinMarcas } from "@/components/ColdEmailChatbot";
import * as hub from "@/lib/chat-hub-client";

const pinta = (props: { initialUnread?: number } = {}) =>
  render(<MemoryRouter initialEntries={["/"]}><ColdEmailChatbot initialOpen {...props} /></MemoryRouter>);
const texto = () => document.body.textContent || "";
/** Abre una conversación nueva desde la pestaña Mensajes. */
const nuevaConversacion = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Mensajes" }));
  fireEvent.click(await screen.findByRole("button", { name: /Nueva conversación/ }));
};
const abreMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: "Más opciones" }));
  return screen.getByRole("menu", { name: "Opciones del chat" });
};

describe("Inicio — como la captura del dueño", () => {
  beforeEach(() => { auth.user = null; perfil.profile = null; vi.clearAllMocks(); });

  it("cabecera 'Asistente IA', saludo, las tres tarjetas, el campo de mensaje y la barra de abajo", async () => {
    pinta();
    expect(await screen.findByText("Asistente IA")).toBeTruthy();
    expect(texto()).toContain("Hola 👋 ¿Cómo podemos ayudarte?");
    expect(texto()).toContain("¿Cómo podemos ayudarte?");
    expect(screen.getByRole("button", { name: /Habla con nuestro equipo.*Te respondemos en menos de 10 minutos/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Descubre la plataforma.*Conoce todo lo que puedes hacer/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Centro de ayuda.*Encuentra respuestas rápidas/ })).toBeTruthy();
    expect(screen.getByPlaceholderText("Escribe un mensaje...")).toBeTruthy();
    const barra = screen.getByRole("navigation", { name: "Secciones del chat" });
    expect(within(barra).getByRole("button", { name: "Inicio" }).getAttribute("aria-current")).toBe("page");
    expect(within(barra).getByRole("button", { name: "Mensajes" })).toBeTruthy();
    expect(within(barra).getByRole("button", { name: "Ayuda" })).toBeTruthy();
    expect(texto()).not.toMatch(/PulseBot|FunnyBot/);
    // El único emoji es el 👋 del diseño.
    expect(texto().replace("👋", "")).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("escribir en Inicio abre la conversación con el Asistente IA y ese mensaje", async () => {
    (hub.callChatHub as any).mockResolvedValue({ conversation_id: "c5", reply: "Starter cuesta 21 € al mes." });
    pinta();
    fireEvent.change(await screen.findByPlaceholderText("Escribe un mensaje..."), { target: { value: "¿Cuánto cuesta?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(hub.callChatHub).toHaveBeenCalledWith(expect.objectContaining({ action: "visitor_chat", message: "¿Cuánto cuesta?" })));
    expect(await screen.findByText(/Starter cuesta 21/)).toBeTruthy();
    expect(screen.getByText("El equipo también puede ayudarte")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Secciones del chat" })).toBeNull();
    // La flecha vuelve a Inicio.
    fireEvent.click(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(await screen.findByText("¿Cómo podemos ayudarte?", { exact: false })).toBeTruthy();
  });

  it("Ayuda: buscador y preguntas desplegables; al final, hablar con el equipo", async () => {
    pinta();
    fireEvent.click(await screen.findByRole("button", { name: "Ayuda" }));
    expect(screen.getByText("¿Cómo conecto mis buzones de correo?")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar en el centro de ayuda"), { target: { value: "oficina" } });
    expect(screen.queryByText("¿Cómo conecto mis buzones de correo?")).toBeNull();
    const pregunta = screen.getByRole("button", { name: /fuera de la oficina/ });
    fireEvent.click(pregunta);
    expect(pregunta.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/espera hasta ese día/)).toBeTruthy();
    expect(screen.getByText("¿No encuentras lo que buscas?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Habla con nuestro equipo/ }));
    expect(await screen.findByText("Equipo de Funnyleads", { selector: "p.font-display" })).toBeTruthy();
  });
});

describe("Conversación — modos según haya sesión", () => {
  beforeEach(() => { auth.user = null; perfil.profile = null; vi.clearAllMocks(); });

  it("visitante en la landing: bienvenida del diseño, sin Modo edición ni analíticas en el menú", async () => {
    pinta();
    await nuevaConversacion();
    expect(await screen.findByText(/estás chateando con nuestro Asistente IA/)).toBeTruthy();
    expect(screen.getByText(/Cuanta más información compartas, mejor podré ayudarte/)).toBeTruthy();
    expect(screen.getByText("¿Cuánto cuesta?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Adjuntar imagen" })).toBeNull();
    const menu = abreMenu();
    expect(menu.textContent).not.toMatch(/Modo edición/);
    expect(menu.textContent).not.toMatch(/Analizar mis campañas/);
    expect(menu.textContent).toContain("Hablar con el equipo");
    expect(menu.textContent).toContain("Ampliar");
    expect(menu.textContent).toContain("Nueva conversación");
    expect(texto()).not.toMatch(/Modo edición|PulseBot|FunnyBot/);
  });

  it("con sesión: saludo con su nombre, Modo edición y analíticas en el menú, y sin emojis", async () => {
    auth.user = { id: "u1", email: "ana@acme.com" };
    perfil.profile = { full_name: "Ana López" };
    pinta();
    await nuevaConversacion();
    expect(await screen.findByText(/Hola, Ana, estás chateando con nuestro Asistente IA/)).toBeTruthy();
    expect(screen.getByText("Analiza mis campañas con gráficos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adjuntar imagen" })).toBeTruthy();
    const menu = abreMenu();
    expect(menu.textContent).toContain("Modo edición");
    expect(menu.textContent).toContain("Analizar mis campañas con gráficos");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Modo edición/ }));
    expect(await screen.findByText("Modo edición · cambios en tus campañas con confirmación")).toBeTruthy();
    expect(texto()).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(texto()).not.toMatch(/PulseBot|FunnyBot/);
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(screen.queryByText("Modo edición · cambios en tus campañas con confirmación")).toBeNull();
  });
});

describe("textoSinMarcas — lo que se ve mientras carga el formato", () => {
  it("quita negritas, almohadillas y guiones de lista", () => {
    expect(textoSinMarcas("**Starter:** 21 €\n## Planes\n- uno")).toBe("Starter: 21 €\nPlanes\n• uno");
  });
});

describe("Habla con nuestro equipo — chat en directo, sin formulario", () => {
  beforeEach(() => { auth.user = null; perfil.profile = null; vi.clearAllMocks(); });

  it("el mensaje va al equipo (no a la IA) y al visitante se le pide el correo en una línea", async () => {
    (hub.teamSend as any).mockResolvedValue({
      conversation_id: "c9", team_status: "open", contact_email: null, needs_email: true,
      message: { id: "m1", role: "user", content: "hola equipo", via: "cliente_equipo", created_at: "2026-11-10T12:00:00Z" },
    });
    pinta();
    fireEvent.click(await screen.findByRole("button", { name: /Habla con nuestro equipo/ }));
    expect(screen.getByText("Equipo de Funnyleads", { selector: "p.font-display" })).toBeTruthy();
    expect(screen.getByText("Normalmente respondemos en menos de 10 minutos")).toBeTruthy();
    expect(screen.getByText(/te responde una persona del equipo en este mismo chat/i)).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    const input = screen.getByPlaceholderText("Escribe un mensaje...");
    fireEvent.change(input, { target: { value: "hola equipo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(hub.teamSend).toHaveBeenCalledWith(expect.objectContaining({ message: "hola equipo", visitorId: "v1" })));
    expect(hub.callChatHub).not.toHaveBeenCalledWith(expect.objectContaining({ action: "visitor_chat" }));
    expect(await screen.findByText(/A qué correo te avisamos/)).toBeTruthy();
    expect(screen.getByPlaceholderText("tu@empresa.com")).toBeTruthy();
    expect(abreMenu().textContent).toContain("Volver al Asistente IA");
  });

  it("si el equipo ha respondido, el chat se abre directamente en el hilo con el equipo", async () => {
    pinta({ initialUnread: 2 });
    expect(await screen.findByText("Equipo de Funnyleads", { selector: "p.font-display" })).toBeTruthy();
    expect(screen.queryByText("¿Cómo podemos ayudarte?", { exact: false })).toBeNull();
  });
});
