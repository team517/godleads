// Plan a medida de Funnyleads (11-11-2026). Una barra de 10 niveles: al subirla crecen los envíos al
// mes, los contactos y, poco a poco, los clientes (workspaces). Todo lo de Scale incluido. Se paga
// desde el primer día (sin prueba). Pura y sin dependencias: la usan la app (src/lib/custom-plan.ts)
// y las funciones de Stripe (create-checkout, check-subscription, stripe-webhook).
//
// Objetos de Stripe creados el 11-11-2026 en la cuenta live (producto "Funnyleads a medida"):
// 10 niveles × mensual/anual = 20 precios y 20 enlaces de pago (redirigen a /empezar?paso=listo).
// Anual = round(mes × 0,83) × 12 (la misma regla que Starter/Growth/Scale: -17 %).

export const CUSTOM_PRODUCT_ID = "prod_VbtahTB7Qo9EqB";
export const CUSTOM_MIN_LEVEL = 1;
export const CUSTOM_MAX_LEVEL = 10;

export interface CustomLevel {
  level: number;
  emails: number;      // envíos al mes
  contacts: number;    // contactos guardados
  clients: number;     // clientes (workspaces) incluidos
  eurMonth: number;    // € al mes (mensual)
  eurYear: number;     // € al año (anual)
  priceMonth: string;
  priceYear: string;
  plinkMonth: string;
  plinkYear: string;
  linkMonth: string;
  linkYear: string;
}

