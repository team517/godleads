// Qué plan de la plataforma da una suscripción de Stripe. Parte pura (se prueba con vitest).
//
// La cuenta de Stripe es compartida con otros negocios (tiene enlaces de pago que no son nuestros).
// Una suscripción que no lleva NINGÚN producto nuestro se ignora: antes se trataba como "free" y
// habría bajado de plan a quien pagase otra cosa con el mismo correo.

import {
  CUSTOM_FIELDS_CLEARED, CUSTOM_PRODUCT_ID, customByMetadata, customByPaymentLink, customByPriceId, customEntitlementFields,
  customLevel, parseCustomLevel, type CustomLevel,
} from "./custom-plan.ts";

export const PLANES = ["starter", "growth", "scale"] as const;
export type Plan = typeof PLANES[number];

/** Productos de los planes: los de Funnyleads (landing, 10-11-2026, con metadata.plan) y los
 *  antiguos GodLeads (EUR, pago dentro de la app). */
export const TIER_BY_PRODUCT: Record<string, Plan> = {
  // El plan a medida (prod_VbtahTB7Qo9EqB) NO va aquí: lo lee leerSuscripcion por su precio/nivel.
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

/** Precios del plan a medida (20): nivel e intervalo. create-checkout los acepta además de los 6. */
export function precioAMedida(priceId: string): { level: CustomLevel; interval: "month" | "year" } | null {
  return customByPriceId(priceId);
}

/** ¿Lleva prueba gratuita este checkout? Sólo si se pide, es un plan normal y nunca tuvo suscripción.
 *  El plan a medida se paga siempre desde el primer día. */
export function checkoutConPrueba(priceId: string, pedida: boolean, yaTuvoSuscripcion: boolean): boolean {
  return pedida && !customByPriceId(priceId) && !yaTuvoSuscripcion;
}

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
  /** price.metadata.level (plan a medida) */
  priceLevel?: string | null;
}

export interface LecturaSuscripcion {
  /** false = ningún producto nuestro: no tocar los derechos de nadie. */
  esNuestra: boolean;
  tier: Plan | null;
  extraSlots: number;
  /** Plan a medida (11-11-2026): su nivel con los topes. null = plan normal. */
  custom: CustomLevel | null;
}

/** `subTier`: metadata de la suscripción (`tier` o `plan`). */
export function leerSuscripcion(lineas: LineaSuscripcion[], subTier: string | null | undefined, slotPriceId = "", subLevel?: string | null): LecturaSuscripcion {
  let tier: Plan | null = null;
  let extraSlots = 0;
  let slots = false;
  let custom: CustomLevel | null = null;
  const subir = (t: Plan) => { if (!tier || RANGO[t] > RANGO[tier]) tier = t; };
  for (const l of lineas) {
    if (slotPriceId && l.priceId === slotPriceId) { extraSlots += l.quantity || 0; slots = true; continue; }
    // Plan a medida: por su precio o, si es un precio nuevo del mismo producto, por su metadata.
    const aMedida = customByPriceId(l.priceId)?.level
      ?? (l.productId === CUSTOM_PRODUCT_ID || String(l.priceTier || "").toLowerCase() === "custom"
        ? (parseCustomLevel(l.priceLevel) ? customLevel(parseCustomLevel(l.priceLevel)!) : null) : null);
    if (aMedida) {
      if (!custom || aMedida.level > custom.level) custom = aMedida;
      subir("scale");
      continue;
    }
    const porProducto = TIER_BY_PRODUCT[l.productId];
    if (porProducto) { subir(porProducto); continue; }
    const porPrecio = PRECIOS_FUNNYLEADS[l.priceId];
    if (porPrecio) { subir(porPrecio.tier); continue; }
    if (esPlan(l.priceTier)) { subir(l.priceTier.toLowerCase() as Plan); continue; }
    if (esPlan(l.productTier)) subir(l.productTier.toLowerCase() as Plan);
  }
  // Último recurso: la metadata que el enlace de pago de la landing pone en la suscripción.
  if (!tier && String(subTier || "").toLowerCase() === "custom" && parseCustomLevel(subLevel)) {
    custom = customLevel(parseCustomLevel(subLevel)!);
    tier = "scale";
  }
  if (!tier && esPlan(subTier)) tier = subTier.toLowerCase() as Plan;
  return { esNuestra: !!tier || slots, tier, extraSlots, custom };
}

/** Columnas del plan a medida para user_entitlements: los topes del nivel, o vacías si no lo es
 *  (o si la suscripción ya no da plan). */
