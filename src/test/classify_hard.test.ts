import { describe, it, expect } from "vitest";
import { classifyMessage } from "@/lib/classify";

// ADVERSARIAL battery: mixed signals, courtesy-then-rejection, referrals without a
// name, RGPD vs neutral curiosity, short/terse, Catalan/English. Each row lists the
// ACCEPTABLE label(s) — some are genuinely ambiguous, so more than one is fine as
// long as it lands on a SAFE side.
const CASES: Array<[string[], string]> = [
  // mixed signals — baja manda
  [["no_contactar"], "Me interesa pero quitadme de la lista, no quiero más correos."],
  [["no_contactar"], "Interesting, but please unsubscribe me."],
  // courtesy then rejection
  [["not_interested"], "Gracias por la info, pero ya tenemos proveedor."],
  [["not_interested"], "Thanks, we're all set for now."],
  // engagement wins over a soft doubt
  [["interested"], "Interesante, ¿cuándo podemos hablar?"],
  [["interested"], "Cuéntame precios y disponibilidad."],
  [["interested"], "Estem interessats, quan podem parlar?"],
  // doubt → PREGUNTA (no inflar interesados)
  [["question"], "¿Podéis mandarme el precio? Aunque no sé si encaja."],
  [["question"], "No estoy seguro, ¿qué incluye exactamente?"],
  // short/terse rejection vs neutral
  [["not_interested"], "No, gracias."],
  [["not_interested", "neutral"], "Ok, gracias."], // ambiguo: cortesía seca → lado seguro
  [["question"], "¿Esto qué es?"],
  // referral without a name
  [["derivado"], "Esto lo lleva otro departamento."],
  [["derivado", "interested", "neutral"], "Se lo paso a mi jefe."], // ambiguo: reenvío interno
  // REAL (Oesia): forwarded to the purchasing dept + a corporate legal disclaimer whose
  // word "internamente" used to leak this to not_interested. It's a referral → derivado.
  [["derivado"], "Hola John, He reenviado tu correo al área de compras por si tu ofrecimiento es de interés. Si fuera así, ellos se pondrían en contacto contigo directamente. Un saludo, Francisco. ESTE CORREO ELECTRÓNICO Y SUS ANEXOS SON DE USO INTERNO, POR LO QUE SOLAMENTE SE PUEDE DISTRIBUIR INTERNAMENTE EN EL GRUPO OESÍA Y TAMBIÉN A CLIENTES, PROVEEDORES Y PARTNERS SI ES ESTRICTAMENTE NECESARIO."],
  // OOO must beat everything, even "urgent contact X"
  [["out_of_office"], "Estoy de vacaciones. Para urgencias, contacta con soporte@empresa.com."],
  [["out_of_office"], "Estoy de baja médica hasta septiembre."],
  // RGPD/angry vs neutral curiosity
  [["no_contactar"], "¿De dónde habéis sacado mis datos? Esto viola el RGPD."],
  [["question", "neutral"], "¿De dónde has sacado mi email?"],
  // English do-not-contact
  [["no_contactar"], "Take me off your list."],
  [["no_contactar"], "This is unsolicited, remove me."],
  // clear interest variants
  [["interested"], "Sí, me encaja. Reservemos una llamada la semana que viene."],
  [["interested"], "Book me in for a demo."],
  // clear not-interested variants
  [["not_interested"], "Ahora mismo no es prioridad para nosotros."],
  [["not_interested"], "Ho fem internament, gràcies."],
  // question variants
  [["question"], "¿Trabajáis con empresas de nuestro sector?"],
  [["question"], "Who are you and what do you do exactly?"],
  // edge: empty / symbols
  [["neutral"], "   "],
  [["neutral"], "👍"],
  // bare date/time is NOT interest (timestamps, signatures, OOO leaks) — the bug reported
  [["neutral"], "Confirmado, lo revisamos el jueves 20."],
  [["neutral"], "Nuestro horario de oficina es de 9h a 18h."],
  [["neutral", "question"], "Recibí tu correo el martes a las 10."],
  // a date/time WITH a meeting word IS interest
  [["interested"], "Perfecto, el jueves a las 10 me viene bien."],
  [["interested"], "Podemos hacer la llamada el martes a las 16h."],
  // French rejections (REVIMA case) — must NOT read as interested
  [["not_interested"], "Bonjour, j'ai bien reçu vos multiples relances. Toutefois, nous n'avons pas dans nos matériels de composants/références électroniques. Bien cordialement, Stéphane"],
  [["not_interested"], "Merci mais ça ne nous intéresse pas."],
  [["not_interested", "neutral"], "Nous n'avons pas besoin de ce service pour le moment."],
  // "indisponible" = UNavailable (opposite of interest) — the /disponible/ leak
  [["neutral", "not_interested", "question"], "Ces composants sont actuellement indisponibles chez nous."],
  [["neutral", "not_interested"], "Ce produit est indisponible dans notre catalogue."],
  // a SERVICE/thing being "disponible" is NOT the prospect's interest (real false
  // positive: a Colegio de Aparejadores newsletter). Must NOT be "interested".
  [["neutral", "question", "out_of_office"], "El servicio de asesoramiento y gestión de accidentes está disponible 24/7 en el teléfono 659 904 889."],
  [["neutral", "question"], "Nuestro horario está disponible en la web y el producto disponible en tienda."],
  // but the PERSON stating their own availability to meet IS interest
  [["interested"], "Estoy disponible el jueves por la mañana para la llamada."],
  [["interested"], "Te paso mi disponibilidad para la reunión."],
  // August multilingual absences / inactive accounts / auto-replies → out_of_office
  [["out_of_office"], "Este correo no será leído hasta el 17 de agosto, si es urgente contacta con Virginia."],
  [["out_of_office"], "Hola, seré fora de l'oficina fins el proper 31 d'agost."],
  [["out_of_office"], "Je serai absent du 7 au 24 août 2026 inclus."],
  [["out_of_office"], "Summer break, from August 10th to 21st. For urgent queries contact me."],
  [["out_of_office"], "Este correo se encuentra inactivo, por favor contactar con sandra@twic.es"],
  // multilingual not-interested
  [["not_interested"], "No need thank you."],
  [["not_interested"], "En Nayar hacemos nuestro propio software, gracias por contactarme."],
  [["not_interested"], "Buongiorno. Siamo a posto grazie mille."],
  [["not_interested"], "Gracias, en estos momentos no es nuestro caso."],
  // not the decision-maker → derivado
  [["derivado", "neutral"], "No decido nada en los temas que me mencionas. Saludos."],
  // ── REAL (ANIMSA, 2026-09-04): polite out-of-scope rejection with NO literal "no me interesa".
  // Was labelled Interesado in prod and "question" by the old rules (the relative clause
  // "clientes que tienen otras empresas" matched the wh-word pattern). Must be a NO.
  [["not_interested"], "Hola. ANIMSA es una empresa pública, que solo presta servicios a las Entidades Públicas de Navarra que son accionistas de ANIMSA, por lo que no tenemos la necesidad de captación de clientes que tienen otras empresas. Gracias, y un saludo"],
  [["not_interested"], "Gracias, pero no tenemos necesidad de este servicio."],
  [["not_interested"], "No necesitamos captar clientes, trabajamos solo con socios."],
  [["not_interested"], "Solo prestamos servicios a nuestros asociados, no captamos clientes externos."],
  [["not_interested"], "Somos una empresa pública y no hacemos captación comercial."],
  [["not_interested"], "Esto no aplica a nuestro caso. Un saludo."],
  [["not_interested"], "No procede, no trabajamos con proveedores externos."],
  [["not_interested"], "No nos hace falta, gracias."],
  // a relative clause "que tiene(n)" is NOT a question (must never read as Pregunta)
  [["neutral", "not_interested"], "Trabajamos con clientes que tienen otras necesidades y proveedores que ya conocen."],
  // …but a real interrogative still is
  [["question"], "¿Qué tiene de especial vuestro servicio?"],
  [["question"], "Hola. Cuánto cuesta al mes?"],
  // a no-need sentence next to an explicit info request stays warm (engagement wins)
  [["interested", "question"], "Ahora mismo no tenemos necesidad, pero mándame la información y el precio por si acaso."],
  // ── REAL threads with OUR quoted outreach + legal footers (the text that must be IGNORED).
  // emxys: hot lead; the footer "return the original message" used to flag it out_of_office.
  [["interested"], "Hola John, Casualmente estamos buscando un IC de categoría RadHard que nos está costando encontrar: TI M4FR5969SRGZT (Qty: 3). A ver si puedes averiguar si tienes disponibles. Saludos, Francisco\n\nEl 05/08/2026 a las 9:48, John Lopez escribió:\n> Hola Francisco, si tenéis algún componente que os esté costando localizar, enviadnos el número de pieza.\n> Sin compromiso.\n\nThis message and any attachments are confidential. If you have received this in error please notify us immediately and return the original message to us."],
  // adarsa: engaged reply; the RGPD footer ("datos personales… tratamiento") used to force no_contactar.
  [["interested", "question"], "Buenas tardes, John. Lo comento con el cliente y te informo. Por otra parte, ¿me puedes pasar los datos de tu empresa? Gracias. Emilio\n\nInformación básica sobre protección de datos. Responsable: Adarsa. Finalidad: gestión de contactos. De conformidad con el Reglamento (UE) 2016/679 en lo que respecta al tratamiento de datos personales."],
  // kalkan: rescheduling a call = interest; "looking forward to" in OUR quoted mail used to read as a referral.
  [["interested"], "Buen día Gavin, we need to move the call for 11AM Spanish time, I have an investor meeting at 10AM. Cosmin\n\n> On Tue, Gavin wrote:\n> Looking forward to speaking with you both!\n> Kind regards"],
  // rtvcyl: "debes dirigirte a la dirección" = referral; the LOPD footer used to make it no_contactar.
  [["derivado"], "Hola Javier; debes dirigirte a la dirección de la empresa porque yo estoy en la redacción de informativos; si quieres te paso su correo. Saludos\n\nInformación básica sobre protección de datos. Responsable: Radio Televisión de Castilla y León. Ley Orgánica 3/2018, de Protección de Datos Personales y garantía de los derechos digitales."],
  // OUR quoted "si ahora mismo no es una prioridad, dímelo" must never turn THEIR reply into a no
  [["interested"], "Sí, hablemos la semana que viene.\n\nEl lun, 1 sept, Javier escribió:\n> ¿Tienes 10 minutos esta semana? Y si ahora mismo no es una prioridad, dímelo sin problema y no vuelvo a molestar."],
  // an auto-reply that itself STARTS with a footer-like phrase must still be out_of_office
  [["out_of_office"], "Este correo no será leído hasta el 22 de septiembre. Para urgencias contacta con recepcion@empresa.es"],
  // ── "I'm BACK from holidays and interested" is the opposite of an absence (real case, Circutor).
  [["interested"], "Hola Javier, Acabo de regresar de las vacaciones y estaría interesado en escucharte. Si te va bien, envíame una convocatoria de reunión para la semana que viene."],
  [["interested"], "Ya he vuelto de vacaciones, hablemos cuando quieras."],
  [["interested", "question"], "Just got back from holiday — can we set up a call next week?"],
  // …but a genuine absence stays out_of_office
  [["out_of_office"], "Estoy de vacaciones hasta el 15 de septiembre, sin acceso al correo."],
  [["out_of_office"], "Me encuentro fuera de la oficina. Vuelvo el lunes 8."],
  // ── REAL prospect replies (7-day audit, 2026-09-04) that the rules used to miss
  [["interested"], "Hi Maria, This sounds interesting - happy to schedule a call. Libby Aldred Principal Argentum Law Your “Outside In-House Counsel”"],
  [["interested"], "Sure - lets see a demo Regards Shobha Moni Director – Business Development"],
  [["interested"], "5:00 pm Dubai time tomorrow Krish Kothari Founder KKD Studio"],
  [["interested", "question"], "Hi dear I have not seen a slot for 9 am dubai time, please send across the invite. Thanks Rima"],
  [["interested"], "Buenos días Alfons, Encantado de conocerte. Por nuestra parte vemos muy interesante lo que planteas."],
  [["not_interested"], "Eric, tenemos un equipo dedicado exclusivamente a generacion de mas leads + agentes de IA. Gracias"],
  [["not_interested", "no_contactar"], "Dear Maria, Not interested, pls delete my contact. Regards, Fabio"],
  [["derivado"], "Adding Sanvi/Sukhdev in the loop. Hi Maria, please connect with Sanvi and she will take it from here."],
  [["derivado"], "Hola, este tema deberías tratarlo con la persona de comunicación. Rita"],
  [["no_contactar"], "Go away"],
  [["out_of_office"], "Estimados colaboradores: La cuenta de correo angel.jimenez@tourdiez.com dejará de estar operativa en breve. Rogamos envíen sus comunicados a contratacion@tourdiez.com"],
  [["question", "interested"], "Maria, Before I consider a meeting do you have some idea on costs?"],
  // "in-house" in a signature tagline must NOT be a rejection; real in-house statements still are
  [["not_interested"], "Thanks, but we handle lead generation in-house."],
];

describe("classifier hard battery", () => {
  it("lands on a safe label for every hard case", () => {
    const rows: string[] = [];
    let fails = 0;
    for (const [ok, msg] of CASES) {
      const got = classifyMessage(null, msg);
      const good = ok.includes(got);
      if (!good) fails++;
      rows.push(`${good ? "OK " : "XX "} got=${got.padEnd(14)} ok=[${ok.join("/")}] | ${msg}`);
    }
    // eslint-disable-next-line no-console
    console.log("\n" + rows.join("\n") + `\n\n${CASES.length - fails}/${CASES.length} en un lado seguro, ${fails} fallos\n`);
    expect(fails).toBe(0);
  });
});
