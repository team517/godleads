import { describe, expect, it } from "vitest";
import {
  AUTO_MIN_NEW_PCT, allocateMix, balancedNewPct, interleave, laneAllowance, mixAdvice, mixEstimate, resolveNewPct, roomForNewLead,
  type MixAccount,
} from "@/lib/lead-mix";

/* Reparto del día entre primeros correos y seguimientos (02-10-2026). */

const acc = (id: string, limit: number, fuDue: number, fuSent = 0): MixAccount => ({ id, limit, fuDue, fuSent });
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("porcentaje de equilibrio", () => {
  it("cada lead nuevo trae (pasos − 1) seguimientos", () => {
    expect([1, 2, 3, 4, 5, 6].map(balancedNewPct)).toEqual([100, 50, 35, 25, 20, 20]);
  });

  it("apagado → null (el motor se comporta como siempre); manual → la barra; auto → equilibrio", () => {
    expect(resolveNewPct({ mode: "off", pct: 50, steps: 3 })).toBeNull();
    expect(resolveNewPct({ mode: null, steps: 3 })).toBeNull();
    expect(resolveNewPct({ mode: "manual", pct: 50, steps: 3 })).toBe(50);
    expect(resolveNewPct({ mode: "manual", pct: 140, steps: 3 })).toBe(100);
    expect(resolveNewPct({ mode: "auto", steps: 3, dailyLimit: 1000, followupsDueToday: 300 })).toBe(35);
  });

  it("auto con cola de seguimientos: los nuevos ceden en proporción, pero nunca bajan del mínimo", () => {
    // 1.000 al día, parte de seguimientos = 650. Con 1.300 pendientes (el doble) → la mitad de nuevos.
    expect(resolveNewPct({ mode: "auto", steps: 3, dailyLimit: 1000, followupsDueToday: 1300 })).toBe(18);
    expect(resolveNewPct({ mode: "auto", steps: 3, dailyLimit: 1000, followupsDueToday: 50_000 })).toBe(AUTO_MIN_NEW_PCT);
    // El caso real del lunes 5-oct en support@: 6.188 seguimientos, capacidad 9.142.
    expect(resolveNewPct({ mode: "auto", steps: 3, dailyLimit: 9142, followupsDueToday: 6188 })).toBe(34);
  });
});

