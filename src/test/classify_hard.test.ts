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
