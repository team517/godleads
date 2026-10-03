import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INBOUND_FETCH_ITEMS, autoSignal, imapCompleted, looksAutoSubject, messageDate, parseInboundItem, pickFolders, refIds, splitFetchItems,
  type FetchItem, type InboundMessage,
} from "../../supabase/functions/_shared/imap-parse";
import { bounceInfo } from "../../supabase/functions/_shared/bounce";
import { classifyMessage } from "../../supabase/functions/_shared/classify";

/* Auditoría del correo entrante (02-10-2026). Cada caso es un correo tal como lo devuelve el
   servidor IMAP (cabeceras + cuerpo dentro de sus literales) y se comprueba que el lector lo
   entrega entero y bien clasificado: nada puede desaparecer por su forma. */

const CRLF = "\r\n";
/** El socket se lee como windows-1252 (1 byte = 1 carácter): un texto UTF-8 llega así. */
const wire = (s: string) => Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join("");
const b64 = (s: string) => btoa(wire(s)).replace(/(.{76})/g, "$1\r\n");

const ACCOUNT = { accountEmail: "lucy@onepulso-ventas.es", imapUsername: "lucy@onepulso-ventas.es" };
const OUR_ID = "<20261001.101500.abcdefghij.k1m2n3@onepulso-ventas.es>";

interface Mail { uid: number; headers: string[]; body: string; flags?: string; internalDate?: string }
/** Un elemento "* N FETCH (...)" como lo manda el servidor. */
function fetchItem(m: Mail, seq = m.uid, order: "normal" | "text-first" = "normal"): string {
  const header = m.headers.join(CRLF) + CRLF + CRLF;
  const idate = m.internalDate || "02-Oct-2026 11:43:12 +0200";
  const h = `BODY[HEADER.FIELDS (FROM TO SUBJECT)] {${header.length}}${CRLF}${header}`;
  const t = `BODY[TEXT]<0> {${m.body.length}}${CRLF}${m.body}`;
  const flags = m.flags ? ` FLAGS (${m.flags})` : "";
  return order === "normal"
    ? `* ${seq} FETCH (UID ${m.uid} INTERNALDATE "${idate}"${flags} ${h} ${t})${CRLF}`
    : `* ${seq} FETCH (${t} ${h} INTERNALDATE "${idate}" UID ${m.uid})${CRLF}`;
}
const response = (items: string[], tag = "A005") => items.join("") + `${tag} OK Fetch completed (0.004 + 0.000 secs).${CRLF}`;

function one(m: Mail): InboundMessage {
  const { items, truncated } = splitFetchItems(response([fetchItem(m)]));
  expect(truncated).toBe(false);
  expect(items).toHaveLength(1);
  const p = parseInboundItem(items[0], ACCOUNT);
  if (p.status !== "message") throw new Error("no se leyó como mensaje: " + JSON.stringify(p));
  return p.msg;
}

const baseHeaders = (extra: string[] = []) => [
  "From: Javier Ruiz <javier@acordia.es>",
  "To: Lucy <lucy@onepulso-ventas.es>",
  "Subject: Re: Lucy - ACORDIA ACR, SL",
  "Date: Fri, 02 Oct 2026 11:40:00 +0200",
  "Message-ID: <CAF123abc@mail.acordia.es>",
  ...extra,
];

