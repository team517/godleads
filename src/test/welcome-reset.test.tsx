import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { welcomeDoneKey } from "@/lib/first-run";

// Reiniciar una cuenta (11-11-2026): aunque el navegador recuerde que hizo la bienvenida, si el
// equipo deja su fila con completed_at vacío, vuelve a salir. Sin fila (guardado fallido), no.
const db = vi.hoisted(() => ({ row: null as any }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: null }) }) }) }) },
}));
const auth = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: auth.id } }) }));

import { useWelcomeGate } from "@/hooks/useWelcomeGate";

describe("bienvenida reiniciada por el equipo", () => {
  it("navegador con la marca + fila reiniciada → vuelve la bienvenida y se borra la marca", async () => {
    auth.id = "reset-1";
    localStorage.setItem(welcomeDoneKey("reset-1"), "1");
    db.row = { completed_at: null };
    const { result } = renderHook(() => useWelcomeGate());
    await waitFor(() => expect(result.current).toBe("pending"));
    expect(localStorage.getItem(welcomeDoneKey("reset-1"))).toBeNull();
  });
  it("navegador con la marca y sin fila (guardado que falló) → sigue hecha", async () => {
    auth.id = "nofila-1";
    localStorage.setItem(welcomeDoneKey("nofila-1"), "1");
    db.row = null;
    const { result } = renderHook(() => useWelcomeGate());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe("done");
  });
  it("navegador con la marca y fila completada → hecha", async () => {
    auth.id = "hecha-1";
    localStorage.setItem(welcomeDoneKey("hecha-1"), "1");
    db.row = { completed_at: "2026-11-11T10:00:00Z" };
    const { result } = renderHook(() => useWelcomeGate());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe("done");
  });
});
