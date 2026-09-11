import { describe, it, expect } from "vitest";
import { looksBinaryText, textFromHtml, replyTextForClassification, repairMojibakeBytes } from "@/lib/reply-text";
import { classifyMessage } from "@/lib/classify";

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
