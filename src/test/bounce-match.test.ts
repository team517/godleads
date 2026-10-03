import { describe, expect, it } from "vitest";
import { BOUNCE_CLOCK_SLACK_MS, chooseBouncedSend, type BounceCandidate } from "../../supabase/functions/_shared/bounce-match";

/* 03-10-2026, caso real: dos respuestas manuales a support@ desde el mismo buzón, la de 22:47 con un
   enlace bloqueado (rebotó, IONOS avisó a las 00:43) y la de 22:50 sin él (llegó). El emparejador
   cogía "el último envío a ese destinatario" → marcó la buena y avisó "No entregado". */

const c = (p: Partial<BounceCandidate> & { id: string; created_at: string }): BounceCandidate => ({
  lead_id: null, campaign_id: null, bounced_at: null, user_id: "u1", to_email: "support@onepulso.online", subject: "Re: interesado", how: "destinatario", ...p,
});
const BOUNCE_AT = "2026-10-03T22:43:52.000Z"; // 00:43 Madrid
const conEnlace = c({ id: "a-2247", created_at: "2026-10-03T20:47:29.000Z" });
const sinEnlace = c({ id: "b-2250", created_at: "2026-10-03T20:50:19.000Z" });

describe("qué envío rebotó", () => {
  it("el Message-ID del correo devuelto manda, aunque haya un envío posterior al mismo destinatario", () => {
    const r = chooseBouncedSend([{ ...conEnlace, how: "message_id" }, sinEnlace], BOUNCE_AT, { message_id: "<x@tunuevoleadpower.com>" });
    expect(r.how).toBe("message_id");
    expect(r.hit?.id).toBe("a-2247");
  });
  it("sin Message-ID y con dos envíos posibles al mismo destinatario, NO se marca ninguno (antes se marcaba el último)", () => {
    const r = chooseBouncedSend([conEnlace, sinEnlace], BOUNCE_AT);
    expect(r.how).toBe("ambiguo");
    expect(r.hit).toBeNull();
    expect(r.candidates).toBe(2);
  });
  it("un único envío anterior posible → es ése", () => {
    const r = chooseBouncedSend([conEnlace], BOUNCE_AT);
    expect(r).toMatchObject({ how: "unico", hit: { id: "a-2247" } });
  });
  it("un envío creado DESPUÉS del rebote no puede ser el que rebotó", () => {
    const tarde = c({ id: "tarde", created_at: new Date(Date.parse(BOUNCE_AT) + BOUNCE_CLOCK_SLACK_MS + 1000).toISOString() });
    expect(chooseBouncedSend([tarde], BOUNCE_AT)).toMatchObject({ how: "ninguno", hit: null });
    // Pero unos minutos de diferencia de reloj (el aviso llegó antes de guardar el envío) se toleran.
    const casi = c({ id: "casi", created_at: new Date(Date.parse(BOUNCE_AT) + 60_000).toISOString() });
    expect(chooseBouncedSend([casi], BOUNCE_AT)).toMatchObject({ how: "unico", hit: { id: "casi" } });
  });
  it("el asunto del original desempata entre varios envíos", () => {
    const otro = c({ id: "otro", created_at: "2026-10-03T20:40:00.000Z", subject: "Propuesta para tu web" });
    const r = chooseBouncedSend([otro, sinEnlace], BOUNCE_AT, { subject: "RE: Propuesta para tu web" });
    expect(r).toMatchObject({ how: "asunto", hit: { id: "otro" } });
  });
  it("dos pasos de la misma campaña al mismo lead: se marca el último (la estadística es la misma)", () => {
    const paso1 = c({ id: "p1", created_at: "2026-09-28T08:00:00.000Z", campaign_id: "camp", lead_id: "lead", subject: "500 leads sin spam" });
    const paso2 = c({ id: "p2", created_at: "2026-10-01T08:00:00.000Z", campaign_id: "camp", lead_id: "lead", subject: "Re: 500 leads sin spam" });
    expect(chooseBouncedSend([paso1, paso2], BOUNCE_AT)).toMatchObject({ how: "mismo_lead", hit: { id: "p2" } });
    // Una respuesta manual y un envío de campaña al mismo destinatario: dudas → nada.
    expect(chooseBouncedSend([paso2, sinEnlace], BOUNCE_AT)).toMatchObject({ how: "ambiguo", hit: null });
  });
  it("sin candidatos, nada", () => {
    expect(chooseBouncedSend([], BOUNCE_AT)).toMatchObject({ how: "ninguno", hit: null, candidates: 0 });
  });
});
