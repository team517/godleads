import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeliverabilityTest from "@/pages/DeliverabilityTest";

// Doble de Supabase: cada tabla devuelve sus filas pase lo que pase en la cadena de filtros, y
// `functions.invoke` responde según la acción. `invoked` guarda lo que la página envía.
let tables: Record<string, any[]>;
let fn: Record<string, any>;
const invoked: Array<Record<string, any>> = [];

vi.mock("@/integrations/supabase/client", () => {
  const query = (rows: any[]) => {
    const q: any = {};
    for (const m of ["select", "eq", "order", "limit", "in", "insert", "delete", "gte"]) q[m] = () => q;
    q.then = (res: (v: any) => void) => res({ data: rows, error: null });
    return q;
  };
  return {
    supabase: {
      from: (t: string) => query(tables[t] || []),
      functions: {
        invoke: (_name: string, opts: { body: Record<string, any> }) => {
          invoked.push(opts.body);
          return Promise.resolve({ data: fn[opts.body.action], error: null });
        },
      },
    },
  };
});

vi.mock("@/contexts/AuthContext", () => {
  const auth = { user: { id: "u1", email: "cliente@empresa.com" }, loading: false };
  return { useAuth: () => auth };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const renderPage = () => render(<MemoryRouter><DeliverabilityTest /></MemoryRouter>);

beforeEach(() => {
  invoked.length = 0;
  tables = {
    email_accounts: [{ id: "acc1", email: "ana@midominio.es", status: "connected", smtp_host: "smtp.ionos.es", first_name: "Ana", last_name: "Ruiz" }],
    campaigns: [{ id: "c1", name: "Talleres Valencia", status: "active" }],
    campaign_steps: [
      { id: "s1", step_order: 1, subject: "Una idea para {{company_name}}", body: "Hola {{first_name}},\n\nSoy {{SenderFirstName}}. ¿Hablamos?", variants: [{ subject: "Pregunta rápida", body: "Hola {{first_name}}, versión B." }] },
      { id: "s2", step_order: 2, subject: "", body: "Hola {{first_name}}, ¿pudiste verlo?", variants: [] },
    ],
    campaign_leads: [{ leads: { email: "marta@acme.es", custom_fields: { first_name: "Marta", company_name: "Acme SL" } } }],
    placement_tests: [],
    placement_seeds: [],
  };
  fn = {
    access: { allowed: true, agency: false, ready: true, providers: ["Gmail"], remaining: 9 },
    run: { ok: true, test_id: "t1", seeds: 3, sent: 3 },
    check: { ok: true, results: [{ provider: "Gmail", folder: "inbox" }, { provider: "Gmail", folder: "inbox" }, { provider: "Gmail", folder: "spam" }] },
  };
});

describe("Entregabilidad (cliente)", () => {
  it("elige campaña y correo → previsualiza con los datos cambiados y los envía así", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: "Talleres Valencia" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Campaña"), { target: { value: "c1" } });
    await waitFor(() => expect(screen.getByLabelText("Asunto")).toHaveValue("Una idea para {{company_name}}"));

    // Vista previa: variables del lead real + nombre del remitente, sin llaves a la vista.
    expect(screen.getByText("Una idea para Acme SL")).toBeInTheDocument();
    expect(screen.getByText(/Hola Marta,/)).toBeInTheDocument();
    expect(screen.getByText(/Soy Ana\./)).toBeInTheDocument();

    // Versión B y el correo 2 (asunto vacío = mismo hilo → hereda el del primero).
    expect(screen.getByRole("option", { name: "Correo 1 · versión B" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Correo de la secuencia"), { target: { value: "s2:0" } });
    await waitFor(() => expect(screen.getByLabelText("Asunto")).toHaveValue("Una idea para {{company_name}}"));
    expect(screen.getByLabelText("Cuerpo del correo")).toHaveValue("Hola {{first_name}}, ¿pudiste verlo?");

    // El cliente cambia un dato de ejemplo y lanza la prueba.
    fireEvent.change(screen.getByLabelText("{{first_name}}"), { target: { value: "Lucía" } });
    expect(screen.getByText(/Hola Lucía,/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Probar entregabilidad/ }));
    await waitFor(() => expect(invoked.some((b) => b.action === "run")).toBe(true));
    const run = invoked.find((b) => b.action === "run")!;
    expect(run).toMatchObject({ account_id: "acc1", campaign_id: "c1", subject: "Una idea para {{company_name}}" });
    expect(run.fields).toMatchObject({ first_name: "Lucía", company_name: "Acme SL" });
  });

  it("pegar mi copy: se envía sin campaña y con datos de ejemplo", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: "ana@midominio.es" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Escribir o pegar mi copy/ }));
    fireEvent.change(screen.getByLabelText("Asunto"), { target: { value: "Hola {{first_name}}" } });
    fireEvent.change(screen.getByLabelText("Cuerpo del correo"), { target: { value: "Vi {{company_name}} en {{city}} y quería comentarte algo concreto sobre vuestro taller esta semana si te encaja." } });
    expect(screen.getByText("Hola Laura")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Probar entregabilidad/ }));
    await waitFor(() => expect(invoked.some((b) => b.action === "run")).toBe(true));
    const run = invoked.find((b) => b.action === "run")!;
    expect(run.campaign_id).toBeUndefined();
    expect(run.fields).toMatchObject({ first_name: "Laura", company_name: "Talleres Martín", city: "Valencia" });
  });

  it("resultado: veredicto y desglose por proveedor, sin ninguna dirección de buzón", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      await waitFor(() => expect(screen.getByRole("option", { name: "ana@midominio.es" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /Escribir o pegar mi copy/ }));
      fireEvent.change(screen.getByLabelText("Asunto"), { target: { value: "Hola" } });
      fireEvent.change(screen.getByLabelText("Cuerpo del correo"), { target: { value: "Un texto de prueba suficientemente largo para no disparar el aviso de correo demasiado corto en la revisión." } });
      fireEvent.click(screen.getByRole("button", { name: /Probar entregabilidad/ }));
      await waitFor(() => expect(screen.getByText(/Esperando a que llegue/)).toBeInTheDocument());
      await vi.advanceTimersByTimeAsync(41_000); // comprobación automática
      await waitFor(() => expect(screen.getByText(/Resultado mixto/)).toBeInTheDocument());
      expect(screen.getByText(/2 de 3 en bandeja de entrada \(67%\)/)).toBeInTheDocument();
      expect(screen.getByText("Bandeja ×2")).toBeInTheDocument();
      expect(screen.getAllByText("Spam").length).toBeGreaterThanOrEqual(2); // el de la cabecera + la etiqueta del resultado
      expect(document.body.textContent).not.toMatch(/@gmail\.com/);
      expect(screen.queryByText(/Buzones semilla/)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("sin plan de pago: muro con «Ver planes», sin formulario", async () => {
    fn.access = { allowed: false, reason: "El test de entregabilidad está incluido en los planes de pago." };
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ver planes" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Probar entregabilidad/ })).toBeNull();
  });

  it("la agencia sí ve y gestiona los buzones semilla", async () => {
    fn.access = { allowed: true, agency: true, ready: true, providers: ["Gmail"], remaining: null };
    tables.placement_seeds = [{ id: "sd1", email: "semilla1@gmail.com", provider: "Gmail", imap_host: "imap.gmail.com", imap_port: 993 }];
    renderPage();
    await waitFor(() => expect(screen.getByText("Buzones semilla de la plataforma")).toBeInTheDocument());
    expect(screen.getByText(/semilla1@gmail\.com/)).toBeInTheDocument();
  });
});
