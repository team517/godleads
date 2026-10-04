import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CampaignDetail from "@/components/campaigns/CampaignDetail";

/* La barra de una campaña con el diseño del 30-09-2026: pestañas Analítica · Editor · Leads ·
   Ajustes, estado, "Vista previa", "Lanzar" y el menú ⋮ que manda órdenes al editor. */

const seqProps: any[] = [];
vi.mock("@/components/campaigns/CampaignSequences", () => ({ default: (p: any) => { seqProps.push(p); return <div>EDITOR</div>; } }));
vi.mock("@/components/campaigns/CampaignAnalytics", () => ({ default: () => <div>RESUMEN</div> }));
vi.mock("@/components/campaigns/CampaignSentLog", () => ({ default: () => <div>ENVIADOS</div> }));
vi.mock("@/components/campaigns/CampaignReportBar", () => ({ default: () => <div>INFORME</div> }));
vi.mock("@/components/campaigns/CampaignSendsChart", () => ({ default: () => <div>GRAFICA</div> }));
vi.mock("@/components/campaigns/CampaignLeads", () => ({ default: () => <div>LEADS</div> }));
vi.mock("@/components/campaigns/CampaignCRM", () => ({ default: () => <div>CRM</div> }));
vi.mock("@/components/campaigns/CampaignEmailAccounts", () => ({ default: () => <div>CUENTAS</div> }));
vi.mock("@/components/campaigns/CampaignSchedule", () => ({ default: () => <div>HORARIO</div> }));
vi.mock("@/components/campaigns/CampaignOptions", () => ({ default: () => <div>OPCIONES</div> }));
vi.mock("@/components/campaigns/CampaignUnsubscribes", () => ({ default: () => <div>BAJAS</div> }));
vi.mock("@/integrations/supabase/client", () => {
  const q: any = { select: () => q, eq: () => q, update: () => q, single: () => Promise.resolve({ data: { crm_enabled: false }, error: null }) };
  // La ficha pide la gráfica diaria (campaign_daily_sends) UNA vez al abrir Analítica.
  return { supabase: { from: () => q, rpc: () => Promise.resolve({ data: [], error: null }) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderDetail = (status = "draft", onToggleStatus = vi.fn()) =>
  render(<CampaignDetail campaign={{ id: "c1", name: "Mi campaña", status }} nameSlot={<h1>Mi campaña</h1>} onBack={vi.fn()} onToggleStatus={onToggleStatus} />);

describe("barra de la campaña", () => {
  it("abre en el Editor con las cuatro pestañas y el botón Lanzar", async () => {
    const onToggle = vi.fn();
    renderDetail("draft", onToggle);
    expect(await screen.findByText("EDITOR")).toBeInTheDocument();
    for (const t of ["Analítica", "Editor", "Leads", "Ajustes"]) expect(screen.getByRole("button", { name: t })).toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Lanzar/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("activa se pausa y pausada se reanuda", () => {
    const { unmount } = renderDetail("active");
    expect(screen.getByRole("button", { name: /Pausar/ })).toBeInTheDocument();
    unmount();
    renderDetail("paused");
    expect(screen.getByRole("button", { name: /Reanudar/ })).toBeInTheDocument();
  });

  it("todas las secciones de antes siguen estando", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Analítica" }));
    expect(await screen.findByText("RESUMEN")).toBeInTheDocument();
    expect(screen.getByText("INFORME")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviados" }));
    expect(await screen.findByText("ENVIADOS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    for (const [tab, txt] of [["Cuentas", "CUENTAS"], ["Horario", "HORARIO"], ["Opciones", "OPCIONES"], ["Bajas", "BAJAS"]]) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      expect(await screen.findByText(txt)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Leads" }));
    expect(await screen.findByText("LEADS")).toBeInTheDocument();
  });

  it("Vista previa se la pasa al editor", async () => {
    renderDetail();
    await screen.findByText("EDITOR");
    fireEvent.click(screen.getByRole("button", { name: /Vista previa/ }));
    await waitFor(() => expect(seqProps[seqProps.length - 1].preview).toBe(true));
  });
});
