import { describe, it, expect } from "vitest";
import { PHASES, normalizeStatus, progressPct, phaseEmailDraft, credentialsEmailDraft } from "@/lib/onboarding";

describe("onboarding progress", () => {
  it("has exactly 6 fixed phases", () => {
    expect(PHASES).toHaveLength(6);
  });
  it("normalizes junk/short/long status to 6 valid states", () => {
    expect(normalizeStatus(null)).toEqual(["pending", "pending", "pending", "pending", "pending", "pending"]);
    expect(normalizeStatus(["done", "bogus", "in_progress"])).toEqual(["done", "pending", "in_progress", "pending", "pending", "pending"]);
    expect(normalizeStatus(["done", "done", "done", "done", "done", "done", "done"])).toHaveLength(6);
  });
  it("computes progress: done=full, in_progress=half", () => {
    expect(progressPct(normalizeStatus([]))).toBe(0);
    expect(progressPct(["done", "done", "done", "done", "done", "done"])).toBe(100);
    expect(progressPct(["done", "in_progress", "pending", "pending", "pending", "pending"])).toBe(Math.round((1.5 / 6) * 100)); // 25
  });
});

describe("phaseEmailDraft", () => {
  it("in_progress draft names the phase, %, portal link; no raw templates", () => {
    const { subject, body } = phaseEmailDraft({
      state: "in_progress", phaseTitle: "Calentamiento", phaseIndex: 2,
      companyName: "SEO innova", pct: 25, portalUrl: "https://x.test/o/seo-innova",
    });
    expect(subject).toBe("Fase en curso: Calentamiento");
    expect(body).toContain("Calentamiento");
    expect(body).toContain("25%");
    expect(body).toContain("https://x.test/o/seo-innova");
    expect(body).not.toMatch(/\{\{|\}\}|undefined|null/);
  });
  it("done with a next phase names the next task", () => {
    const { subject, body } = phaseEmailDraft({
      state: "done", phaseTitle: "Calentamiento", phaseIndex: 2,
      companyName: "SEO innova", pct: 42, nextPhaseTitle: "Listas y segmentación",
    });
    expect(subject).toBe("Fase completada: Calentamiento");
    expect(body).toContain("siguiente");
    expect(body).toContain("Listas y segmentación");
  });
  it("done at 100% is a congrats draft", () => {
    const { subject, body } = phaseEmailDraft({
      state: "done", phaseTitle: "Lanzamiento y optimización", phaseIndex: 5, pct: 100,
    });
    expect(subject).toBe("¡Onboarding completado!");
    expect(body).toContain("última fase");
    expect(body).not.toContain("undefined");
  });
});

describe("credentialsEmailDraft", () => {
  it("includes the email, password and portal link", () => {
    const { subject, body } = credentialsEmailDraft({
      companyName: "SEO innova", portalUrl: "https://x.test/o/seo-innova",
      email: "info@seoinnova.es", password: "OnePulso123%",
    });
    expect(subject).toContain("SEO innova");
    expect(body).toContain("info@seoinnova.es");
    expect(body).toContain("OnePulso123%");
    expect(body).toContain("https://x.test/o/seo-innova");
  });
  it("tolerates a missing password", () => {
    const { body } = credentialsEmailDraft({ email: "a@b.com", password: null });
    expect(body).toContain("a@b.com");
    expect(body).not.toContain("null");
  });
});
