import { describe, it, expect } from "vitest";
import { looksBinaryText, textFromHtml, replyTextForClassification, repairMojibakeBytes } from "@/lib/reply-text";
import { classifyMessage } from "@/lib/classify";

// Real case (Auteide, 2026-09-16): a Thunderbird HTML reply stored as mojibake, with two lone
// surrogates and a couple of curly quotes ("â€œ") in its quoted part. The all-or-nothing pass
// gave up on the whole text and the user read "podrÃ­amos fijar esa conversaciÃ³n".
describe("repairMojibakeBytes — token a token", () => {
  const moji = (s: string) => s; // the strings below are written already mangled
  it("repara aunque haya un carácter no mapeable (surrogate suelto, emoji) en otra parte del texto", () => {
    const s = moji("podrÃ­amos fijar esa conversaciÃ³n 😀 y \udc81 firma â€œhola â€�");
    const out = repairMojibakeBytes(s);
    expect(out).toContain("podríamos fijar esa conversación");
    expect(out).toContain("😀");          // the emoji survives untouched
    expect(out).toContain("“hola");             // â€œ → “
    expect(out).toContain("â€�");     // an unrecoverable token is left as it was
  });
  it("no toca un token con un acento REAL (0xE9 no es byte inicial UTF-8 válido)", () => {
    expect(repairMojibakeBytes("café y podrÃ­amos")).toBe("café y podríamos");
  });
  it("repara dentro de HTML sin tocar las etiquetas", () => {
    expect(repairMojibakeBytes("<div class=\"moz-cite-prefix\">Hola, Â¿cÃ³mo estÃ¡s?</div>")).toBe("<div class=\"moz-cite-prefix\">Hola, ¿cómo estás?</div>");
  });
  it("texto limpio: idéntico", () => {
    const clean = "Hola Juanjo, podríamos vernos el lunes — “sí”";
    expect(repairMojibakeBytes(clean)).toBe(clean);
  });
});

describe("texto que se clasifica", () => {
  const photoshopBytes = 'ExifII*(12i \n\'\n\'Adobe Photoshop 21.2 (Windows)2025:06:23 14:57:190231nv(~pHHAdobe_CMAdobed  \n\r\r\r\r"?\n\n3!1AQa"q2B#$Rb34rC%Scs5&DTdE£t6UeuF\'Vfv7GWgw5!1AQaq"2B#R3$brCScs4%&5DTdEU6teuFVfv\'7GWgw?';
  const html = '<html><head><style>v\:* {behavior:url(#default#VML);}</style></head><body><p>Buenos días</p><p>&nbsp;</p><p>Gracias por su email pero no estamos interesados</p><p>Atentamente,</p><table><tr><td>Carolina Marin</td></tr></table></body></html>';

  it("reconoce una imagen volcada como texto", () => {
    expect(looksBinaryText(photoshopBytes)).toBe(true);
    expect(looksBinaryText("Buenos días, gracias por su email pero no estamos interesados. Atentamente, Carolina")).toBe(false);
  });

  it("saca el texto del HTML sin estilos ni tablas", () => {
    const t = textFromHtml(html);
    expect(t).toContain("Gracias por su email pero no estamos interesados");
    expect(t).not.toContain("behavior:url");
    expect(t).not.toContain("<");
  });

  it("caso real Laystil: body_text binario + body_html con la respuesta → No interesado", () => {
    const text = replyTextForClassification(photoshopBytes, html);
    expect(text).toContain("no estamos interesados");
    expect(classifyMessage("RE: Maria - Laystil S.A.", text)).toBe("not_interested");
  });

  it("con texto normal no toca nada", () => {
    expect(replyTextForClassification("Hola, sí me interesa, ¿hablamos el jueves?", html)).toBe("Hola, sí me interesa, ¿hablamos el jueves?");
  });

  it("sin texto ni html devuelve vacío", () => {
    expect(replyTextForClassification("", "")).toBe("");
    expect(replyTextForClassification(null, null)).toBe("");
  });
});

describe("repairMojibake — UTF-8 misread as Latin-1", () => {
  it("repairs the accented Spanish the classifier depends on", () => {
    expect(repairMojibakeBytes("informaciÃ³n")).toBe("información");
    expect(repairMojibakeBytes("Â¿QuÃ© tal? MÃ¡s reuniÃ³n")).toBe("¿Qué tal? Más reunión");
    expect(repairMojibakeBytes("EspaÃ±a")).toBe("España");
  });

  it("leaves clean text untouched", () => {
    const ok = "¿Qué tal? Estoy interesado en más información.";
    expect(repairMojibakeBytes(ok)).toBe(ok);
    expect(repairMojibakeBytes("Plain ASCII text")).toBe("Plain ASCII text");
    expect(repairMojibakeBytes("")).toBe("");
  });

  it("classification reads repaired text", () => {
    expect(replyTextForClassification("me interesa, Â¿podrÃ­as enviarme mÃ¡s informaciÃ³n?", null))
      .toBe("me interesa, ¿podrías enviarme más información?");
  });

  it("recovers accents from the HTML when body_text is binary", () => {
    const html = "<p>Gracias, no estamos interesados por ahora. Un saludo, JosÃ© MarÃ­a</p>";
    const out = replyTextForClassification("\uFFFD\uFFFDJFIF\u0000\u0010Exif Adobe Photoshop sRGB IHDR IDAT", html);
    expect(out).toContain("José María");
  });
});
