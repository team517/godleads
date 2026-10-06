import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/* Motor de envío (06-10-2026): clasificación de errores SMTP, reintentos con espera, buzón
 * remitente muerto, adjuntos permitidos y lectura de respuestas SMTP. Las funciones viven en
 * process-campaign-queue/index.ts (Deno, no se puede importar aquí), así que se toma el trozo
 * puro del archivo REAL —de "Error classification" a "Promise with timeout"— y se evalúa. */

const SRC = readFileSync(resolve(__dirname, "../../supabase/functions/process-campaign-queue/index.ts"), "utf8");
const start = SRC.indexOf("// ─── Error classification (Instantly-style) ───");
const end = SRC.indexOf("// Promise with timeout");
if (start < 0 || end < 0 || end <= start) throw new Error("no se encuentra el bloque de clasificación en index.ts");
const js = ts.transpileModule(SRC.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const NAMES = [
  "classifySmtpError", "senderStageClass", "recipientStageClass", "countsAgainstRecipient",
  "leadRetryPlan", "isDeadSenderError", "attachmentSource", "smtpReplyComplete",
  "MAX_SEND_ATTEMPTS_PER_STEP", "RETRY_BACKOFF_MS",
] as const;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const E: Record<(typeof NAMES)[number], any> = new Function(`${js}\nreturn { ${NAMES.join(", ")} };`)();

const MIN = 60_000;
const H = 60 * MIN;

describe("clasificación en la fase del destinatario (:465 igual que STARTTLS)", () => {
  it("un bloqueo por reputación NO es rebote del lead: 'rate'", () => {
    expect(E.recipientStageClass("550 5.7.1 Service unavailable; client host blocked using Spamhaus")).toBe("rate");
    expect(E.recipientStageClass("554 5.7.1 rejected: listed in RBL")).toBe("rate");
  });
  it("un rechazo por spam/política: 'soft' (se reintenta, no se suprime)", () => {
    expect(E.recipientStageClass("554 5.7.1 message rejected as spam")).toBe("soft");
  });
  it("un buzón inexistente sigue siendo rebote: 'hard'", () => {
    expect(E.recipientStageClass("550 5.1.1 <x@y.com>: Recipient address rejected: User unknown")).toBe("hard");
  });
  it("556 'domain does not accept mail' (RFC 7504) es rebote", () => {
    const r = "556-Requested action not taken: domain does not accept mail\r\n556 invalid domain\r\n";
    expect(E.classifySmtpError(r)).toBe("hard");
    expect(E.recipientStageClass(r)).toBe("hard");
  });
  it("451 local error sigue siendo pasajero", () => {
    expect(E.recipientStageClass("451-Requested action aborted: local error in processing\r\n451 1MTfgb\r\n")).toBe("rate");
  });
  it("el camino :465 ya no usa classifySmtpError para RCPT ni para el final de DATA", () => {
    expect(SRC).not.toMatch(/errorClass: classifySmtpError\(rcptResp\)/);
    expect(SRC).not.toMatch(/errorClass: classifySmtpError\(dataResp\)/);
  });
});

describe("qué fallos cuentan contra el destinatario (tope de 5)", () => {
  it("451 en RCPT cuenta; un 421/greylisting no", () => {
    expect(E.countsAgainstRecipient("Recipient rejected: 451-Requested action aborted: local error in processing")).toBe(true);
    expect(E.countsAgainstRecipient("Recipient rejected: 451 4.7.1 greylisted, try again later")).toBe(false);
    expect(E.countsAgainstRecipient("Recipient rejected: 421 too many connections")).toBe(false);
  });
  it("fallos del remitente o del servidor no gastan intentos del lead", () => {
    expect(E.countsAgainstRecipient("Sender rejected: 550 5.1.0 mailbox unavailable")).toBe(false);
    expect(E.countsAgainstRecipient("Servidor SMTP no permitido: Ese servidor no está permitido")).toBe(false);
    expect(E.countsAgainstRecipient("Auth failed: 535 Authentication credentials invalid")).toBe(false);
  });
  it("un bloqueo Spamhaus en RCPT es culpa de la IP: no cuenta", () => {
    expect(E.countsAgainstRecipient("Recipient rejected: 550 5.7.1 blocked using Spamhaus")).toBe(false);
  });
  it("un timeout de conexión cuenta (como antes)", () => {
    expect(E.countsAgainstRecipient("SMTP error: Timeout: connect smtp.ionos.es:465 (25000ms)")).toBe(true);
  });
});

describe("reintento con espera: 10 min, 1 h, 4 h, 24 h y luego 'failed'", () => {
  const r451 = "Recipient rejected: 451-Requested action aborted: local error in processing";
  it("calendario de esperas", () => {
    expect(E.RETRY_BACKOFF_MS).toEqual([10 * MIN, H, 4 * H, 24 * H]);
    expect(E.leadRetryPlan("rate", r451, 0)).toEqual({ kind: "retry", delayMs: 10 * MIN });
    expect(E.leadRetryPlan("rate", r451, 1)).toEqual({ kind: "retry", delayMs: H });
    expect(E.leadRetryPlan("rate", r451, 2)).toEqual({ kind: "retry", delayMs: 4 * H });
    expect(E.leadRetryPlan("rate", r451, 3)).toEqual({ kind: "retry", delayMs: 24 * H });
  });
  it("al quinto fallo que cuenta: tope → 'failed'", () => {
    expect(E.MAX_SEND_ATTEMPTS_PER_STEP).toBe(5);
    expect(E.leadRetryPlan("rate", r451, 4)).toEqual({ kind: "cap" });
  });
  it("greylisting espera sin gastar intentos", () => {
    expect(E.leadRetryPlan("rate", "Recipient rejected: 451 4.7.1 greylisted, try again later", 2))
      .toEqual({ kind: "retry", delayMs: H });
  });
  it("rebote, credenciales, remitente muerto o problema de la cuenta: nada que aplazar", () => {
    expect(E.leadRetryPlan("hard", "Recipient rejected: 550 5.1.1 user unknown", 0)).toBeNull();
    expect(E.leadRetryPlan("auth", "Auth failed: 535 invalid", 0)).toBeNull();
    expect(E.leadRetryPlan("sender", "Servidor SMTP no permitido: x", 0)).toBeNull();
    expect(E.leadRetryPlan("rate", "Sender rejected: 550 mailbox unavailable", 0)).toBeNull();
    expect(E.leadRetryPlan("rate", "No 220 greeting: 421 too many connections", 0)).toBeNull();
    expect(E.leadRetryPlan("sent_unconfirmed", "Send unconfirmed post-DATA: Timeout", 0)).toBeNull();
  });
});

describe("buzón remitente muerto", () => {
  it("MAIL FROM 550/553/554 permanente → la cuenta va a 'error'", () => {
    expect(E.isDeadSenderError("Sender rejected: 550 5.1.0 <a@b.es> sender mailbox unavailable")).toBe(true);
    expect(E.isDeadSenderError("Sender rejected: 553 5.7.1 sender address not allowed")).toBe(true);
    expect(E.senderStageClass("550 5.1.0 mailbox unavailable")).toBe("rate"); // la clase no cambia
  });
  it("reputación, límites o fallos pasajeros NO marcan la cuenta", () => {
    expect(E.isDeadSenderError("Sender rejected: 554 5.7.1 blocked using Spamhaus")).toBe(false);
    expect(E.isDeadSenderError("Sender rejected: 550 sending limit exceeded")).toBe(false);
    expect(E.isDeadSenderError("Sender rejected: 451 local error in processing")).toBe(false);
    expect(E.isDeadSenderError("Sender rejected: 503 bad sequence of commands")).toBe(false);
    expect(E.isDeadSenderError("Recipient rejected: 550 user unknown")).toBe(false);
  });
});

describe("adjuntos: sólo los de esta campaña", () => {
  const camp = { id: "c1", user_id: "u1" };
  it("legado en godtube-media con campaign-attachments/<campaña>/", () => {
    expect(E.attachmentSource({ path: "campaign-attachments/c1/s1/f.pdf" }, camp))
      .toEqual({ bucket: "godtube-media", path: "campaign-attachments/c1/s1/f.pdf" });
    expect(E.attachmentSource({ bucket: "godtube-media", path: "campaign-attachments/c1/s1/f.pdf" }, camp))
      .toEqual({ bucket: "godtube-media", path: "campaign-attachments/c1/s1/f.pdf" });
  });
  it("nuevo bucket privado con <usuario>/<campaña>/", () => {
    expect(E.attachmentSource({ bucket: "campaign-attachments", path: "u1/c1/s1/f.pdf" }, camp))
      .toEqual({ bucket: "campaign-attachments", path: "u1/c1/s1/f.pdf" });
  });
  it("cualquier otra ruta se rechaza", () => {
    expect(E.attachmentSource({ path: "campaign-attachments/OTRA/s1/f.pdf" }, camp)).toBeNull();
    expect(E.attachmentSource({ path: "avatars/u2/secreto.png" }, camp)).toBeNull();
    expect(E.attachmentSource({ bucket: "campaign-attachments", path: "u2/c1/s1/f.pdf" }, camp)).toBeNull();
    expect(E.attachmentSource({ bucket: "campaign-attachments", path: "campaign-attachments/c1/f.pdf" }, camp)).toBeNull();
    expect(E.attachmentSource({ path: "campaign-attachments/c1/../../x" }, camp)).toBeNull();
    expect(E.attachmentSource({ bucket: "otro-bucket", path: "campaign-attachments/c1/f.pdf" }, camp)).toBeNull();
    expect(E.attachmentSource({ path: "" }, camp)).toBeNull();
  });
});

describe("respuesta SMTP completa", () => {
  it("sólo con CRLF final y última línea 'NNN '", () => {
    expect(E.smtpReplyComplete("220 smtp.ionos.es ESMTP\r\n")).toBe(true);
    expect(E.smtpReplyComplete("250-smtp.ionos.es\r\n250-PIPELINING\r\n250 STARTTLS\r\n")).toBe(true);
    expect(E.smtpReplyComplete("250\r\n")).toBe(true);           // RFC 5321: el texto es opcional
  });
  it("un trozo cortado no se da por completo", () => {
    expect(E.smtpReplyComplete("250")).toBe(false);              // antes valía: llegaba "-PIPELINING" después
    expect(E.smtpReplyComplete("250-smtp.ionos.es\r\n250")).toBe(false);
    expect(E.smtpReplyComplete("250-smtp.ionos.es\r\n")).toBe(false);
    expect(E.smtpReplyComplete("250 OK")).toBe(false);
  });
  it("tras DATA se exige 354 antes de escribir el mensaje (los dos caminos)", () => {
    expect((SRC.match(/startsWith\("354"\)/g) || []).length).toBe(2);
  });
});
