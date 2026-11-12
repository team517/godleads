import { describe, expect, it } from "vitest";
import { decidirReprogramacion, reprogramarFueraDeOficina } from "../../supabase/functions/_shared/ooo-reschedule";

/* Fuera de oficina → la campaña espera a que vuelva (10-11-2026): qué se decide y qué se escribe. */
const RECIBIDO = "2026-10-20T08:00:00Z";
const AHORA = Date.parse("2026-10-20T09:00:00Z");
const CAMP = { ooo_reschedule: true, timezone: "Europe/Madrid", send_start_hour: 9 };
const LEAD = { status: "in_progress", current_step: 1, next_attempt_at: null };

const decide = (over: Partial<Parameters<typeof decidirReprogramacion>[0]> = {}) =>
  decidirReprogramacion({ fecha: "2026-10-29", recibidoIso: RECIBIDO, nowMs: AHORA, campania: CAMP, lead: LEAD, pasos: 3, ...over });

describe("decidirReprogramacion", () => {
  it("vuelve el jueves 29 → espera hasta ese día a las 9:00 de Madrid", () => {
    expect(decide()).toEqual({ status: "programado", scheduledFor: "2026-10-29T08:00:00.000Z", nextAttempt: "2026-10-29T08:00:00.000Z" });
  });
  it("si vuelve en sábado, se le escribe el lunes", () => {
    expect(decide({ fecha: "2026-10-31" }).scheduledFor).toBe("2026-11-02T08:00:00.000Z");
  });
  it("nunca adelanta: si ya esperaba a algo posterior, se deja", () => {
    const r = decide({ lead: { ...LEAD, next_attempt_at: "2026-11-05T08:00:00.000Z" } });
    expect(r.status).toBe("programado");
    expect(r.nextAttempt).toBe("2026-11-05T08:00:00.000Z");
  });
  it("sin fecha, fecha lejana o pasada → no se toca nada", () => {
    expect(decide({ fecha: null }).status).toBe("sin_fecha");
    expect(decide({ fecha: "2028-06-01" }).status).toBe("sin_fecha");
    expect(decide({ fecha: "2026-10-19" }).status).toBe("pasado");
    // mañana a las 9:00, pero ya son las 10:00 de ese día → ya ha vuelto
    expect(decide({ fecha: "2026-10-21", nowMs: Date.parse("2026-10-21T09:00:00Z") }).status).toBe("pasado");
  });
  it("opción apagada en la campaña → desactivado", () => {
    expect(decide({ campania: { ...CAMP, ooo_reschedule: false } }).status).toBe("desactivado");
  });
  it("ya respondió, secuencia terminada o fuera de la secuencia → no se programa", () => {
    expect(decide({ lead: { ...LEAD, status: "replied" } }).status).toBe("ya_respondio");
    expect(decide({ lead: { ...LEAD, status: "completed" } }).status).toBe("secuencia_terminada");
    expect(decide({ lead: { ...LEAD, current_step: 3 } }).status).toBe("secuencia_terminada");
    expect(decide({ lead: { ...LEAD, status: "unsubscribed" } }).status).toBe("no_aplica");
    expect(decide({ lead: null }).status).toBe("no_aplica");
  });
});

describe("opciones de la campaña (12-11-2026)", () => {
  it("margen tras la vuelta: vuelve el jueves 29 y con 1 día de margen se le escribe el viernes 30", () => {
    expect(decide({ campania: { ...CAMP, ooo_delay_days: 1 } }).scheduledFor).toBe("2026-10-30T08:00:00.000Z");
  });
  it("el margen que cae en fin de semana pasa al lunes", () => {
    expect(decide({ campania: { ...CAMP, ooo_delay_days: 2 } }).scheduledFor).toBe("2026-11-02T08:00:00.000Z");
  });
  it("sin fecha y opción en 0 (por defecto): sigue la secuencia normal", () => {
    expect(decide({ fecha: null }).status).toBe("sin_fecha");
    expect(decide({ fecha: null, campania: { ...CAMP, ooo_no_date_days: 0 } }).status).toBe("sin_fecha");
  });
  it("sin fecha y «esperar 7 días»: se le vuelve a escribir 7 días después de su respuesta", () => {
    const r = decide({ fecha: null, campania: { ...CAMP, ooo_no_date_days: 7 } });
    expect(r).toMatchObject({ status: "programado", espera: true, scheduledFor: "2026-10-27T08:00:00.000Z" });
  });
  it("sin fecha pero no es una ausencia (ya no trabaja, buzón cerrado) o la opción general apagada: no se espera", () => {
    expect(decide({ fecha: null, campania: { ...CAMP, ooo_no_date_days: 7 }, noEsAusencia: true }).status).toBe("sin_fecha");
    expect(decide({ fecha: null, campania: { ...CAMP, ooo_no_date_days: 7, ooo_reschedule: false } }).status).toBe("sin_fecha");
  });
  it("valores raros se acotan (nunca más de 7 días de margen)", () => {
    expect(decide({ campania: { ...CAMP, ooo_delay_days: 99 } }).scheduledFor).toBe("2026-11-05T08:00:00.000Z");
  });
});