describe("respuestas de una persona", () => {
  it("1. respuesta normal con In-Reply-To", () => {
    const m = one({ uid: 101, headers: baseHeaders([`In-Reply-To: ${OUR_ID}`, "Content-Type: text/plain; charset=utf-8"]), body: wire("Hola Lucy, sí, me interesa. ¿Hablamos el martes?") + CRLF });
    expect(m.from_email).toBe("javier@acordia.es");
    expect(m.from_name).toBe("Javier Ruiz");
    expect(m.kind).toBe("human");
    expect(m.auto_signal).toBe("");
    expect(refIds(m.ref_chain)).toEqual([OUR_ID]);
    expect(m.body_text).toContain("me interesa");
    expect(m.to_emails).toContain("lucy@onepulso-ventas.es");
    expect(m.message_id).toBe("CAF123abc@mail.acordia.es");
  });

  it("2. respuesta con References (cadena entera, plegada en dos líneas)", () => {
    const m = one({ uid: 102, headers: baseHeaders([`References: <otro@x.com>${CRLF} ${OUR_ID}`]), body: "Vale, mándame info." + CRLF });
    expect(refIds(m.ref_chain)).toEqual(["<otro@x.com>", OUR_ID]);
  });

  it("3. respuesta SIN In-Reply-To ni References: se guarda igual (se enlazará por remitente)", () => {
    const m = one({ uid: 103, headers: baseHeaders(), body: "Buenas, llamadme al 600 000 000." + CRLF });
    expect(m.ref_chain).toBe("");
    expect(m.from_email).toBe("javier@acordia.es");
  });

  it("12. baja: se guarda y las reglas la leen como No contactar", () => {
    const m = one({ uid: 112, headers: baseHeaders(), body: wire("Por favor, dadme de baja de vuestra lista. No me escribáis más.") + CRLF });
    expect(m.kind).toBe("human");
    expect(classifyMessage(m.subject, m.body_text)).toBe("no_contactar");
  });

  it("27. Reply-To distinto de From: el remitente es From y Reply-To se conserva", () => {
    const m = one({ uid: 127, headers: baseHeaders(["Reply-To: compras@acordia.es"]), body: "Escribid a compras." + CRLF });
    expect(m.from_email).toBe("javier@acordia.es");
    expect(m.reply_to).toBe("compras@acordia.es");
  });

  it("28. asunto cambiado por completo: el hilo sigue en References", () => {
    const h = baseHeaders([`References: ${OUR_ID}`]).map((x) => x.startsWith("Subject:") ? "Subject: Presupuesto 2027" : x);
    const m = one({ uid: 128, headers: h, body: "Os paso lo que necesitamos." + CRLF });
    expect(m.subject).toBe("Presupuesto 2027");
    expect(refIds(m.ref_chain)).toEqual([OUR_ID]);
  });

  it("25. sin Message-ID ni Date: se guarda con la fecha interna del servidor (fija en cada lectura)", () => {
    const h = ["From: javier@acordia.es", "Subject: hola"];
    const a = one({ uid: 125, headers: h, body: "sin identificador" + CRLF, internalDate: "30-Sep-2026 09:15:00 +0200" });
    const b = one({ uid: 125, headers: h, body: "sin identificador" + CRLF, internalDate: "30-Sep-2026 09:15:00 +0200" });
    expect(a.message_id).toBe("");
    expect(a.date).toBe("2026-09-30T07:15:00.000Z");
    expect(b.date).toBe(a.date);
  });
});

