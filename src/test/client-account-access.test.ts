// Una cuenta de CLIENTE nunca puede topar con el muro de pago: paga su dueño.
//
// Desde que el cliente es una cuenta completa de la plataforma, lo único que la
// libra del muro es esto: el servidor le escribe `profiles.allowed_routes` (desde
// client_routes_for_sections) y decideAccess trata cualquier cuenta con rutas
// asignadas como "free". Ya no hay ninguna redirección a un área aparte que la
// esquivara, así que esta prueba es la red de seguridad: si alguien quita la rama
// de allowed_routes de decideAccess, los clientes de todo el mundo se quedan fuera.
import { describe, expect, it } from "vitest";
import { decideAccess, TRIAL_CUTOFF_MS, type AccessInput } from "@/lib/access";

/** Una cuenta de cliente recién creada, en el peor caso posible: nacida DESPUÉS
 *  del corte de la prueba gratuita, sin suscripción y con la prueba ya vencida. */
const clientAccount: AccessInput = {
  email: "ana@verasalud.com",
  role: null,
  isClientManager: false,
  // Lo que escribe la edge function `clients` con las secciones que le abre su dueño.
  allowedRoutes: ["/campaigns", "/dashboard", "/email-accounts", "/leads", "/stats", "/unibox"],
  contactEmail: null,
  createdAt: "2026-09-12T10:00:00Z",
  stripeSubscribed: false,
  nowMs: Date.parse("2026-11-01T00:00:00Z"), // mucho después de sus 5 días
};

describe("cuenta de cliente · nunca la bloquea el muro de pago", () => {
  it("nació después del corte y no paga, pero es «free» por tener allowed_routes", () => {
    expect(Date.parse(clientAccount.createdAt!)).toBeGreaterThan(TRIAL_CUTOFF_MS);
    expect(decideAccess(clientAccount).kind).toBe("free");
  });

  it("no es «expired» ni «trialing» aunque hayan pasado meses", () => {
    const kind = decideAccess(clientAccount).kind;
    expect(kind).not.toBe("expired");
    expect(kind).not.toBe("trialing");
  });

  it("sigue siendo «free» con una sola sección abierta", () => {
    expect(decideAccess({ ...clientAccount, allowedRoutes: ["/unibox"] }).kind).toBe("free");
  });

  it("con las siete secciones de la lista blanca también es «free»", () => {
    const todas = ["/dashboard", "/email-accounts", "/campaigns", "/leads", "/unibox", "/stats", "/ai-prompts"];
    expect(decideAccess({ ...clientAccount, allowedRoutes: todas }).kind).toBe("free");
  });

  it("y una cuenta normal sin rutas en las mismas condiciones SÍ queda bloqueada (la prueba no es vacía)", () => {
    expect(decideAccess({ ...clientAccount, allowedRoutes: null }).kind).toBe("expired");
    expect(decideAccess({ ...clientAccount, allowedRoutes: [] }).kind).toBe("expired");
  });
});
