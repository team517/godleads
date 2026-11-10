import { describe, expect, it } from "vitest";
import { cortarCita, evaluarVuelta, horaLocalAUtc, parseOooReturn, programarVuelta } from "../../supabase/functions/_shared/ooo-return";

/* Fuera de oficina → día de vuelta (10-11-2026). Las frases calcan la FORMA de respuestas reales de
   los últimos 30 días (etiqueta "Fuera / Auto"), pero anonimizadas: los nombres, correos, empresas y
   teléfonos son inventados (el repositorio es público). */
const OCT20 = "2026-10-20T08:00:00Z";
const NOV05 = "2026-11-05T09:30:00Z";

const vuelve = (t: string, recibido = OCT20) => parseOooReturn(t, recibido).date;

describe("parseOooReturn — formas reales con fecha", () => {
  it("until Monday 26th → el día siguiente (27)", () => {
    expect(vuelve("I'm out of office until Monday 26th with limited access to internet. For urgent matters please contact ops@example.com")).toBe("2026-10-27");
  });
  it("until October 28! → 29 de octubre", () => {
    expect(vuelve("Dear Sender, Thank you very much for your email. I am out of office with limited access to my emails until October 28! For other matters, please contact team@example.org")).toBe("2026-10-29");
  });
  it("I will be back on Monday 2nd of November → 2 de noviembre", () => {
    expect(vuelve("Dear sender, Thanks for your e-mail, Please note that I'm out of the office with limited access to my emails, I will be back on Monday 2nd of November Regards, Alex", "2026-10-28T10:00:00Z")).toBe("2026-11-02");
  });
  it("Absent du les 19 au 30 octobre → 31 de octubre (rango)", () => {
    expect(vuelve("Bonjour, Absent du les 19 au 30 octobre, vous pouvez contacter un collègue pour toute urgence. Cdlt.", "2026-10-19T07:00:00Z")).toBe("2026-10-31");
  });
  it("till 28th Oct → 29 de octubre", () => {
    expect(vuelve("Dear Sender, I'm out for business trip till 28th Oct, with limited access to the email. Whatsapp only: +00 000 000 000. Thanks.")).toBe("2026-10-29");
  });
  it("je serai de retour le lundi 26 octobre → 26 de octubre", () => {
    expect(vuelve("Bonjour, Actuellement en congés, je serai de retour le lundi 26 octobre. Je prendrais connaissance de vos messages à mon retour. Cordialement")).toBe("2026-10-26");
  });
  it("until next 13th October → 14 de octubre", () => {
    expect(vuelve("Thanks for your message. I am out of office, and I will have no access to the e-mail until next 13th October. For any urgent matter, please call +00 00 000 00 00. Thank you!", "2026-10-06T09:00:00Z")).toBe("2026-10-14");
  });
  it("no me incorporaré hasta mayo de 2027 → 1 de mayo de 2027", () => {
    expect(vuelve("Gracias por tu mensaje. Estaré ausente por un periodo prolongado y no me incorporaré hasta mayo de 2027. Si necesitas cualquier cosa, escribe a equipo@example.com", NOV05)).toBe("2027-05-01");
  });
  it("until tomorrow → el día siguiente; la fecha del correo citado no cuenta", () => {
    expect(vuelve("I am currently out of office until tomorrow. If the matter is urgent please contact help@example.com Thank you, On 4 Nov 2026, at 10:27, Someone wrote: > Hola, > > Soy alguien", "2026-11-04T10:30:00Z")).toBe("2026-11-05");
  });
  it("from October 7th to 16th … I'll resume normal activity on the 19th → 19 (la vuelta explícita manda)", () => {
    expect(vuelve("**Please be advised that I'll be travelling from October 7th to 16th with a very limited access to the e-mail. I'll resume normal activity on the 19th. Thanks and regards**", "2026-10-07T06:00:00Z")).toBe("2026-10-19");
  });
  it("OOO afternoon of Nov 29th and on Nov 30th → 1 de diciembre", () => {
    expect(vuelve("Hello, I will be OOO afternoon of Nov 29th and on Nov 30th, with no access to my e-mail or Teams. The project repository has been shared", NOV05)).toBe("2026-12-01");
  });
  it("out of office October 16 until October 21 both included → 22 de octubre", () => {
    expect(vuelve("Dear Customer, Thank you for your message. Please be advised that I will be out of office October 16 until October 21 both included. I will have limited access to my email", "2026-10-16T08:00:00Z")).toBe("2026-10-22");
  });
  it("hasta el 21 de octubre → 22 de octubre", () => {
    expect(vuelve("Hola, Gracias por tu mensaje. Estaré fuera de la oficina y tendré acceso limitado al correo hasta el 21 de octubre. A mi vuelta, responderé a tu mensaje lo antes posible.")).toBe("2026-10-22");
  });
  it("will be back on January 7th, 2027 → 7 de enero de 2027", () => {
    expect(vuelve("Hi there, Thank you for your message! I'm currently on leave and will be back on January 7th, 2027. If you have any questions please write to support@example.com", NOV05)).toBe("2027-01-07");
  });
});

