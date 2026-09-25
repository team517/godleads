// A dónde llevan, en la aplicación real, los botones de la landing exportada de Claude Design.
// En el diseño son anclas de maqueta; el archivo no se modifica, así que la traducción vive aquí.

export type LandingTarget = { kind: "route"; to: string } | { kind: "external"; to: string };

const CONTACT = "mailto:team@onepulso.online";

const TARGETS: Record<string, LandingTarget> = {
  "#login": { kind: "route", to: "/auth" },
  "#signup": { kind: "route", to: "/auth?mode=signup" },
  // "Book a demo" / "See it in action" / "Contact": hablar con el equipo.
  "#demo": { kind: "external", to: `${CONTACT}?subject=${encodeURIComponent("Demo de OnePulso")}` },
  "#contact": { kind: "external", to: CONTACT },
  "#partners": { kind: "external", to: `${CONTACT}?subject=${encodeURIComponent("Partners")}` },
};

/** Destino real de un enlace de la landing, o null si debe comportarse como en el diseño
 *  (anclas de sección como #pricing o #faq, que desplazan la propia página). */
export function landingTarget(href: string | null | undefined): LandingTarget | null {
  if (!href) return null;
  return TARGETS[href.trim().toLowerCase()] ?? null;
}

/** ¿Ha terminado de desempaquetarse y ha pintado su contenido? */
export function landingIsPainted(doc: Document | null | undefined): boolean {
  if (!doc || !doc.body) return false;
  if (doc.getElementById("__bundler_thumbnail") || doc.getElementById("__bundler_loading")) return false;
  const h1 = doc.querySelector("h1");
  return !!h1 && (h1.textContent || "").trim().length > 0;
}

/* ── "Choose" de los precios → pago en Stripe ────────────────────────────────────────────────
   Los tres botones "Choose" del diseño son todos "#signup". Se sabe qué plan es por la TARJETA
   en la que está el botón: su precio dice el plan y si está en mensual o en anual (el
   interruptor Monthly/Yearly del diseño sólo cambia las cifras). */

export type PlanLanding = "starter" | "growth" | "scale";
export type Periodo = "month" | "year";

/** Precios que enseña la landing (por mes; en anual se cobra el año entero). */
export const PRECIOS_LANDING: Record<PlanLanding, Record<Periodo, number>> = {
  starter: { month: 17, year: 14 },
  growth: { month: 65, year: 54 },
  scale: { month: 170, year: 141 },
};

/** Enlaces de pago de Stripe (base + IVA 21 % − IRPF 7 %). Vacío = aún no creado: el botón lleva
 *  al registro con el plan elegido, como hasta ahora. */
export const ENLACES_PAGO: Record<`${PlanLanding}_${Periodo}`, string> = {
  starter_month: "",
  starter_year: "",
  growth_month: "",
  growth_year: "",
  scale_month: "",
  scale_year: "",
};

/** Los planes cuyos precios aparecen en un texto. */
export function planesEnTexto(texto: string): { tier: PlanLanding; periodo: Periodo }[] {
  const cifras = new Set([...String(texto || "").matchAll(/\$\s?(\d{1,4})(?![\d.,]\d)/g)].map((m) => Number(m[1])));
  const out: { tier: PlanLanding; periodo: Periodo }[] = [];
  for (const [tier, p] of Object.entries(PRECIOS_LANDING) as [PlanLanding, Record<Periodo, number>][]) {
    for (const periodo of ["month", "year"] as Periodo[]) if (cifras.has(p[periodo])) out.push({ tier, periodo });
  }
  return out;
}

/** Texto de la tarjeta de precio que contiene al botón: se sube por sus contenedores mientras
 *  sólo haya precios de UN plan; al llegar a la sección con los tres, se para. */
export function textoDeTarjeta(el: Element | null): string {
  let actual = "";
  for (let n: Element | null = el; n; n = n.parentElement) {
    const t = n.textContent || "";
    const tiers = new Set(planesEnTexto(t).map((x) => x.tier));
    if (tiers.size > 1) break;
    actual = t;
    if (n.tagName === "BODY") break;
  }
  return actual;
}

/** A dónde lleva "Choose" en una tarjeta: al pago de Stripe si el enlace existe; si no, al
 *  registro con el plan anotado. null = no es una tarjeta de precio reconocible. */
export function destinoChoose(textoTarjeta: string): LandingTarget | null {
  const planes = planesEnTexto(textoTarjeta);
  if (!planes.length || new Set(planes.map((p) => p.tier)).size !== 1) return null;
  const tier = planes[0].tier;
  // Si se ven las dos cifras (p. ej. la mensual tachada junto a la anual), manda la que dice el texto.
  const periodo: Periodo = planes.length === 1 ? planes[0].periodo : (/year|annual|anual/i.test(textoTarjeta) ? "year" : "month");
  const enlace = ENLACES_PAGO[`${tier}_${periodo}`];
  if (enlace) return { kind: "external", to: enlace };
  return { kind: "route", to: `/auth?mode=signup&plan=${tier}&periodo=${periodo}` };
}
