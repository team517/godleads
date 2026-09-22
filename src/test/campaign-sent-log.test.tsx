import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/* El registro de envíos de una campaña pedía TODOS los correos con su HTML (la API los cortaba en
 * 1.000 y eran MB por pestaña). Ahora: 100 por página, y el cuerpo sólo al abrir un correo. */

const calls: { table: string; select: string; range?: [number, number]; eq?: [string, string] }[] = [];
const EMAILS = Array.from({ length: 250 }, (_, i) => ({
  id: `e${i}`, to_email: `p${i}@x.es`, subject: `Asunto ${i}`, status: "sent", sent_at: new Date(Date.now() - i * 60000).toISOString(),
  replied_at: null, opened_at: null, bounced_at: null, error_message: null, campaign_step_id: "s0", lead_id: null, account_id: "a1", transport: "smtp",
}));

vi.mock("@/integrations/supabase/client", () => {
  const q = (table: string, select: string) => {
    const rec: any = { table, select };
    calls.push(rec);
    const b: any = {};
    for (const m of ["order"]) b[m] = () => b;
    b.eq = (c: string, v: string) => { rec.eq = [c, v]; return b; };
    b.range = (a: number, z: number) => { rec.range = [a, z]; return b; };
    b.maybeSingle = () => { rec.single = true; return b; };
    b.then = (res: any) => {
      if (table === "sent_emails" && rec.single) return res({ data: { body: `<p>Cuerpo de ${rec.eq?.[1]}</p>` }, error: null });
      if (table === "sent_emails") { const [a, z] = rec.range || [0, 999]; return res({ data: EMAILS.slice(a, z + 1), count: EMAILS.length, error: null }); }
      if (table === "campaign_steps") return res({ data: [{ id: "s0", step_order: 0, subject: "Asunto", delay_days: 0 }], error: null });
      if (table === "email_accounts") return res({ data: [{ id: "a1", email: "buzon@x.es" }], error: null });
      return res({ data: [], error: null });
    };
    return b;
  };
  return { supabase: { from: (t: string) => ({ select: (s: string) => q(t, s) }) } };
});

import CampaignSentLog from "@/components/campaigns/CampaignSentLog";

beforeEach(() => { calls.length = 0; });

describe("Registro de envíos de la campaña", () => {
  it("pide 100 por página, SIN el cuerpo, y dice el total real", async () => {
    render(<CampaignSentLog campaignId="c1" />);
    await screen.findByText("p0@x.es");
    const list = calls.find((c) => c.table === "sent_emails")!;
    expect(list.range).toEqual([0, 99]);
    expect(list.select).not.toMatch(/\bbody\b/);
    expect(screen.getByText(/250 emails enviados · mostrando 1–100/)).toBeInTheDocument();
    expect(screen.queryByText("p100@x.es")).not.toBeInTheDocument();
  });

  it("la página 2 pide las 100 siguientes", async () => {
    render(<CampaignSentLog campaignId="c1" />);
    await screen.findByText("p0@x.es");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await screen.findByText("p100@x.es");
    const list = calls.filter((c) => c.table === "sent_emails").pop()!;
    expect(list.range).toEqual([100, 199]);
  });

  it("el cuerpo se trae sólo al abrir ese correo", async () => {
    render(<CampaignSentLog campaignId="c1" />);
    await screen.findByText("p3@x.es");
    expect(calls.some((c) => c.table === "sent_emails" && c.select === "body")).toBe(false);
    fireEvent.click(screen.getByText("p3@x.es"));
    await waitFor(() => expect(screen.getByText("Cuerpo de e3")).toBeInTheDocument());
    const bodyCalls = calls.filter((c) => c.table === "sent_emails" && c.select === "body");
    expect(bodyCalls).toHaveLength(1);
    expect(bodyCalls[0].eq).toEqual(["id", "e3"]);
  });
});
