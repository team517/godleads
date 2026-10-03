import { describe, expect, it } from "vitest";
import {
  buildConversations, deriveStatus, detailDate, displayName, editorToSource, effectiveStatus, EMPTY_FILTERS,
  filterConversations, isMobileReply, labelsForStatus, listDate, quoteHeader, replySubject, statusCounts,
  statusFromCategory, type InboxRow, type LeadStatus,
} from "@/lib/mobile-inbox";
import { isMobileAppPath, mobileAppUrl, notificationTarget, shouldOpenMobileApp, uniboxAllowed } from "@/lib/mobile-app";

let n = 0;
const row = (o: Partial<InboxRow>): InboxRow => ({
  id: `m${++n}`, account_id: "a1", lead_id: "l1", campaign_id: "c1", from_email: "x@empresa.es",
  subject: "Re: hola", body_text: "texto", received_at: "2026-10-02T10:00:00Z", is_read: false, labels: [], ...o,
});

describe("estados del contacto", () => {
  it("cada categoría del clasificador va a su estado de Instantly", () => {
    expect(statusFromCategory("interested")).toBe("interested");
    expect(statusFromCategory("question")).toBe("interested");
    expect(statusFromCategory("not_interested")).toBe("not_interested");
    expect(statusFromCategory("no_contactar")).toBe("not_interested");
    expect(statusFromCategory("derivado")).toBe("wrong_person");
    expect(statusFromCategory("out_of_office")).toBe("out_of_office");
    expect(statusFromCategory("neutral")).toBe("lead");
  });

  it("un fuera de la oficina DESPUÉS de un interesado no le quita el interés", () => {
    const msgs = [
      row({ labels: ["Fuera / Auto"], received_at: "2026-10-03T10:00:00Z" }),
      row({ labels: ["Interesado"], received_at: "2026-10-01T10:00:00Z" }),
    ];
    expect(deriveStatus(msgs)).toBe("interested");
    expect(deriveStatus([row({ labels: ["Fuera / Auto"] })])).toBe("out_of_office");
  });

  it("lo elegido a mano manda sobre lo deducido", () => {
    const [c] = buildConversations([row({ labels: ["Interesado"] })]);
    expect(effectiveStatus(c, new Map())).toBe("interested");
    expect(effectiveStatus(c, new Map<string, LeadStatus>([["x@empresa.es", "meeting_booked"]]))).toBe("meeting_booked");
  });

  it("las etiquetas del escritorio siguen al estado elegido en el móvil", () => {
    expect(labelsForStatus(["Interesado", "IA"], "not_interested")).toEqual(["IA", "No interesado"]);
    expect(labelsForStatus(["No interesado", "Importante"], "meeting_booked")).toEqual(["Importante", "Interesado"]);
    expect(labelsForStatus(["Interesado"], "closed")).toBeNull(); // ya está
    expect(labelsForStatus(["No contactar"], "not_interested")).toBeNull(); // más fuerte, se respeta
    expect(labelsForStatus(["Pregunta"], "lead")).toBeNull(); // Lead no toca nada
    expect(labelsForStatus([], "wrong_person")).toEqual(["Derivado"]);
    expect(labelsForStatus(null, "out_of_office")).toEqual(["Fuera / Auto"]);
  });
});

