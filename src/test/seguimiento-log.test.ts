import { describe, expect, it } from "vitest";
import { fechaReprogramacion, hiloTrasUltimo, ultimosEnvios, type FollowUp } from "@/lib/seguimiento-log";

const fu = (p: Partial<FollowUp>): FollowUp => ({ id: Math.random().toString(36), contact_email: "a@x.es", status: "sent", scheduled_at: "2026-09-20T10:00:00Z", ...p });

describe("registro de últimos envíos", () => {
  it("una fila por persona, la más reciente arriba, con su próximo programado", () => {
    const r = ultimosEnvios([
      fu({ contact_email: "a@x.es", sent_at: "2026-09-20T10:00:00Z", body: "viejo" }),
      fu({ contact_email: "A@x.es", sent_at: "2026-09-25T10:00:00Z", body: "nuevo" }),
      fu({ contact_email: "b@y.es", sent_at: "2026-09-29T11:00:00Z" }),
      fu({ contact_email: "a@x.es", status: "scheduled", scheduled_at: "2026-10-02T10:00:00Z" }),
      fu({ contact_email: "c@z.es", status: "canceled" }),
    ]);
    expect(r.map((e) => e.ultimo.contact_email.toLowerCase())).toEqual(["b@y.es", "a@x.es"]);
    expect(r[1].ultimo.body).toBe("nuevo");
    expect(r[1].enviados).toBe(2);
    expect(r[1].programado?.scheduled_at).toBe("2026-10-02T10:00:00Z");
    expect(r[0].programado).toBeNull();
  });

  it("el nuevo contesta al último enviado y arrastra toda la cadena", () => {
    expect(hiloTrasUltimo(fu({ in_reply_to: "<a@m>", references_hdr: "<z@m> <a@m>", sent_message_id: "<b@onepulso.online>" })))
      .toEqual({ inReplyTo: "<b@onepulso.online>", references: "<z@m> <a@m> <b@onepulso.online>" });
    expect(hiloTrasUltimo(fu({ in_reply_to: "<a@m>" }))).toEqual({ inReplyTo: "<a@m>", references: "<a@m>" });
  });

  it("programa a 3 días laborables, a la misma hora, sin fines de semana", () => {
    const jueves = new Date(2026, 9, 1, 12, 0); // jueves 1 oct 2026
    const d = fechaReprogramacion(new Date(2026, 8, 29, 11, 41).toISOString(), jueves);
    expect([d.getDate(), d.getMonth(), d.getDay(), d.getHours(), d.getMinutes()]).toEqual([6, 9, 2, 11, 41]); // martes 6 oct 11:41
    const noche = fechaReprogramacion(new Date(2026, 8, 29, 22, 5).toISOString(), jueves);
    expect([noche.getHours(), noche.getMinutes()]).toEqual([17, 30]);
  });
});