describe("reparto del día", () => {
  it("las dos partes con demanda de sobra: sale el porcentaje pedido y se usa toda la capacidad", () => {
    const accounts = Array.from({ length: 10 }, (_, i) => acc("a" + i, 10, 20));
    const p = allocateMix({ dailyLimit: 100, newPct: 35, newDemand: 5000, accounts });
    expect(p.newQuota + p.fuQuota).toBe(100);
    expect(p.fuQuota).toBe(65);
    expect(p.newQuota).toBe(35);
    expect(sum(p.fuTarget)).toBe(65);
    for (const a of accounts) expect(p.fuTarget[a.id]).toBeLessThanOrEqual(a.limit);
  });

  it("sin seguimientos que enviar: todo el día es para leads nuevos", () => {
    const p = allocateMix({ dailyLimit: 100, newPct: 35, newDemand: 5000, accounts: Array.from({ length: 10 }, (_, i) => acc("a" + i, 10, 0)) });
    expect(p).toMatchObject({ newQuota: 100, fuQuota: 0 });
  });

  it("pocos seguimientos: salen todos y lo que sobra de su parte pasa a leads nuevos", () => {
    const p = allocateMix({ dailyLimit: 100, newPct: 35, newDemand: 5000, accounts: Array.from({ length: 10 }, (_, i) => acc("a" + i, 10, 2)) });
    expect(p).toMatchObject({ fuQuota: 20, newQuota: 80 });
  });

  it("sin leads nuevos: todo el día es para seguimientos", () => {
    const p = allocateMix({ dailyLimit: 100, newPct: 35, newDemand: 0, accounts: Array.from({ length: 10 }, (_, i) => acc("a" + i, 10, 20)) });
    expect(p).toMatchObject({ newQuota: 0, fuQuota: 100 });
  });

  it("pocos leads nuevos: salen todos y el resto es para seguimientos", () => {
    const p = allocateMix({ dailyLimit: 100, newPct: 35, newDemand: 10, accounts: Array.from({ length: 10 }, (_, i) => acc("a" + i, 10, 20)) });
    expect(p).toMatchObject({ newQuota: 10, fuQuota: 90 });
  });

  it("seguimientos mal repartidos entre buzones: el buzón cargado no pierde sitio si los nuevos caben en los demás", () => {
    // A tiene 20 seguimientos, B ninguno. Con 35 % nuevos: seguimientos hasta 13, nuevos 7.
    const p = allocateMix({ dailyLimit: 20, newPct: 35, newDemand: 500, accounts: [acc("A", 10, 20), acc("B", 10, 0)] });
    expect(p.fuTarget).toEqual({ A: 10, B: 0 });       // A dedica todo su día a seguimientos…
    expect(p.fuQuota).toBe(10);
    expect(p.newQuota).toBe(10);                       // …y los leads nuevos salen por B. Nada se queda sin usar.
  });

  it("nivelado: los buzones con pocos seguimientos los envían todos; los cargados ceden por igual", () => {
    const accounts = [acc("A", 10, 30), acc("B", 10, 30), acc("C", 10, 2), acc("D", 10, 1)];
    const p = allocateMix({ dailyLimit: 40, newPct: 50, newDemand: 500, accounts });
    expect(p.fuQuota).toBe(20);
    expect(p.fuTarget.C).toBe(2);
    expect(p.fuTarget.D).toBe(1);
    expect(p.fuTarget.A + p.fuTarget.B).toBe(17);
    expect(Math.abs(p.fuTarget.A - p.fuTarget.B)).toBeLessThanOrEqual(1);
    expect(p.newQuota).toBe(20);
  });

  it("lo ya enviado hoy nunca se deshace (mover la barra a media mañana)", () => {
    const p = allocateMix({ dailyLimit: 20, newPct: 90, newDemand: 500, accounts: [acc("A", 10, 5, 6), acc("B", 10, 5, 0)] });
    expect(p.fuTarget.A).toBeGreaterThanOrEqual(6);
    expect(p.newQuota + p.fuQuota).toBeLessThanOrEqual(20);
  });

  it("límite de campaña por debajo de lo que suman los buzones: manda el de la campaña", () => {
    const p = allocateMix({ dailyLimit: 50, newPct: 40, newDemand: 500, accounts: Array.from({ length: 10 }, (_, i) => acc("a" + i, 10, 20)) });
    expect(p.fuQuota).toBe(30);
    expect(p.newQuota).toBe(20);
  });

  it("seguimientos de un buzón desconectado (saldrán prestados) cuentan en el total", () => {
    const p = allocateMix({ dailyLimit: 20, newPct: 50, newDemand: 500, accounts: [acc("A", 10, 0), acc("B", 10, 0)], extraFuDue: 4 });
    expect(p.fuQuota).toBe(4);
    expect(p.newQuota).toBe(16);
  });

  it("datos raros no rompen nada", () => {
    expect(allocateMix({ dailyLimit: 0, newPct: 35, newDemand: 10, accounts: [] })).toEqual({ newQuota: 0, fuQuota: 0, fuTarget: {} });
    const p = allocateMix({ dailyLimit: NaN as unknown as number, newPct: NaN as unknown as number, newDemand: -5, accounts: [acc("A", -3, -1)] });
    expect(p.newQuota).toBe(0);
    expect(p.fuQuota).toBe(0);
  });
});