export const CUSTOM_LEVELS: readonly CustomLevel[] = [
  { level: 1, emails: 250_000, contacts: 85_000, clients: 6, eurMonth: 99, eurYear: 984,
    priceMonth: "price_1Uafnl2ObXNkJIexMwu7C1xf", priceYear: "price_1Uafnm2ObXNkJIexJu2KtYHT",
    plinkMonth: "plink_1Uafox2ObXNkJIexVGVcJa9o", plinkYear: "plink_1UafpY2ObXNkJIexvCqbckha",
    linkMonth: "https://buy.stripe.com/eVq5kw6zY71iaSJ03K2ZO0n", linkYear: "https://buy.stripe.com/6oUfZa0bAgBS5yp8Ag2ZO0o" },
  { level: 2, emails: 400_000, contacts: 135_000, clients: 8, eurMonth: 149, eurYear: 1488,
    priceMonth: "price_1Uafno2ObXNkJIexQItxKNzl", priceYear: "price_1Uafnp2ObXNkJIexx2c91wkz",
    plinkMonth: "plink_1UafpZ2ObXNkJIexVdJoXW7s", plinkYear: "plink_1Uafpb2ObXNkJIexUwSBJaMb",
    linkMonth: "https://buy.stripe.com/bJe14gaQedpG1i903K2ZO0p", linkYear: "https://buy.stripe.com/7sYeV6cYmfxO1i93fW2ZO0q" },
  { level: 3, emails: 600_000, contacts: 200_000, clients: 10, eurMonth: 209, eurYear: 2076,
    priceMonth: "price_1Uafnq2ObXNkJIex2WRv1VZo", priceYear: "price_1Uafns2ObXNkJIexLh1oHQPO",
    plinkMonth: "plink_1Uafpc2ObXNkJIexJIcBihNo", plinkYear: "plink_1Uafpe2ObXNkJIexQQr2nHtb",
    linkMonth: "https://buy.stripe.com/cNi4gsbUi85m5ypeYE2ZO0r", linkYear: "https://buy.stripe.com/4gMaEQ0bAclCd0R5o42ZO0s" },
  { level: 4, emails: 800_000, contacts: 270_000, clients: 12, eurMonth: 269, eurYear: 2676,
    priceMonth: "price_1Uafnt2ObXNkJIexne0iyOmJ", priceYear: "price_1Uafnw2ObXNkJIexNYp1mSVj",
    plinkMonth: "plink_1Uafpf2ObXNkJIexHi3kKteH", plinkYear: "plink_1Uafph2ObXNkJIexkTkxVWkQ",
    linkMonth: "https://buy.stripe.com/bJe14g4rQdpGbWNcQw2ZO0t", linkYear: "https://buy.stripe.com/8x24gs5vU4Ta1i93fW2ZO0u" },
  { level: 5, emails: 1_000_000, contacts: 340_000, clients: 14, eurMonth: 319, eurYear: 3180,
    priceMonth: "price_1Uafny2ObXNkJIext0ou0oZK", priceYear: "price_1Uafnz2ObXNkJIexIBSMra11",
    plinkMonth: "plink_1Uafpi2ObXNkJIexvxpRQhoI", plinkYear: "plink_1Uafpk2ObXNkJIex91LxH0DC",
    linkMonth: "https://buy.stripe.com/4gMeV65vU3P69OF3fW2ZO0v", linkYear: "https://buy.stripe.com/3cI9AM1fE4TaaSJbMs2ZO0w" },
  { level: 6, emails: 1_500_000, contacts: 500_000, clients: 16, eurMonth: 449, eurYear: 4476,
    priceMonth: "price_1UafoQ2ObXNkJIex8pAdTnQY", priceYear: "price_1UafoR2ObXNkJIexJJNtg7nl",
    plinkMonth: "plink_1UafqO2ObXNkJIexnScvoGUr", plinkYear: "plink_1UafqP2ObXNkJIexX2l4MrXn",
    linkMonth: "https://buy.stripe.com/eVq28ke2qdpGgd3dUA2ZO0x", linkYear: "https://buy.stripe.com/14A3co3nMadu1i97wc2ZO0y" },
  { level: 7, emails: 2_000_000, contacts: 670_000, clients: 18, eurMonth: 569, eurYear: 5664,
    priceMonth: "price_1UafoT2ObXNkJIexeX0c1Nmg", priceYear: "price_1UafoU2ObXNkJIexVgrgoDRz",
    plinkMonth: "plink_1UafqQ2ObXNkJIexOxPlRfo4", plinkYear: "plink_1UafqS2ObXNkJIexarVNNhrl",
    linkMonth: "https://buy.stripe.com/6oUeV6gaydpGd0RdUA2ZO0z", linkYear: "https://buy.stripe.com/aFa7sE8I61GY4uldUA2ZO0A" },
  { level: 8, emails: 3_000_000, contacts: 1_000_000, clients: 20, eurMonth: 799, eurYear: 7956,
    priceMonth: "price_1UafoV2ObXNkJIexygRmrDgK", priceYear: "price_1UafoX2ObXNkJIexvsbH3LnQ",
    plinkMonth: "plink_1UafqT2ObXNkJIexqFgzIx3p", plinkYear: "plink_1UafqV2ObXNkJIexku9XOufa",
    linkMonth: "https://buy.stripe.com/dRm3co4rQfxO4ul8Ag2ZO0B", linkYear: "https://buy.stripe.com/dRmeV64rQ85m4ul7wc2ZO0C" },
  { level: 9, emails: 4_000_000, contacts: 1_350_000, clients: 22, eurMonth: 1019, eurYear: 10152,
    priceMonth: "price_1UafoY2ObXNkJIexxaQ1cUNU", priceYear: "price_1UafoZ2ObXNkJIexT9OvcaxR",
    plinkMonth: "plink_1UafqX2ObXNkJIexHinmvXO3", plinkYear: "plink_1UafqY2ObXNkJIexwwGOfIkj",
    linkMonth: "https://buy.stripe.com/aFa6oA9Ma5Xe5ypcQw2ZO0D", linkYear: "https://buy.stripe.com/28EbIUgaybhy7Gxg2I2ZO0E" },
  { level: 10, emails: 5_000_000, contacts: 1_700_000, clients: 25, eurMonth: 1229, eurYear: 12240,
    priceMonth: "price_1Uafob2ObXNkJIexK1GlqTUO", priceYear: "price_1Uafoc2ObXNkJIextbOwIEOL",
    plinkMonth: "plink_1Uafqa2ObXNkJIexbgb0bo0F", plinkYear: "plink_1Uafqb2ObXNkJIexZhw7EXey",
    linkMonth: "https://buy.stripe.com/9B63co5vUclC5yp03K2ZO0F", linkYear: "https://buy.stripe.com/28EeV62jIadu9OFaIo2ZO0G" },
];

