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