describe("ritmo dentro del día y sitio por buzón", () => {
  it("cada parte se reparte a lo largo de la franja", () => {
    expect(laneAllowance(100, 0, 0)).toBe(2);         // nada más abrir, las dos partes arrancan
    expect(laneAllowance(100, 0, 0.5)).toBe(50);
    expect(laneAllowance(100, 50, 0.5)).toBe(0);      // va al día: espera
    expect(laneAllowance(100, 30, 0.5)).toBe(20);     // va retrasada: recupera
    expect(laneAllowance(100, 99, 1)).toBe(1);
    expect(laneAllowance(100, 100, 1)).toBe(0);
    expect(laneAllowance(0, 0, 1)).toBe(0);
    expect(laneAllowance(1, 0, 0)).toBe(1);
  });

  it("un buzón guarda sitio para sus seguimientos antes de coger leads nuevos", () => {
    // tope 10, le tocan 6 seguimientos hoy y lleva 2: guarda 4 → puede coger nuevos hasta 6 enviados.
    expect(roomForNewLead({ limit: 10, sentToday: 5, fuSent: 2 }, 6)).toBe(true);
    expect(roomForNewLead({ limit: 10, sentToday: 6, fuSent: 2 }, 6)).toBe(false);
    expect(roomForNewLead({ limit: 10, sentToday: 9, fuSent: 6 }, 6)).toBe(true);   // ya envió los suyos
    expect(roomForNewLead({ limit: 10, sentToday: 10, fuSent: 6 }, 6)).toBe(false); // tope del día
  });

  it("dentro de una pasada salen intercalados en proporción", () => {
    expect(interleave(["f1", "f2", "f3", "f4"], ["n1", "n2"], 2, 1).join(" ")).toBe("f1 n1 f2 f3 n2 f4");
    expect(interleave(["f1"], ["n1", "n2"], 0, 3)).toEqual(["n1", "n2", "f1"]);
    expect(interleave(["f1", "f2"], [], 1, 1)).toEqual(["f1", "f2"]);
    expect(interleave(["f1"], ["n1"], 0, 0)).toEqual(["f1", "n1"]);
  });

  it("la ayuda de la barra avisa cuando los seguimientos se van a retrasar", () => {
    expect(mixAdvice(35, 3).tone).toBe("ok");
    expect(mixAdvice(60, 3).tone).toBe("warn");
    expect(mixAdvice(10, 3).tone).toBe("info");
    expect(mixAdvice(50, 1).tone).toBe("info");
  });
});

/* ── Simulación de varias semanas ─────────────────────────────────────────────────────────────
   20 buzones a 10 correos/día, secuencia de 3 pasos (espera 3 y 5 días), 5.000 leads en cola.
   Cada día: se calcula el reparto, cada buzón envía sus seguimientos (los más antiguos primero)
   y los leads nuevos ocupan el sitio que queda. */
function simulate(opts: { mode: "auto" | "manual"; pct?: number; days: number; backlogDay0?: number }) {
  const N = 20, LIMIT = 10, L = N * LIMIT, STEPS = 3, DELAY = [0, 3, 5];
  type Lead = { acc: number; step: number; due: number };
  const inSeq: Lead[] = [];
  let pending = 5000;
  // Cola inicial (como tras el bloqueo de IONOS): seguimientos ya vencidos el primer día.
  for (let i = 0; i < (opts.backlogDay0 || 0); i++) inSeq.push({ acc: i % N, step: 1, due: 0 });
  const log: { day: number; nuevos: number; seg: number; maxRetraso: number; pct: number }[] = [];
  for (let day = 0; day < opts.days; day++) {
    const due = (a: number) => inSeq.filter((l) => l.acc === a && l.due <= day);
    const accounts = Array.from({ length: N }, (_, a) => acc(String(a), LIMIT, due(a).length));
    const dueTotal = accounts.reduce((s, a) => s + a.fuDue, 0);
    const pct = resolveNewPct({ mode: opts.mode, pct: opts.pct, steps: STEPS, dailyLimit: L, followupsDueToday: dueTotal })!;
    const plan = allocateMix({ dailyLimit: L, newPct: pct, newDemand: pending, accounts });
    let seg = 0, nuevos = 0, maxRetraso = 0;
    const sentBy = new Array(N).fill(0);
    for (let a = 0; a < N; a++) {
      const mine = due(a).sort((x, y) => x.due - y.due).slice(0, plan.fuTarget[String(a)]);
      for (const l of mine) {
        maxRetraso = Math.max(maxRetraso, day - l.due);
        l.step++; seg++; sentBy[a]++;
        if (l.step >= STEPS) inSeq.splice(inSeq.indexOf(l), 1); else l.due = day + DELAY[l.step];
      }
    }
    let left = plan.newQuota;
    for (let a = 0; a < N && left > 0; a++) {
      const room = LIMIT - Math.max(sentBy[a], plan.fuTarget[String(a)]);
      const take = Math.min(room, left, pending);
      for (let k = 0; k < take; k++) inSeq.push({ acc: a, step: 1, due: day + DELAY[1] });
      sentBy[a] += take; nuevos += take; left -= take; pending -= take;
    }
    for (let a = 0; a < N; a++) expect(sentBy[a]).toBeLessThanOrEqual(LIMIT);   // ningún buzón pasa de su tope
    log.push({ day, nuevos, seg, maxRetraso, pct });
  }
  return { log, L };
}