describe("conversaciones", () => {
  it("sólo respuestas reales: enlazadas, sin rebotes ni archivadas", () => {
    expect(isMobileReply(row({}))).toBe(true);
    expect(isMobileReply(row({ lead_id: null, campaign_id: null }))).toBe(false);
    expect(isMobileReply(row({ from_email: "mailer-daemon@ionos.es" }))).toBe(false);
    expect(isMobileReply(row({ is_archived: true }))).toBe(false);
  });

  it("agrupa por buzón + remitente, la más nueva arriba, con sus no leídos", () => {
    const list = buildConversations([
      row({ from_email: "Ana@Empresa.es", received_at: "2026-10-01T09:00:00Z", is_read: true }),
      row({ from_email: "ana@empresa.es", received_at: "2026-10-02T09:00:00Z", subject: "Re: segunda" }),
      row({ from_email: "luis@otra.es", received_at: "2026-10-01T12:00:00Z" }),
      row({ from_email: "ana@empresa.es", account_id: "a2", received_at: "2026-09-30T12:00:00Z" }),
    ]);
    expect(list.map((c) => c.key)).toEqual(["a1|ana@empresa.es", "a1|luis@otra.es", "a2|ana@empresa.es"]);
    expect(list[0].subject).toBe("Re: segunda");
    expect(list[0].messageIds).toHaveLength(2);
    expect(list[0].unreadIds).toHaveLength(1);
  });

  it("Others = sólo respuestas automáticas; si alguien escribió de verdad, va a Primary", () => {
    const [auto] = buildConversations([row({ auto_signal: "auto-submitted", subject: "Respuesta automática: Lucy" })]);
    expect(auto.tab).toBe("others");
    const [mixed] = buildConversations([
      row({ auto_signal: "auto-submitted", received_at: "2026-10-03T10:00:00Z" }),
      row({ body_text: "Me interesa, llámame", received_at: "2026-10-01T10:00:00Z" }),
    ]);
    expect(mixed.tab).toBe("primary");
  });

  it("nombre: el del remitente o Unknown (nunca un email ni '(sin asunto)')", () => {
    expect(displayName({ from_name: "Marta Ruiz" })).toBe("Marta Ruiz");
    expect(displayName({ from_name: null })).toBe("Unknown");
    expect(displayName({ from_name: "  " })).toBe("Unknown");
    expect(displayName({ from_name: "marta@x.es" })).toBe("Unknown");
    expect(displayName({ from_name: "=?UTF-8?Q?Mar=C3=ADa?=" })).toBe("María");
  });

  it("filtros: pestaña, estado, buzón, campaña, no leídos y búsqueda; contadores de las dos pestañas", () => {
    const list = buildConversations([
      row({ from_email: "a@a.es", labels: ["Interesado"], received_at: "2026-10-02T10:00:00Z" }),
      row({ from_email: "b@b.es", labels: ["No interesado"], is_read: true, campaign_id: "c2" }),
      row({ from_email: "c@c.es", auto_signal: "auto-submitted", labels: ["Fuera / Auto"] }),
    ]);
    const manual = new Map<string, LeadStatus>();
    expect(filterConversations(list, EMPTY_FILTERS, manual).map((c) => c.email)).toEqual(["a@a.es", "b@b.es"]);
    expect(filterConversations(list, { ...EMPTY_FILTERS, tab: "others" }, manual).map((c) => c.email)).toEqual(["c@c.es"]);
    expect(filterConversations(list, { ...EMPTY_FILTERS, status: "not_interested" }, manual).map((c) => c.email)).toEqual(["b@b.es"]);
    expect(filterConversations(list, { ...EMPTY_FILTERS, campaignId: "c2" }, manual).map((c) => c.email)).toEqual(["b@b.es"]);
    expect(filterConversations(list, { ...EMPTY_FILTERS, unreadOnly: true }, manual).map((c) => c.email)).toEqual(["a@a.es"]);
    expect(filterConversations(list, { ...EMPTY_FILTERS, search: "B.ES" }, manual).map((c) => c.email)).toEqual(["b@b.es"]);
    const counts = statusCounts(list, EMPTY_FILTERS, manual);
    expect(counts.interested).toEqual({ total: 1, unread: 1 });
    expect(counts.not_interested).toEqual({ total: 1, unread: 0 });
    expect(counts.out_of_office.total).toBe(1);
  });
});

describe("fechas y textos", () => {
  const now = new Date(2026, 9, 3, 13, 0);
  it("lista: hora hoy, Yesterday ayer y fecha larga antes", () => {
    expect(listDate(new Date(2026, 9, 3, 10, 24).toISOString(), now)).toBe("10:24 AM");
    expect(listDate(new Date(2026, 9, 2, 20, 24).toISOString(), now)).toBe("Yesterday");
    expect(listDate(new Date(2026, 9, 1, 8, 0).toISOString(), now)).toBe("October 1, 2026");
  });
  it("detalle: 'Friday, October 2, 2026 at 8:24 pm'", () => {
    expect(detailDate(new Date(2026, 9, 2, 20, 24).toISOString())).toBe("Friday, October 2, 2026 at 8:24 pm");
  });
  it("asunto de respuesta y cabecera de la cita", () => {
    expect(replySubject("Hola")).toBe("Re: Hola");
    expect(replySubject("RE: Hola")).toBe("RE: Hola");
    expect(quoteHeader({ from_email: "a@b.es", from_name: "Ana", received_at: new Date(2026, 9, 2, 20, 24).toISOString() }))
      .toMatch(/^El 2 oct 2026, 20:24, Ana <a@b\.es> escribió:$/);
  });
});

