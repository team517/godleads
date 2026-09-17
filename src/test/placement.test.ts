import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canUsePlacement, contentHints, findSpamFolder, providerOf, resultsForClient, sampleFieldsFor, summarizePlacement,
  type PlacementAccessInput, type SeedResult,
} from "@/lib/placement";

const r = (provider: string, folder: SeedResult["folder"], email = `s@${provider}.com`): SeedResult => ({ email, provider, folder });

describe("summarizePlacement", () => {
  it("todo en bandeja → veredicto bandeja, 100%", () => {
    const s = summarizePlacement([r("Gmail", "inbox"), r("Gmail", "inbox"), r("Outlook", "inbox")]);
    expect(s.verdict).toBe("inbox");
    expect(s.inboxPct).toBe(100);
    expect(s.byProvider).toEqual([
      { provider: "Gmail", inbox: 2, promotions: 0, spam: 0, missing: 0, error: 0 },
      { provider: "Outlook", inbox: 1, promotions: 0, spam: 0, missing: 0, error: 0 },
    ]);
  });
  it("todo en spam → spam; mezcla → mixto con su %", () => {
    expect(summarizePlacement([r("Gmail", "spam"), r("Gmail", "spam")]).verdict).toBe("spam");
    const m = summarizePlacement([r("Gmail", "inbox"), r("Gmail", "spam"), r("Gmail", "spam")]);
    expect(m.verdict).toBe("mixed");
    expect(m.inboxPct).toBe(33);
  });
  it("Promociones cuenta como bandeja (no es spam)", () => {
    const s = summarizePlacement([r("Gmail", "promotions"), r("Gmail", "inbox")]);
    expect(s.verdict).toBe("inbox");
    expect(s.promotions).toBe(1);
    expect(s.inboxPct).toBe(100);
  });
  it("lo que aún no ha llegado no cuenta en contra: pendiente, no spam", () => {
    const s = summarizePlacement([r("Gmail", "missing"), r("Gmail", "missing")]);
    expect(s.verdict).toBe("pending");
    expect(s.inboxPct).toBeNull();
    const parcial = summarizePlacement([r("Gmail", "inbox"), r("Gmail", "missing")]);
    expect(parcial.verdict).toBe("inbox");
    expect(parcial.inboxPct).toBe(100);
    expect(parcial.missing).toBe(1);
  });
  it("sin buzones o sólo errores → sin resultado", () => {
    expect(summarizePlacement([]).verdict).toBe("unknown");
    expect(summarizePlacement([r("Gmail", "error")]).verdict).toBe("unknown");
  });
});

describe("privacidad de los buzones semilla", () => {
  it("al cliente sólo le llega proveedor + carpeta, nunca la dirección", () => {
    const out = resultsForClient([r("Gmail", "inbox", "semilla.secreta@gmail.com")]);
    expect(out).toEqual([{ provider: "Gmail", folder: "inbox" }]);
    expect(JSON.stringify(out)).not.toContain("semilla.secreta");
  });
  it("proveedor por dominio", () => {
    expect(providerOf("a@gmail.com")).toBe("Gmail");
    expect(providerOf("a@hotmail.es")).toBe("Outlook");
    expect(providerOf("a@yahoo.es")).toBe("Yahoo");
    expect(providerOf("a@empresa.es")).toBe("empresa.es");
  });
});

describe("findSpamFolder", () => {
  const BS = String.fromCharCode(92);
  it("usa la marca Junk (RFC 6154) aunque el nombre esté en otro idioma", () => {
    const list = `* LIST (${BS}HasNoChildren) "/" "INBOX"\r\n* LIST (${BS}HasNoChildren ${BS}Junk) "/" "[Gmail]/Correo no deseado"\r\n* LIST (${BS}Trash) "/" "[Gmail]/Papelera"\r\n`;
    expect(findSpamFolder(list)).toBe("[Gmail]/Correo no deseado");
  });
  it("sin marcas, por nombre (Junk, Spam, no deseado); y null si no hay", () => {
    expect(findSpamFolder(`* LIST () "." INBOX\r\n* LIST () "." INBOX.Junk\r\n`)).toBe("INBOX.Junk");
    expect(findSpamFolder(`* LIST () "/" "INBOX"\r\n* LIST () "/" "[Gmail]/Spam"\r\n`)).toBe("[Gmail]/Spam");
    expect(findSpamFolder(`* LIST () "/" "INBOX"\r\n* LIST () "/" "Enviados"\r\n`)).toBeNull();
  });
  it("una carpeta llamada «Spamalot» o «Antispam-info» no se confunde con la de spam", () => {
    expect(findSpamFolder(`* LIST () "/" "INBOX"\r\n* LIST () "/" "Spamalot"\r\n`)).toBeNull();
  });
});

