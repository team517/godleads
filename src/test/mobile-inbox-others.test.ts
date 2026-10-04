import { describe, expect, it } from "vitest";
import {
  blockedChecker, buildConversations, EMPTY_FILTERS, feedLane, filterConversations, isPrimaryRow, mergeWindow,
  newestCreated, PRIMARY_FEED, sortRows, statusCounts, upsertRows, withinOthersWindow, type InboxRow,
} from "@/lib/mobile-inbox";
import { campaignMatchCounts } from "@/lib/inbox-filters";

let n = 0;
const row = (o: Partial<InboxRow>): InboxRow => ({
  id: `o${++n}`, account_id: "a1", lead_id: null, campaign_id: null, from_email: `s${n}@pool.co`,
  subject: "Hola", body_text: "texto", received_at: "2026-10-04T10:00:00Z", is_read: false, labels: [], ...o,
});

describe("isPrimaryRow: la regla única de Primary (móvil) y Campañas (escritorio)", () => {
  it("lo de campaña sí", () => {
    expect(isPrimaryRow(row({ lead_id: "l1", in_campaign: true, match_why: "lead", subject: "Re: Mario - BeShiny" }))).toBe(true);
    expect(isPrimaryRow(row({ in_campaign: true, match_why: "dominio", from_email: "lucia@theofficeco.es", subject: "Re: una idea para The Office" }))).toBe(true);
    expect(isPrimaryRow(row({ in_campaign: true, match_why: "hilo", from_email: "ruth@gmail.com", subject: "RE: Project Plan" }))).toBe(true);
    expect(isPrimaryRow(row({ in_campaign: true, match_why: "marca", from_email: "leire@kurago.software", subject: "Respuesta automática: una idea para Kurago" }))).toBe(true);
  });
  it("warm-up, rebotes, ruido y lo que no coincide: no", () => {
    // Warm-up sin enlazar que cita nuestros buzones ("responde"): nunca Primary.
    expect(isPrimaryRow(row({ is_warmup: true, in_campaign: true, match_why: "responde", subject: "RE: Coffee Meetup" }))).toBe(false);
    expect(isPrimaryRow(row({ in_campaign: false, match_why: "warmup", subject: "Lucy - coffee? | KK5XRDN 0396QKE" }))).toBe(false);
    expect(isPrimaryRow(row({ in_campaign: true, match_why: "dominio", from_email: "postmaster2@rheinschrift.de", subject: "Unzustellbar: Lucy - Rheinschrift" }))).toBe(false);
    expect(isPrimaryRow(row({ in_campaign: true, match_why: "lead", from_email: "mailer-daemon@ionos.es", subject: "Re: hola" }))).toBe(false);
    expect(isPrimaryRow(row({ in_campaign: false, match_why: null, subject: "Factura" }))).toBe(false);
    // Enlazado y marcado warm-up por la sincronización: manda el servidor (en este caso, de campaña).
    expect(isPrimaryRow(row({ lead_id: "l1", is_warmup: true, in_campaign: true, match_why: "lead", subject: "Re: Juan - TTR Data" }))).toBe(true);
  });
});

describe("responde / marca: las respuestas reales cuentan como campaña (regresión)", () => {
  it("respuestas cortas en español o inglés no se toman por hilos del pool", () => {
    for (const subject of [
      "Re: Me interesa", "RE: Mas informacion", "RE: No gracias", "Re: Not interested", "RE: Call next week", "RE: John- Acme Srl",
      "Re: interesad", "RE: XAVI - Swing Maniacs", "Re: no te olvides de esto de Felidarity", "Automatic reply: XAVI - Camunda",
      "Baja", "RE: [EXTERNAL] XAVI - Signaturit", "Fuera de la oficina", "OOO Re: Maria - Affility",
    ]) {
      for (const why of ["responde", "marca"]) {
        expect(campaignMatchCounts({ in_campaign: true, match_why: why, subject }), `${why}: ${subject}`).toBe(true);
      }
    }
  });
});