export type CustomInterval = "month" | "year";

/** Nivel válido (1–10) o null. Acepta número o texto ("5", "custom-5"). */
export function parseCustomLevel(v: unknown): number | null {
  const m = String(v ?? "").match(/(\d{1,2})\s*$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= CUSTOM_MIN_LEVEL && n <= CUSTOM_MAX_LEVEL ? n : null;
}

export function customLevel(level: number): CustomLevel {
  const n = Math.min(CUSTOM_MAX_LEVEL, Math.max(CUSTOM_MIN_LEVEL, Math.round(level || 1)));
  return CUSTOM_LEVELS[n - 1];
}

export function customPriceId(level: number, interval: CustomInterval): string {
  const l = customLevel(level);
  return interval === "year" ? l.priceYear : l.priceMonth;
}

export function customPaymentLink(level: number, interval: CustomInterval): string {
  const l = customLevel(level);
  return interval === "year" ? l.linkYear : l.linkMonth;
}

/** Por price id de Stripe: nivel e intervalo, o null si no es un precio a medida. */
export function customByPriceId(priceId: string | null | undefined): { level: CustomLevel; interval: CustomInterval } | null {
  if (!priceId) return null;
  for (const l of CUSTOM_LEVELS) {
    if (l.priceMonth === priceId) return { level: l, interval: "month" };
    if (l.priceYear === priceId) return { level: l, interval: "year" };
  }
  return null;
}

/** Por enlace de pago (plink_…). */
export function customByPaymentLink(plink: string | null | undefined): { level: CustomLevel; interval: CustomInterval } | null {
  if (!plink) return null;
  for (const l of CUSTOM_LEVELS) {
    if (l.plinkMonth === plink) return { level: l, interval: "month" };
    if (l.plinkYear === plink) return { level: l, interval: "year" };
  }
  return null;
}

/** Por la metadata que llevan precios, enlaces, sesiones y suscripciones ({plan: custom, level}). */
export function customByMetadata(md: Record<string, string> | null | undefined): CustomLevel | null {
  if (!md || String(md.plan || md.tier || "").toLowerCase() !== "custom") return null;
  const n = parseCustomLevel(md.level);
  return n ? customLevel(n) : null;
}

/** Lo que se guarda en user_entitlements para un plan a medida. El tier es "scale": así todas las
 *  funciones de Scale (IA, A/B, analítica, clientes…) se abren igual; los topes los dan las columnas. */
export function customEntitlementFields(l: CustomLevel): Record<string, number | string> {
  return { tier: "scale", custom_level: l.level, plan_emails_month: l.emails, plan_contacts: l.contacts, plan_clients: l.clients };
}

/** Campos a limpiar cuando la suscripción ya no es a medida (pasa a Starter/Growth/Scale). */
export const CUSTOM_FIELDS_CLEARED = { custom_level: null, plan_emails_month: null, plan_contacts: null, plan_clients: null } as const;

/** € al mes que se enseñan: el anual, prorrateado. */
export function customPerMonth(l: CustomLevel, interval: CustomInterval): number {
  return interval === "year" ? Math.round(l.eurYear / 12) : l.eurMonth;
}

/** Ahorro del anual frente a 12 meses sueltos. */
export function customYearSavings(l: CustomLevel): number {
  return l.eurMonth * 12 - l.eurYear;
}

/** "250K", "1M", "1,5M". */
export function fmtVolume(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toLocaleString("es-ES", { maximumFractionDigits: 2 })}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
