import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { DEMO_URL, landingIsPainted, landingTarget } from "@/lib/landing-links";

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

describe("botones de la landing → aplicación real", () => {
  it("Log in lleva al acceso (y #signup, si existiera, al alta con prueba)", () => {
    expect(landingTarget("#login")).toEqual({ kind: "route", to: "/auth" });
    expect(landingTarget("#signup")).toEqual({ kind: "route", to: "/empezar" });
  });
  it("Start free trial / Start free / Start now llevan al alta; el menú Pricing sigue desplazando la página", () => {
    for (const t of ["Start free trial", "Start free", "Start now →", "  start free trial  "]) {
      expect(landingTarget("#pricing", t)).toEqual({ kind: "route", to: "/empezar" });
    }
    expect(landingTarget("#pricing", "Pricing")).toBeNull();
    expect(landingTarget("#pricing")).toBeNull();
    expect(landingTarget("#pricing", "Compare the plans")).toBeNull();
  });
  it("los Choose de precios (enlaces de pago del diseño) llevan al alta con su plan y periodo", () => {
    expect(landingTarget("https://buy.stripe.com/aFa28kcYmbhy0e55o42ZO0g", "Choose")).toEqual({ kind: "route", to: "/empezar?plan=starter&periodo=month" });
    expect(landingTarget("https://buy.stripe.com/00w7sE7E299q6Ct17O2ZO0j", "Choose")).toEqual({ kind: "route", to: "/empezar?plan=growth&periodo=year" });
    expect(landingTarget("https://buy.stripe.com/5kQcMYe2q85m2mddUA2ZO0l")).toEqual({ kind: "route", to: "/empezar?plan=scale&periodo=year" });
    // La formación de 350 € (pago único) sigue yendo a Stripe.
    expect(landingTarget("https://buy.stripe.com/14AeV64rQgBSbWN03K2ZO0m", "Book your training")).toEqual({ kind: "external", to: "https://buy.stripe.com/14AeV64rQgBSbWN03K2ZO0m" });
  });
  it("Book a demo / See it in action / Talk to sales abren la agenda; Contact, un correo al equipo", () => {
    expect(landingTarget("#demo")).toEqual({ kind: "external", to: DEMO_URL });
    expect(DEMO_URL).toMatch(/^https:\/\/cal\.com\//);
    expect(landingTarget("#contact")).toEqual({ kind: "external", to: "mailto:team@onepulso.online" });
  });
  it("los enlaces del pie (About, Careers, Partners, Docs, API, Status, Privacy, Terms) escriben al equipo con asunto", () => {
    for (const h of ["#about", "#careers", "#partners", "#docs", "#api", "#status", "#privacy", "#terms"]) {
      const t = landingTarget(h);
      expect(t?.kind).toBe("external");
      expect(t?.to).toMatch(/^mailto:team@onepulso\.online\?subject=.+Funnyleads/);
    }
  });
  it("los enlaces absolutos (pago de Stripe, agenda) y los mailto salen del marco tal cual", () => {
    expect(landingTarget("https://buy.stripe.com/otro-enlace")).toEqual({ kind: "external", to: "https://buy.stripe.com/otro-enlace" });
    expect(landingTarget("  https://cal.com/x/15min ")).toEqual({ kind: "external", to: "https://cal.com/x/15min" });
    expect(landingTarget("mailto:hola@x.es")).toEqual({ kind: "external", to: "mailto:hola@x.es" });
  });
  it("las anclas de sección se quedan como en el diseño (desplazan la página)", () => {
    for (const h of ["#pricing", "#faq", "#scale", "#infra", "#deliverability", "#inbox", "#top", "", null, undefined]) {
      expect(landingTarget(h as string)).toBeNull();
    }
  });
});

describe("pantalla de carga de la landing", () => {
  const docFrom = (html: string) => new DOMParser().parseFromString(html, "text/html");
  it("mientras está la miniatura violeta del empaquetado antiguo, NO está lista", () => {
    expect(landingIsPainted(docFrom('<body><div id="__bundler_thumbnail"></div><h1>Turn cold email</h1></body>'))).toBe(false);
    expect(landingIsPainted(docFrom('<body><div id="__bundler_loading">Unpacking…</div></body>'))).toBe(false);
  });
  it("la página .dc.html con su plantilla sin montar (x-dc sin #dc-root) tampoco", () => {
    expect(landingIsPainted(docFrom("<body><x-dc><h1>Turn cold email into booked revenue</h1></x-dc></body>"))).toBe(false);
    expect(landingIsPainted(docFrom("<body><h1>  </h1></body>"))).toBe(false);
    expect(landingIsPainted(null)).toBe(false);
  });
  it("montada (#dc-root) y con el titular pintado, lista — aunque conserve la miniatura oculta del editor", () => {
    expect(landingIsPainted(docFrom('<body><div id="dc-root"><header></header><h1>Turn cold email into booked revenue</h1></div></body>'))).toBe(true);
    expect(landingIsPainted(docFrom('<body><div id="dc-root"><svg id="__bundler_thumbnail"></svg><h1>Turn cold email into booked revenue</h1></div></body>'))).toBe(true);
    expect(landingIsPainted(docFrom('<body><div id="dc-root"><h1> </h1></div></body>'))).toBe(false);
    expect(landingIsPainted(docFrom("<body><header></header><h1>Turn cold email into booked revenue</h1></body>"))).toBe(true);
  });
});

describe("la landing de Funnyleads (landing-src/funnyleads)", () => {
  // El diseño de Claude Design se sirve tal cual: página + runtime + imágenes + vídeo. Cada archivo
  // lleva su huella en el manifiesto; los grandes van en trozos. Lo que se monta debe ser idéntico.
  const base = "landing-src/funnyleads";
  const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, "utf-8"));
  const fileOf = (f: { path: string; parts?: number }) => f.parts
    ? Buffer.concat(Array.from({ length: f.parts }, (_, i) => readFileSync(`${base}/${f.path}.part-${String(i).padStart(2, "0")}`)))
    : readFileSync(`${base}/${f.path}`);

  it("todos los archivos del manifiesto existen y coinciden en tamaño y huella", () => {
    expect(manifest.files.length).toBe(59); // 14-11-2026: + logo de OnePulso (Funnyleads × OnePulso)
    for (const f of manifest.files) {
      const buf = fileOf(f);
      expect(buf.length, f.path).toBe(f.size);
      expect(sha256(buf), f.path).toBe(f.sha256);
    }
  });
  it("la página es el diseño de Funnyleads y carga su runtime y sus recursos en relativo", () => {
    const html = fileOf(manifest.files.find((f: any) => f.path === "index.html")).toString("utf-8");
    expect(html).toContain("Funnyleads");
    expect(html).toContain('<script src="./support.js">');
    expect(html).toContain('<script src="./image-slot.js">');
    expect(html).toContain("./assets/video/reel.mp4");
    expect(html).toContain("./assets/onepulso-logo.png");
    expect(html).toContain("Funnyleads × OnePulso");
    // Todo recurso que la página referencia está en el manifiesto.
    const refs = new Set([...html.matchAll(/["'(](?:\.\/)?(assets\/[^"')\s]+)/g)].map((m) => m[1]));
    const paths = new Set(manifest.files.map((f: any) => f.path));
    for (const r of refs) expect(paths.has(r), r).toBe(true);
    // Botones del diseño que la aplicación traduce.
    for (const h of ["#login", "#demo", "#contact", "#privacy", "#terms"]) expect(html).toContain(`href="${h}"`);
  });
  it("el vídeo y el mapa van troceados en partes de 1,4 MB como mucho", () => {
    const big = manifest.files.filter((f: any) => f.parts);
    expect(big.map((f: any) => f.path).sort()).toEqual(["assets/opt/worldmap2.png", "assets/video/reel.mp4"]);
    for (const f of readdirSync(`${base}/assets/video`)) {
      if (/\.part-\d+$/.test(f)) expect(readFileSync(`${base}/assets/video/${f}`).length).toBeLessThanOrEqual(1_400_000);
    }
  });
});

describe("la landing anterior de OnePulso (landing-src/*.part-NN) sigue montándose igual", () => {
  const parts = readdirSync("landing-src").filter((f) => /\.part-\d+$/.test(f)).sort();
  const whole = Buffer.concat(parts.map((f) => readFileSync(`landing-src/${f}`)));
  const manifest = JSON.parse(readFileSync("landing-src/manifest.json", "utf-8"));
  it("los trozos unidos son el archivo original: mismo tamaño y misma huella", () => {
    expect(whole.length).toBe(manifest.size);
    expect(sha256(whole)).toBe(manifest.sha256);
    expect(manifest.sha256).toBe("160f25feb35b64fa7df5afee2e6e3071fe8b65fa18d5881ba0bb6324e74a8b2d");
  });
});