describe("Others = \"Todos\" menos Primary", () => {
  it("el warm-up, los rebotes y el ruido van a Others, lo más nuevo arriba", () => {
    const list = buildConversations([
      row({ is_warmup: true, in_campaign: false, subject: "RE: Upcoming Software Upgrade", received_at: "2026-10-04T22:34:00Z" }),
      row({ from_email: "mailer-daemon@ionos.es", subject: "Mail delivery failed", received_at: "2026-10-04T22:00:00Z" }),
      row({ lead_id: "l1", in_campaign: true, match_why: "lead", from_email: "ana@empresa.es", subject: "Re: Juan - Empresa", received_at: "2026-10-03T09:00:00Z" }),
    ]);
    expect(list.map((c) => c.tab)).toEqual(["others", "others", "primary"]);
    expect(list[0].receivedAt).toBe("2026-10-04T22:34:00Z");
  });
  it("la misma fila de las dos fuentes cuenta una vez", () => {
    const r = row({ lead_id: "l1", in_campaign: true, match_why: "lead", subject: "Re: X - Y" });
    const [c] = buildConversations([r, { ...r }]);
    expect(c.messageIds).toHaveLength(1);
  });
  it("bloqueado: fuera, salvo que sea parte de un hilo (como \"Todos\" en el escritorio)", () => {
    const isBlocked = blockedChecker([{ entry_type: "domain", value: "spam.com" }, { entry_type: "email", value: "x@otro.es" }]);
    expect(isBlocked("A@Spam.com")).toBe(true);
    expect(isBlocked("x@otro.es")).toBe(true);
    expect(isBlocked("y@otro.es")).toBe(false);
    const rows = [
      row({ from_email: "a@spam.com", subject: "Oferta" }),
      row({ from_email: "b@spam.com", subject: "Re: hola", ref_chain: "<abc@onepulso.online>" }),
      row({ from_email: "c@libre.es", subject: "Hola" }),
    ];
    expect(buildConversations(rows, { isBlocked }).map((c) => c.email).sort()).toEqual(["b@spam.com", "c@libre.es"]);
  });
  it("mientras quede Others por bajar, la lista llega sólo hasta lo cargado", () => {
    const list = buildConversations([
      row({ subject: "nuevo", received_at: "2026-10-04T22:00:00Z" }),
      row({ subject: "viejo", received_at: "2026-10-01T10:00:00Z" }),
      row({ lead_id: "l1", in_campaign: true, match_why: "lead", subject: "Re: A - B", received_at: "2026-09-20T10:00:00Z" }),
    ]);
    const floor = "2026-10-04T21:00:00Z";
    const f = { ...EMPTY_FILTERS, tab: "others" as const };
    expect(filterConversations(list, f, new Map(), floor).map((c) => c.subject)).toEqual(["nuevo"]);
    expect(filterConversations(list, f, new Map(), null)).toHaveLength(2);
    expect(statusCounts(list, f, new Map(), floor).lead.total).toBe(1);
    // A Primary no le afecta.
    expect(filterConversations(list, EMPTY_FILTERS, new Map(), floor)).toHaveLength(1);
    expect(withinOthersWindow(list[2], floor)).toBe(true);
  });
});

describe("mezclar lo que llega del servidor", () => {
  it("upsert: lo nuevo sustituye por id, lo archivado se va, ordenado", () => {
    const a = row({ received_at: "2026-10-04T10:00:00Z" });
    const b = row({ received_at: "2026-10-04T11:00:00Z" });
    const out = upsertRows([a, b], [{ ...a, is_read: true }, row({ id: "nuevo", received_at: "2026-10-04T12:00:00Z" }), { ...b, is_archived: true }]);
    expect(out.map((r) => r.id)).toEqual(["nuevo", a.id]);
    expect(out[1].is_read).toBe(true);
  });
  it("ventana: dentro de la página fresca manda el servidor; más viejo se queda; cada carril con la suya", () => {
    const linkedOld = row({ lead_id: "l1", received_at: "2026-09-10T10:00:00Z" });
    const linkedGone = row({ lead_id: "l1", received_at: "2026-10-03T10:00:00Z" });   // archivado en otro sitio
    const otherOld = row({ received_at: "2026-10-01T10:00:00Z" });                       // otro carril, más viejo que su ventana
    const fresh = [row({ lead_id: "l1", received_at: "2026-10-04T10:00:00Z" }), row({ lead_id: "l1", received_at: "2026-10-02T10:00:00Z" }), row({ received_at: "2026-10-03T12:00:00Z" })];
    const out = mergeWindow([linkedOld, linkedGone, otherOld], fresh, feedLane);
    const ids = out.map((r) => r.id);
    expect(ids).toContain(linkedOld.id);
    expect(ids).toContain(otherOld.id);
    expect(ids).not.toContain(linkedGone.id);
    expect(out).toEqual(sortRows(out));
  });
  it("ventana: con varias filas a la misma hora en el corte, las que el servidor dejó fuera se quedan", () => {
    const t = "2026-10-04T10:00:00Z";
    // Orden del servidor: received_at desc, id desc. La página cortó tras "id-c": "id-b" y "id-a" quedan fuera.
    const fresh = [row({ id: "id-z", received_at: "2026-10-04T11:00:00Z" }), row({ id: "id-c", received_at: t })];
    const existing = [row({ id: "id-b", received_at: t }), row({ id: "id-a", received_at: t }), row({ id: "id-d", received_at: t })];
    const ids = mergeWindow(existing, fresh).map((r) => r.id);
    expect(ids).toContain("id-b");          // misma hora, id menor: fuera del corte → se queda
    expect(ids).toContain("id-a");
    expect(ids).not.toContain("id-d");      // misma hora, id mayor: dentro de la página y no vino → se va
    expect(ids).toEqual(["id-z", "id-c", "id-b", "id-a"]);
  });
  it("lo nuevo se pide por fecha de guardado (lo que la sincronización guarda tarde también llega)", () => {
    expect(newestCreated([row({ created_at: "2026-10-04T22:00:00Z" }), row({ created_at: "2026-10-04T22:05:00Z" }), row({})])).toBe("2026-10-04T22:05:00Z");
    expect(newestCreated([], "2026-10-04T22:00:00Z")).toBe("2026-10-04T22:00:00Z");
  });
  it("la ventana de Primary cabe en una respuesta de PostgREST (1.000 filas)", () => {
    expect(PRIMARY_FEED.linked + PRIMARY_FEED.other).toBeLessThanOrEqual(1000);
  });
});
