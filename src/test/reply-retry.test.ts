import { describe, expect, it } from "vitest";
import { bounceRetryable, canResend, MAX_REPLY_SENDS, resentNote, sendRetryable } from "../../supabase/functions/_shared/reply-retry";

/* Respuestas manuales que fallan o rebotan (06-10-2026). Queja del dueño: "envío un correo y me
   llega al móvil un aviso de error". Textos reales de sent_emails.error_message (direcciones fuera). */

describe("sendRetryable: fallo al enviar desde send-email", () => {
  it("reintenta lo pasajero", () => {
    expect(sendRetryable("El servidor rechazó al destinatario (RCPT TO): 451-Requested action aborted: local error in processing\r\n451 1MA4ja-1x")).toBe(true);
    expect(sendRetryable("SMTP error: Timeout: connect smtp.ionos.es:465 (25000ms)")).toBe(true);
    expect(sendRetryable("SMTP error: Connection reset by peer (os error 104)")).toBe(true);
    expect(sendRetryable("El servidor no confirmó el envío: 421 4.7.0 Try again later")).toBe(true);
    expect(sendRetryable("El servidor rechazó el remitente (MAIL FROM): 450 4.7.1 temporarily rejected")).toBe(true);
  });
  it("no reintenta lo definitivo ni lo que puede haber salido", () => {
    expect(sendRetryable("Auth failed: 535 Authentication credentials invalid\r\n")).toBe(false);
    expect(sendRetryable("El servidor rechazó al destinatario (RCPT TO): 550 5.1.1 user unknown")).toBe(false);
    expect(sendRetryable("SMTP error sin confirmar (el correo puede haber salido): Timeout: read")).toBe(false);
    expect(sendRetryable("El servidor no ofrece conexión cifrada (TLS); usa el puerto 465 o 587 con STARTTLS")).toBe(false);
    expect(sendRetryable("")).toBe(false);
    expect(sendRetryable(null)).toBe(false);
  });
});

describe("bounceRetryable: rebote de una respuesta manual", () => {
  it("reenvía si el rechazo es por la IP de salida de IONOS", () => {
    expect(bounceRetryable({ code: "5.0.0", permanent: true, diag: "550 5.7.1 Service unavailable, Client host [82.165.159.38] blocked using Spamhaus. To request removal from this list see https://www.spamhaus.org/query/ip/82.165.159.38" })).toBe(true);
    // Texto guardado con el salto de línea del aviso en medio de "Spamhaus".
    expect(bounceRetryable({ code: "5.0.0", permanent: true, diag: "550 5.7.1 Service unavailable, Client host [82.165.159.9] blocked using Sp amhaus." })).toBe(true);
    expect(bounceRetryable({ code: "5.7.1", permanent: true, diag: "554 5.7.1 Your sending IP is listed by Barracuda" })).toBe(true);
    expect(bounceRetryable({ code: "4.7.0", permanent: false, diag: "421 4.7.0 Try again later" })).toBe(true);
  });
  it("no reenvía direcciones muertas ni políticas del destinatario", () => {
    expect(bounceRetryable({ code: "5.1.1", permanent: true, diag: "550-5.1.1 The email account that you tried to reach does not exist." })).toBe(false);
    expect(bounceRetryable({ code: "5.2.1", permanent: true, diag: "550-5.2.1 The email account that you tried to reach is inactive." })).toBe(false);
    expect(bounceRetryable({ code: "5.4.1", permanent: true, diag: "550 5.4.1 Recipient address rejected: Access denied." })).toBe(false);
    expect(bounceRetryable({ code: "5.7.520", permanent: true, diag: "550 5.7.520 Access denied, Your organization does not allow external forwarding." })).toBe(false);
    expect(bounceRetryable({ code: "5.1.10", permanent: true, diag: "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup" })).toBe(false);
    expect(bounceRetryable({ code: "5.0.0", permanent: true, diag: "Your email could not be delivered. The following recipient address(es) could not be reached" })).toBe(false);
  });
});

describe("tope de reenvíos", () => {
  it("como mucho 3 envíos de la misma respuesta", () => {
    expect(MAX_REPLY_SENDS).toBe(3);
    expect(canResend(0)).toBe(true);
    expect(canResend(1)).toBe(true);
    expect(canResend(2)).toBe(false);
  });
  it("la nota se añade una sola vez", () => {
    const a = resentNote("Rebote 5.0.0: blocked using Spamhaus");
    expect(a).toBe("Rebote 5.0.0: blocked using Spamhaus · Reenviado automáticamente");
    expect(resentNote(a)).toBe(a);
  });
});