describe("parseOooReturn — formas reales SIN fecha o que no son vacaciones", () => {
  const sinFecha = [
    "Thank you for you email. I will be OOO for a few weeks. I’ll reply as soon as possible. If it’s urgent, please contact me via WhatsApp +00 000000000",
    "Thank you for your email. I am currently on medical leave and do not have access to my email. Messages sent to this address will not be read or processed.",
    "Hola, Actualmente estoy fuera de la oficina debido a mi permiso de paternidad. Su E-Mail no será reenviado a otro remitente. En el tiempo que esté fuera, me sustituye un compañero.",
    "Bonjour, je suis absent du bureau avec accès à mes mails sera limité. En cas d&#39;urgence me contacter par téléphone Hello, I&#39;ll be out of the office and have limited access to my emails.",
    "Hola, Gracias por tu correo. Estaré fuera de la oficina. Puedes contar con el equipo para responder a tu mensaje. Por favor, reenvía tu correo a las siguientes personas para una atención inmediata:",
  ];
  it.each(sinFecha)("sin fecha: %s", (t) => {
    expect(parseOooReturn(t, OCT20).date).toBeNull();
  });
  const noVacaciones = [
    "Una persona ya no forma parte del equipo. Para cualquier asunto puede ponerse en contacto en otra@example.com",
    "Thank you for your email. Please note that this person is no longer part of the organization. Their responsibilities have been taken over by a colleague.",
    "Hola, Gracias por tu mensaje. Esta cuenta de correo electrónico ya no está operativa. Para cualquier consulta, dirígete a oficina@example.com",
    "El destinatario de este correo ha causado baja en la empresa. Por favor, remitan el correo a: general@example.com",
    "Hola, Acabas de enviarme un e-mail por primera vez. Mi mensajería está protegida contra los ciberataques por la solución Protect de Mailinblack.",
    "¡Un clic para enviar tu correo electrónico! Hola, Estoy protegido por Protect de Mailinblack , una solución de ciberseguridad",
  ];
  it.each(noVacaciones)("no es una ausencia: %s", (t) => {
    const r = parseOooReturn(t, OCT20);
    expect(r.date).toBeNull();
    expect(r.notVacation).toBe(true);
  });
  it("'OOO for a few weeks' no tiene fecha pero sí referencia de tiempo (candidato para la IA)", () => {
    expect(parseOooReturn(sinFecha[0], OCT20).hasTimeRef).toBe(true);
  });
});

describe("parseOooReturn — otros idiomas y formatos", () => {
  it("italiano: rientro il 3 novembre → 3", () => { expect(vuelve("Sono fuori ufficio, rientro il 3 novembre.")).toBe("2026-11-03"); });
  it("italiano: fino al 30 ottobre → 31", () => { expect(vuelve("Sarò in ferie fino al 30 ottobre.")).toBe("2026-10-31"); });
  it("alemán: bis zum 28. Oktober → 29", () => { expect(vuelve("Ich bin bis zum 28. Oktober nicht im Büro.")).toBe("2026-10-29"); });
  it("alemán: zurück am 2. November → 2", () => { expect(vuelve("Ich bin im Urlaub, zurück am 2. November.")).toBe("2026-11-02"); });
  it("portugués: até 25 de outubro → 26", () => { expect(vuelve("Estou de férias até 25 de outubro.")).toBe("2026-10-26"); });
  it("numérica europea: hasta el 30/10 → 31", () => { expect(vuelve("Estaré fuera hasta el 30/10, gracias.")).toBe("2026-10-31"); });
  it("numérica inglesa imposible en europeo: until 11/15 → 16 de noviembre", () => { expect(vuelve("Out until 11/15.")).toBe("2026-11-16"); });
  it("del 19 al 30 de octubre → 31", () => { expect(vuelve("Estaré de vacaciones del 19 al 30 de octubre.")).toBe("2026-10-31"); });
  it("hasta el lunes → el próximo lunes tras la recepción", () => {
    // 2026-10-20 es martes → el lunes siguiente es el 26
    expect(vuelve("Estoy fuera hasta el lunes, gracias.")).toBe("2026-10-26");
  });
  it("hasta mañana → recibido + 1", () => { expect(vuelve("Fuera de la oficina hasta mañana.")).toBe("2026-10-21"); });
  it("vuelvo el 7 de enero escrito en diciembre → enero del año siguiente", () => {
    expect(vuelve("Estoy de vacaciones, vuelvo el 7 de enero.", "2026-12-20T10:00:00Z")).toBe("2027-01-07");
  });
  it("un contestador olvidado (hasta el 28 de octubre recibido el 5 de noviembre) queda en el pasado", () => {
    const d = vuelve("Estaré fuera hasta el 28 de octubre.", NOV05);
    expect(d).toBe("2026-10-29");
    expect(evaluarVuelta(d, NOV05)).toBe("pasada");
  });
  it("los teléfonos y los códigos no son fechas", () => {
    expect(vuelve("Out of office. Urgent: +00 00 000 00 00 or 000 000 000. Error 4.4.5")).toBeNull();
  });
});

