import { describe, expect, it } from "vitest";
import { ASUNTO_ARRANQUE, EQUIPO_EMAIL, introEmailHtml } from "@/lib/intro-email";

const base = { name: "Laura", company: "Acme", formUrl: "https://forms.gle/x", onboardingUrl: "https://app/o/acme", color: "" };

describe("correo de arranque de Automatización", () => {
  it("lo firma el asistente y lleva formulario, onboarding, credenciales y el correo del equipo", () => {
    const html = introEmailHtml({ ...base, email: "laura@acme.es", password: "Clave123", loginUrl: "https://app/auth" });
    expect(html).toContain("Muy buenas, Laura:");
    expect(html).toContain("Soy el asistente de OnePulso");
    expect(html).toContain('href="https://forms.gle/x"');
    expect(html).toContain('href="https://app/o/acme"');
    expect(html).toContain("laura@acme.es");
    expect(html).toContain("Clave123");
    expect(html).toContain(`mailto:${EQUIPO_EMAIL}`);
    expect(html).toContain("Quedamos atentos a tu respuesta del formulario para poder crear la campaña");
  });

  it("sin contraseña no enseña el bloque de credenciales", () => {
    const html = introEmailHtml(base);
    expect(html).not.toContain("Contraseña");
    expect(html).toContain(EQUIPO_EMAIL);
  });

  it("escapa lo que escribe el usuario y no lleva emojis", () => {
    const html = introEmailHtml({ ...base, name: "<b>x</b>" });
    expect(html).not.toContain("<b>x</b>");
    expect(/\p{Extended_Pictographic}/u.test(html + ASUNTO_ARRANQUE)).toBe(false);
  });
});