export function camposAMedida(custom: CustomLevel | null, sinPlan = false): Record<string, number | null> {
  if (!custom || sinPlan) return { ...CUSTOM_FIELDS_CLEARED };
  const { tier: _t, ...campos } = customEntitlementFields(custom);
  return campos as Record<string, number>;
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

/** Enlaces de pago de Funnyleads (14 días de prueba, tarjeta obligatoria). 11-11-2026: son el plan B
 *  del alta cuando no se puede crear un checkout con la clave de Stripe. */
export const ENLACES_PAGO_FUNNYLEADS: Record<string, { tier: Plan; interval: "month" | "year" }> = {
  plink_1UaCM62ObXNkJIexIHPrhQKl: { tier: "starter", interval: "month" },
  plink_1UaCMC2ObXNkJIexdfaNHg6Q: { tier: "starter", interval: "year" },
  plink_1UaCMF2ObXNkJIexyE0w92Jw: { tier: "growth", interval: "month" },
  plink_1UaCMJ2ObXNkJIexE46HfZkS: { tier: "growth", interval: "year" },
  plink_1UaCMM2ObXNkJIexsjSz4Re3: { tier: "scale", interval: "month" },
  plink_1UaCMP2ObXNkJIexBbShBoqs: { tier: "scale", interval: "year" },
};
export const DIAS_PRUEBA_ENLACE = 14;

/** Derecho de plan a partir SÓLO del aviso checkout.session.completed de un enlace de pago (sin
 *  preguntar a Stripe, por si la clave falla). null si la sesión no es de un enlace nuestro. Lo
 *  completa después customer.subscription.created/updated, que trae la suscripción entera. */
export function filaDesdeSesionDeEnlace(ses: {
  mode?: string | null; payment_link?: string | null; metadata?: Record<string, string> | null;
  customer?: string | null; subscription?: string | null; created?: number | null; amount_total?: number | null;
}, ahoraSeg = Math.floor(Date.now() / 1000)): Record<string, unknown> | null {
  if (ses.mode !== "subscription" || !ses.customer) return null;
  const md = ses.metadata || {};
  // Plan a medida: se paga desde el primer día (sin prueba); el periodo es el mes o el año pagado.
  const medida = (ses.payment_link ? customByPaymentLink(ses.payment_link) : null)
    ?? (customByMetadata(md) ? { level: customByMetadata(md)!, interval: (md.billing === "yearly" ? "year" : "month") as "month" | "year" } : null);
  if (medida) {
    const inicio = ses.created || ahoraSeg;
    const fin = new Date(inicio * 1000);
    if (medida.interval === "year") fin.setUTCFullYear(fin.getUTCFullYear() + 1); else fin.setUTCMonth(fin.getUTCMonth() + 1);
    return {
      ...customEntitlementFields(medida.level),
      status: "active",
      stripe_customer_id: String(ses.customer),
      stripe_subscription_id: ses.subscription ? String(ses.subscription) : null,
      trial_end: null,
      current_period_end: fin.toISOString(),
      cancel_at_period_end: false,
      billing_interval: medida.interval,
      last_payment_error: null,
      last_event_at: new Date(ahoraSeg * 1000).toISOString(),
    };
  }
  const porEnlace = ses.payment_link ? ENLACES_PAGO_FUNNYLEADS[ses.payment_link] : undefined;
  const tierMd = tierDeMetadata(md);
  const tier = porEnlace?.tier || (tierMd && esPlan(tierMd) ? (tierMd.toLowerCase() as Plan) : null);
  if (!tier || (!porEnlace && md.app !== "warmlead")) return null;
  const interval = porEnlace?.interval || (md.billing === "yearly" ? "year" : "month");
  const inicio = ses.created || ahoraSeg;
  // Los enlaces dan 14 días gratis; si la sesión cobró algo, ya no es prueba.
  const prueba = !ses.amount_total;
  const fin = new Date((inicio + DIAS_PRUEBA_ENLACE * 86_400) * 1000).toISOString();
  return {
    tier,
    status: prueba ? "trialing" : "active",
    stripe_customer_id: String(ses.customer),
    stripe_subscription_id: ses.subscription ? String(ses.subscription) : null,
    trial_end: prueba ? fin : null,
    current_period_end: prueba ? fin : null,
    cancel_at_period_end: false,
    billing_interval: interval,
    last_payment_error: null,
    last_event_at: new Date(ahoraSeg * 1000).toISOString(),
    ...CUSTOM_FIELDS_CLEARED,
  };
}
