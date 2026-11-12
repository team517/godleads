// Fuera de oficina → la campaña espera a que vuelva (10-11-2026).
//
// Cuando llega un "estoy fuera hasta el 21 de octubre" de un lead de campaña y la campaña tiene la
// opción "Fuera de oficina: esperar a que vuelva" (campaigns.ooo_reschedule, activada por defecto),
// el lead deja de recibir correos hasta ese día: campaign_leads.next_attempt_at = el día de vuelta a
// la hora de inicio de la campaña (si cae en fin de semana, el lunes). El motor ya respeta esa
// columna (process-campaign-queue y la RPC campaign_due_followups), así que ese día sale el
// SIGUIENTE correo de la secuencia, en el mismo hilo. Nunca se adelanta: si el lead ya esperaba a
// una fecha posterior, se deja. Todo queda anotado en ooo_returns (una fila por correo recibido).
import { evaluarVuelta, parseOooReturn, programarVuelta } from "./ooo-return.ts";

export type OooStatus =
  | "pendiente" | "programado" | "sin_fecha" | "pasado" | "secuencia_terminada" | "desactivado" | "ya_respondio" | "no_aplica";

export interface CampaniaOoo {
  ooo_reschedule: boolean | null; timezone: string | null; send_start_hour: number | null;
  /** Días de margen tras la vuelta antes de escribirle (12-11-2026; 0 = el mismo día). */
  ooo_delay_days?: number | null;
  /** Si no dice cuándo vuelve: días de espera desde que llegó (0 = seguir la secuencia normal). */
  ooo_no_date_days?: number | null;
}
export interface LeadOoo { status: string | null; current_step: number | null; next_attempt_at: string | null }

/** Estados de campaign_leads en los que el lead sigue en la secuencia. */
export const EN_SECUENCIA = ["pending", "in_progress", "active"];

const DIA_MS = 86_400_000;
const clampDias = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
/** "2026-10-29" + n días → "2026-11-01". */
export function sumarDias(fecha: string, n: number): string {
  return new Date(Date.parse(fecha + "T00:00:00Z") + n * DIA_MS).toISOString().slice(0, 10);
}

/** Decisión PURA (con pruebas): qué hacer con un fuera de oficina con (o sin) fecha de vuelta.
 *  `espera` = no dijo cuándo vuelve y la campaña pide esperar unos días igualmente. */
export function decidirReprogramacion(i: {
  fecha: string | null; recibidoIso: string; nowMs: number;
  campania: CampaniaOoo | null; lead: LeadOoo | null; pasos: number;
  /** El texto no es de vacaciones (ya no trabaja allí, buzón cerrado, antispam): esperar no sirve. */
  noEsAusencia?: boolean;
}): { status: OooStatus; scheduledFor: string | null; nextAttempt: string | null; espera?: boolean } {
  const nada = (status: OooStatus, scheduledFor: string | null = null) => ({ status, scheduledFor, nextAttempt: null });
  if (!i.campania || !i.lead) return nada("no_aplica");
  const ev = evaluarVuelta(i.fecha, i.recibidoIso);
  let scheduledFor: string;
  let espera = false;
  if (ev === "sin_fecha" || ev === "lejana") {
    // Sin fecha: por defecto sigue la secuencia normal; si la campaña lo pide, se espera N días.
    const dias = clampDias(i.campania.ooo_no_date_days, 30);
    if (ev === "lejana" || !dias || i.noEsAusencia || i.campania.ooo_reschedule === false) return nada("sin_fecha");
    scheduledFor = programarVuelta(sumarDias(i.recibidoIso.slice(0, 10), dias), i.campania.timezone, i.campania.send_start_hour);
    espera = true;
  } else if (ev === "pasada") {
    return nada("pasado");
  } else {
    // Con fecha: el día que vuelve, más el margen elegido (para que no le pille con la bandeja llena).
    const margen = clampDias(i.campania.ooo_delay_days, 7);
    scheduledFor = programarVuelta(sumarDias(i.fecha!, margen), i.campania.timezone, i.campania.send_start_hour);
  }
  if (Date.parse(scheduledFor) <= i.nowMs) return nada("pasado", scheduledFor);
  if (i.campania.ooo_reschedule === false) return nada("desactivado", scheduledFor);
  const st = String(i.lead.status || "");
  if (st === "replied") return nada("ya_respondio", scheduledFor);
  if (st === "completed" || (i.pasos > 0 && (i.lead.current_step ?? 0) >= i.pasos)) return nada("secuencia_terminada", scheduledFor);
  if (!EN_SECUENCIA.includes(st)) return nada("no_aplica", scheduledFor);
  // Nunca adelantar: si ya esperaba a algo posterior (otro fuera de oficina, un reintento), se deja.
  const actual = i.lead.next_attempt_at ? Date.parse(i.lead.next_attempt_at) : NaN;
  const nextAttempt = Number.isFinite(actual) && actual > Date.parse(scheduledFor) ? new Date(actual).toISOString() : scheduledFor;
  return espera ? { status: "programado", scheduledFor, nextAttempt, espera: true } : { status: "programado", scheduledFor, nextAttempt };
}

