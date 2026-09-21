import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Welcome from "@/pages/Welcome";

/* La bienvenida de principio a fin, como la recorre alguien que acaba de crear su cuenta. */

let saved: any = null;
let saveError: any = null;
const navigated: any[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: (row: any) => {
        saved = row;
        return Promise.resolve({ error: saveError });
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "nuevo@empresa.com" }, loading: false }) }));
vi.mock("@/contexts/ProfileContext", () => ({ useProfile: () => ({ profile: { allowed_routes: null }, loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => (to: string, opts?: any) => navigated.push([to, opts]) };
});

const renderPage = () => render(<MemoryRouter><Welcome /></MemoryRouter>);

beforeEach(() => {
  saved = null;
  saveError = null;
  navigated.length = 0;
  localStorage.clear();
});

describe("Bienvenida (primer acceso)", () => {
  // Con la suite entera en paralelo el asistente completo pasa de los 5 s por defecto (falso rojo).
  vi.setConfig({ testTimeout: 30_000 });
  it("empieza preguntando cómo nos ha encontrado, y no deja seguir sin respuesta", () => {
    renderPage();
    expect(screen.getByText("¿Cómo nos has encontrado?")).toBeInTheDocument();
    expect(screen.getByText(/Paso 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /LinkedIn/ }));
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
  });

  it('elegir "Otro" abre el hueco para contarlo', () => {
    renderPage();
    expect(screen.queryByPlaceholderText(/Dónde nos viste/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Otro/ }));
    expect(screen.getByPlaceholderText(/Dónde nos viste/)).toBeInTheDocument();
  });

  it("una web mal escrita se avisa y no pasa de pantalla", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Google/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Comenzar ahora/ }));

    const campo = screen.getByPlaceholderText("tuempresa.com");
    fireEvent.change(campo, { target: { value: "no tengo" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    expect(screen.getByText(/no parece una dirección web/i)).toBeInTheDocument();
    expect(screen.getByText(/sitio web/i)).toBeInTheDocument();     // sigue en el mismo paso
  });

  it("recorre los cuatro pasos, guarda las respuestas y entra al panel", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /LinkedIn/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Comenzar ahora/ }));
    fireEvent.change(screen.getByPlaceholderText("tuempresa.com"), { target: { value: "Acme.ES/precios" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));

    expect(screen.getByText("¿Qué quieres lograr?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Entrar en OnePulso/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Correo en frío/ }));
    fireEvent.click(screen.getByRole("button", { name: /Conseguir leads/ }));
    fireEvent.click(screen.getByRole("button", { name: /Entrar en OnePulso/ }));

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved.source).toBe("linkedin");
    expect(saved.website).toBe("https://acme.es/precios");
    expect(saved.goals).toEqual(["cold_email", "leads"]);
    expect(saved.completed_at).toBeTruthy();
    await waitFor(() => expect(navigated[0]).toEqual(["/dashboard", { replace: true }]));
    expect(localStorage.getItem("op:welcome-done:u1")).toBe("1");
  });

  it("como mucho tres objetivos", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Google/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Comenzar ahora/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ahora no/ }));

    for (const n of [/Correo en frío/, /Conseguir leads/, /Gestionar campañas/, /Analizar resultados/]) {
      fireEvent.click(screen.getByRole("button", { name: n }));
    }
    expect(screen.getByText("3 de 3 seleccionadas")).toBeInTheDocument();
  });

  it("si el guardado falla, nadie se queda encerrado aquí", async () => {
    saveError = { message: "sin conexión" };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Omitir/ }));
    await waitFor(() => expect(navigated[0]).toEqual(["/dashboard", { replace: true }]));
  });
});
