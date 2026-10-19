import { describe, expect, it } from "vitest";
import { findEmailStatusColumn, normalizeEmailStatus, rowEmailStatus } from "@/lib/email-status";

/* Estado del email que traen las listas → leads.verification_status (19-10-2026). */
describe("email-status", () => {
  it("encuentra la columna con distintos nombres", () => {
    expect(findEmailStatusColumn(["id", "first_name", "email", "email_status", "name"])).toBe("email_status");
    expect(findEmailStatusColumn(["Email", "Email Status"])).toBe("Email Status");
    expect(findEmailStatusColumn(["email", "verification_status"])).toBe("verification_status");
    expect(findEmailStatusColumn(["email", "Estado del email"])).toBe("Estado del email");
    expect(findEmailStatusColumn(["email", "status", "first_name"])).toBeNull(); // "status" a secas puede ser otra cosa
  });

  it("traduce los valores de Apollo y verificadores", () => {
    expect(normalizeEmailStatus("VALID")).toBe("valid");
    expect(normalizeEmailStatus("Verified")).toBe("valid");
    expect(normalizeEmailStatus("deliverable")).toBe("valid");
    expect(normalizeEmailStatus("GUESSED")).toBe("risky");
    expect(normalizeEmailStatus("extrapolated")).toBe("risky");
    expect(normalizeEmailStatus("catch-all")).toBe("risky");
    expect(normalizeEmailStatus("Accept All")).toBe("risky");
    expect(normalizeEmailStatus("UNAVAILABLE")).toBe("invalid");
    expect(normalizeEmailStatus("invalid")).toBe("invalid");
    expect(normalizeEmailStatus("do_not_mail")).toBe("invalid");
    expect(normalizeEmailStatus("Bounced")).toBe("invalid");
    expect(normalizeEmailStatus("")).toBeNull();
    expect(normalizeEmailStatus("algo raro")).toBeNull();
  });

  it("estado de una fila", () => {
    expect(rowEmailStatus({ email: "a@b.es", email_status: "VALID" }, "email_status")).toBe("valid");
    expect(rowEmailStatus({ email: "a@b.es" }, null)).toBeNull();
  });
});
