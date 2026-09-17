import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { landingTarget } from "@/lib/landing-links";

describe("botones de la landing → aplicación real", () => {
  it("Log in y Start free llevan al acceso", () => {
    expect(landingTarget("#login")).toEqual({ kind: "route", to: "/auth" });
    expect(landingTarget("#signup")).toEqual({ kind: "route", to: "/auth?mode=signup" });
  });
  it("Book a demo / Contact abren un correo al equipo", () => {
    expect(landingTarget("#demo")?.to).toMatch(/^mailto:team@onepulso\.online\?subject=/);
    expect(landingTarget("#contact")).toEqual({ kind: "external", to: "mailto:team@onepulso.online" });
  });
  it("las anclas de sección se quedan como en el diseño (desplazan la página)", () => {
    for (const h of ["#pricing", "#faq", "#scale", "#deliverability", "#inbox", "#top", "", null, undefined]) {
      expect(landingTarget(h as string)).toBeNull();
    }
  });
});

describe("el archivo de la landing", () => {
  // Vive troceado en landing-src/ (un único objeto de 10 MB no subía a GitHub) y se monta al
  // construir. Lo que importa: unido, es el archivo del propietario byte a byte.
  const parts = readdirSync("landing-src").filter((f) => /\.part-\d+$/.test(f)).sort();
  const whole = Buffer.concat(parts.map((f) => readFileSync(`landing-src/${f}`)));
  const manifest = JSON.parse(readFileSync("landing-src/manifest.json", "utf-8"));

  it("los trozos unidos son el archivo original: mismo tamaño y misma huella", () => {
    expect(whole.length).toBe(10726782);
    expect(whole.length).toBe(manifest.size);
    expect(createHash("sha256").update(whole).digest("hex")).toBe(manifest.sha256);
    expect(manifest.sha256).toBe("160f25feb35b64fa7df5afee2e6e3071fe8b65fa18d5881ba0bb6324e74a8b2d");
    expect(whole.subarray(0, 400).toString("utf-8")).toContain("<title>Bundled Page</title>");
  });
  it("usa los destinos que la aplicación traduce", () => {
    const html = whole.toString("utf-8");
    // Los enlaces van dentro de la plantilla JSON, con las comillas escapadas.
    const hrefs = new Set([...html.matchAll(/href=\\"(#[a-z-]+)\\"/g)].map((m) => m[1]));
    expect(hrefs.has("#login")).toBe(true);
    expect(hrefs.has("#signup")).toBe(true);
  });
});
