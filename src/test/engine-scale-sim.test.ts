import { describe, expect, it } from "vitest";
import { perTickCampaignCap } from "../../supabase/functions/_shared/engine-scale";

/* Simulación, minuto a minuto, de las MISMAS compuertas que aplica el motor a una campaña:
 *   · ritmo por horas: a estas alturas de la ventana "tocan" ceil(límite × transcurrido/ventana)
 *   · tope de la campaña por pasada (antes 4 fijo; ahora perTickCampaignCap)
 *   · por buzón: 1 correo por pasada, espera de 6–9 min (aquí 9, el peor caso), su límite diario
 *   · slow-ramp por buzón: empieza en `start` y sube `inc` por día de envío hasta 30
 * Sirve para contestar "¿una campaña de 400 buzones con slow-ramp gasta su capacidad cada día?". */

const WINDOW = 9 * 60; // 9:00–18:00
const HARD_DAILY_CAP = 30;

function simulateDay(accounts: number, perAccountLimit: number, capFor: (daily: number, win: number) => number) {
  const dailyLimit = accounts * perAccountLimit;
  const cap = capFor(dailyLimit, WINDOW);
  const sentByAcc = new Array(accounts).fill(0);
  const lastSend = new Array(accounts).fill(-Infinity);
  let sent = 0;
  let maxPerMinute = 0;
  let maxPerAccountGapViolation = 0;
  for (let m = 0; m < WINDOW; m++) {
    const expected = Math.max(4, Math.ceil(dailyLimit * ((m + 1) / WINDOW)));
    const budget = Math.min(cap, expected - sent, dailyLimit - sent);
    if (budget <= 0) continue;
    // El motor ordena las cuentas por "menos enviados hoy".
    const order = sentByAcc.map((n, i) => [n, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let thisTick = 0;
    for (const [, i] of order) {
      if (thisTick >= budget) break;
      if (sentByAcc[i] >= perAccountLimit) continue;
      if (m - lastSend[i] < 9) continue; // en espera
      if (m - lastSend[i] < 6) maxPerAccountGapViolation++;
      sentByAcc[i]++; lastSend[i] = m; thisTick++; sent++;
    }
    maxPerMinute = Math.max(maxPerMinute, thisTick);
  }
  return { dailyLimit, cap, sent, maxPerMinute, maxPerAccount: Math.max(...sentByAcc), maxPerAccountGapViolation };
}

const rampLimit = (day: number, start = 2, inc = 2) => Math.min(start + day * inc, HARD_DAILY_CAP);

describe("campaña de 400 buzones con slow-ramp (2/día, +2 por día de envío, hasta 30)", () => {
  it("con el tope nuevo gasta su capacidad TODOS los días de la rampa", () => {
    const rows: string[] = [];
    for (let day = 0; day <= 15; day++) {
      const r = simulateDay(400, rampLimit(day), perTickCampaignCap);
      rows.push(`día ${String(day + 1).padStart(2)} · ${rampLimit(day)}/buzón · capacidad ${r.dailyLimit} · tope/min ${r.cap} · enviados ${r.sent} · pico/min ${r.maxPerMinute}`);
      expect(r.sent).toBe(r.dailyLimit);                                       // gasta TODA su capacidad, ni más ni menos
      expect(r.sent).toBeLessThanOrEqual(r.dailyLimit);                       // nunca por encima del límite
      expect(r.maxPerAccount).toBeLessThanOrEqual(rampLimit(day));            // ningún buzón pasa de su rampa
      expect(r.maxPerMinute).toBeLessThanOrEqual(24);                         // ni la campaña de su techo por pasada
    }
    console.log("\n" + rows.join("\n"));
  });

  it("con el 4 fijo de antes se quedaba en 2.160/día aunque sus buzones dieran 12.000", () => {
    const r = simulateDay(400, 30, () => 4);
    expect(r.sent).toBe(4 * WINDOW);
    expect(r.sent / r.dailyLimit).toBeLessThan(0.2);
  });

  it("las campañas de hoy (40–119 buzones) envían lo mismo con la regla nueva que con el 4 fijo", () => {
    for (const [accounts, perAcc] of [[40, 30], [51, 26], [100, 14], [119, 13], [23, 16]] as const) {
      const before = simulateDay(accounts, perAcc, () => 4);
      const after = simulateDay(accounts, perAcc, perTickCampaignCap);
      expect(after.cap).toBe(4);
      expect(after.sent).toBe(before.sent);
    }
  });
});
