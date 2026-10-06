import { describe, expect, it } from "vitest";
import {
  isCompleteSmtpReply, makeBudget, readSmtpReply, sanitizeServerText, smtpReplyCode, withTimeout,
} from "../../supabase/functions/_shared/smtp-wire";
import { buildMimeMessage } from "../../supabase/functions/_shared/smtp";

describe("isCompleteSmtpReply (auditoría #18)", () => {
  it("sólo da por completa una respuesta con CRLF final y última línea 'NNN '", () => {
    expect(isCompleteSmtpReply("250 OK\r\n")).toBe(true);
    expect(isCompleteSmtpReply("250-smtp.x.es\r\n250-STARTTLS\r\n250 8BITMIME\r\n")).toBe(true);
    expect(isCompleteSmtpReply("354 End data with <CR><LF>.<CR><LF>\r\n")).toBe(true);
    expect(isCompleteSmtpReply("250\r\n")).toBe(true); // código solo, válido en RFC 5321
  });
  it("un trozo cortado a mitad de línea o una continuación NO está completo", () => {
    expect(isCompleteSmtpReply("250 OK")).toBe(false); // sin CRLF: puede faltar texto
    expect(isCompleteSmtpReply("250-smtp.x.es\r\n250-STARTTLS\r\n")).toBe(false); // continuación
    expect(isCompleteSmtpReply("250-smtp.x.es\r\n250 STAR")).toBe(false);
    expect(isCompleteSmtpReply("")).toBe(false);
    expect(isCompleteSmtpReply("garbage\r\n")).toBe(false);
  });
  it("smtpReplyCode lee el código de la última línea", () => {
    expect(smtpReplyCode("250-a\r\n354 go\r\n")).toBe(354);
    expect(smtpReplyCode("nada")).toBe(0);
  });
});

describe("readSmtpReply", () => {
  const readerOf = (chunks: string[]) => {
    const enc = new TextEncoder();
    let i = 0;
    return {
      read: async (p: Uint8Array) => {
        if (i >= chunks.length) return null;
        const b = enc.encode(chunks[i++]);
        p.set(b);
        return b.length;
      },
    };
  };
  it("sigue leyendo hasta que la última línea está entera (EHLO multilínea partido en segmentos)", async () => {
    const r = readerOf(["250-mail.x.es\r\n250-STARTT", "LS\r\n250 8BITMIME", "\r\n"]);
    const out = await readSmtpReply(() => r, { readMs: 1000 });
    expect(out).toBe("250-mail.x.es\r\n250-STARTTLS\r\n250 8BITMIME\r\n");
  });
  it("no se queda con '250 OK' si falta el CRLF: espera al resto", async () => {
    const r = readerOf(["250 OK", "\r\n"]);
    expect(await readSmtpReply(() => r, { readMs: 1000 })).toBe("250 OK\r\n");
  });
  it("si el servidor cierra devuelve lo acumulado", async () => {
    const r = readerOf(["250-a\r\n"]);
    expect(await readSmtpReply(() => r, { readMs: 1000 })).toBe("250-a\r\n");
  });
  it("vence el plazo de lectura si el servidor no contesta", async () => {
    const mudo = { read: () => new Promise<number | null>(() => {}) };
    await expect(readSmtpReply(() => mudo, { readMs: 30 })).rejects.toThrow(/timeout/);
  });
  it("rechaza una respuesta que no acaba nunca (tope de bytes)", async () => {
    const big = "250-" + "x".repeat(4000) + "\r\n";
    const r = readerOf(Array(40).fill(big));
    await expect(readSmtpReply(() => r, { readMs: 1000, maxBytes: 16 * 1024 })).rejects.toThrow(/demasiado larga/);
  });
});

describe("withTimeout / makeBudget", () => {
  it("withTimeout rechaza al vencer y resuelve si llega a tiempo", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "x")).rejects.toThrow("SMTP timeout (x)");
    await expect(withTimeout(Promise.resolve(7), 50, "x")).resolves.toBe(7);
  });
  it("makeBudget recorta cada plazo a lo que queda del total y lanza al agotarse", () => {
    let t = 1000;
    const budget = makeBudget(45_000, () => t);
    expect(budget(25_000)).toBe(25_000);
    t += 30_000;
    expect(budget(25_000)).toBe(15_000); // sólo quedan 15 s del total
    t += 15_000;
    expect(() => budget(1000)).toThrow(/presupuesto total/);
  });
});

describe("sanitizeServerText (el cliente nunca ve la respuesta cruda)", () => {
  it("quita binarios y saltos de línea y limita a 120", () => {
    const raw = "535 5.7.8 \u0000\u0001Bad\r\ncredentials ÿþ " + "z".repeat(300);
    const out = sanitizeServerText(raw, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).not.toMatch(/[^\x20-\x7E…]/);
    expect(out).toContain("535 5.7.8");
  });
  it("tolera null/undefined", () => {
    expect(sanitizeServerText(undefined)).toBe("");
  });
});

describe("smtp.ts buildMimeMessage: Subject / From con encoded-words de ≤75 (RFC 2047 §2, #25)", () => {
  const msg = buildMimeMessage({
    from: "equipo@onepulso.online",
    fromName: "Équipe Pérez Núñez y compañía de servicios jurídicos internacionales",
    to: "a@b.es",
    subject: "Propuesta de colaboración estratégica para la expansión comercial: análisis de mercado y próximos pasos",
    html: "<p>hola</p>",
  });
  const headerBlock = msg.split("\r\n\r\n")[0];
  const words = headerBlock.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g) || [];
  it("cada palabra codificada mide como máximo 75 caracteres", () => {
    expect(words.length).toBeGreaterThan(2);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
  });
  it("el asunto largo queda plegado con CRLF + espacio", () => {
    expect(headerBlock).toMatch(/Subject: =\?UTF-8\?B\?[^\r]+\?=\r\n =\?UTF-8\?B\?/);
  });
});
