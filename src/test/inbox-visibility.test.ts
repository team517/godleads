import { describe, it, expect } from "vitest";
import { isCampaignRelevant } from "@/lib/inbox-visibility";

// The clean Unibox shows a message only when isCampaignRelevant() is true. These cases mirror the
// owner's rule: campaign lead OR same domain as a campaign lead → in; warm-up / random noise → out.
const leadDomains = new Set(["acme.com", "globex.io", "spiky.ai"]);

describe("inbox visibility — clean bandeja whitelist", () => {
  const rel = (m: any) => isCampaignRelevant(m, leadDomains);

  it("SHOWS a message linked to a lead (lead_id)", () => {
    expect(rel({ lead_id: "abc", from_email: "someone@whatever.com" })).toBe(true);
  });
  it("SHOWS a message linked to a campaign (campaign_id)", () => {
    expect(rel({ campaign_id: "c1", from_email: "x@random.net" })).toBe(true);
  });
  it("SHOWS a reply from a lead's exact domain", () => {
    expect(rel({ from_email: "oliver@acme.com" })).toBe(true);
  });
  it("SHOWS a COLLEAGUE at the same company (same domain, different person, not linked)", () => {
    expect(rel({ from_email: "another.person@globex.io" })).toBe(true);
  });
  it("is case-insensitive on the domain", () => {
    expect(rel({ from_email: "Boss@ACME.com" })).toBe(true);
  });

  // The noise the owner is complaining about → must be HIDDEN from the clean view.
  it("HIDES a warm-up-network message from an unrelated domain", () => {
    expect(rel({ from_email: "seed4821@warmupmail.co" })).toBe(false);
  });
  it("HIDES a random nonsensical message (\"Will review the new processes…\")", () => {
    expect(rel({ from_email: "randomguy@unknown-corp.com", subject: "Will review the new processes and ensure my team is on board" })).toBe(false);
  });
  it("HIDES a message with no from_email", () => {
    expect(rel({ from_email: "" })).toBe(false);
    expect(rel({ from_email: null })).toBe(false);
    expect(rel({})).toBe(false);
  });
  it("HIDES a subdomain that is NOT itself in the lead domains", () => {
    // Strict: only the exact lead domain counts (mail.acme.com is not acme.com).
    expect(rel({ from_email: "noreply@mail.acme.com" })).toBe(false);
  });
});
