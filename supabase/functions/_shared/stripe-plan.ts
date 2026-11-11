// Qué plan de la plataforma da una suscripción de Stripe. Parte pura (se prueba con vitest).
//
// La cuenta de Stripe es compartida con otros negocios (tiene enlaces de pago que no son nuestros).
// Una suscripción que no lleva NINGÚN producto nuestro se ignora: antes se trataba como "free" y
// habría bajado de plan a quien pagase otra cosa con el mismo correo.

export const PLANES = ["starter", "growth", "scale"] as const;
export type Plan = typeof PLANES[number];

/** Productos de los planes: los de Funnyleads (landing, 10-11-2026, con metadata.plan) y los
 *  antiguos GodLeads (EUR, pago dentro de la app). */
export const TIER_BY_PRODUCT: Record<string, Plan> = {
  // Funnyleads (metadata {app: funnyleads, plan})
  prod_VbP8mquDtmuTKr: "starter",
  prod_VbP8T2qoDDeJOO: "growth",
  prod_VbP8hN9R1brqFJ: "scale",
  // GodLeads antiguos
  prod_U29mvQRMbo5m6f: "starter", prod_U29mwf36xp5tzO: "starter",
  prod_U29mEi2w9ltRwG: "growth", prod_U29nlSXrrxJsWI: "growth",
  prod_U29nsLzCYygn4u: "scale", prod_U29n2lYSL63LWg: "scale",
};

/** Precios de Funnyleads (los únicos que acepta create-checkout). */
export const PRECIOS_FUNNYLEADS: Record<string, { tier: Plan; interval: "month" | "year" }> = {
  price_1UaCJz2ObXNkJIexLnC0KEao: { tier: "starter", interval: "month" },
  price_1UaCK82ObXNkJIex9sAU4ko7: { tier: "starter", interval: "year" },
  price_1UaCK42ObXNkJIexveYDJQRh: { tier: "growth", interval: "month" },
  price_1UaCKB2ObXNkJIexITFdvpKA: { tier: "growth", interval: "year" },
  price_1UaCK62ObXNkJIexngKtK5Br: { tier: "scale", interval: "month" },
  price_1UaCKD2ObXNkJIexO8o0rU1L: { tier: "scale", interval: "year" },
};

const RANGO: Record<Plan, number> = { starter: 1, growth: 2, scale: 3 };
const esPlan = (v: unknown): v is Plan => typeof v === "string" && (PLANES as readonly string[]).includes(v.toLowerCase());

export interface LineaSuscripcion {
  productId: string;
  priceId: string;
  quantity: number;
  /** price.metadata.tier o price.metadata.plan */
  priceTier?: string | null;
  /** product.metadata.plan (si el producto viene expandido) */
  productTier?: string | null;
}

export interface LecturaSuscripcion {
  /** false = ningún producto nuestro: no tocar los derechos de nadie. */
  esNuestra: boolean;
  tier: Plan | null;
  extraSlots: number;
}

/** `subTier`: metadata de la suscripción (`tier` o `plan`). */
export function leerSuscripcion(lineas: LineaSuscripcion[], subTier: string | null | undefined, slotPriceId = ""): LecturaSuscripcion {
  let tier: Plan | null = null;
  let extraSlots = 0;
  let slots = false;
  const subir = (t: Plan) => { if (!tier || RANGO[t] > RANGO[tier]) tier = t; };
  for (const l of lineas) {
    if (slotPriceId && l.priceId === slotPriceId) { extraSlots += l.quantity || 0; slots = true; continue; }
    const porProducto = TIER_BY_PRODUCT[l.productId];
    if (porProducto) { subir(porProducto); continue; }
    const porPrecio = PRECIOS_FUNNYLEADS[l.priceId];
    if (porPrecio) { subir(porPrecio.tier); continue; }
    if (esPlan(l.priceTier)) { subir(l.priceTier.toLowerCase() as Plan); continue; }
    if (esPlan(l.productTier)) subir(l.productTier.toLowerCase() as Plan);
  }
  // Último recurso: la metadata que el enlace de pago de la landing pone en la suscripción.
  if (!tier && esPlan(subTier)) tier = subTier.toLowerCase() as Plan;
  return { esNuestra: !!tier || slots, tier, extraSlots };
}

/** Lee `tier` o `plan` de un objeto metadata de Stripe. */
export function tierDeMetadata(md: Record<string, string> | null | undefined): string | null {
  if (!md) return null;
  return md.tier || md.plan || null;
}

/** Estados de suscripción de Stripe que dan acceso. */
export const ESTADOS_CON_ACCESO = ["active", "trialing"] as const;
/** Estados que son un problema de cobro: se bloquea con "no hemos podido cobrar". */
export const ESTADOS_IMPAGO = ["past_due", "unpaid", "incomplete", "incomplete_expired"] as const;
/** Estados en los que la suscripción ya no existe para nosotros. */
export const ESTADOS_BAJA = ["canceled", "paused"] as const;

/** Orden para elegir la "mejor" suscripción nuestra de un cliente con varias. */
export function rangoEstado(status: string): number {
  switch (status) {
    case "active": return 6;
    case "trialing": return 5;
    case "past_due": return 4;
    case "unpaid": return 3;
    case "incomplete": return 2;
    case "paused": return 1;
    default: return 0; // canceled, incomplete_expired
  }
}

/** Error de Stripe que se puede enseñar en pantalla (11-11-2026). Nunca deja ver la clave (Stripe la
 *  repite enmascarada en "Invalid API Key provided: …"): un problema de clave o de conexión con
 *  Stripe sale como "el pago no está disponible ahora mismo". */
export const PAGO_NO_DISPONIBLE = "El pago no está disponible en este momento. Inténtalo de nuevo en unos minutos o escríbenos a team@onepulso.online.";
export function publicStripeError(e: unknown): { message: string; status: number; stripeUnavailable: boolean } {
  const err = e as { type?: string; message?: string } | null;
  const msg = String(err?.message || e || "");
  if (err?.type === "StripeAuthenticationError" || err?.type === "StripePermissionError" || err?.type === "StripeConnectionError"
    || /api key|api_key|authentication|permission/i.test(msg)) {
    return { message: PAGO_NO_DISPONIBLE, status: 503, stripeUnavailable: true };
  }
  const limpio = msg.replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, "[oculto]").slice(0, 300);
  return { message: limpio || "No se pudo completar la operación con Stripe.", status: 500, stripeUnavailable: false };
}