/** Base simulada mínima: guarda lo que se actualiza y se inserta. */
function fakeDb(state: { camp: any; lead: any; pasos: number }) {
  const writes: { table: string; op: string; row: any; filters: any[] }[] = [];
  const from = (table: string) => {
    const filters: any[] = [];
    let op = "select"; let row: any = null; let head = false;
    const q: any = {
      select: (_c: string, o?: any) => { if (o?.head) head = true; return q; },
      eq: (k: string, v: any) => { filters.push(["eq", k, v]); return q; },
      in: (k: string, v: any) => { filters.push(["in", k, v]); return q; },
      update: (r: any) => { op = "update"; row = r; return q; },
      upsert: (r: any) => { op = "upsert"; row = r; writes.push({ table, op, row, filters }); return Promise.resolve({ error: null }); },
      maybeSingle: () => Promise.resolve({ data: table === "campaigns" ? state.camp : table === "campaign_leads" ? state.lead : null, error: null }),
      then: (res: any) => {
        if (op === "update") writes.push({ table, op, row, filters });
        if (head) return Promise.resolve({ count: state.pasos, error: null }).then(res);
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return q;
  };
  return { db: { from }, writes };
}

describe("reprogramarFueraDeOficina (con base simulada)", () => {
  it("con fecha: pone next_attempt_at sólo si sigue en la secuencia y lo anota", async () => {
    const { db, writes } = fakeDb({ camp: CAMP, lead: LEAD, pasos: 3 });
    const r = await reprogramarFueraDeOficina(db, {
      messageId: "m1", campaignId: "c1", leadId: "l1", receivedAt: RECIBIDO,
      text: "Estaré fuera de la oficina hasta el 28 de octubre.",
    }, { nowMs: AHORA });
    expect(r.status).toBe("programado");
    const up = writes.find((w) => w.table === "campaign_leads");
    expect(up?.row).toEqual({ next_attempt_at: "2026-10-29T08:00:00.000Z" });
    expect(up?.filters).toContainEqual(["in", "status", ["pending", "in_progress", "active"]]);
    const log = writes.find((w) => w.table === "ooo_returns");
    expect(log?.row).toMatchObject({ inbox_message_id: "m1", return_date: "2026-10-29", status: "programado", source: "reglas" });
  });
  it("sin fecha y sin IA: no toca el lead, sólo lo anota", async () => {
    const { db, writes } = fakeDb({ camp: CAMP, lead: LEAD, pasos: 3 });
    const r = await reprogramarFueraDeOficina(db, {
      messageId: "m2", campaignId: "c1", leadId: "l1", receivedAt: RECIBIDO, text: "Estoy fuera de la oficina unos días.",
    }, { nowMs: AHORA, useAi: false });
    expect(r.status).toBe("sin_fecha");
    expect(writes.some((w) => w.table === "campaign_leads")).toBe(false);
    expect(writes.find((w) => w.table === "ooo_returns")?.row.status).toBe("sin_fecha");
  });
  it("sin fecha con «esperar 7 días»: programa y lo anota como espera", async () => {
    const { db, writes } = fakeDb({ camp: { ...CAMP, ooo_no_date_days: 7 }, lead: LEAD, pasos: 3 });
    const r = await reprogramarFueraDeOficina(db, {
      messageId: "m3", campaignId: "c1", leadId: "l1", receivedAt: RECIBIDO, text: "Estoy fuera de la oficina unos días.",
    }, { nowMs: AHORA, useAi: false });
    expect(r.status).toBe("programado");
    expect(writes.find((w) => w.table === "campaign_leads")?.row).toEqual({ next_attempt_at: "2026-10-27T08:00:00.000Z" });
    expect(writes.find((w) => w.table === "ooo_returns")?.row).toMatchObject({ status: "programado", source: "espera", return_date: null });
  });
});
