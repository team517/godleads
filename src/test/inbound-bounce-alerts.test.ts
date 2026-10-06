import { describe, expect, it } from "vitest";
import {
  bounceDismissal, chooseBouncedSend, decideBounce, normMid, parentRef, repliedToSend,
  type BounceCandidate, type BouncedSend,
} from "../../supabase/functions/_shared/bounce-match";
import { bounceInfo, ionosNoticeReason, isAutomatedSender } from "../../supabase/functions/_shared/bounce";
import { looksAutoSubject, parseInboundItem, splitFetchItems } from "../../supabase/functions/_shared/imap-parse";

/* Avisos de "No entregado" (06-10-2026). Queja del dueño: "salió el aviso de rebote y me respondió".
   Casos reales de los últimos días (direcciones inventadas, mismas fechas y formas). */

const cand = (over: Partial<BounceCandidate>): BounceCandidate => ({
  id: "s1", lead_id: null, campaign_id: null, bounced_at: null, user_id: "u1", to_email: "samuel@businessgo.es",
  subject: "RE: Samuel - Businessgo", created_at: "2026-10-06T10:53:19Z", how: "message_id", ...over,
});
const sent = (over: Partial<BouncedSend>): BouncedSend => ({
  id: "s1", to_email: "xavi@cafesilvestre.com", smtp_message_id: "<20261002.133544.b@onepulso-ventas.es>",
  bounced_at: "2026-09-28T08:06:15Z", campaign_id: null, error_message: "Rebote 5.0.0: 554 5.7.1 Service unavailable",
  created_at: "2026-10-02T13:35:46Z", ...over,
});

describe("parentRef: el correo al que contesta es el ÚLTIMO de la cadena", () => {
  it("toma el último identificador, en minúsculas y con <>", () => {
    expect(parentRef("<A@x.es> <B@Y.es>")).toBe("<b@y.es>");
    expect(parentRef("")).toBe("");
    expect(normMid("abc@x.es")).toBe("<abc@x.es>");
  });
  it("molotov.es (05-10): la respuesta arrastra en References el envío rebotado, pero contesta al reenvío", () => {
    const chain = "<1@onepulso.es> <rebotado@onepulso.es> <reenvio@onepulso.es>";
    expect(repliedToSend("<rebotado@onepulso.es>", [chain])).toBe(false);
    expect(repliedToSend("<reenvio@onepulso.es>", [chain])).toBe(true);
  });
});

describe("decideBounce: cuándo se marca y cuándo suena el móvil", () => {
  const info = { permanent: true, code: "5.7.1", recipients: ["samuel@businessgo.es"] };
  it("businessgo.es (06-10): Spamhaus 5.7.1 casado por Message-ID → se marca y avisa (era un rebote real)", () => {
    const d = decideBounce(info, { hit: cand({}), how: "message_id", candidates: 1 }, "2026-10-06T10:53:19Z");
    expect(d).toEqual({ mark: true, push: true, why: "" });
  });
  it("un retraso (4.x.x / delayed) nunca marca ni avisa", () => {
    const d = decideBounce({ permanent: false, code: "4.4.7", recipients: ["samuel@businessgo.es"] }, { hit: cand({}), how: "message_id", candidates: 1 }, "2026-10-06T12:00:00Z");
    expect(d).toMatchObject({ mark: false, push: false, why: "temporal" });
  });
  it("fallo definitivo con código 4.x.x (el servidor se rindió): se marca, pero no suena", () => {
    const d = decideBounce({ permanent: true, code: "4.4.1", recipients: [] }, { hit: cand({}), how: "message_id", candidates: 1 }, "2026-10-06T12:00:00Z");
    expect(d).toMatchObject({ mark: true, push: false });
  });
  it("el aviso es de OTRA dirección (una copia en CC): no se marca el envío", () => {
    const d = decideBounce({ ...info, recipients: ["compras@businessgo.es"] }, { hit: cand({}), how: "message_id", candidates: 1 }, "2026-10-06T10:53:19Z");
    expect(d).toMatchObject({ mark: false, why: "otro_destinatario" });
  });
  it("el destinatario ya contestó a ese mismo correo: llegó, no se marca", () => {
    const d = decideBounce(info, { hit: cand({}), how: "message_id", candidates: 1 }, "2026-10-06T10:53:19Z", true);
    expect(d).toMatchObject({ mark: false, push: false, why: "respondio" });
  });
  it("casado por asunto o por destinatario hace días: se marca, pero no suena", () => {
    expect(decideBounce(info, { hit: cand({ how: "destinatario" }), how: "asunto", candidates: 2 }, "2026-10-06T10:53:19Z").push).toBe(false);
    expect(decideBounce(info, { hit: cand({ how: "destinatario", created_at: "2026-10-01T10:00:00Z" }), how: "unico", candidates: 1 }, "2026-10-06T10:53:19Z"))
      .toMatchObject({ mark: true, push: false });
    expect(decideBounce(info, { hit: cand({ how: "destinatario" }), how: "unico", candidates: 1 }, "2026-10-06T10:53:40Z").push).toBe(true);
  });
  it("los envíos de campaña nunca avisan al móvil", () => {
    expect(decideBounce(info, { hit: cand({ campaign_id: "c1" }), how: "message_id", candidates: 1 }, "2026-10-06T10:53:19Z")).toMatchObject({ mark: true, push: false });
  });
  it("cafesilvestre.com: un rebote del 28-09 traído por un repaso NO puede colgarse de un envío del 02-10", () => {
    const later = cand({ id: "posterior", how: "destinatario", created_at: "2026-10-02T13:35:46Z", to_email: "xavi@cafesilvestre.com" });
    expect(chooseBouncedSend([later], "2026-09-28T08:06:15Z").hit).toBeNull();
  });
});

