import { describe, expect, it, vi } from "vitest";
import {
  autoRepliesLabel, campaignHealthReason, fetchCampaignHealth, fetchMetricsExtra, repliesView, sentTooltip, sumMetricsExtra,
  type CampaignHealthRow,
} from "@/lib/campaign-health";

const ok = (over: Partial<CampaignHealthRow> = {}): CampaignHealthRow => ({
  campaign_id: "c1", pending_leads: 500, in_progress_leads: 20,
  total_accounts: 10, connected_accounts: 10, sendable_accounts: 8,
  sent_today: 40, day_cap: 270, in_window: true, minutes_into_window: 120,
  last_sent_at: "2026-10-06T11:00:00Z", sent_24h: 120, ...over,
});

describe("campaignHealthReason — por qué una campaña Activa no envía", () => {
  it("sano = sin chip", () => expect(campaignHealthReason("active", ok())).toBeNull());
  it("sólo mira campañas activas y con datos", () => {
    expect(campaignHealthReason("paused", ok({ connected_accounts: 0 }))).toBeNull();
    expect(campaignHealthReason("draft", ok({ connected_accounts: 0 }))).toBeNull();
    expect(campaignHealthReason("active", null)).toBeNull();
    expect(campaignHealthReason("active", undefined)).toBeNull();
  });
  it("sin buzones conectados", () => {
    const r = campaignHealthReason("active", ok({ connected_accounts: 0, sendable_accounts: 0 }));
    expect(r?.key).toBe("no_mailboxes");
    expect(r?.label).toBe("Sin buzones");
    expect(r?.tone).toBe("warn");
    expect(r?.title).toMatch(/ninguno de los 10 buzones/i);
  });
  it("sin buzones asignados del todo", () => {
    const r = campaignHealthReason("active", ok({ total_accounts: 0, connected_accounts: 0, sendable_accounts: 0 }));
    expect(r?.title).toMatch(/no tiene buzones asignados/i);
  });
  it("fuera de horario (informativo, no alarma)", () => {
    const r = campaignHealthReason("active", ok({ in_window: false, minutes_into_window: null }));
    expect(r?.key).toBe("off_hours");
    expect(r?.label).toBe("Fuera de horario");
    expect(r?.tone).toBe("muted");
  });
  it("tope diario: todos los buzones llenos", () => {
    expect(campaignHealthReason("active", ok({ sendable_accounts: 0 }))?.label).toBe("Tope diario alcanzado");
  });
  it("tope diario: la campaña llegó a su tope del día", () => {
    const r = campaignHealthReason("active", ok({ sent_today: 270, day_cap: 270 }));
    expect(r?.key).toBe("daily_cap");
    expect(r?.title).toMatch(/270 de 270/);
  });
  it("tope desconocido (0) no se toma por alcanzado", () => {
    expect(campaignHealthReason("active", ok({ day_cap: 0, sent_today: 50 }))).toBeNull();
  });
  it("sin leads pendientes ni en secuencia", () => {
    const r = campaignHealthReason("active", ok({ pending_leads: 0, in_progress_leads: 0 }));
    expect(r?.key).toBe("no_leads");
    expect(r?.label).toBe("Sin leads pendientes");
  });
  it("seguimientos en secuencia cuentan como trabajo", () => {
    expect(campaignHealthReason("active", ok({ pending_leads: 0, in_progress_leads: 5 }))).toBeNull();
  });
  it("sin envíos en 24 h con todo lo demás en orden", () => {
    const r = campaignHealthReason("active", ok({ sent_24h: 0, minutes_into_window: 200 }));
    expect(r?.key).toBe("no_sends_24h");
    expect(r?.label).toBe("Sin envíos en 24 h");
  });
  it("recién abierta la franja no se da la alarma (el motor aún no ha pasado)", () => {
    expect(campaignHealthReason("active", ok({ sent_24h: 0, minutes_into_window: 10 }))).toBeNull();
  });
  it("sin envíos y sin último envío conocido", () => {
    const r = campaignHealthReason("active", ok({ sent_24h: 0, last_sent_at: null }));
    expect(r?.title).toMatch(/no ha enviado nada todavía/i);
  });
  it("gana la primera razón, en el orden pedido", () => {
    // Sin buzones gana a todo lo demás.
    expect(campaignHealthReason("active", ok({ connected_accounts: 0, in_window: false, pending_leads: 0, in_progress_leads: 0 }))?.key).toBe("no_mailboxes");
    // Fuera de horario gana al tope, a los leads y a "sin envíos".
    expect(campaignHealthReason("active", ok({ in_window: false, sendable_accounts: 0, pending_leads: 0, in_progress_leads: 0, sent_24h: 0 }))?.key).toBe("off_hours");
    // Tope gana a sin leads.
    expect(campaignHealthReason("active", ok({ sendable_accounts: 0, pending_leads: 0, in_progress_leads: 0 }))?.key).toBe("daily_cap");
    // Sin leads gana a sin envíos.
    expect(campaignHealthReason("active", ok({ pending_leads: 0, in_progress_leads: 0, sent_24h: 0 }))?.key).toBe("no_leads");
  });
});

