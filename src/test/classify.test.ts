import { describe, it, expect } from "vitest";
import { classifyMessage } from "@/lib/classify";

describe("classifyMessage", () => {
  it("detects INTERESTED", () => {
    expect(classifyMessage("Re: propuesta", "Hola, me interesa mucho. ¿Podemos agendar una reunión?")).toBe("interested");
    expect(classifyMessage("Re: proposal", "Sounds good, let's schedule a call. I'm interested.")).toBe("interested");
    expect(classifyMessage(null, "Perfecto, me parece bien. Pásame info y presupuesto.")).toBe("interested");
  });

  it("detects QUESTION", () => {
    expect(classifyMessage("Duda", "¿Cómo funciona exactamente? ¿Qué incluye?")).toBe("question");
    expect(classifyMessage(null, "No sé si me interesa, cuéntame un poco más.")).toBe("question");
    expect(classifyMessage("Re:", "Could you tell me what is the price?")).toBe("question");
  });

  it("detects NOT INTERESTED (rejection without a baja request)", () => {
    expect(classifyMessage("Re:", "No me interesa, gracias.")).toBe("not_interested");
    expect(classifyMessage(null, "Ya trabajamos con otra agencia.")).toBe("not_interested");
    expect(classifyMessage(null, "Ahora no es el momento.")).toBe("not_interested");
    expect(classifyMessage(null, "Lo hacemos internamente, gracias.")).toBe("not_interested");
    // The plain "No interesado" reply (no "me"/"estoy") used to leak as Interested.
    expect(classifyMessage(null, "No interesado")).toBe("not_interested");
    expect(classifyMessage("Re:", "No interesa")).toBe("not_interested");
  });

  it("detects NO CONTACTAR — la baja manda (beats a rejection or a question)", () => {
    expect(classifyMessage(null, "Please remove me from your list, not interested.")).toBe("no_contactar");
    expect(classifyMessage(null, "Deja de enviar correos, por favor.")).toBe("no_contactar");
    expect(classifyMessage(null, "Quitadme de la lista.")).toBe("no_contactar");
    expect(classifyMessage("Re:", "Dadme de baja de la lista.")).toBe("no_contactar");
    expect(classifyMessage(null, "Esto es spam, no me escribáis más.")).toBe("no_contactar");
    expect(classifyMessage(null, "Exijo saber cómo tratáis mis datos según el RGPD.")).toBe("no_contactar");
    // "no me interesa y no me escribáis más" → baja manda sobre el rechazo.
    expect(classifyMessage(null, "No me interesa y no me volváis a escribir.")).toBe("no_contactar");
  });

  it("detects DERIVADO — hands off to another person", () => {
    expect(classifyMessage(null, "Yo no lo llevo, esto lo gestiona Marta.")).toBe("derivado");
    expect(classifyMessage(null, "Te paso con nuestro responsable de compras.")).toBe("derivado");
    expect(classifyMessage(null, "No soy la persona indicada, deberías hablar con Juan.")).toBe("derivado");
  });

  it("detects OUT OF OFFICE / auto", () => {
    expect(classifyMessage("Automatic reply", "Estaré ausente / out of office hasta el lunes.")).toBe("out_of_office");
    expect(classifyMessage("Respuesta automática", "Estoy de vacaciones, vuelvo el 1 de julio.")).toBe("out_of_office");
  });

  it("falls back to NEUTRAL", () => {
    expect(classifyMessage("Hola", "Buenos días, le escribo en relación al pedido.")).toBe("neutral");
  });

  it("does not mark engaged-but-doubtful as not_interested", () => {
    // doubt + asking for info → question, not not_interested
    expect(classifyMessage(null, "No estoy seguro, pero pásame más información.")).toBe("question");
  });
});
