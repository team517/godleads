import { describe, it, expect } from "vitest";
import {
  cleanBody,
  htmlToText,
  isAutomatedMessage,
  stripEmojis,
  textToHtml,
  withSignoff,
} from "../../supabase/functions/_shared/serviceAgent";

describe("htmlToText", () => {
  it("turns block tags into line breaks", () => {
    expect(htmlToText("<p>Hola</p><p>Adiós</p>")).toBe("Hola\nAdiós\n");
    expect(htmlToText("una<br>dos")).toBe("una\ndos");
  });
  it("drops scripts, styles and comments", () => {
    const out = htmlToText("<style>p{color:red}</style><!-- oculto --><script>alert(1)</script><p>Hola</p>");
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("oculto");
    expect(out.trim()).toBe("Hola");
  });
  it("decodes the common entities", () => {
    expect(htmlToText("<p>Ana&nbsp;&amp;&nbsp;Luis &lt;jefe&gt; &quot;ok&quot;</p>").trim()).toBe('Ana & Luis <jefe> "ok"');
  });
});

describe("cleanBody", () => {
  it("prefers the plain-text part", () => {
    expect(cleanBody("Hola equipo", "<p>otra cosa</p>")).toBe("Hola equipo");
  });

  it("falls back to the HTML body de-tagged (the model must read words, not markup)", () => {
    const out = cleanBody("", '<div style="font-family:Arial"><p>Quiero cambiar el asunto</p></div>');
    expect(out).toBe("Quiero cambiar el asunto");
    expect(out).not.toContain("<");
  });

  it("also falls back when body_text is only whitespace", () => {
    expect(cleanBody("   \n  ", "<p>Hola</p>")).toBe("Hola");
  });

  it("cuts the quoted history off", () => {
    const raw = "Cambia el asunto por 'Nueva propuesta'.\n\nEl 12 de agosto escribió:\n> texto antiguo\n> más texto";
    expect(cleanBody(raw)).toBe("Cambia el asunto por 'Nueva propuesta'.");
  });

  it("cuts English quote markers too", () => {
    const raw = "Perfecto, adelante con eso por favor.\n\nOn Tue, Aug 12, 2026 at 10:00 AM Team wrote:\n> hola";
    expect(cleanBody(raw)).toBe("Perfecto, adelante con eso por favor.");
  });

  it("drops MIME noise lines", () => {
    const raw = "Hola\n--00000000000abcdef123\nContent-Type: text/plain\nBODY[TEXT]\nQuiero un cambio";
    expect(cleanBody(raw)).toBe("Hola\nQuiero un cambio");
  });

  it("caps the length so one huge email can't blow up the prompt", () => {
    expect(cleanBody("x".repeat(5000)).length).toBe(2500);
  });

  it("is safe on empty input", () => {
    expect(cleanBody(null, null)).toBe("");
    expect(cleanBody(undefined)).toBe("");
  });
});

describe("stripEmojis / withSignoff", () => {
  it("removes emojis", () => {
    expect(stripEmojis("Hola 👋 qué tal 🚀")).toBe("Hola qué tal");
  });
  it("keeps accents and normal punctuation", () => {
    expect(stripEmojis("¿Cómo va la campaña? ¡Genial!")).toBe("¿Cómo va la campaña? ¡Genial!");
  });
  it("appends the sign-off once", () => {
    expect(withSignoff("Hola")).toBe("Hola\n\nUn saludo,\nEquipo de OnePulso · OnePulso Team");
  });
  it("does not append a second sign-off", () => {
    const already = "Hola\n\nUn saludo,\nEquipo de OnePulso · OnePulso Team";
    expect(withSignoff(already)).toBe(already);
    expect(withSignoff("Hola\n\nOnePulso Team")).toBe("Hola\n\nOnePulso Team");
  });
});

describe("textToHtml", () => {
  it("wraps paragraphs", () => {
    expect(textToHtml("uno\n\ndos")).toBe("<p>uno</p><p>dos</p>");
  });
  it("keeps single newlines as <br>", () => {
    expect(textToHtml("uno\ndos")).toBe("<p>uno<br>dos</p>");
  });
  it("leaves existing HTML alone", () => {
    expect(textToHtml("<p>ya es html</p>")).toBe("<p>ya es html</p>");
  });
});

describe("isAutomatedMessage — the agent must never talk to a robot", () => {
  it("skips unattended addresses", () => {
    for (const from of [
      "no-reply@empresa.com",
      "noreply@empresa.com",
      "donotreply@empresa.com",
      "MAILER-DAEMON@empresa.com",
      "postmaster@empresa.com",
      "bounces@empresa.com",
      "notifications@empresa.com",
    ]) {
      expect(isAutomatedMessage({ fromEmail: from, subject: "Hola", body: "Hola" })).toBe(true);
    }
  });

  it("skips out-of-office and bounce subjects", () => {
    for (const subject of [
      "Out of Office: tu campaña",
      "Fuera de la oficina",
      "Respuesta automática: ausente",
      "Automatic reply: away",
      "Undeliverable: Los mensajes de tu campaña",
      "Delivery Status Notification (Failure)",
      "Mail delivery failed: returning message to sender",
    ]) {
      expect(isAutomatedMessage({ fromEmail: "ana@empresa.com", subject, body: "" })).toBe(true);
    }
  });

  it("skips auto-responder bodies", () => {
    expect(
      isAutomatedMessage({
        fromEmail: "ana@empresa.com",
        subject: "Re: tu campaña",
        body: "Gracias por tu mensaje. Estaré fuera hasta el 30 de agosto.",
      }),
    ).toBe(true);
    expect(
      isAutomatedMessage({
        fromEmail: "ana@empresa.com",
        subject: "Re: tu campaña",
        body: "Este es un mensaje automático, no responda a este correo.",
      }),
    ).toBe(true);
  });

  it("does NOT skip a real client asking something", () => {
    for (const body of [
      "Hola, quiero cambiar el asunto del primer email por 'Nueva propuesta'.",
      "¿Cómo va la campaña? ¿Me pasas los mensajes?",
      "Oye, no me interesa seguir con la campaña, quiero cancelar.",
      "Perfecto, gracias por todo. Hablamos la semana que viene.",
    ]) {
      expect(isAutomatedMessage({ fromEmail: "ana@empresa.com", subject: "Re: tu campaña", body })).toBe(false);
    }
  });

  it("does not confuse a real address that merely contains 'reply'", () => {
    expect(isAutomatedMessage({ fromEmail: "replybox@empresa.com", subject: "Hola", body: "Hola" })).toBe(false);
  });

  it("only reads the head of a long body (a footer must not silence a real question)", () => {
    const body = "¿Me cambias el asunto, por favor?\n" + "relleno ".repeat(300) + "\nEste es un mensaje automático";
    expect(isAutomatedMessage({ fromEmail: "ana@empresa.com", subject: "Duda", body })).toBe(false);
  });
});
