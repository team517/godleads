import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CampaignEmailAccounts from "@/components/campaigns/CampaignEmailAccounts";

/** Mutable fixtures — each test tweaks them before rendering. */
const db = vi.hoisted(() => ({
  campaign: null as any,
  stats: [] as any[],
  accounts: [] as any[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const ok = (data: any) => Promise.resolve({ data, error: null });
  /** Minimal chainable PostgREST stub: select/eq chain, in/single resolve. */
  const query = (data: () => any) => {
    const q: any = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => ok(data());
    q.single = () => ok(data());
    return q;
  };
  return {
    supabase: {
      from: (table: string) => (table === "campaigns" ? query(() => db.campaign) : query(() => db.accounts)),
      rpc: () => ok(db.stats),
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const stat = (over: Record<string, any>) => ({
  in_campaign_direct: false,
  in_campaign_by_tag: false,
  leads_assigned: 0,
  sent_total: 0,
  sent_today: 0,
  replied: 0,
  bounced: 0,
  campaigns_total: 0,
  campaigns_active: 0,
  ...over,
});

const account = (over: Record<string, any>) => ({
  status: "connected",
  daily_limit: 30,
  sent_today: 0,
  warmup_enabled: false,
  warmup_started_at: null,
  warmup_score: null,
  tags: [],
  last_error: null,
  ...over,
});

beforeEach(() => {
  db.campaign = { id: "c1", name: "Prospección Q1", status: "active", account_tags: ["ventas"] };
  db.stats = [
    stat({
      account_id: "a1",
      in_campaign_by_tag: true,
      leads_assigned: 40,
      sent_total: 120,
      sent_today: 29,
      replied: 8,
      bounced: 1,
      campaigns_total: 2,
      campaigns_active: 1,
    }),
    stat({ account_id: "a2", in_campaign_direct: true, leads_assigned: 0, sent_total: 0 }),
  ];
  db.accounts = [
    account({ id: "a1", email: "ana@onepulso.es", first_name: "Ana", last_name: "Gómez", sent_today: 29, tags: ["ventas"] }),
    account({ id: "a2", email: "beto@onepulso.es", first_name: "Beto", last_name: "Ruiz", status: "auth_failed", last_error: "LOGIN failed" }),
  ];
});

const rowOf = async (text: string) => (await screen.findByText(text)).closest("tr") as HTMLElement;

describe("CampaignEmailAccounts", () => {
  it("lista las cuentas de la campaña con nombre y email", async () => {
    render(<CampaignEmailAccounts campaignId="c1" />);
    expect(await screen.findByText("Ana Gómez")).toBeInTheDocument();
    expect(screen.getByText("ana@onepulso.es")).toBeInTheDocument();
    expect(screen.getByText("Beto Ruiz")).toBeInTheDocument();
    expect(screen.getByText("beto@onepulso.es")).toBeInTheDocument();
  });

  it("muestra «Preparada» para una cuenta conectada y «Error» para auth_failed", async () => {
    render(<CampaignEmailAccounts campaignId="c1" />);
    expect(within(await rowOf("Ana Gómez")).getByText("Preparada")).toBeInTheDocument();
    expect(within(await rowOf("Beto Ruiz")).getByText("Error")).toBeInTheDocument();
  });

  it("muestra el uso del límite diario como «29 / 30» y «97%»", async () => {
    render(<CampaignEmailAccounts campaignId="c1" />);
    const row = await rowOf("Ana Gómez");
    expect(within(row).getByText("29 / 30")).toBeInTheDocument();
    expect(within(row).getByText("97%")).toBeInTheDocument();
  });

  it("muestra el estado compartido de campañas y los leads asignados", async () => {
    render(<CampaignEmailAccounts campaignId="c1" />);
    const row = await rowOf("Ana Gómez");
    expect(within(row).getByText("Total 2")).toBeInTheDocument();
    expect(within(row).getByText("Activas 1")).toBeInTheDocument();
    expect(within(row).getByText("40")).toBeInTheDocument();   // leads asignados
    expect(within(row).getByText("120")).toBeInTheDocument();  // enviados desde esta cuenta
  });

  it("muestra el estado vacío cuando la campaña no tiene cuentas", async () => {
    db.stats = [];
    db.accounts = [];
    render(<CampaignEmailAccounts campaignId="c1" />);
    expect(
      await screen.findByText(
        "Esta campaña aún no tiene cuentas. Asígnalas por etiqueta o una a una en la pestaña Opciones.",
      ),
    ).toBeInTheDocument();
  });
});
