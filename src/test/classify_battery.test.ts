import { describe, it, expect } from "vitest";
import { classifyMessage } from "@/lib/classify";

// Big realistic battery: the user's spec examples + the tricky/precedence cases
// their own rules describe. Logs input → expected → got so we can SEE every call.
const CASES: Array<[string, string]> = [
  // ── INTERESADO ──
  ["INT", "¿Tenéis hueco el jueves?"],
  ["INT", "Me interesa, ¿podemos hablar esta semana?"],
  ["INT", "Perfecto, pásame una propuesta con precios."],
  ["INT", "Sí, cuéntame más."],
  ["INT", "Estoy disponible el martes a las 10h, ¿te va bien?"],
  ["INT", "Sounds good, let's schedule a call."],
  ["INT", "Envíame info y un presupuesto, por favor."],
  // SPEC §6 (2026-09-09): a question ABOUT THE OFFER (price, scope, how it works, proof) is
  // commercial exploration → INTERESADO. Only neutral/administrative questions stay PREGUNTA.
  ["INT", "¿Cómo funciona y qué precios manejáis?"],
  ["INT", "How much does it cost?"],
  ["INT", "Tengo una duda antes de decidir, ¿tenéis casos de éxito?"],
  ["INT", "No sé si me interesa, pásame más información."], // la duda no anula la petición (§6)
  // ── PREGUNTA (neutral: sobre nosotros o el origen del dato, no sobre la oferta) ──
  ["PRE", "¿Quiénes sois y en qué os diferenciáis?"],
  ["PRE", "¿De dónde habéis sacado mi contacto?"], // neutral curiosity → PREGUNTA (not RGPD)
  // ── NO_INTERESADO ──
  // SPEC §7 case 29: "ya trabajamos con otra agencia" A SECAS es objeción → REVISIÓN (neutral).
  ["NEU", "Ya trabajamos con otra agencia."],
  ["NOI", "Ya trabajamos con otra agencia y no queremos cambiar."],
  ["NOI", "Gracias, pero no es el momento."],
  ["NOI", "Lo hacemos internamente."],
  ["NOI", "No hay presupuesto ahora mismo."],
  ["NOI", "No me interesa, gracias."],
  ["NOI", "No interesado"],
  ["NOI", "No ens interessa, gràcies."],
  ["NOI", "Not a good fit for us right now."],
  // ── NO_CONTACTAR (la baja manda) ──
  ["NOC", "Quitadme de la lista."],
  ["NOC", "Dadme de baja, por favor."],
  ["NOC", "Please remove me from your list."],
  ["NOC", "Unsubscribe."],
  ["NOC", "Esto es spam, dejad de escribirme."],
  ["NOC", "Exijo que borréis mis datos según el RGPD."],
  ["NOC", "No me interesa y no me volváis a escribir."], // baja manda sobre rechazo
  ["NOC", "Stop contacting me."],
  // ── DERIVADO ──
  ["DER", "Yo no lo llevo, esto lo gestiona Marta."],
  ["DER", "Te paso con nuestro responsable de compras."],
  ["DER", "No soy la persona indicada, habla con Juan (juan@empresa.com)."],
  ["DER", "Deberías contactar con el departamento de IT."],
  // ── AUTOMÁTICO ──
  ["AUT", "Estaré fuera de la oficina hasta el 25 de agosto."],
  ["AUT", "Respuesta automática: estoy de vacaciones, te contesto a la vuelta."],
  ["AUT", "Out of office until Monday."],
  // ── NEUTRAL / corto ──
  ["NEU", "Ok."],
  ["NEU", "Buenos días, le escribo en relación al pedido."],
];

const MAP: Record<string, string> = {
  INT: "interested", PRE: "question", NOI: "not_interested",
  NOC: "no_contactar", DER: "derivado", AUT: "out_of_office", NEU: "neutral",
};

describe("classifier battery", () => {
  it("classifies the whole battery correctly", () => {
    const rows: string[] = [];
    let fails = 0;
    for (const [exp, msg] of CASES) {
      const got = classifyMessage(null, msg);
      const ok = got === MAP[exp];
      if (!ok) fails++;
      rows.push(`${ok ? "OK " : "XX "} ${exp}->${got.padEnd(14)} | ${msg}`);
    }
    // eslint-disable-next-line no-console
    console.log("\n" + rows.join("\n") + `\n\n${CASES.length - fails}/${CASES.length} correctos, ${fails} fallos\n`);
    expect(fails).toBe(0);
  });
});