describe("canUsePlacement", () => {
  const base: PlacementAccessInput = { email: "nuevo@cliente.com", role: null, isClientManager: false, allowedRoutes: null, createdAt: "2026-09-10T00:00:00Z", entitlementTier: null, entitlementStatus: null };
  it("agencia, gestores y admin: sí, y gestionan las semillas", () => {
    expect(canUsePlacement({ ...base, email: "Hello@onepulso.blog" })).toEqual({ allowed: true, agency: true });
    expect(canUsePlacement({ ...base, isClientManager: true })).toEqual({ allowed: true, agency: true });
    expect(canUsePlacement({ ...base, role: "admin" })).toEqual({ allowed: true, agency: true });
  });
  it("cliente creado por la agencia y cuentas anteriores al muro de pago: sí, sin ser agencia", () => {
    expect(canUsePlacement({ ...base, allowedRoutes: ["/dashboard"] })).toEqual({ allowed: true, agency: false });
    expect(canUsePlacement({ ...base, createdAt: "2026-08-01T00:00:00Z" })).toEqual({ allowed: true, agency: false });
  });
  it("suscriptor de pago: sí; registro nuevo en prueba gratuita o plan cancelado: no", () => {
    expect(canUsePlacement({ ...base, entitlementTier: "growth", entitlementStatus: "active" })).toEqual({ allowed: true, agency: false });
    expect(canUsePlacement(base)).toEqual({ allowed: false, reason: expect.stringContaining("planes de pago") });
    expect(canUsePlacement({ ...base, entitlementTier: "growth", entitlementStatus: "canceled" }).allowed).toBe(false);
    expect(canUsePlacement({ ...base, entitlementTier: "free", entitlementStatus: "active" }).allowed).toBe(false);
  });
});

describe("sampleFieldsFor — la prueba sale con los datos cambiados", () => {
  it("prefiere los datos reales del lead (sin importar cómo se escriba la clave)", () => {
    const f = sampleFieldsFor(["first_name", "company_name"], { FirstName: "Marta", "Company Name": "Acme SL" });
    expect(f).toEqual({ first_name: "Marta", company_name: "Acme SL" });
  });
  it("lo que falte se rellena con un ejemplo verosímil; nunca queda una variable del remitente", () => {
    const f = sampleFieldsFor(["first_name", "city", "SenderFirstName", "dato_raro"], { first_name: "  " });
    expect(f.first_name).toBe("Laura");
    expect(f.city).toBe("Valencia");
    expect(f).not.toHaveProperty("SenderFirstName");
    expect(f.dato_raro).toBe("");
  });
});

describe("contentHints", () => {
  it("un copy limpio no da avisos", () => {
    expect(contentHints("Una idea para Acme", "Hola Marta,\n\nVi que estáis creciendo en Valencia y quería proponerte algo concreto para el taller. ¿Te viene bien una llamada de diez minutos esta semana? Un saludo.")).toEqual([]);
  });
  it("avisa de enlaces, acortadores, imágenes, palabras gancho y mayúsculas", () => {
    const h = contentHints("OFERTA URGENTE", 'Hola, haz clic aquí: https://bit.ly/x https://a.com https://b.com <img src="x.png"> ¡¡¡GRATIS!!!').map((x) => x.text).join(" | ");
    expect(h).toMatch(/3 enlaces/);
    expect(h).toMatch(/acortado/);
    expect(h).toMatch(/imágenes/);
    expect(h).toMatch(/gratis/);
    expect(h).toMatch(/haz clic/);
    expect(h).toMatch(/MAYÚSCULAS/);
    expect(h).toMatch(/exclamación/);
  });
  it("«ofertar» o «freelance» no disparan el aviso de palabras", () => {
    expect(contentHints("Hola", "Trabajo como freelance y os quería ofertar una colaboración a medida para vuestro equipo de ventas durante este trimestre.").some((x) => /Palabras/.test(x.text))).toBe(false);
  });
});

describe("espejo servidor ↔ navegador", () => {
  it("src/lib/placement.ts es idéntico a supabase/functions/_shared/placement.ts", () => {
    const norm = (p: string) => readFileSync(p, "utf-8").split(String.fromCharCode(13)).join("");
    expect(norm("src/lib/placement.ts")).toBe(norm("supabase/functions/_shared/placement.ts"));
  });
});
