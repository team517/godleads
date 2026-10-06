import { describe, expect, it } from "vitest";
import { globalReplyRate, sumCampaignTotals } from "@/lib/campaign-totals";

/* Estadísticas globales (06-10-2026): la tasa salía 0,1 % porque dividía las respuestas de las
   campañas entre todos los destinatarios de siempre. Ahora = suma de las cifras de cada campaña. */
describe("totales globales de las campañas", () => {
  const rows = [
    { campaign_id: "a", sent: 228, contacted: 229, replied: 3, bounced: 9 },
    { campaign_id: "b", sent: 211, contacted: 211, replied: 5, bounced: 13 },
    { campaign_id: "c", sent: 124, contacted: 123, replied: 5, bounced: 4 },
  ];
  it("suma enviados, contactados, respondidos y rebotados", () => {
    expect(sumCampaignTotals(rows)).toEqual({ sent: 563, contacted: 563, replied: 13, bounced: 26, campaigns: 3 });
  });
  it("respondidos con desglose = humanas + automáticas", () => {
    const t = sumCampaignTotals(rows, { a: { repliedHuman: 2, repliedAuto: 1, sentUnconfirmed: 0 }, b: { repliedHuman: 0, repliedAuto: 6, sentUnconfirmed: 0 } });
    expect(t.replied).toBe(3 + 6 + 5);
  });
  it("tasa = total respondidos ÷ total contactados, no la media de porcentajes", () => {
    // Media de porcentajes daría (50 % + 0 %) / 2 = 25 %; la tasa real es 1 / 102.
    const t = sumCampaignTotals([{ campaign_id: "x", contacted: 2, replied: 1 }, { campaign_id: "y", contacted: 100, replied: 0 }]);
    expect(globalReplyRate(t).toFixed(2)).toBe("0.98");
    expect(globalReplyRate({ replied: 0, contacted: 0 })).toBe(0);
  });
  it("sin filas: ceros", () => {
    expect(sumCampaignTotals(null)).toEqual({ sent: 0, contacted: 0, replied: 0, bounced: 0, campaigns: 0 });
  });
});
