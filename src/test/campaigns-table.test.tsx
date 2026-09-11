import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import CampaignsTable, { type CampaignMetrics } from "@/components/campaigns/CampaignsTable";

const campaigns = [
  { id: "c1", name: "Prospección Q1", status: "active", created_at: "2026-01-15T09:30:00Z", manager_id: "m1" },
  { id: "c2", name: "Retargeting SaaS", status: "paused", created_at: "2026-02-02T11:00:00Z" },
  { id: "c3", name: "Borrador interno", status: "draft", created_at: "2026-03-01T08:00:00Z" },
];

const progressMap = {
  c1: { sent: 50, total: 200 },
  c2: { sent: 10, total: 40 },
  c3: { sent: 0, total: 0 },
};

const metrics: Record<string, CampaignMetrics> = {
  c1: { sent: 100, contacted: 50, opened: 40, replied: 10, positive: 5, bounced: 6, sequences: 3 },
  c2: { sent: 20, contacted: 10, opened: 5, replied: 2, positive: 1, bounced: 0, sequences: 1 },
};

function renderTable(over: Partial<React.ComponentProps<typeof CampaignsTable>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onToggleStatus: vi.fn(),
    onDuplicate: vi.fn(),
    onRemix: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <CampaignsTable
      campaigns={campaigns}
      managers={[{ id: "m1", name: "Ana", color: "#7A5AF8" }]}
      progressMap={progressMap}
      metricsFor={(id) => metrics[id] ?? null}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("CampaignsTable", () => {
  it("cuenta las pestañas sobre la lista COMPLETA y muestra los estados en español", () => {
    renderTable();
    expect(screen.getByRole("tab", { name: "Todas (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activas (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pausadas (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Borradores (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Completadas (0)" })).toBeInTheDocument();
    expect(within(rowOf("Prospección Q1")).getByText("Activa")).toBeInTheDocument();
    expect(within(rowOf("Retargeting SaaS")).getByText("Pausada")).toBeInTheDocument();
  });

  it("filtra por pestaña sin cambiar los contadores", () => {
    renderTable();
    fireEvent.click(screen.getByRole("tab", { name: "Pausadas (1)" }));
    expect(screen.queryByText("Prospección Q1")).not.toBeInTheDocument();
    expect(screen.getByText("Retargeting SaaS")).toBeInTheDocument();
    // los contadores siguen siendo los de la lista completa
    expect(screen.getByRole("tab", { name: "Todas (3)" })).toBeInTheDocument();
  });

  it("busca por nombre y avisa cuando no hay coincidencias", () => {
    renderTable();
    fireEvent.change(screen.getByLabelText("Buscar campaña"), { target: { value: "retarget" } });
    expect(screen.getByText("Retargeting SaaS")).toBeInTheDocument();
    expect(screen.queryByText("Prospección Q1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar campaña"), { target: { value: "zzz" } });
    expect(screen.getByText(/Ninguna campaña coincide/)).toBeInTheDocument();
  });

  it("muestra leads, métricas y porcentajes (respondidos sobre contactados)", () => {
    renderTable();
    const row = rowOf("Prospección Q1");
    expect(within(row).getByText("200")).toBeInTheDocument();   // leads totales
    expect(within(row).getByText("100")).toBeInTheDocument();   // enviados
    expect(within(row).getByText("40.0%")).toBeInTheDocument(); // abiertos / enviados
    expect(within(row).getByText("20.0%")).toBeInTheDocument(); // respondidos / contactados (10/50)
    expect(within(row).getByText("50.0%")).toBeInTheDocument(); // positivos / respondidos (5/10)
    expect(within(row).getByText("3 secuencias", { exact: false })).toBeInTheDocument();
    // rebote 6/100 = 6% > 2% → aviso
    expect(within(row).getByLabelText("Tasa de rebote alta")).toBeInTheDocument();
    expect(within(rowOf("Retargeting SaaS")).queryByLabelText("Tasa de rebote alta")).not.toBeInTheDocument();
  });

  it("muestra — cuando las métricas aún no han cargado", () => {
    renderTable();
    const row = rowOf("Borrador interno");
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("conserva todas las acciones y no abre la campaña al pulsarlas", () => {
    const h = renderTable();
    const row = rowOf("Prospección Q1");
    fireEvent.click(within(row).getByLabelText("Pausar la campaña Prospección Q1"));
    fireEvent.click(within(row).getByLabelText("Duplicar la campaña Prospección Q1"));
    fireEvent.click(within(row).getByLabelText("Remix — fusionar otra campaña en Prospección Q1"));
    fireEvent.click(within(row).getByLabelText("Eliminar la campaña Prospección Q1"));
    expect(h.onToggleStatus).toHaveBeenCalledWith(campaigns[0]);
    expect(h.onDuplicate).toHaveBeenCalledWith(campaigns[0]);
    expect(h.onRemix).toHaveBeenCalledWith(campaigns[0]);
    expect(h.onDelete).toHaveBeenCalledWith("c1");
    expect(h.onSelect).not.toHaveBeenCalled();
    // la fila sí abre la campaña
    fireEvent.click(within(row).getByText("Prospección Q1"));
    expect(h.onSelect).toHaveBeenCalledWith("c1");
  });

  it("muestra el responsable de la campaña", () => {
    renderTable();
    expect(within(rowOf("Prospección Q1")).getByText("Ana")).toBeInTheDocument();
  });
});
