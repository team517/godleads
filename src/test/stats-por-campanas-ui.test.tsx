import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* Estadísticas segmentadas por campañas (13-10-2026): el selector filtra tarjetas, gráfica y tabla. */

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const DAY = [{ day: "2026-10-13", sends: 10, new_leads: 4, followups: 6, replies: 1 }];

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

vi.mock("@/integrations/supabase/client", () => {
  const rpc = (name: string, args: Record<string, unknown>) => {
    // cached_rpc (31-10-2026) devuelve lo mismo que la función que guarda: se resuelve igual que el servidor.
    const key = name === "cached_rpc" ? String(args.p_key) : "";
    const fn = key ? (key.startsWith("user_daily_sends:") ? "user_daily_sends" : key) : name;
    rpcCalls.push({ fn, args });
    const data =
      fn === "user_email_stats" ? { sent: 9999, contacted: 9999, bounced: 0, opened: 0, replied: 0, failed: 0 }
      : fn === "campaign_metrics_v2" ? [
          { campaign_id: "c1", sent: 449, contacted: 361, replied: 12, bounced: 10, opened: 0, sender_bounced: 2 },
          { campaign_id: "c2", sent: 436, contacted: 440, replied: 5, bounced: 24, opened: 0, sender_bounced: 0 },
        ]
      : fn === "campaign_metrics_extra" ? []
      : fn === "campaign_lead_counts" ? [{ campaign_id: "c1", leads_sent: 361 }, { campaign_id: "c2", leads_sent: 440 }]
      : DAY;
    return Promise.resolve({ data, error: null });
  };
  const from = () => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
    b.then = (res: any) => res({ data: [{ id: "c1", name: "SAMUEL ONEPULSO", status: "active" }, { id: "c2", name: "LUCY onepulso", status: "active" }], error: null });
    return b;
  };
  return { supabase: { rpc, from } };
});

import Stats from "@/pages/Stats";

beforeEach(() => { rpcCalls.length = 0; localStorage.clear(); });

const renderStats = () => render(<MemoryRouter><Stats /></MemoryRouter>);

describe("Estadísticas: segmentar por campañas", () => {
  it("por defecto son todas: suma de las dos y la media de sus %", async () => {
    renderStats();
    await screen.findByRole("button", { name: /Todas las campañas/ });
    await waitFor(() => expect(screen.getByText("801")).toBeInTheDocument()); // 361 + 440 contactados
    // media de 3,32 % y 1,14 % = 2,2 %
    expect(screen.getByText("2.2%")).toBeInTheDocument();
    expect(screen.getByText("Por campaña")).toBeInTheDocument();
    expect(rpcCalls.some((c) => c.fn === "user_daily_sends")).toBe(true);
  });

  it("al elegir una campaña: sus cifras, su gráfica y se recuerda", async () => {
    renderStats();
    fireEvent.click(await screen.findByRole("button", { name: /Todas las campañas/ }));
    fireEvent.click(await screen.findByRole("option", { name: /SAMUEL ONEPULSO/ }));
    await waitFor(() => expect(screen.getByText("361")).toBeInTheDocument());
    expect(screen.getByText("3.3%")).toBeInTheDocument(); // 12 / 361
    expect(screen.queryByText("Por campaña")).not.toBeInTheDocument(); // con una sola no hace falta tabla
    await waitFor(() => {
      const daily = rpcCalls.filter((c) => c.fn === "campaigns_daily_sends").pop();
      expect(daily?.args).toEqual({ p_campaign_ids: ["c1"], p_days: 14 });
    });
    expect(JSON.parse(localStorage.getItem("op_stats_campaigns:u1") || "[]")).toEqual(["c1"]);
  });

  it("«Todas» quita el filtro", async () => {
    localStorage.setItem("op_stats_campaigns:u1", JSON.stringify(["c2"]));
    renderStats();
    const btn = await screen.findByRole("button", { name: /LUCY onepulso/ });
    fireEvent.click(btn);
    const pop = await screen.findByRole("listbox");
    fireEvent.click(within(pop.parentElement!).getByRole("button", { name: "Todas" }));
    await screen.findByRole("button", { name: /Todas las campañas/ });
    expect(JSON.parse(localStorage.getItem("op_stats_campaigns:u1") || "[]")).toEqual([]);
  });
});