describe("bounceDismissal: el destinatario contesta al correo marcado como no entregado", () => {
  it("cafesilvestre.com (03-10): contesta justo a la respuesta marcada → se quita la marca", () => {
    const msg = bounceDismissal(sent({}), {
      from_email: "Xavi@CafeSilvestre.com", received_at: "2026-10-03T09:46:03Z",
      ref_chain: "<20260924.1@onepulso-ventas.es> <20260928.2@onepulso-ventas.es> <20261002.133544.b@onepulso-ventas.es>",
    });
    expect(msg).toBe("Rebote descartado: respondió · Rebote 5.0.0: 554 5.7.1 Service unavailable");
  });
  it("molotov.es: contesta a un envío POSTERIOR (el rebotado sólo va en References) → se queda marcado", () => {
    expect(bounceDismissal(sent({ smtp_message_id: "<rebotado@onepulso.es>", to_email: "xavi@molotov.es" }), {
      from_email: "xavi@molotov.es", received_at: "2026-10-05T08:19:15Z", ref_chain: "<1@onepulso.es> <rebotado@onepulso.es> <reenvio@onepulso.es>",
    })).toBeNull();
  });
  it("otra persona, un envío de campaña o una respuesta anterior al envío: no se toca", () => {
    const rc = "<20261002.133544.b@onepulso-ventas.es>";
    expect(bounceDismissal(sent({}), { from_email: "otra@cafesilvestre.com", received_at: "2026-10-03T09:46:03Z", ref_chain: rc })).toBeNull();
    expect(bounceDismissal(sent({ campaign_id: "c1" }), { from_email: "xavi@cafesilvestre.com", received_at: "2026-10-03T09:46:03Z", ref_chain: rc })).toBeNull();
    expect(bounceDismissal(sent({}), { from_email: "xavi@cafesilvestre.com", received_at: "2026-10-01T09:46:03Z", ref_chain: rc })).toBeNull();
    expect(bounceDismissal(sent({ bounced_at: null }), { from_email: "xavi@cafesilvestre.com", received_at: "2026-10-03T09:46:03Z", ref_chain: rc })).toBeNull();
  });
});

describe("aviso de IONOS 'Your email could not be delivered' (38% de los 'other')", () => {
  const ionos = (reason: string[]) => [
    "This is a multi-part message in MIME format.", "", "--IONOSB1", "Content-Type: text/plain; charset=utf-8", "",
    "Your email could not be delivered", "", "The following recipient address(es) could not be reached:", "", "* compras@taborbus.com", "",
    ...reason,
    "Possible reasons:", "- There may be a typo in the email address.", "- The email address may no longer exist or may no longer be in use.",
    "- The recipient's mailbox may be full or temporarily unavailable.", "",
    "--IONOSB1", "Content-Type: message/delivery-status", "", "Reporting-MTA: dns; mout.kundenserver.de", "",
    "Final-Recipient: rfc822; compras@taborbus.com", "Action: failed", "Status: 5.0.0", "",
    "--IONOSB1", "Content-Type: message/rfc822", "", "From: Lucy <lucy@onepulso-ventas.es>", "To: compras@taborbus.com",
    "Subject: Propuesta para Taborbus", "Message-ID: <20261005.111.abc@onepulso-ventas.es>", "", "Hola, ¿qué tal? La caja no está bloqueada ni es spam.", "--IONOSB1--",
  ].join("\r\n");
  const ct = 'multipart/report; report-type=delivery-status; boundary="IONOSB1"';
  const subj = "Mail delivery failed: returning message to sender";

  it("buzón inexistente: 550 5.1.1 → recipient_gone, con el código concreto", () => {
    const b = bounceInfo("mailer-daemon@kundenserver.de", subj, ct, ionos(["550 5.1.1 <compras@taborbus.com>: Recipient address rejected: User does not exist", ""]))!;
    expect(b).toMatchObject({ cls: "recipient_gone", permanent: true, code: "5.1.1", recipients: ["compras@taborbus.com"] });
    expect(b.diag).toContain("does not exist");
    expect(b.original.message_id).toBe("<20261005.111.abc@onepulso-ventas.es>");
  });
  it("lista negra (Spamhaus) → policy, aunque la copia de nuestro correo diga 'spam'", () => {
    const b = bounceInfo("mailer-daemon@kundenserver.de", subj, ct, ionos(["Technical details:", "554 5.7.1 Service unavailable; Client host [82.165.159.37] blocked using zen.spamhaus.org", ""]))!;
    expect(b).toMatchObject({ cls: "policy", code: "5.7.1" });
    expect(b.diag).toContain("spamhaus");
  });
  it("'Requested action not taken: mailbox unavailable' sin código → recipient_gone", () => {
    const b = bounceInfo("mailer-daemon@kundenserver.de", subj, ct, ionos(["Requested action not taken: mailbox unavailable", ""]))!;
    expect(b.cls).toBe("recipient_gone");
  });
  it("sólo la lista genérica de causas: sigue 'other' (no se inventa un motivo)", () => {
    const b = bounceInfo("mailer-daemon@kundenserver.de", subj, ct, ionos([]))!;
    expect(b).toMatchObject({ cls: "other", code: "5.0.0", permanent: true });
    expect(ionosNoticeReason(ionos([]).split("--IONOSB1\r\nContent-Type: message/rfc822")[0])).toBe("");
  });
  it("motivo en la misma línea de la dirección", () => {
    expect(ionosNoticeReason("could not be reached:\n\n* juan@acme.com: 550 5.1.1 user unknown\n\nPossible reasons:\n- There may be a typo")).toBe("550 5.1.1 user unknown");
  });
});

