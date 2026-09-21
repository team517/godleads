import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CampaignSequences from "@/components/campaigns/CampaignSequences";
import { ConfirmProvider } from "@/hooks/useConfirm";

/* El editor de la secuencia con el diseño nuevo: el raíl (Paso 1 · Esperar · Paso 2), la tarjeta
 * de cada correo y la barra de formato. Lo que se comprueba aquí es que lo que se toca en la
 * pantalla acaba guardado tal cual en campaign_steps. */

let tables: Record<string, any[]>;
const saved: any[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const make = (t: string) => {
    const q: any = {};
    for (const m of ["select", "eq", "order", "limit", "in", "gte", "not", "single", "maybeSingle"]) q[m] = () => q;
    q.update = (payload: any) => { saved.push({ table: t, payload }); return q; };
    q.delete = () => { saved.push({ table: t, deleted: true }); return q; };
    q.insert = (payload: any) => { saved.push({ table: t, insert: payload }); return q; };
    q.upsert = (payload: any) => { saved.push({ table: t, upsert: payload }); return q; };
    q.then = (res: (v: any) => void) => res({ data: tables[t] || [], error: null });
    return q;
  };
  return {
    supabase: {
      from: make,
      functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "ana@onepulso.online" }, loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const lastFor = (table: string, field: string) =>
  [...saved].reverse().find((s) => s.table === table && s.payload && field in s.payload)?.payload[field];

beforeEach(() => {
  saved.length = 0;
  tables = {
    campaign_steps: [
      { id: "s1", step_order: 1, subject: "Una idea para {{company_name}}", body: "Hola, ¿hablamos?", delay_days: 0, variants: [], variants_off: [], attachments: [] },
      { id: "s2", step_order: 2, subject: "", body: "¿Pudiste verlo?", delay_days: 2, variants: [], attachments: [] },
    ],
    campaign_leads: [{ leads: { email: "marta@acme.es", custom_fields: { first_name: "Marta", company_name: "Acme SL" } } }],
    email_accounts: [{ id: "a1", email: "ana@onepulso.online" }],
    email_templates: [],
  };
});

const renderEditor = async () => {
  render(<ConfirmProvider><CampaignSequences campaignId="c1" /></ConfirmProvider>);
  await waitFor(() => expect(screen.getByText("Paso 1")).toBeInTheDocument());
};

describe("Editor de secuencia", () => {
  it("pinta el raíl con los pasos y la espera entre ellos", async () => {
    await renderEditor();
    expect(screen.getByText("Email inicial")).toBeInTheDocument();
    expect(screen.getAllByText("Esperar").length).toBeGreaterThanOrEqual(2);   // el raíl y la tarjeta
    expect(screen.getByText("Paso 2")).toBeInTheDocument();
    expect(screen.getByText("Seguimiento")).toBeInTheDocument();
    expect(screen.getByText("2 pasos")).toBeInTheDocument();
  });

  it("el primer paso se abre solo y el segundo se abre al hacer clic", async () => {
    await renderEditor();
    expect(screen.getByDisplayValue("Una idea para {{company_name}}")).toBeInTheDocument();
    // El segundo está cerrado: su cuerpo se lee, pero no es un campo.
    expect(screen.queryByDisplayValue("¿Pudiste verlo?")).toBeNull();
    fireEvent.click(screen.getByText("¿Pudiste verlo?"));
    await waitFor(() => expect(screen.getByDisplayValue("¿Pudiste verlo?")).toBeInTheDocument());
  });

  it("escribir el asunto y el cuerpo se guarda", async () => {
    await renderEditor();
    fireEvent.change(screen.getByDisplayValue("Una idea para {{company_name}}"), { target: { value: "Pregunta rápida" } });
    fireEvent.change(screen.getByDisplayValue("Hola, ¿hablamos?"), { target: { value: "Hola Marta," } });
    // El guardado espera medio segundo: escribir no manda una peticion por tecla.
    expect(lastFor("campaign_steps", "subject")).toBeUndefined();
    await waitFor(() => expect(lastFor("campaign_steps", "subject")).toBe("Pregunta rápida"));
    await waitFor(() => expect(lastFor("campaign_steps", "body")).toBe("Hola Marta,"));
  });

  it("el botón {} del asunto mete la variable donde está el cursor, y se guarda", async () => {
    await renderEditor();
    const subject = screen.getByDisplayValue("Una idea para {{company_name}}") as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "Hola , una idea" } });
    subject.setSelectionRange(5, 5); // justo después de "Hola "
    // Cada paso pinta su botón; sólo el del paso abierto (el primero) está activo.
    const varButtons = screen.getAllByRole("button", { name: "Insertar variable en el asunto" });
    expect(varButtons[0]).not.toBeDisabled();
    expect(varButtons[1]).toBeDisabled();
    fireEvent.click(varButtons[0]);
    const option = await screen.findAllByText("{{first_name}}");
    fireEvent.click(option[0].closest("button")!);
    expect(subject.value).toBe("Hola {{first_name}}, una idea");
    await waitFor(() => expect(lastFor("campaign_steps", "subject")).toBe("Hola {{first_name}}, una idea"));
  });

  it("la negrita envuelve lo seleccionado y se puede quitar", async () => {
    await renderEditor();
    const body = screen.getByDisplayValue("Hola, ¿hablamos?") as HTMLTextAreaElement;
    body.setSelectionRange(0, 4);                       // "Hola"
    fireEvent.click(screen.getByTitle("Negrita"));
    await waitFor(() => expect(lastFor("campaign_steps", "body")).toBe("<b>Hola</b>, ¿hablamos?"));
  });

  it("las viñetas convierten la línea en lista", async () => {
    await renderEditor();
    const body = screen.getByDisplayValue("Hola, ¿hablamos?") as HTMLTextAreaElement;
    body.setSelectionRange(0, 0);
    fireEvent.click(screen.getByTitle("Lista"));
    await waitFor(() => expect(lastFor("campaign_steps", "body")).toBe("• Hola, ¿hablamos?"));
  });

  it("la espera se escribe en días y se guarda en días", async () => {
    await renderEditor();
    const dias = screen.getByLabelText("Cuánto esperar") as HTMLInputElement;
    expect(dias.value).toBe("2");
    fireEvent.change(dias, { target: { value: "5" } });
    expect(lastFor("campaign_steps", "delay_days")).toBe(5);
  });

  it("una espera de 14 días se enseña como 2 semanas", async () => {
    tables.campaign_steps[1].delay_days = 14;
    await renderEditor();
    expect((screen.getByLabelText("Cuánto esperar") as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("Semanas")).toBeInTheDocument();
  });

  it("un paso se puede eliminar desde su raíl, y se pregunta antes", async () => {
    await renderEditor();
    fireEvent.click(screen.getAllByRole("button", { name: /^Eliminar$/ })[0]);
    expect(await screen.findByText("¿Eliminar el paso 1?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(saved.some((x) => x.table === "campaign_steps" && x.deleted)).toBe(true));
  });

  it("si se dice que no, el paso no se toca", async () => {
    await renderEditor();
    fireEvent.click(screen.getAllByRole("button", { name: /^Eliminar$/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("¿Eliminar el paso 1?")).toBeNull());
    expect(saved.some((x) => x.deleted)).toBe(false);
  });

  it("apagar una variante la saca del envío, pero no la borra", async () => {
    tables.campaign_steps[0].variants = [{ subject: "B", body: "cuerpo B" }];
    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^B$/ }));          // pestaña B
    fireEvent.click(screen.getByTitle(/Apagar la versión B/));

    // Lo que lee el motor se queda sin ella; su texto se guarda aparte, con su letra.
    await waitFor(() => expect(lastFor("campaign_steps", "variants")).toEqual([]));
    expect(lastFor("campaign_steps", "variants_off")[0]).toMatchObject({ subject: "B", body: "cuerpo B", off_slot: 1 });
    expect(saved.some((x) => x.deleted)).toBe(false);                      // nada borrado
    expect(screen.getByText(/no se envía/)).toBeInTheDocument();
  });

  it("y se puede volver a encender", async () => {
    tables.campaign_steps[0].variants = [];
    tables.campaign_steps[0].variants_off = [{ subject: "B", body: "cuerpo B", off_slot: 1 }];
    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^B$/ }));
    fireEvent.click(screen.getByTitle(/Encender la versión B/));
    await waitFor(() => expect(lastFor("campaign_steps", "variants")).toEqual([{ subject: "B", body: "cuerpo B" }]));
    expect(lastFor("campaign_steps", "variants_off")).toEqual([]);
  });

  it("sin pasos, invita a crear el primero", async () => {
    tables.campaign_steps = [];
    render(<ConfirmProvider><CampaignSequences campaignId="c1" /></ConfirmProvider>);
    await waitFor(() => expect(screen.getByText("Todavía no hay ningún correo")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Crear primer paso/ })).toBeInTheDocument();
  });
});
