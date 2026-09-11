import { describe, it, expect } from "vitest";
import { encodeMimeHeaderFolded, foldHeader, collapseHeaderWhitespace } from "@/lib/mime-headers";

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
