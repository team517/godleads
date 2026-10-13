import { describe, expect, it } from "vitest";
import { campaignStatRows, rowsFor, sumFieldFor, totalsFor, type CampaignBreakdown } from "@/lib/campaign-totals";
import { pickerLabel } from "@/components/stats/CampaignPicker";

// Las seis campañas de support@ del 07-10-2026 (contactados = leads escritos, como la tabla).
const b: CampaignBreakdown = {
  rows: [
    { campaign_id: "xavi", sent: 248, contacted: 248, replied: 10, bounced: 11, opened: 3, sender_bounced: 1 },
    { campaign_id: "samuel", sent: 449, contacted: 361, replied: 12, bounced: 10, opened: 0, sender_bounced: 2 },
    { campaign_id: "javi", sent: 440, contacted: 445, replied: 9, bounced: 17, opened: 0, sender_bounced: 0 },
    { campaign_id: "erik", sent: 399, contacted: 402, replied: 8, bounced: 19, opened: 1, sender_bounced: 0 },
    { campaign_id: "juan", sent: 643, contacted: 650, replied: 10, bounced: 29, opened: 0, sender_bounced: 4 },
    { campaign_id: "lucy", sent: 436, contacted: 440, replied: 5, bounced: 24, opened: 0, sender_bounced: 0 },
  ],
  extra: {},
  leadsSent: { xavi: 248, samuel: 361, javi: 445, erik: 402, juan: 650, lucy: 440 },
};

describe("Estadísticas segmentadas por campañas", () => {
  it("sin selección son todas: la media de las 6 es 2,34 %", () => {
    const t = totalsFor(b, [])!;
    expect(t.campaigns).toBe(6);
    expect(t.contacted).toBe(2546);
    expect(t.replied).toBe(54);
    expect(t.avgRate).toBeCloseTo(2.3406, 3);
    expect(totalsFor(b, null)!.campaigns).toBe(6);
  });

  it("una campaña: sus cifras y su %", () => {
    const t = totalsFor(b, ["samuel"])!;
    expect(t).toMatchObject({ sent: 449, contacted: 361, replied: 12, bounced: 10, campaigns: 1 });
    expect(t.avgRate).toBeCloseTo((12 / 361) * 100, 6);
  });

  it("varias campañas: sumas y media de SUS %", () => {
    const t = totalsFor(b, ["xavi", "lucy"])!;
    expect(t).toMatchObject({ contacted: 688, replied: 15, campaigns: 2 });
    expect(t.avgRate).toBeCloseTo(((10 / 248) * 100 + (5 / 440) * 100) / 2, 6);
  });

  it("un id que no existe no suma nada; sin datos todavía = null", () => {
    expect(rowsFor(b, ["borrada"])).toEqual([]);
    expect(totalsFor(b, ["borrada"])!.campaigns).toBe(0);
    expect(totalsFor(null, ["xavi"])).toBeNull();
  });

  it("abiertos y fallidos de las elegidas", () => {
    expect(sumFieldFor(b, ["xavi", "erik"], "opened")).toBe(4);
    expect(sumFieldFor(b, ["juan", "samuel"], "sender_bounced")).toBe(6);
    expect(sumFieldFor(b, [], "sender_bounced")).toBe(7);
  });

  it("filas por campaña con su %", () => {
    const rows = campaignStatRows(b, ["xavi", "juan"]);
    expect(rows.map((r) => r.id)).toEqual(["xavi", "juan"]);
    expect(rows[0]).toMatchObject({ contacted: 248, replied: 10, sent: 248, bounced: 11 });
    expect(rows[0].pct).toBeCloseTo(4.0323, 3);
  });

  it("texto del selector", () => {
    const cs = [{ id: "a", name: "LUCY onepulso" }, { id: "b", name: "ERIK onepulso" }];
    expect(pickerLabel(cs, [])).toBe("Todas las campañas");
    expect(pickerLabel(cs, ["a"])).toBe("LUCY onepulso");
    expect(pickerLabel(cs, ["a", "b"])).toBe("2 campañas");
  });
});
