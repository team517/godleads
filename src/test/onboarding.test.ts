import { describe, it, expect } from "vitest";
import { PHASES, normalizeStatus, progressPct, buildPhaseEmail } from "@/lib/onboarding";

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

describe("buildPhaseEmail", () => {
  it("in_progress email carries phase title, %, portal button, no raw templates", () => {
    const { subject, html } = buildPhaseEmail({
      state: "in_progress", phaseTitle: "Calentamiento", phaseIndex: 2,
      companyName: "SEO innova", pct: 25, portalUrl: "https://x.test/o/seo-innova", accent: "#1EA7B5",
    });
    expect(subject).toContain("Fase en curso");
    expect(subject).toContain("Calentamiento");
    expect(html).toContain("Fase 3: Calentamiento");
    expect(html).toContain("25%");
    expect(html).toContain("https://x.test/o/seo-innova");
    expect(html).toContain("#1EA7B5");
    expect(html).not.toMatch(/\{\{|\}\}|undefined/);
  });
  it("done at 100% is a congrats email", () => {
    const { subject, html } = buildPhaseEmail({
      state: "done", phaseTitle: "Lanzamiento y optimización", phaseIndex: 5,
      companyName: "SEO innova", pct: 100,
    });
    expect(subject).toContain("Onboarding completado");
    expect(html).toContain("todas las fases");
  });
  it("escapes HTML in company/phase and tolerates missing company + url", () => {
    const { subject, html } = buildPhaseEmail({
      state: "done", phaseTitle: "A & <b>B</b>", phaseIndex: 0, companyName: null, pct: 50, portalUrl: null,
    });
    expect(subject).toContain("tu proyecto");
    expect(html).toContain("A &amp; &lt;b&gt;B&lt;/b&gt;");
    expect(html).not.toContain("<b>B</b>");
    expect(html).not.toContain("Ver mi progreso"); // no button without url
  });
});
