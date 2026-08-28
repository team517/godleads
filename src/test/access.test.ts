import { describe, it, expect } from "vitest";
import { decideAccess, AccessInput } from "@/lib/access";

// Billing gate — this decides who accesses free vs. must pay, so every case is pinned down.
const base: AccessInput = {
  email: "newuser@example.com",
  role: null,
  isClientManager: false,
  allowedRoutes: null,
  contactEmail: null,
  createdAt: "2026-09-01T00:00:00Z", // after the cutoff → a genuinely NEW self-signup
  stripeSubscribed: false,
  nowMs: Date.parse("2026-09-03T00:00:00Z"), // 2 days after signup
};

describe("decideAccess — billing / trial gate", () => {
  it("agency emails are staff (free unlimited), even after the cutoff & unpaid", () => {
    for (const email of ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"]) {
      expect(decideAccess({ ...base, email }).kind).toBe("staff");
    }
  });
  it("role=admin is staff", () => {
    expect(decideAccess({ ...base, role: "admin" }).kind).toBe("staff");
  });
  it("is_client_manager is staff", () => {
    expect(decideAccess({ ...base, isClientManager: true }).kind).toBe("staff");
  });
  it("special full-access contact_email is staff", () => {
    expect(decideAccess({ ...base, contactEmail: "alex@vioonyx.com" }).kind).toBe("staff");
  });

  it("admin-created client (allowed_routes) is free — never gated", () => {
    expect(decideAccess({ ...base, allowedRoutes: ["/dashboard", "/campaigns"] }).kind).toBe("free");
  });
  it("account created BEFORE the cutoff is grandfathered (free)", () => {
    expect(decideAccess({ ...base, createdAt: "2026-08-01T00:00:00Z" }).kind).toBe("free");
  });

  it("NEW self-signup with an active Stripe sub is subscribed", () => {
    expect(decideAccess({ ...base, stripeSubscribed: true }).kind).toBe("subscribed");
  });
  it("NEW self-signup, unpaid, WITHIN 5 days is trialing (days left counted)", () => {
    const d = decideAccess(base);
    expect(d.kind).toBe("trialing");
    if (d.kind === "trialing") expect(d.daysLeft).toBe(3); // signup +5d = Sep 6; now Sep 3 → 3 left
  });
  it("NEW self-signup, unpaid, AFTER 5 days is expired (BLOCKED)", () => {
    expect(decideAccess({ ...base, nowMs: Date.parse("2026-09-10T00:00:00Z") }).kind).toBe("expired");
  });
  it("on the exact boundary (=5 days) it is expired, not trialing", () => {
    expect(decideAccess({ ...base, nowMs: Date.parse("2026-09-06T00:00:00Z") }).kind).toBe("expired");
  });
  it("missing creation date → free (fail-safe, never blocked)", () => {
    expect(decideAccess({ ...base, createdAt: null }).kind).toBe("free"); // null createdAt → grandfathered branch
  });

  it("PRECEDENCE: staff wins even when unpaid + after cutoff", () => {
    expect(decideAccess({ ...base, email: "hello@onepulso.blog", stripeSubscribed: false }).kind).toBe("staff");
  });
});
