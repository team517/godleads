import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/* Bandeja del equipo (10-11-2026): lista de chats, hilo con lo hablado con FunnyBot en gris,
   responder con Intro (Mayús+Intro = salto de línea) y cerrar. */
const hub = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("@/lib/chat-hub-client", () => ({
  haceCuanto: () => "hace 2 min",
  callChatHub: vi.fn(async (body: any) => {
    hub.calls.push(body);
    if (body.action === "team_inbox") return {
      unread_total: 2,
      conversations: [{
        id: "c1", user_id: null, visitor_id: "v1", title: null, team_status: "open", team_unread: 2, user_unread: 0,
        last_message_at: "2026-11-10T12:00:00Z", last_client_message_at: null, last_team_reply_at: null,
        contact_email: "ana@acme.com", contact_name: null, page_url: "/", team_opened_at: null,
        account_email: null, full_name: null, company: null, plan: null,
        last_message: { role: "user", content: "¿Hacéis demos?", via: "cliente_equipo", created_at: "2026-11-10T12:00:00Z" },
      }],
    };
    if (body.action === "team_thread") return { messages: [
      { id: "m0", role: "user", content: "¿Cuánto cuesta?", via: "visitante", created_at: "2026-11-10T11:58:00Z" },
      { id: "m1", role: "assistant", content: "Desde 21 €/mes", via: "visitante", created_at: "2026-11-10T11:58:10Z" },
      { id: "m2", role: "system", content: "Conversación con el equipo abierta", via: "equipo", created_at: "2026-11-10T11:59:00Z" },
      { id: "m3", role: "user", content: "¿Hacéis demos?", via: "cliente_equipo", created_at: "2026-11-10T12:00:00Z" },
    ] };
    if (body.action === "team_reply") return { message: { id: "m4", role: "assistant", content: body.message, via: "equipo", author_name: "Xavi", created_at: "2026-11-10T12:01:00Z" } };
    return { ok: true };
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TeamInbox, nombreDelChat, vistaPrevia } from "@/components/chatbot/TeamInbox";

describe("TeamInbox", () => {
  beforeEach(() => { hub.calls = []; });

  it("lista, abre el hilo y responde con Intro", async () => {
    const onUnread = vi.fn();
    render(<TeamInbox onUnread={onUnread} />);
    fireEvent.click(await screen.findByText("ana@acme.com"));
    expect(await screen.findByText("Desde 21 €/mes")).toBeTruthy();
    expect(screen.getByText("Conversación con el equipo abierta")).toBeTruthy();
    expect(onUnread).toHaveBeenCalledWith(2);
    const caja = screen.getByLabelText("Respuesta");
    fireEvent.change(caja, { target: { value: "Sí, ¿te va mañana a las 10?" } });
    fireEvent.keyDown(caja, { key: "Enter" });
    await waitFor(() => expect(hub.calls).toContainEqual({ action: "team_reply", conversation_id: "c1", message: "Sí, ¿te va mañana a las 10?" }));
    expect(await screen.findByText("Sí, ¿te va mañana a las 10?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cerrar/ }));
    await waitFor(() => expect(hub.calls).toContainEqual({ action: "team_close", conversation_id: "c1" }));
  });

  it("Mayús+Intro no envía", async () => {
    render(<TeamInbox />);
    fireEvent.click(await screen.findByText("ana@acme.com"));
    const caja = await screen.findByLabelText("Respuesta");
    fireEvent.change(caja, { target: { value: "línea 1" } });
    fireEvent.keyDown(caja, { key: "Enter", shiftKey: true });
    expect(hub.calls.some((c) => c.action === "team_reply")).toBe(false);
  });
});

describe("nombre y vista previa", () => {
  it("nombre: contacto, cuenta, correo o visitante", () => {
    expect(nombreDelChat({ contact_name: null, full_name: null, contact_email: null, account_email: null, user_id: null })).toBe("Visitante de la landing");
    expect(nombreDelChat({ contact_name: null, full_name: "Ana", contact_email: "a@x.es", account_email: null, user_id: "u" })).toBe("Ana");
  });
  it("vista previa con 'Tú:' si lo último lo escribió el equipo", () => {
    expect(vistaPrevia({ role: "assistant", via: "equipo", content: "Hola  ahí", created_at: "" })).toBe("Tú: Hola ahí");
    expect(vistaPrevia({ role: "user", via: "cliente_equipo", content: "x", created_at: "" })).toBe("x");
    expect(vistaPrevia(null)).toBe("");
  });
});
