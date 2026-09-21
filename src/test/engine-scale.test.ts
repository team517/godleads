import { describe, expect, it } from "vitest";
import {
  chunkIds,
  IN_CHUNK,
  MAX_SENDS_PER_CAMPAIGN_PER_TICK,
  MIN_SENDS_PER_CAMPAIGN_PER_TICK,
  perTickCampaignCap,
  sortBySentToday,
} from "../../supabase/functions/_shared/engine-scale";

/* Campañas grandes (100k leads, cientos de buzones). El tope fijo de 4 correos por campaña y
 * pasada las dejaba en ~2.160/día; y pedir 900 cuentas en un solo `.in()` rompía la URL. */

const WINDOW_9H = 9 * 60;

describe("tope de envíos por campaña y pasada", () => {
  it("las campañas de hoy siguen EXACTAMENTE igual (4)", () => {
    // Las activas el 21-09-2026: entre 372 y 1.551 correos/día, ventana 9–18.
    for (const daily of [0, 50, 372, 834, 1014, 1200, 1326, 1400, 1551, 1728]) {
      expect(perTickCampaignCap(daily, WINDOW_9H)).toBe(MIN_SENDS_PER_CAMPAIGN_PER_TICK);
    }
  });

  it("una campaña con más capacidad recibe más huecos, en proporción", () => {
    expect(perTickCampaignCap(3000, WINDOW_9H)).toBe(7);    // 100 buzones a 30/día
    expect(perTickCampaignCap(6000, WINDOW_9H)).toBe(14);   // 200 buzones
    expect(perTickCampaignCap(9000, WINDOW_9H)).toBe(21);   // 300 buzones
  });

  it("nunca pasa del techo: siempre caben al menos 3 campañas por pasada", () => {
    expect(perTickCampaignCap(12000, WINDOW_9H)).toBe(MAX_SENDS_PER_CAMPAIGN_PER_TICK);
    expect(perTickCampaignCap(90000, WINDOW_9H)).toBe(MAX_SENDS_PER_CAMPAIGN_PER_TICK);
    expect(MAX_SENDS_PER_CAMPAIGN_PER_TICK * 3).toBeLessThanOrEqual(72);
  });

  it("el tope alcanza para gastar la capacidad del día dentro de la ventana", () => {
    for (const daily of [1200, 3000, 6000, 9000, 12000]) {
      expect(perTickCampaignCap(daily, WINDOW_9H) * WINDOW_9H).toBeGreaterThanOrEqual(daily);
    }
  });

  it("una ventana corta sube el ritmo; datos rotos caen al suelo, nunca a 0 ni a NaN", () => {
    expect(perTickCampaignCap(1200, 120)).toBe(13);
    for (const bad of [NaN, -5, Infinity, undefined as any, null as any]) {
      expect(perTickCampaignCap(bad, WINDOW_9H)).toBe(MIN_SENDS_PER_CAMPAIGN_PER_TICK);
      expect(perTickCampaignCap(1200, bad)).toBe(MIN_SENDS_PER_CAMPAIGN_PER_TICK);
    }
  });
});

describe("listas largas de ids", () => {
  it("trocea 898 cuentas en grupos que caben en la URL", () => {
    const ids = Array.from({ length: 898 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(5);
    expect(chunks.every((c) => c.length <= IN_CHUNK)).toBe(true);
    expect(chunks.flat()).toEqual(ids); // ni se pierde ni se repite ninguna
  });

  it("una campaña normal sigue siendo UNA sola petición", () => {
    expect(chunkIds(Array.from({ length: 119 }, (_, i) => i))).toHaveLength(1);
    expect(chunkIds([])).toEqual([]);
  });

  it("al juntar los trozos se conserva el orden del motor: menos enviados hoy, primero", () => {
    const merged = [{ id: "a", sent_today: 12 }, { id: "b", sent_today: 0 }, { id: "c", sent_today: null }, { id: "d", sent_today: 30 }];
    expect(sortBySentToday(merged).map((a) => a.id)).toEqual(["b", "c", "a", "d"]);
    expect(merged[0].id).toBe("a"); // no muta la entrada
  });
});
