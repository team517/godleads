// Qué plan de OnePulso da una suscripción de Stripe. Parte pura (se prueba con vitest).
//
// La cuenta de Stripe es compartida con otros negocios (tiene enlaces de pago que no son de
// OnePulso). Una suscripción que no lleva NINGÚN producto nuestro se ignora: antes se trataba
// como "free" y habría bajado de plan a quien pagase otra cosa con el mismo correo.

export const PLANES = ["starter", "growth", "scale"] as const;
export type Plan = typeof PLANES[number];

/** Productos antiguos (EUR, usados por el pago dentro de la app). Los nuevos de la landing llevan
 *  el plan en metadata.tier, así que no hace falta apuntarlos aquí. */
export const TIER_BY_PRODUCT: Record<string, Plan> = {
  prod_U29mvQRMbo5m6f: "starter", prod_U29mwf36xp5tzO: "starter",
  prod_U29mEi2w9ltRwG: "growth", prod_U29nlSXrrxJsWI: "growth",
  prod_U29nsLzCYygn4u: "scale", prod_U29n2lYSL63LWg: "scale",
};

const RANGO: Record<Plan, number> = { starter: 1, growth: 2, scale: 3 };
const esPlan = (v: unknown): v is Plan => typeof v === "string" && (PLANES as readonly string[]).includes(v.toLowerCase());

export interface LineaSuscripcion {
  productId: string;
  priceId: string;
  quantity: number;
  priceTier?: string | null;   // price.metadata.tier
}

export interface LecturaSuscripcion {
  /** false = ningún producto de OnePulso: no tocar los derechos de nadie. */
  esNuestra: boolean;
  tier: Plan | null;
  extraSlots: number;
}

export function leerSuscripcion(lineas: LineaSuscripcion[], subTier: string | null | undefined, slotPriceId = ""): LecturaSuscripcion {
  let tier: Plan | null = null;
  let extraSlots = 0;
  let slots = false;
  const subir = (t: Plan) => { if (!tier || RANGO[t] > RANGO[tier]) tier = t; };
  for (const l of lineas) {
    if (slotPriceId && l.priceId === slotPriceId) { extraSlots += l.quantity || 0; slots = true; continue; }
    const porProducto = TIER_BY_PRODUCT[l.productId];
    if (porProducto) { subir(porProducto); continue; }
    if (esPlan(l.priceTier)) subir(l.priceTier.toLowerCase() as Plan);
  }
  // Último recurso: la metadata que el enlace de pago de la landing pone en la suscripción.
  if (!tier && esPlan(subTier)) tier = subTier.toLowerCase() as Plan;
  return { esNuestra: !!tier || slots, tier, extraSlots };
}