describe("repliesView — Respondidos = todos los que contestan, en una cifra (06-10-2026)", () => {
  it("con desglose: humanas + automáticas, sin «+N» aparte", () => {
    expect(repliesView({ replied: 22, repliedHuman: 10, repliedAuto: 12 })).toEqual({ shown: 22, auto: 0, split: false });
  });
  it("sin desglose (migración sin aplicar): la cifra de siempre", () => {
    expect(repliesView({ replied: 22 })).toEqual({ shown: 22, auto: 0, split: false });
  });
  it("nunca por debajo de replied", () => {
    expect(repliesView({ replied: 9, repliedHuman: 3, repliedAuto: 4 })).toEqual({ shown: 9, auto: 0, split: false });
  });
  it("sin métricas", () => expect(repliesView(null)).toEqual({ shown: 0, auto: 0, split: false }));
  it("etiqueta en singular y plural", () => {
    expect(autoRepliesLabel(0)).toBe("");
    expect(autoRepliesLabel(1)).toBe("+1 automática");
    expect(autoRepliesLabel(12)).toBe("+12 automáticas");
  });
});

describe("sentTooltip — Enviados = aceptados por el servidor", () => {
  it("explica que no es entrega", () => expect(sentTooltip(100, 0)).toMatch(/Aceptados por el servidor/));
  it("cuenta los sin confirmar", () => expect(sentTooltip(100, 3)).toMatch(/3 de 100 se dieron por enviados sin confirmación/));
});

describe("lectores de RPC", () => {
  it("fetchCampaignHealth normaliza filas y tolera fallos", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ campaign_id: "c1", pending_leads: "12", in_progress_leads: 3, total_accounts: 4, connected_accounts: 4, sendable_accounts: 2, sent_today: 9, day_cap: 60, in_window: true, minutes_into_window: 77, last_sent_at: "2026-10-06T09:00:00Z", sent_24h: 30 }],
      error: null,
    }));
    const m = await fetchCampaignHealth({ rpc });
    expect(rpc).toHaveBeenCalledWith("campaign_health_mine", {});
    expect(m.c1.pending_leads).toBe(12);
    expect(m.c1.in_window).toBe(true);
    const bad = await fetchCampaignHealth({ rpc: async () => ({ data: null, error: { message: "boom" } }) });
    expect(bad).toEqual({});
    const missing = await fetchCampaignHealth({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) });
    expect(missing).toEqual({});
  });

  it("fetchMetricsExtra + sumMetricsExtra", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { campaign_id: "a", replied_human: 10, replied_auto: 12, sent_unconfirmed: 0 },
        { campaign_id: "b", replied_human: "5", replied_auto: 1, sent_unconfirmed: 2 },
      ],
      error: null,
    }));
    const m = await fetchMetricsExtra({ rpc });
    expect(m.b).toEqual({ repliedHuman: 5, repliedAuto: 1, sentUnconfirmed: 2 });
    expect(sumMetricsExtra(m)).toEqual({ human: 15, auto: 13 });
    expect(sumMetricsExtra({})).toBeNull();
    expect(await fetchMetricsExtra({ rpc: async () => ({ data: null, error: { message: "x" } }) })).toEqual({});
  });
});