describe("simulación de 30 días", () => {
  it("automático: todos los días hay primeros correos, se usa toda la capacidad y los seguimientos van al día", () => {
    const { log, L } = simulate({ mode: "auto", days: 30 });
    for (const d of log) {
      expect(d.nuevos + d.seg, `día ${d.day}`).toBe(L);
      expect(d.nuevos, `día ${d.day}`).toBeGreaterThanOrEqual(Math.floor(L * AUTO_MIN_NEW_PCT / 100));
    }
    expect(Math.max(...log.map((d) => d.maxRetraso))).toBeLessThanOrEqual(2);
    // En régimen: un tercio de nuevos, dos tercios de seguimientos.
    const tail = log.slice(15);
    const share = tail.reduce((s, d) => s + d.nuevos, 0) / (tail.length * L);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.42);
  });

  it("automático con una cola enorme el primer día: sigue habiendo primeros correos y la cola se vacía", () => {
    const { log, L } = simulate({ mode: "auto", days: 30, backlogDay0: 900 });
    expect(log[0].nuevos).toBeGreaterThanOrEqual(Math.floor(L * AUTO_MIN_NEW_PCT / 100));
    expect(log[0].nuevos + log[0].seg).toBe(L);
    for (const d of log) expect(d.nuevos, `día ${d.day}`).toBeGreaterThan(0);
    // La cola inicial (4,5 días de capacidad) queda absorbida: al final los retrasos son pequeños.
    expect(log[log.length - 1].maxRetraso).toBeLessThanOrEqual(3);
  });

  it("manual 35 %: cada día el reparto pedido mientras haya de las dos cosas", () => {
    const { log, L } = simulate({ mode: "manual", pct: 35, days: 30 });
    for (const d of log.slice(10)) {
      expect(d.nuevos + d.seg).toBe(L);
      expect(d.nuevos).toBeGreaterThanOrEqual(Math.round(L * 0.35));
    }
  });

  it("manual 70 %: salen más nuevos, pero los seguimientos se retrasan cada vez más (lo que avisa la barra)", () => {
    const { log, L } = simulate({ mode: "manual", pct: 70, days: 30 });
    for (const d of log.slice(10)) expect(d.nuevos).toBe(Math.round(L * 0.7));
    expect(log[29].maxRetraso).toBeGreaterThan(log[12].maxRetraso);
    expect(log[29].maxRetraso).toBeGreaterThan(5);
  });
});

describe("estimación para la pantalla de opciones", () => {
  it("el lunes 5-oct en support@: 9.142 envíos, 6.188 seguimientos pendientes", () => {
    const pct = resolveNewPct({ mode: "auto", steps: 3, dailyLimit: 9142, followupsDueToday: 6188 })!;
    const e = mixEstimate({ dailyLimit: 9142, newPct: pct, newPending: 188_000, followupsDueToday: 6188 });
    expect(e.nuevos + e.seguimientos).toBe(9142);
    expect(e.nuevos).toBeGreaterThan(3000);
    expect(e.aplazados).toBeLessThan(200);
  });
  it("con tope de leads nuevos al día, lo que sobra pasa a seguimientos", () => {
    expect(mixEstimate({ dailyLimit: 1000, newPct: 50, newPending: 9000, followupsDueToday: 2000, maxNewPerDay: 100 }))
      .toEqual({ nuevos: 100, seguimientos: 900, aplazados: 1100 });
  });
  it("sin seguimientos, todo son primeros correos", () => {
    expect(mixEstimate({ dailyLimit: 500, newPct: 35, newPending: 9000, followupsDueToday: 0 })).toEqual({ nuevos: 500, seguimientos: 0, aplazados: 0 });
  });
});