/* ── Respaldo con IA: sólo cuando las reglas no sacan fecha y el texto habla de tiempo ─────────── */

export const OOO_AI_SYSTEM = `Recibes la respuesta automática de "fuera de oficina" de una persona y la fecha en que llegó.
Devuelve SOLO un JSON {"return_date":"YYYY-MM-DD"} con el PRIMER día en que la persona vuelve a estar disponible, o {"return_date":null} si el texto no lo dice con claridad.
Reglas:
- "vuelvo el X", "back on X", "de retour le X", "rientro il X" → X.
- "fuera hasta el X", "until X", "jusqu'au X", "fino al X", "bis X" (fuera hasta X incluido) → X + 1 día.
- Un rango "del X al Y" → Y + 1 día.
- El año, a partir de la fecha de llegada (si la fecha queda antes de la llegada y es enero-marzo recibido en octubre-diciembre, es del año siguiente).
- Sin fecha concreta ("unas semanas", "pronto", "a mi vuelta"), si ya no trabaja allí, si es un antispam o si dudas → null.
No inventes nada.`;

/** Fecha de vuelta según el modelo, o null. Nunca lanza: un fallo es "sin fecha". */
export async function aiOooReturnDate(apiKey: string, texto: string, recibidoIso: string, timeoutMs = 8_000): Promise<string | null> {
  const t = String(texto || "").slice(0, 2000);
  if (!apiKey || t.replace(/\s+/g, "").length < 4) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        max_tokens: 40,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: OOO_AI_SYSTEM },
          { role: "user", content: `LLEGÓ EL: ${recibidoIso.slice(0, 10)}\n\nRESPUESTA AUTOMÁTICA:\n${t}` },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    const raw = String(j?.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const d = JSON.parse(raw)?.return_date;
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Con la base de datos (service role) ───────────────────────────────────────────────────── */

export interface EntradaOoo { messageId: string; campaignId: string; leadId: string; text: string; receivedAt: string }

/** Interpreta, decide, aplica (next_attempt_at) y lo anota en ooo_returns. Idempotente por correo. */
// deno-lint-ignore no-explicit-any
export async function reprogramarFueraDeOficina(db: any, e: EntradaOoo, opts: { apiKey?: string; useAi?: boolean; nowMs?: number } = {}): Promise<{ status: OooStatus; usedAi: boolean; fecha: string | null }> {
  const parsed = parseOooReturn(e.text, e.receivedAt);
  let fecha = parsed.date;
  let source: "reglas" | "ia" | "espera" | null = fecha ? "reglas" : null;
  let usedAi = false;
  if (!fecha && !parsed.notVacation && parsed.hasTimeRef && opts.useAi && opts.apiKey) {
    usedAi = true;
    const f = await aiOooReturnDate(opts.apiKey, e.text, e.receivedAt);
    if (f && evaluarVuelta(f, e.receivedAt) !== "sin_fecha") { fecha = f; source = "ia"; }
  }

  const [{ data: campania }, { data: lead }, { count }] = await Promise.all([
    db.from("campaigns").select("ooo_reschedule, ooo_delay_days, ooo_no_date_days, timezone, send_start_hour").eq("id", e.campaignId).maybeSingle(),
    db.from("campaign_leads").select("status, current_step, next_attempt_at").eq("campaign_id", e.campaignId).eq("lead_id", e.leadId).maybeSingle(),
    db.from("campaign_steps").select("id", { count: "exact", head: true }).eq("campaign_id", e.campaignId),
  ]);
  const d = decidirReprogramacion({ fecha, recibidoIso: e.receivedAt, nowMs: opts.nowMs ?? Date.now(), campania, lead, pasos: count || 0, noEsAusencia: !!parsed.notVacation });
  if (d.espera) source = "espera";

  if (d.status === "programado") {
    const { error } = await db.from("campaign_leads").update({ next_attempt_at: d.nextAttempt })
      .eq("campaign_id", e.campaignId).eq("lead_id", e.leadId).in("status", EN_SECUENCIA);
    if (error) throw new Error(`campaign_leads: ${error.message}`);
  }
  const { error: logErr } = await db.from("ooo_returns").upsert({
    inbox_message_id: e.messageId, campaign_id: e.campaignId, lead_id: e.leadId,
    return_date: fecha, scheduled_for: d.scheduledFor, source, status: d.status,
    snippet: String(e.text || "").replace(/\s+/g, " ").trim().slice(0, 500),
    updated_at: new Date().toISOString(),
  }, { onConflict: "inbox_message_id" });
  if (logErr) throw new Error(`ooo_returns: ${logErr.message}`);
  return { status: d.status, usedAi, fecha };
}