describe("respuestas automáticas (fuera de oficina)", () => {
  it("4. Microsoft 365: cabeceras de Exchange", () => {
    const m = one({
      uid: 204,
      headers: [
        "From: Marta Soler <marta.soler@mivisa-group.com>", "Subject: =?utf-8?Q?Respuesta_autom=C3=A1tica:_Alfons_-_mivisa_envases?=",
        "Date: Fri, 02 Oct 2026 11:40:00 +0200", "Message-ID: <AM9PR04MB1234@eurprd04.prod.outlook.com>",
        "Auto-Submitted: auto-generated", "X-MS-Exchange-Inbox-Rules-Loop: marta.soler@mivisa-group.com", "X-Auto-Response-Suppress: All",
        `In-Reply-To: ${OUR_ID}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: quoted-printable",
      ],
      body: "<html><body><p>Estar=C3=A9 fuera de la oficina hasta el 14 de octubre.</p></body></html>" + CRLF,
    });
    expect(m.subject).toBe("Respuesta automática: Alfons - mivisa envases");
    expect(m.kind).toBe("auto_reply");
    expect(m.auto_signal).toBe("auto-submitted:auto-generated");
    expect(m.body_text).toContain("Estaré fuera de la oficina");
    expect(classifyMessage(m.subject, m.body_text)).toBe("out_of_office");
  });

  it("5. Gmail: contestador de vacaciones con el asunto ORIGINAL y sin palabra clave en el texto", () => {
    const m = one({
      uid: 205,
      headers: baseHeaders(["Auto-Submitted: auto-replied", "X-Autoreply: yes", "Precedence: bulk", `In-Reply-To: ${OUR_ID}`]),
      body: wire("Gracias por tu mensaje. Responderé a mi regreso.") + CRLF,
    });
    // Las reglas de texto NO lo ven como fuera de oficina: lo delata la cabecera.
    expect(m.kind).toBe("auto_reply");
    expect(m.auto_signal).toBe("auto-submitted:auto-replied");
  });

  it("6-8. asuntos de contestador en español, inglés, alemán, francés, italiano, catalán, portugués y neerlandés", () => {
    for (const s of [
      "Respuesta automática: una idea para Acme", "Automatic reply: una idea para Acme", "Out of Office: una idea", "Fuera de la oficina",
      "Automatische Antwort: una idea para Acme", "Abwesenheitsnotiz", "Réponse automatique : une idée", "Risposta automatica: idea para Lafert",
      "Resposta automàtica: john - Elastomer", "Resposta automática: john - Elastomer", "Automatisch antwoord: Maria - Aqua Aero", "Autosvar: hej",
    ]) expect(looksAutoSubject(s), s).toBe(true);
    for (const s of ["Re: Lucy - ACORDIA ACR, SL", "una idea para Acme", "Re: te dejaste esto en H2H", "Automatización de facturas"]) expect(looksAutoSubject(s), s).toBe(false);
  });

  it("26. contestador sin In-Reply-To: sigue siendo una respuesta automática (cabecera) y se guarda", () => {
    const m = one({ uid: 226, headers: ["From: info@glenair.es", "Subject: Ausente", "Auto-Submitted: auto-replied", "Message-ID: <x1@glenair.es>"], body: "Vuelvo el lunes." + CRLF });
    expect(m.kind).toBe("auto_reply");
    expect(m.ref_chain).toBe("");
  });

  it("Auto-Submitted: no es un correo escrito por una persona", () => {
    expect(autoSignal("Auto-Submitted: no\r\n")).toBe("");
    expect(autoSignal("X-Autorespond: yes\r\n")).toBe("x-autorespond");
    expect(autoSignal("Precedence: auto_reply\r\n")).toBe("precedence:auto_reply");
    expect(autoSignal("Precedence: bulk\r\n")).toBe("");
  });

  it("un acuse de noreply@ también se lee (antes se tiraba sin más)", () => {
    const m = one({ uid: 230, headers: ["From: Soporte <noreply@acordia.es>", "Subject: Hemos recibido su mensaje", "Message-ID: <t1@acordia.es>", `In-Reply-To: ${OUR_ID}`], body: "Le responderemos lo antes posible." + CRLF });
    expect(m.automated_sender).toBe(true);
    expect(m.kind).toBe("human");
    expect(m.bounce).toBeNull();
  });
});

describe("rebotes", () => {
  const dsn = (status: string, diag: string, action = "failed") => [
    "This is a MIME-encapsulated message.", "", "--BOUND123456", "Content-Type: text/plain", "",
    "The following address failed:", "    juan@empresa.com", "", "--BOUND123456", "Content-Type: message/delivery-status", "",
    "Reporting-MTA: dns; mout.kundenserver.de", "", "Final-Recipient: rfc822; juan@empresa.com", `Action: ${action}`, `Status: ${status}`,
    `Diagnostic-Code: smtp; ${diag}`, "", "--BOUND123456--", "",
  ].join(CRLF);
  const dsnHeaders = ["From: Mail Delivery System <mailer-daemon@kundenserver.de>", "Subject: Mail delivery failed: returning message to sender",
    "Message-ID: <E1abc@mout.kundenserver.de>", "Auto-Submitted: auto-replied",
    'Content-Type: multipart/report; report-type=delivery-status; boundary="BOUND123456"'];

  it("9. rebote duro (el buzón no existe): se identifica, con destinatario y código, y se deja de escribir a esa dirección", () => {
    const { items } = splitFetchItems(response([fetchItem({ uid: 309, headers: dsnHeaders, body: dsn("5.1.1", "550 5.1.1 <juan@empresa.com>: Recipient address rejected: User unknown") })]));
    const p = parseInboundItem(items[0], ACCOUNT);
    if (p.status !== "message") throw new Error("mal");
    expect(p.msg.kind).toBe("bounce");
    expect(p.msg.bounce).toMatchObject({ recipients: ["juan@empresa.com"], code: "5.1.1", cls: "recipient_gone", permanent: true });
    expect(p.suppress).toEqual(["juan@empresa.com"]);
  });

  it("10. rebote blando (retraso 4.x.x): se anota como temporal y NO suprime a nadie", () => {
    const { items } = splitFetchItems(response([fetchItem({ uid: 310, headers: dsnHeaders.map((h) => h.startsWith("Subject") ? "Subject: Warning: message delayed" : h), body: dsn("4.4.7", "451 4.4.7 Message delayed, still retrying", "delayed") })]));
    const p = parseInboundItem(items[0], ACCOUNT);
    if (p.status !== "message") throw new Error("mal");
    expect(p.msg.bounce).toMatchObject({ cls: "temporary", permanent: false, code: "4.4.7" });
    expect(p.suppress).toEqual([]);
  });

  it("11. rechazo por política/spam (5.7.1): antes no dejaba ningún rastro; ahora queda anotado, sin suprimir al lead", () => {
    const { items } = splitFetchItems(response([fetchItem({ uid: 311, headers: dsnHeaders, body: dsn("5.7.1", "550 5.7.1 Message rejected as spam by content filtering") })]));
    const p = parseInboundItem(items[0], ACCOUNT);
    if (p.status !== "message") throw new Error("mal");
    expect(p.msg.bounce).toMatchObject({ cls: "policy", permanent: true, recipients: ["juan@empresa.com"] });
    expect(p.suppress).toEqual([]);
  });

  it("aviso de Exchange desde una dirección que no es mailer-daemon: es un rebote, no una respuesta", () => {
    const b = bounceInfo("microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@sonaca-es.com", "Undeliverable: una idea para Aciturri Tech",
      'multipart/report; report-type=delivery-status; boundary="x"', "Your message to pedro@aciturri.com couldn't be delivered.\r\nStatus: 5.1.10\r\nDiagnostic-Code: smtp;550 5.1.10 RESOLVER.ADR.RecipientNotFound");
    expect(b).toMatchObject({ cls: "recipient_gone", permanent: true });
    expect(b!.recipients).toContain("pedro@aciturri.com");
  });

  it("aviso de IONOS: la clase sale de lo que dice el servidor, no de la copia de nuestro correo que va debajo", () => {
    const body = [
      "This message was created automatically by mail delivery software.", "",
      "A message that you sent could not be delivered to one or more of", "its recipients. This is a permanent error. The following address(es)", "failed:", "",
      "  compras@taborbus.com:",
      "    SMTP error from remote server for RCPT TO command, host: mx.taborbus.com (203.0.113.9) reason: 550 5.1.1 <compras@taborbus.com>: Recipient address rejected: User unknown", "",
      "--- The header of the original message is following. ---", "",
      "Received: from [10.0.0.1] by mrelayeu.kundenserver.de id 0Mabc; Fri, 02 Oct 2026 12:18:00 +0200",
      "DKIM-Signature: v=1; a=rsa-sha256; d=onepulso-ventas.es; s=s1-ionos;",
      "Subject: 500 leads sin spam para Taborbus", "",
    ].join(CRLF);
    const b = bounceInfo("mailer-daemon@kundenserver.de", "Mail delivery failed: returning message to sender", "text/plain", body);
    expect(b).toMatchObject({ cls: "recipient_gone", permanent: true, code: "5.1.1", recipients: ["compras@taborbus.com"] });
    expect(b!.diag).toContain("User unknown");
    // El mismo aviso con un rechazo por contenido: política, no "buzón inexistente".
    const spam = bounceInfo("mailer-daemon@kundenserver.de", "Mail delivery failed: returning message to sender", "text/plain",
      body.replace("550 5.1.1 <compras@taborbus.com>: Recipient address rejected: User unknown", "554 5.7.1 Message rejected as spam"));
    expect(spam).toMatchObject({ cls: "policy", permanent: true });
    // Dominio que ya no recibe correo.
    const dead = bounceInfo("mailer-daemon@kundenserver.de", "Mail delivery failed: returning message to sender", "text/plain",
      body.replace(/SMTP error[^\r]*/, "Unrouteable address"));
    expect(dead).toMatchObject({ cls: "recipient_gone" });
  });

  it("el aviso devuelve el correo original: se saca su Message-ID y su asunto para colgar el rebote del envío exacto", () => {
    // IONOS: la copia del original va como message/rfc822 debajo del aviso.
    const ionos = [
      "Your email could not be delivered", "The following recipient address(es) could not be reached:", "* support@onepulso.online", "",
      "--BOUND9", "Content-Type: message/delivery-status", "", "Final-Recipient: rfc822; support@onepulso.online", "Action: failed", "Status: 5.0.0", "",
      "--BOUND9", "Content-Type: message/rfc822", "",
      "Received: from [10.0.0.1] by mrelayeu.kundenserver.de id 0Mabc; Sat, 03 Oct 2026 22:47:29 +0200",
      "From: Mario <mario@tunuevoleadpower.com>", "To: support@onepulso.online",
      "Subject: =?UTF-8?Q?Re=3A_interesado_=E2=80=94_reuni=C3=B3n?=",
      "Message-ID: <20261003.204729.j6sqi9rohz.bwsgqh@tunuevoleadpower.com>", "", "Hola, te paso el enlace.", "--BOUND9--",
    ].join(CRLF);
    const { items } = splitFetchItems(response([fetchItem({ uid: 312, headers: dsnHeaders, body: ionos })]));
    const p = parseInboundItem(items[0], ACCOUNT);
    if (p.status !== "message") throw new Error("mal");
    expect(p.msg.bounce?.original).toEqual({ message_id: "<20261003.204729.j6sqi9rohz.bwsgqh@tunuevoleadpower.com>", subject: "Re: interesado — reunión" });
    // Exim: sólo las cabeceras del original, tras la línea "--- The header of the original message ---".
    const exim = ["A message that you sent could not be delivered. The following address(es) failed:", "  juan@empresa.com:", "    550 5.1.1 User unknown", "",
      "--- The header of the original message is following. ---", "", "Subject: Propuesta", "Message-ID:", "  <abc.def@onepulso-ventas.es>", ""].join(CRLF);
    expect(bounceInfo("mailer-daemon@kundenserver.de", "Mail delivery failed: returning message to sender", "text/plain", exim)!.original)
      .toEqual({ message_id: "<abc.def@onepulso-ventas.es>", subject: "Propuesta" });
    // Un aviso que no devuelve el original: sin Message-ID, y no se inventa uno.
    expect(bounceInfo("mailer-daemon@kundenserver.de", "Mail delivery failed: returning message to sender", "text/plain",
      "The following address(es) failed:\r\n  juan@empresa.com:\r\n    550 5.1.1 User unknown\r\n")!.original).toEqual({ message_id: "", subject: "" });
  });

  it("una respuesta humana que menciona un rebote NO es un rebote, ni lo es un acuse de lectura", () => {
    expect(bounceInfo("javier@acordia.es", "Re: Undeliverable: lo que os comenté", "text/plain", "Me rebotó vuestro correo, escribidme aquí.")).toBeNull();
    expect(bounceInfo("javier@acordia.es", "Leído: Lucy - ACORDIA", 'multipart/report; report-type=disposition-notification; boundary="x"', "Su mensaje fue leído.")).toBeNull();
  });
});

describe("formas del cuerpo (MIME)", () => {
  it("13. sólo HTML", () => {
    const m = one({ uid: 413, headers: baseHeaders(["Content-Type: text/html; charset=utf-8"]), body: wire("<html><body><p>Sí, <b>llámame</b> mañana.</p></body></html>") + CRLF });
    expect(m.body_html).toContain("<b>llámame</b>");
    expect(m.body_text).toContain("llámame");
  });

  it("14. sólo texto", () => {
    const m = one({ uid: 414, headers: baseHeaders(["Content-Type: text/plain; charset=utf-8"]), body: wire("Línea uno.\r\n\r\nLínea dos (con paréntesis).") + CRLF });
    expect(m.body_text).toBe("Línea uno.\n\nLínea dos (con paréntesis).");
    expect(m.body_html).toBe("");
  });

  it("15. multipart/alternative", () => {
    const body = ["--000000000000aaa111", 'Content-Type: text/plain; charset="UTF-8"', "", wire("Buenos días, ¿qué precio tiene?"), "",
      "--000000000000aaa111", 'Content-Type: text/html; charset="UTF-8"', "", wire("<div>Buenos días, ¿qué precio tiene?</div>"), "", "--000000000000aaa111--", ""].join(CRLF);
    const m = one({ uid: 415, headers: baseHeaders(['Content-Type: multipart/alternative; boundary="000000000000aaa111"']), body });
    expect(m.body_text).toBe("Buenos días, ¿qué precio tiene?");
    expect(m.body_html).toContain("<div>Buenos días");
  });

  it("16. quoted-printable en ISO-8859-1", () => {
    const m = one({ uid: 416, headers: baseHeaders(["Content-Type: text/plain; charset=iso-8859-1", "Content-Transfer-Encoding: quoted-printable"]), body: "Ma=F1ana le env=EDo la informaci=F3n." + CRLF });
    expect(m.body_text).toBe("Mañana le envío la información.");
  });

  it("17. base64", () => {
    const m = one({ uid: 417, headers: baseHeaders(["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64"]), body: b64("No estamos interesados, gracias.") + CRLF });
    expect(m.body_text).toBe("No estamos interesados, gracias.");
  });

  it("asunto vacío y cuerpo vacío: el correo no se pierde", () => {
    const m = one({ uid: 418, headers: ["From: javier@acordia.es", "Subject:", "Message-ID: <vacio@acordia.es>"], body: "" });
    expect(m.subject).toBe("(sin asunto)");
    expect(m.body_text).toBe("");
  });
});

describe("troceo de la respuesta de FETCH", () => {
  it("el cuerpo puede citar líneas de IMAP sin descuadrar nada", () => {
    const tramposo = ["Te reenvío el log:", "* 12 FETCH (UID 9999 BODY[TEXT] {5}", "hola)", "A005 OK Fetch completed.", "From: otro@malo.com", "Message-ID: <falso@malo.com>", ")", ""].join(CRLF);
    const r = response([
      fetchItem({ uid: 501, headers: baseHeaders(), body: tramposo }),
      fetchItem({ uid: 502, headers: baseHeaders().map((h) => h.startsWith("Message-ID") ? "Message-ID: <segundo@acordia.es>" : h), body: "segundo" + CRLF }),
    ]);
    const { items, truncated } = splitFetchItems(r);
    expect(truncated).toBe(false);
    expect(items.map((i) => i.uid)).toEqual([501, 502]);
    const a = parseInboundItem(items[0], ACCOUNT);
    if (a.status !== "message") throw new Error("mal");
    expect(a.msg.from_email).toBe("javier@acordia.es");
    expect(a.msg.message_id).toBe("CAF123abc@mail.acordia.es");
    expect(a.msg.body_text).toContain("A005 OK Fetch completed.");
    expect(imapCompleted(r.slice(-400), "A005")).toBe("OK");
  });

  it("el servidor puede devolver los datos en otro orden (cuerpo antes que cabeceras, UID al final)", () => {
    const { items } = splitFetchItems(response([fetchItem({ uid: 503, headers: baseHeaders(), body: "orden raro" + CRLF }, 3, "text-first")]));
    expect(items[0]).toMatchObject({ uid: 503, complete: true });
    const p = parseInboundItem(items[0], ACCOUNT);
    expect(p.status === "message" && p.msg.body_text).toBe("orden raro");
  });

  it("18-19. un correo ya leído desde otro dispositivo (\\Seen) se lee igual; no se pide nunca por 'no leídos'", () => {
    const { items } = splitFetchItems(response([fetchItem({ uid: 518, headers: baseHeaders(), body: "ya abierto en el móvil" + CRLF, flags: "\\Seen \\Answered" })]));
    expect(items).toHaveLength(1);
    expect(parseInboundItem(items[0], ACCOUNT).status).toBe("message");
    expect(INBOUND_FETCH_ITEMS).toContain("BODY.PEEK[");          // leer no marca el correo como leído
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/fetch-inbox/index.ts"), "utf8");
    expect(src).not.toMatch(/SEARCH[^\n`]*\b(UNSEEN|NEW|RECENT)\b/);   // la búsqueda es por UID, no por estado
    expect(src).toMatch(/UID FETCH \$\{lo\}/);
  });

  it("20-21. respuesta cortada (caída de la conexión): el mensaje a medias NO se da por leído", () => {
    const full = response([
      fetchItem({ uid: 520, headers: baseHeaders(), body: "entero" + CRLF }),
      fetchItem({ uid: 521, headers: baseHeaders().map((h) => h.startsWith("Message-ID") ? "Message-ID: <b@acordia.es>" : h), body: "x".repeat(4000) + CRLF }),
    ]);
    const cortada = full.slice(0, full.length - 1500);
    const { items, truncated } = splitFetchItems(cortada);
    expect(truncated).toBe(true);
    expect(items.filter((i) => i.complete).map((i) => i.uid)).toEqual([520]);
    expect(imapCompleted(cortada.slice(-400), "A005")).toBeNull();
    const medio = items.find((i) => !i.complete)!;
    expect(parseInboundItem(medio, ACCOUNT)).toMatchObject({ status: "skipped", reason: "incomplete" });
  });

  it("un aviso suelto del servidor entre mensajes no se confunde con un correo", () => {
    const r = response([fetchItem({ uid: 530, headers: baseHeaders(), body: "uno" + CRLF }), `* 7 FETCH (FLAGS (\\Seen))${CRLF}`, `* 8 EXISTS${CRLF}`]);
    const { items } = splitFetchItems(r);
    expect(items.filter((i) => i.header || i.text).map((i) => i.uid)).toEqual([530]);
  });

  it("23-24. el mismo Message-ID dos veces da la misma clave: la base de datos lo guarda una sola vez", () => {
    const m = { uid: 540, headers: baseHeaders(), body: "duplicado" + CRLF };
    const a = one(m), b = one({ ...m, uid: 77 });
    expect("mid:" + a.message_id.toLowerCase()).toBe("mid:" + b.message_id.toLowerCase());
  });
});

describe("remitentes difíciles", () => {
  const item = (headers: string[]): FetchItem => splitFetchItems(response([fetchItem({ uid: 600, headers, body: "texto" + CRLF })])).items[0];

  it("la dirección envuelta entera en una palabra codificada", () => {
    const p = parseInboundItem(item([`From: =?UTF-8?B?${btoa("Wang Wei <wang@fabrica.cn>")}?=`, "Subject: hola"]), ACCOUNT);
    expect(p.status === "message" && p.msg.from_email).toBe("wang@fabrica.cn");
  });

  it("un asunto que contiene 'From:' delante de la cabecera From no confunde al lector", () => {
    const p = parseInboundItem(item(["Subject: Re: Invoice from: ACME", "From: Ana <ana@acme.com>", "Message-ID: <z@acme.com>"]), ACCOUNT);
    expect(p.status === "message" && p.msg.from_email).toBe("ana@acme.com");
    expect(p.status === "message" && p.msg.subject).toBe("Re: Invoice from: ACME");
  });

  it("sin From legible se usa Reply-To; sin ninguno queda anotado como 'sin remitente' (no en silencio)", () => {
    const a = parseInboundItem(item(["From: <>", "Reply-To: ventas@acme.com", "Subject: aviso"]), ACCOUNT);
    expect(a.status === "message" && a.msg.from_email).toBe("ventas@acme.com");
    const b = parseInboundItem(item(["Subject: sin nada"]), ACCOUNT);
    expect(b).toMatchObject({ status: "skipped", reason: "no_from", uid: 600 });
  });

  it("la copia de un envío nuestro no es correo entrante", () => {
    expect(parseInboundItem(item(["From: Lucy <LUCY@onepulso-ventas.es>", "Subject: hola"]), ACCOUNT)).toMatchObject({ status: "skipped", reason: "own_copy" });
  });

  it("el nombre nunca acaba como dirección (cabecera plegada)", () => {
    const p = parseInboundItem(item([`From: "Ignacio Garcia Cuadrado, Director Comercial"${CRLF} <ignacio@empresa.es>`, "Subject: hola"]), ACCOUNT);
    expect(p.status === "message" && p.msg.from_email).toBe("ignacio@empresa.es");
  });
});

describe("fecha del mensaje", () => {
  it("manda la cabecera Date cuando es razonable", () => {
    expect(messageDate("Fri, 02 Oct 2026 11:40:00 +0200", "02-Oct-2026 11:43:12 +0200")).toBe("2026-10-02T09:40:00.000Z");
  });
  it("reloj del remitente mal (futuro, o años atrás): vale la fecha en que NUESTRO servidor lo recibió", () => {
    expect(messageDate("Mon, 01 Jan 2029 10:00:00 +0000", "02-Oct-2026 11:43:12 +0200")).toBe("2026-10-02T09:43:12.000Z");
    expect(messageDate("Thu, 01 Jan 2015 10:00:00 +0000", "02-Oct-2026 11:43:12 +0200")).toBe("2026-10-02T09:43:12.000Z");
    expect(messageDate("no es una fecha", "02-Oct-2026 11:43:12 +0200")).toBe("2026-10-02T09:43:12.000Z");
  });
  it("sin ninguna de las dos, una fecha fija", () => {
    expect(messageDate("", "")).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("22. carpetas que se leen", () => {
  const list = (rows: [string, string][]) => rows.map(([flags, name]) => `* LIST (${flags}) "/" "${name}"${CRLF}`).join("") + `A002 OK List completed.${CRLF}`;

  it("IONOS: INBOX, la carpeta de spam y las carpetas propias; nunca enviados, borradores ni papelera", () => {
    const f = pickFolders(list([
      ["\\HasNoChildren", "INBOX"], ["\\HasNoChildren \\Sent", "Elementos enviados"], ["\\HasNoChildren \\Drafts", "Borradores"],
      ["\\HasNoChildren \\Trash", "Papelera"], ["\\HasNoChildren \\Junk", "Spam"], ["\\HasNoChildren", "Clientes"], ["\\HasNoChildren \\Archive", "Archivo"],
      ["\\Noselect \\HasChildren", "Carpetas"],
    ]));
    expect(f.spam).toBe("Spam");
    expect(f.extra).toEqual(["Clientes", "Archivo"]);
  });

  it("la carpeta de spam se reconoce por su marca aunque se llame de otra forma, y por su nombre si no hay marca", () => {
    expect(pickFolders(list([["\\HasNoChildren", "INBOX"], ["\\Junk", "Correo basura"]])).spam).toBe("Correo basura");
    expect(pickFolders(list([["\\HasNoChildren", "INBOX"], ["\\HasNoChildren", "Correo no deseado"]])).spam).toBe("Correo no deseado");
  });

  it("Gmail: no se leen las vistas que lo repiten todo", () => {
    const f = pickFolders(list([
      ["\\HasNoChildren", "INBOX"], ["\\All \\HasNoChildren", "[Gmail]/Todos"], ["\\HasNoChildren \\Sent", "[Gmail]/Enviados"],
      ["\\Flagged \\HasNoChildren", "[Gmail]/Destacados"], ["\\HasNoChildren \\Junk", "[Gmail]/Spam"], ["\\HasNoChildren", "Proveedores"],
    ]));
    expect(f.spam).toBe("[Gmail]/Spam");
    expect(f.extra).toEqual(["Proveedores"]);
  });
});
