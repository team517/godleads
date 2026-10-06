import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import CampaignsTable, { type CampaignMetrics } from "@/components/campaigns/CampaignsTable";
import type { CampaignHealthRow } from "@/lib/campaign-health";

const campaigns = [
  { id: "c1", name: "Prospección Q1", status: "active", created_at: "2026-01-15T09:30:00Z" },
  { id: "c2", name: "Retargeting SaaS", status: "paused", created_at: "2026-02-02T11:00:00Z" },
];
const progressMap = { c1: { sent: 50, total: 200 }, c2: { sent: 10, total: 40 } };

const split: CampaignMetrics = { sent: 100, contacted: 50, opened: 40, replied: 22, repliedHuman: 10, repliedAuto: 12, sentUnconfirmed: 2, positive: 5, bounced: 6, sequences: 3 };
const legacy: CampaignMetrics = { sent: 20, contacted: 10, opened: 5, replied: 2, positive: 1, bounced: 0, sequences: 1 };

const health = (over: Partial<CampaignHealthRow> = {}): CampaignHealthRow => ({
  campaign_id: "c1", pending_leads: 10, in_progress_leads: 0, total_accounts: 3, connected_accounts: 3, sendable_accounts: 3,
  sent_today: 0, day_cap: 90, in_window: true, minutes_into_window: 100, last_sent_at: null, sent_24h: 5, ...over,
});

function renderTable(metrics: Record<string, CampaignMetrics>, healthFor?: (id: string) => CampaignHealthRow | null) {
  render(
    <CampaignsTable
      campaigns={campaigns}
      progressMap={progressMap}
      metricsFor={(id) => metrics[id] ?? null}
      healthFor={healthFor}
      onSelect={vi.fn()} onToggleStatus={vi.fn()} onDuplicate={vi.fn()} onRemix={vi.fn()} onDelete={vi.fn()}
    />,
  );
}
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("CampaignsTable — el panel dice la verdad", () => {
  it("«Respondidos» es una sola cifra con las automáticas incluidas (sin «+N automáticas»)", () => {
    renderTable({ c1: split, c2: legacy });
    expect(screen.getByRole("columnheader", { name: /Respondidos/ })).toBeInTheDocument();
    const row = rowOf("Prospección Q1");
    expect(within(row).queryByText(/automática/)).not.toBeInTheDocument();
    // replied (22, ya incluye las automáticas) ÷ 50 contactados = 44 %.
    expect(within(row).getByText("22")).toBeInTheDocument();
    expect(within(row).getByText("44.0%")).toBeInTheDocument();
  });

  it("el % nunca pasa de 100 (más respuestas que contactados en una prueba)", () => {
    renderTable({ c1: { ...split, replied: 80 }, c2: legacy });
    expect(within(rowOf("Prospección Q1")).getByText("100.0%")).toBeInTheDocument();
  });

  it("sin el desglose (RPC sin aplicar) se ve la cifra de siempre y sin «+N»", () => {
    renderTable({ c1: split, c2: legacy });
    const row = rowOf("Retargeting SaaS");
    expect(within(row).queryByText(/automática/)).not.toBeInTheDocument();
    expect(within(row).getByText("20.0%")).toBeInTheDocument(); // 2 ÷ 10
  });

  it("«Enviados» explica que son aceptados por el servidor y cuenta los sin confirmar", () => {
    renderTable({ c1: split, c2: legacy });
    const cell = within(rowOf("Prospección Q1")).getByText("100").closest("[title]") as HTMLElement;
    expect(cell.getAttribute("title")).toMatch(/Aceptados por el servidor/);
    expect(cell.getAttribute("title")).toMatch(/2 de 100/);
  });

  it("chip junto a «Activa» sólo en campañas activas con problema", () => {
    renderTable({ c1: split, c2: legacy }, (id) => (id === "c1" ? health({ connected_accounts: 0, sendable_accounts: 0 }) : health({ connected_accounts: 0 })));
    expect(within(rowOf("Prospección Q1")).getByText("Sin buzones")).toBeInTheDocument();
    // La pausada no lleva chip aunque sus datos fueran malos.
    expect(within(rowOf("Retargeting SaaS")).queryByText("Sin buzones")).not.toBeInTheDocument();
  });

  it("campaña sana: sin chip; sin datos de salud: sin chip", () => {
    renderTable({ c1: split, c2: legacy }, () => health());
    expect(within(rowOf("Prospección Q1")).queryByText(/Sin buzones|Fuera de horario|Tope diario|Sin leads|Sin envíos/)).not.toBeInTheDocument();
  });

  it("fuera de horario usa el chip informativo", () => {
    renderTable({ c1: split, c2: legacy }, (id) => (id === "c1" ? health({ in_window: false, minutes_into_window: null }) : null));
    expect(within(rowOf("Prospección Q1")).getByText("Fuera de horario")).toBeInTheDocument();
  });
});