describe("remitentes automáticos y fuera de oficina", () => {
  it("isAutomatedSender sólo con la parte local entera (o tras un separador)", () => {
    for (const e of ["noreply@acme.com", "no-reply@acme.com", "info-noreply@acme.com", "bounce@acme.com", "mailer-daemon@kundenserver.de", "postmaster@acme.com", "do-not-reply@acme.com"]) expect(isAutomatedSender(e), e).toBe(true);
    for (const e of ["jbounce@acme.com", "tonoreply@acme.com", "juan@acme.com", "bounce.manager@acme.com"]) expect(isAutomatedSender(e), e).toBe(false);
  });
  it("asuntos de contestador estrictos: un 'Re:' normal no lo es", () => {
    for (const s of ["Abwesenheit: Samuel", "Ausente: Re: Lucy - Acme", "Ausencia: vacaciones", "Out-of-office: una idea", "RE: Respuesta automática: Lucy"]) expect(looksAutoSubject(s), s).toBe(true);
    for (const s of ["Re: Ausencias de personal en Acme", "RE: Samuel - Businessgo", "Re: Out of stock", "Ausentismo laboral", "Re: una idea para Acme"]) expect(looksAutoSubject(s), s).toBe(false);
  });
  it("fuera de oficina SIN cabecera Auto-Submitted: auto_signal = 'subject:auto' (no para la secuencia)", () => {
    const header = ["From: Marta <marta@mivisa.com>", "Subject: Fuera de la oficina: Alfons - mivisa", "Message-ID: <ooo1@mivisa.com>", "In-Reply-To: <x@onepulso-ventas.es>"].join("\r\n") + "\r\n\r\n";
    const body = "Vuelvo el lunes 14.\r\n";
    const raw = `* 1 FETCH (UID 901 INTERNALDATE "06-Oct-2026 10:00:00 +0200" BODY[HEADER.FIELDS (FROM)] {${header.length}}\r\n${header} BODY[TEXT]<0> {${body.length}}\r\n${body})\r\nA1 OK done\r\n`;
    const p = parseInboundItem(splitFetchItems(raw).items[0], { accountEmail: "lucy@onepulso-ventas.es", imapUsername: "lucy@onepulso-ventas.es" });
    if (p.status !== "message") throw new Error("mal");
    expect(p.msg.kind).toBe("auto_reply");
    expect(p.msg.auto_signal).toBe("subject:auto");
  });
  it("una respuesta humana 'RE: …' sigue sin señal", () => {
    const header = ["From: Samuel <samuel@businessgo.es>", "Subject: RE: Samuel - Businessgo", "Message-ID: <h1@businessgo.es>"].join("\r\n") + "\r\n\r\n";
    const body = "Me interesa, llamadme.\r\n";
    const raw = `* 1 FETCH (UID 902 INTERNALDATE "06-Oct-2026 10:00:00 +0200" BODY[HEADER.FIELDS (FROM)] {${header.length}}\r\n${header} BODY[TEXT]<0> {${body.length}}\r\n${body})\r\nA1 OK done\r\n`;
    const p = parseInboundItem(splitFetchItems(raw).items[0], { accountEmail: "lucy@onepulso-ventas.es", imapUsername: "lucy@onepulso-ventas.es" });
    if (p.status !== "message") throw new Error("mal");
    expect(p.msg.kind).toBe("human");
    expect(p.msg.auto_signal).toBe("");
  });
});
