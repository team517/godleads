import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

/* Secuencia REAL del cambio de cuenta, de punta a punta en el navegador (10-11-2026): el dueño entraba
   en un cliente y, ya dentro, no le salía "Volver a mi cuenta". Aquí se monta el aviso global con la
   sesión del equipo, se llama a enterClient (función, verifyOtp y recarga simulados), la sesión pasa
   al cliente, "se recarga" la página y el aviso tiene que seguir ahí con el estado intacto. */

const auth = vi.hoisted(() => ({
  user: { id: "u-equipo", email: "hello@onepulso.blog" } as { id: string; email: string },
  loading: false,
  session: { access_token: "tok-equipo", refresh_token: "ref-equipo", expires_at: 4102444800, user: { id: "u-equipo", email: "hello@onepulso.blog" } } as any,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user, loading: auth.loading }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      verifyOtp: vi.fn(async () => {
        // Como en la vida real, la red tarda: mientras tanto la app sigue viendo al EQUIPO y React
        // tiene tiempo de repintar el aviso con el estado recién escrito (ahí estaba el fallo).
        await new Promise((r) => setTimeout(r, 50));
        // verifyOtp abre la sesión del cliente: a partir de aquí la app "ve" al cliente.
        auth.user = { id: "u-cliente", email: "salles@3nitram.com" };
        auth.session = { ...auth.session, user: auth.user, access_token: "tok-cliente" };
        return { data: { session: auth.session }, error: null };
      }),
      setSession: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  },
}));

import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { enterClient, readImpersonation, IMPERSONATION_KEY } from "@/lib/impersonation";

describe("cambio de cuenta — secuencia completa", () => {
  beforeEach(() => {
    localStorage.clear();
    auth.user = { id: "u-equipo", email: "hello@onepulso.blog" };
    auth.session = { access_token: "tok-equipo", refresh_token: "ref-equipo", expires_at: 4102444800, user: auth.user };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.action === "start") {
        return new Response(JSON.stringify({ token_hash: "hash-1", target: { id: "u-cliente", email: "salles@3nitram.com", company: "3nitram" }, log_id: "log-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: vi.fn() } });
  });

  it("entrar en un cliente deja 'Volver a mi cuenta' a la vista, también tras recargar", async () => {
    // 1. El equipo, en su cuenta, con el aviso global montado (como en App.tsx).
    const { rerender, unmount } = render(<ImpersonationBanner />);
    expect(screen.queryByText(/Volver a mi cuenta/)).toBeNull();

    // 2. Pulsa "Entrar" en 3nitram. El aviso está montado durante todo el proceso.
    // Se lanza sin agrupar: la escritura del estado y el repintado ocurren en mitad del cambio,
    // con la sesión del EQUIPO todavía abierta, igual que en el navegador.
    let entrada!: Promise<void>;
    act(() => { entrada = enterClient("u-cliente"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
    rerender(<ImpersonationBanner />);
    await act(async () => { await entrada; });
    expect(window.location.assign).toHaveBeenCalledWith("/dashboard");

    // El estado sobrevive al instante en que la sesión todavía era la del equipo.
    const st = readImpersonation();
    expect(st?.actor.email).toBe("hello@onepulso.blog");
    expect(st?.actor.refreshToken).toBe("ref-equipo");
    expect(st?.target.userId).toBe("u-cliente");

    // 3. La app ya ve al cliente: aparece el aviso.
    rerender(<ImpersonationBanner />);
    expect(await screen.findByText(/Volver a mi cuenta/)).toBeTruthy();
    expect(screen.getByText("3nitram")).toBeTruthy();

    // 4. "Recarga" completa de la página: se monta de nuevo desde cero con la sesión del cliente.
    unmount();
    render(<ImpersonationBanner />);
    expect(await screen.findByText(/Volver a mi cuenta/)).toBeTruthy();
    expect(localStorage.getItem(IMPERSONATION_KEY)).not.toBeNull();
  });

  it("el cliente que inicia sesión por su cuenta (sin estado guardado) no ve nada", () => {
    auth.user = { id: "u-cliente", email: "salles@3nitram.com" };
    render(<ImpersonationBanner />);
    expect(screen.queryByText(/Volver a mi cuenta/)).toBeNull();
  });
});