describe("cuadro de respuesta → texto que manda send-email", () => {
  const html = (s: string) => { const d = document.createElement("div"); d.innerHTML = s; return d; };
  it("texto sin formato: tal cual, sin escapar (lo escapa el servidor)", () => {
    expect(editorToSource(html("Hola Marta &amp; equipo <br>¿qué tal?"))).toBe("Hola Marta & equipo\n¿qué tal?");
  });
  it("líneas de Chrome y de Safari (div por línea) sin saltos de más", () => {
    expect(editorToSource(html("uno<div>dos</div><div><br></div><div>cuatro</div>"))).toBe("uno\ndos\n\ncuatro");
    expect(editorToSource(html("<div>a</div><div>b</div>"))).toBe("a\nb");
  });
  it("negrita, cursiva, subrayado y enlaces se mantienen; el resto se escapa", () => {
    expect(editorToSource(html("Hola <b>Marta</b>, mira <a href=\"https://calendly.com/onepulso\">mi agenda</a> &lt;3")))
      .toBe("Hola <b>Marta</b>, mira <a href=\"https://calendly.com/onepulso\">mi agenda</a> &lt;3");
    expect(editorToSource(html("<i>a</i> <u>b</u> <span style=\"font-weight: bold\">c</span>"))).toBe("<i>a</i> <u>b</u> <b>c</b>");
  });
  it("enlaces peligrosos fuera, tamaño de letra como span", () => {
    expect(editorToSource(html("<a href=\"javascript:alert(1)\">x</a>"))).toBe("x");
    expect(editorToSource(html("<font size=\"5\">grande</font>"))).toBe("<span style=\"font-size:19px\">grande</span>");
  });
});

describe("cuándo se abre la app del móvil", () => {
  it("rutas", () => {
    expect(isMobileAppPath("/m")).toBe(true);
    expect(isMobileAppPath("/metrics")).toBe(false);
    expect(isMobileAppPath("/modificaciones-ia")).toBe(false);
  });
  it("teléfono con la app instalada: siempre; en el navegador: sólo la Unibox; ordenador: nunca", () => {
    expect(shouldOpenMobileApp({ pathname: "/dashboard", phone: true, installed: true, allowed: true })).toBe(true);
    expect(shouldOpenMobileApp({ pathname: "/dashboard", phone: true, installed: false, allowed: true })).toBe(false);
    expect(shouldOpenMobileApp({ pathname: "/unibox", phone: true, installed: false, allowed: true })).toBe(true);
    expect(shouldOpenMobileApp({ pathname: "/unibox", phone: false, installed: true, allowed: true })).toBe(false);
    expect(shouldOpenMobileApp({ pathname: "/unibox", phone: true, installed: true, allowed: false })).toBe(false);
  });
  it("cuentas de cliente: sólo si tienen la Unibox", () => {
    expect(uniboxAllowed(null)).toBe(true);
    expect(uniboxAllowed([])).toBe(true);
    expect(uniboxAllowed(["/campaigns"])).toBe(false);
    expect(uniboxAllowed(["/campaigns", "/unibox"])).toBe(true);
  });
  it("una notificación abre la conversación (en la app del móvil, dentro de /m)", () => {
    expect(mobileAppUrl("?c=abc")).toBe("/m?c=abc");
    expect(mobileAppUrl("")).toBe("/m");
    expect(notificationTarget("/unibox?c=abc", "/m")).toBe("/m?c=abc");
    expect(notificationTarget("/unibox?c=abc", "/dashboard")).toBe("/unibox?c=abc");
    expect(notificationTarget("/unibox", "/m")).toBe("/m");
  });
});