describe("cortarCita", () => {
  it("corta en 'On … wrote:' y en las líneas citadas", () => {
    expect(cortarCita("Hasta el lunes.\nOn 4 Nov 2026, at 10:27, Ana wrote:\n> hola")).toBe("Hasta el lunes.\n");
    expect(cortarCita("Fuera.\n> El 3 de noviembre")).toBe("Fuera.");
  });
});

describe("evaluarVuelta y programarVuelta", () => {
  it("futura / pasada / lejana / sin fecha", () => {
    expect(evaluarVuelta("2026-10-29", OCT20)).toBe("futura");
    expect(evaluarVuelta("2026-10-20", OCT20)).toBe("pasada");
    expect(evaluarVuelta("2028-01-01", OCT20)).toBe("lejana");
    expect(evaluarVuelta(null, OCT20)).toBe("sin_fecha");
  });
  it("a la hora de inicio de la campaña en su zona (Madrid en invierno = UTC+1)", () => {
    expect(programarVuelta("2026-11-03", "Europe/Madrid", 9)).toBe("2026-11-03T08:00:00.000Z");
  });
  it("en verano Madrid es UTC+2", () => {
    expect(horaLocalAUtc("2026-07-15", 9, "Europe/Madrid")).toBe("2026-07-15T07:00:00.000Z");
  });
  it("sábado o domingo → lunes", () => {
    expect(programarVuelta("2026-10-31", "Europe/Madrid", 9)).toBe("2026-11-02T08:00:00.000Z"); // sábado
    expect(programarVuelta("2026-11-01", "Europe/Madrid", 9)).toBe("2026-11-02T08:00:00.000Z"); // domingo
  });
  it("otra zona (Ciudad de México, UTC−6) y zona inválida → Madrid", () => {
    expect(programarVuelta("2026-11-03", "America/Mexico_City", 10)).toBe("2026-11-03T16:00:00.000Z");
    expect(programarVuelta("2026-11-03", "No/Existe", 9)).toBe("2026-11-03T08:00:00.000Z");
  });
});

describe("parseOooReturn — casos reales que fallaban en la primera pasada (anonimizados)", () => {
  it("returning on Tuesday, November 3 → 3 (coma tras el día)", () => {
    expect(vuelve("I am out of the office, returning on Tuesday, November 3. For immediate assistance please contact someone@example.org", "2026-10-26T08:00:00Z")).toBe("2026-11-03");
  });
  it("I'll be back on November, 02nd → 2 (coma tras el mes)", () => {
    expect(vuelve("I'm out of the office. For urgent reply, please write to sales@example.com. I'll be back on November, 02nd.", "2026-10-30T08:00:00Z")).toBe("2026-11-02");
  });
  it("à mon retour, le LUNDI 02/11/2026 → 2", () => {
    expect(vuelve("Bonjour, Absents. Je prendrai connaissance de votre message à mon retour, le LUNDI 02/11/2026.", "2026-10-26T08:00:00Z")).toBe("2026-11-02");
  });
  it("on an extended leave returning 29th November → 29", () => {
    expect(vuelve("Thank you for your email, I am now on an extended leave returning 29th November.", "2026-11-06T08:00:00Z")).toBe("2026-11-29");
  });
  it("Hope to come back to my desk on Oct. 28th → 28", () => {
    expect(vuelve("I will be out of my office on October 27th for personal leave. Hope to come back to my desk on Oct. 28th.", "2026-10-27T08:00:00Z")).toBe("2026-10-28");
  });
  it("catalán: fins el proper 25 d'octubre → 26", () => {
    expect(vuelve("Bon dia, Seré fora de l’oficina fins el proper 25 d'octubre.", "2026-10-23T08:00:00Z")).toBe("2026-10-26");
  });
  it("formatos pegados: back by Monday 02Nov2026 → 2 · until 19OCT2026 → 20", () => {
    expect(vuelve("I am currently out of office and will be back by Monday 02Nov2026, morning.", "2026-10-30T08:00:00Z")).toBe("2026-11-02");
    expect(vuelve("Hello I am out of the office until 19OCT2026 and will respond after my return.", "2026-10-13T08:00:00Z")).toBe("2026-10-20");
  });
  it("una jubilación no es una ausencia temporal", () => {
    const r = parseOooReturn("I am on leave and will not be returning to the office until my retirement scheduled for November 1st.", "2026-10-27T08:00:00Z");
    expect(r.notVacation).toBe(true);
  });
  it("'estaré fuera a partir del 30' es cuando se va, no cuando vuelve", () => {
    expect(vuelve("Estaré fuera de la oficina a partir del 30 de octubre con acceso limitado al correo.")).not.toBe("2026-10-30");
  });
});
