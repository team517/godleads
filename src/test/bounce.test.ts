import { describe, it, expect } from "vitest";
import { extractPermanentBounceRecipients } from "../../supabase/functions/_shared/bounce";

const daemon = "mailer-daemon@ionos.es";
const subj = "Undeliverable: Maria - Take A Tip";

/** Real-world DSN shapes. Suppressing a recipient hides their whole conversation, so the only
 *  acceptable trigger is "this mailbox does not exist". */
describe("extractPermanentBounceRecipients", () => {
  it("suppresses a genuine unknown-user bounce", () => {
    const body = [
      "Content-Type: message/delivery-status",
      "Final-Recipient: rfc822;juan@empresa.com",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 <juan@empresa.com>: Recipient address rejected: User unknown in virtual mailbox table",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual(["juan@empresa.com"]);
  });

  it("suppresses a Spanish 'no existe' bounce", () => {
    const body = [
      "Final-Recipient: rfc822; ana@compania.es",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 La cuenta no existe",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual(["ana@compania.es"]);
  });

  // ── The regression that cost a real lead ────────────────────────────────────────────────
  it("does NOT suppress a spam-policy rejection (5.7.1) — the address is fine", () => {
    const body = [
      "Final-Recipient: rfc822;pcalvo@takeatip.es",
      "Action: failed",
      "Status: 5.7.1",
      "Diagnostic-Code: smtp; 550 5.7.1 Message rejected due to content restrictions",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual([]);
  });

  it("does NOT suppress a reputation / blocklist rejection", () => {
    const body = [
      "Final-Recipient: rfc822;maria@cliente.es",
      "Status: 5.7.606",
      "Diagnostic-Code: smtp; 550 5.7.606 Access denied, banned sending IP [1.2.3.4] listed by Spamhaus",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual([]);
  });

  it("does NOT suppress a full mailbox / over-quota bounce", () => {
    const body = [
      "Final-Recipient: rfc822;jefe@empresa.com",
      "Status: 5.2.2",
      "Diagnostic-Code: smtp; 552 5.2.2 Mailbox full: over quota",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual([]);
  });

  it("does NOT suppress a message-too-large bounce", () => {
    const body = [
      "Final-Recipient: rfc822;compras@empresa.com",
      "Status: 5.3.4",
      "Diagnostic-Code: smtp; 552 5.3.4 Message too large, size limit exceeded",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual([]);
  });

  it("does NOT suppress a temporary 4.x.x deferral", () => {
    const body = [
      "Final-Recipient: rfc822;lead@empresa.com",
      "Status: 4.2.1",
      "Diagnostic-Code: smtp; 450 4.2.1 Greylisted, try again later",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual([]);
  });

  it("ignores wording quoted from OUR OWN email underneath the report", () => {
    // The DSN quotes the original message. Deciding on the whole body let a sales line
    // ("no existe una solución igual") or a footer word flip the verdict.
    const body = [
      "Final-Recipient: rfc822;director@empresa.com",
      "Status: 5.7.1",
      "Diagnostic-Code: smtp; 550 5.7.1 Rejected by policy",
      "",
      "------ Original message ------",
      "Hola, te escribo porque el usuario desconocido de tu web no existe y queria comentarte...",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual([]);
  });

  it("returns nothing when the mail is not a bounce at all", () => {
    expect(extractPermanentBounceRecipients("pedro@empresa.com", "Re: una idea", "Hola, me interesa")).toEqual([]);
  });

  it("never returns the daemon's own address", () => {
    const body = [
      "Final-Recipient: rfc822;mailer-daemon@ionos.es",
      "Final-Recipient: rfc822;real@empresa.com",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
    ].join("\n");
    expect(extractPermanentBounceRecipients(daemon, subj, body)).toEqual(["real@empresa.com"]);
  });
});
