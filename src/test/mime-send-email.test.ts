import { describe, it, expect } from "vitest";
import { encodeMimeHeaderFolded, foldHeader, collapseHeaderWhitespace, hasHtmlMarkup } from "@/lib/mime-headers";

// Decode an "=?UTF-8?B?..?=" chain back to the original string, the way a mail client
// does: unfold (CRLF + WSP), then base64-decode every word and concatenate.
function decodeEncodedWords(header: string): string {
  const unfolded = header.replace(/\r\n[ \t]/g, "");
  if (!/=\?UTF-8\?B\?/i.test(unfolded)) return unfolded;
  return unfolded
    .split(/\s*(?==\?UTF-8\?B\?)/i)
    .filter(Boolean)
    .map((w) => {
      const m = w.match(/^=\?UTF-8\?B\?(.*)\?=$/i);
      if (!m) return w;
      return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
    })
    .join("");
}

const linesOf = (header: string) => header.split("\r\n");
const longestLine = (header: string) => Math.max(...linesOf(header).map((l) => l.length));

describe("collapseHeaderWhitespace", () => {
  it("collapses a BARE \\r (the case /\\r?\\n/ misses)", () => {
    expect(collapseHeaderWhitespace("Hola\rBcc: evil@x.com")).toBe("Hola Bcc: evil@x.com");
  });
  it("collapses \\n and \\r\\n too", () => {
    expect(collapseHeaderWhitespace("a\nb\r\nc")).toBe("a b c");
  });
  it("leaves no CR or LF behind whatever the mix", () => {
    const out = encodeMimeHeaderFolded("Asunto\r\rinyectado\nX-Evil: 1");
    expect(decodeEncodedWords(out)).not.toMatch(/[\r\n]/);
  });
});

describe("encodeMimeHeaderFolded", () => {
  it("leaves a short ASCII subject untouched", () => {
    expect(encodeMimeHeaderFolded("Quick question")).toBe("Quick question");
  });

  it("round-trips accents", () => {
    const subject = "Reunión rápida sobre la propuesta de colaboración";
    const encoded = encodeMimeHeaderFolded(subject);
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeEncodedWords(encoded)).toBe(subject);
  });

  it("round-trips ñ", () => {
    const subject = "Año nuevo, campaña nueva para la señora Núñez";
    expect(decodeEncodedWords(encodeMimeHeaderFolded(subject))).toBe(subject);
  });

  it("round-trips an emoji without splitting the surrogate pair", () => {
    const subject = "Resultados 🚀 del trimestre 🎯 para tu equipo";
    const encoded = encodeMimeHeaderFolded(subject);
    expect(decodeEncodedWords(encoded)).toBe(subject);
    // No replacement characters = no half-encoded code point anywhere.
    expect(decodeEncodedWords(encoded)).not.toContain("�");
  });

  it("keeps every encoded-word at 75 chars or less (RFC 2047 §2)", () => {
    const subject = "🚀".repeat(60) + " " + "áéíóúñ".repeat(40);
    const encoded = encodeMimeHeaderFolded(subject);
    for (const line of linesOf(encoded)) {
      expect(line.replace(/^ /, "").length).toBeLessThanOrEqual(75);
    }
    expect(decodeEncodedWords(encoded)).toBe(subject);
  });

  it("folds a 300-char accented subject into several words and still decodes", () => {
    const subject = ("Propuesta de colaboración para tu equipo de ventas — ".repeat(10)).slice(0, 300);
    const encoded = encodeMimeHeaderFolded(subject);
    expect(linesOf(encoded).length).toBeGreaterThan(1);
    expect(decodeEncodedWords(encoded)).toBe(subject);
    expect(longestLine(`Subject: ${encoded}`)).toBeLessThanOrEqual(998);
  });

  it("keeps a 300-char ASCII subject on one line, well under the hard limit", () => {
    const subject = "a".repeat(60) + " " + "quick follow up on the proposal ".repeat(7);
    const encoded = encodeMimeHeaderFolded(subject.slice(0, 300));
    expect(encoded).not.toContain("\r\n");
    expect(longestLine(`Subject: ${encoded}`)).toBeLessThanOrEqual(998);
  });

  it("never exceeds 998 chars even for an absurd single-token ASCII value", () => {
    const header = `Subject: ${encodeMimeHeaderFolded("x".repeat(5000))}`;
    expect(longestLine(header)).toBeLessThanOrEqual(998);
  });

  it("returns empty for empty input", () => {
    expect(encodeMimeHeaderFolded("")).toBe("");
    expect(encodeMimeHeaderFolded("   \r\n  ")).toBe("");
  });
});

