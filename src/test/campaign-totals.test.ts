import { describe, expect, it } from "vitest";
import { globalReplyRate, sumCampaignTotals } from "@/lib/campaign-totals";

/* Estadísticas globales (06-10-2026): la tasa salía 0,1 % porque dividía las respuestas de las
   campañas entre todos los destinatarios de siempre. Decisión del dueño: la tasa global es la MEDIA
   de los % de la columna «Respondidos» de Campañas; las tarjetas suman. */
describe("totales globales de las campañas", () => {
  const rows = [
    { campaign_id: "a", sent: 228, contacted: 229, replied: 3, bounced: 9 },
    { campaign_id: "b", sent: 211, contacted: 211, replied: 5, bounced: 13 },
    { campaign_id: "c", sent: 124, contacted: 123, replied: 5, bounced: 4 },
  ];
  it("suma enviados, contactados, respondidos y rebotados", () => {
    const t = sumCampaignTotals(rows);
    expect({ ...t, avgRate: undefined }).toEqual({ sent: 563, contacted: 563, replied: 13, bounced: 26, campaigns: 3, avgRate: undefined, ratedCampaigns: 3 });
  });
  it("contactados = leads ya escritos de cada campaña (como la columna de la tabla)", () => {
    const t = sumCampaignTotals(rows, null, { a: 250, b: 220, c: 130 });
    expect(t.contacted).toBe(600);
  });
  it("respondidos = replied de cada campaña; el desglose por mensajes no la infla", () => {
    const t = sumCampaignTotals(rows, { a: { repliedHuman: 2, repliedAuto: 1, sentUnconfirmed: 0 }, b: { repliedHuman: 40, repliedAuto: 6, sentUnconfirmed: 0 } });
    expect(t.replied).toBe(3 + 5 + 5);
  });
  it("hello@: una prueba con 1 contactado no dispara la media (antes 162,6 %)", () => {
    const camp = [
      { campaign_id: "pt", contacted: 479, replied: 18 }, { campaign_id: "es", contacted: 994, replied: 20 },
      { campaign_id: "it", contacted: 754, replied: 13 }, { campaign_id: "fr", contacted: 704, replied: 27 },
      { campaign_id: "prueba", contacted: 2, replied: 1 }, { campaign_id: "vacia", contacted: 0, replied: 0 },
    ];
    const lsent = { pt: 483, es: 1030, it: 759, fr: 689, prueba: 1, vacia: 0 };
    const t = sumCampaignTotals(camp, { prueba: { repliedHuman: 8, repliedAuto: 0, sentUnconfirmed: 0 } }, lsent);
    expect(t.ratedCampaigns).toBe(4);
    // (3,73 + 1,94 + 1,71 + 3,92) / 4 = 2,8 %
    expect(globalReplyRate(t).toFixed(1)).toBe("2.8");
  });
  it("tasa global = media de los % de cada campaña (la captura del dueño: 2,1 %)", () => {
    // 1,2 % · 2,7 % · 1,6 % · 1,1 % · 3,8 % · 2,0 %
    const camp = [[3, 250], [6, 222], [4, 250], [4, 364], [5, 132], [5, 250]].map(([r, c], i) => ({ campaign_id: `x${i}`, replied: r, contacted: c, sent: c }));
    expect(globalReplyRate(sumCampaignTotals(camp)).toFixed(1)).toBe("2.1");
  });
  it("las campañas sin contactados no cuentan en la media", () => {
    const t = sumCampaignTotals([{ campaign_id: "x", contacted: 100, replied: 2 }, { campaign_id: "y", contacted: 0, replied: 0 }]);
    expect(globalReplyRate(t)).toBe(2);
    expect(globalReplyRate(null)).toBe(0);
  });
  it("sin filas: ceros", () => {
    expect(sumCampaignTotals(null)).toEqual({ sent: 0, contacted: 0, replied: 0, bounced: 0, campaigns: 0, avgRate: 0, ratedCampaigns: 0 });
  });
});