describe("foldHeader", () => {
  it("keeps a short header on a single line", () => {
    expect(foldHeader("To", "ana@example.com")).toBe("To: ana@example.com");
  });

  it("folds a 20-id References chain with CRLF + TAB and preserves every id", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `<camp.${i}.abcdef0123456789@sending-domain-example.com>`);
    const header = foldHeader("References", ids.join(" "));
    expect(header.startsWith("References: ")).toBe(true);
    expect(header).toContain("\r\n\t");
    expect(longestLine(header)).toBeLessThanOrEqual(998);
    // Unfolding gives the original chain back, untouched.
    const unfolded = header.replace(/^References: /, "").replace(/\r\n\t/g, " ");
    expect(unfolded.split(" ")).toEqual(ids);
  });

  it("folds a long To list below the 998-char hard limit", () => {
    const many = Array.from({ length: 60 }, (_, i) => `destinatario.numero.${i}@empresa-de-ejemplo.com`);
    const header = foldHeader("To", many.join(", "));
    expect(longestLine(header)).toBeLessThanOrEqual(998);
    expect(longestLine(header)).toBeLessThanOrEqual(78);
    const unfolded = header.replace(/^To: /, "").replace(/\r\n\t/g, " ");
    expect(unfolded.split(", ")).toEqual(many);
  });

  it("never produces a line over 998 even with unfoldable giant tokens", () => {
    const monster = `https://example.com/${"z".repeat(4000)}`;
    for (const header of [foldHeader("List-Unsubscribe", `<${monster}>`), foldHeader("To", `${monster} ${monster}`)]) {
      expect(longestLine(header)).toBeLessThanOrEqual(998);
    }
  });

  it("strips CR/LF from the value (header injection guard)", () => {
    const header = foldHeader("To", "ana@example.com\r\nBcc: evil@x.com");
    expect(linesOf(header).length).toBe(1);
    expect(header).toBe("To: ana@example.com Bcc: evil@x.com");
  });
});

describe("hasHtmlMarkup — which bodies are already HTML", () => {
  it("recognises inline formatting used by real campaign steps", () => {
    // Four live steps are written exactly like this, with no <p> anywhere.
    expect(hasHtmlMarkup("Buenas <b>{{first_name}}</b>, Soy Oliver.")).toBe(true);
    expect(hasHtmlMarkup("un <strong>37% más</strong> de reuniones")).toBe(true);
    expect(hasHtmlMarkup("<em>texto</em>")).toBe(true);
    expect(hasHtmlMarkup("<h2>Título</h2>")).toBe(true);
  });

  it("still recognises block markup", () => {
    expect(hasHtmlMarkup("<p>Hola</p>")).toBe(true);
    expect(hasHtmlMarkup("linea<br>otra")).toBe(true);
    expect(hasHtmlMarkup('<a href="https://x">x</a>')).toBe(true);
  });

  it("treats real plain text as plain text, so < and & get escaped", () => {
    expect(hasHtmlMarkup("Respondemos en <2 horas")).toBe(false);
    expect(hasHtmlMarkup("Coste < 100 € & sin permanencia")).toBe(false);
    expect(hasHtmlMarkup("Hola Javier,\n\nUn saludo")).toBe(false);
    expect(hasHtmlMarkup("")).toBe(false);
    expect(hasHtmlMarkup(null)).toBe(false);
  });
});

describe("encodeMimeHeaderFolded — corte por espacios", () => {
  const decodeWords = (h: string, joinSep: string) =>
    h.split("\r\n ").map((w) => {
      const m = w.match(/^=\?UTF-8\?B\?(.+)\?=$/);
      return m ? Buffer.from(m[1], "base64").toString("utf8") : w;
    }).join(joinSep);

  const subject = "¿Más reuniones para OnePulso? 🚀 Prueba de estructura del envío";

  it("un decodificador correcto reconstruye el asunto exacto", () => {
    expect(decodeWords(encodeMimeHeaderFolded(subject), "")).toBe(subject);
  });

  it("un decodificador chapucero no parte ninguna palabra", () => {
    // Junta las palabras SIN aplicar la regla de ignorar el espacio separador.
    const naive = decodeWords(encodeMimeHeaderFolded(subject), " ").replace(/\s{2,}/g, " ");
    expect(naive).toBe(subject);
    expect(naive).not.toContain("Prueb a");
  });

  it("cada encoded-word sigue dentro del limite", () => {
    for (const w of encodeMimeHeaderFolded(subject).split("\r\n ")) {
      expect(w.length).toBeLessThanOrEqual(75);
    }
  });

  it("una palabra larguisima sin espacios se parte igualmente", () => {
    const long = "áéíóú".repeat(40);
    const out = encodeMimeHeaderFolded(long);
    expect(decodeWords(out, "")).toBe(long);
    for (const w of out.split("\r\n ")) expect(w.length).toBeLessThanOrEqual(75);
  });
});
