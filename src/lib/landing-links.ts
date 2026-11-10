// A dónde llevan, en la aplicación real, los botones de la landing exportada de Claude Design.
// En el diseño son anclas de maqueta; el archivo no se modifica, así que la traducción vive aquí.

export type LandingTarget = { kind: "route"; to: string } | { kind: "external"; to: string };

const CONTACT = "mailto:team@onepulso.online";
/** Reservar una demo: la agenda del equipo. */
export const DEMO_URL = "https://cal.com/xavier-falco-hszeeb/15min";

const mail = (asunto: string): LandingTarget => ({ kind: "external", to: `${CONTACT}?subject=${encodeURIComponent(asunto)}` });

/* Diseño de Funnyleads (10-11-2026). Sus botones son anclas de maqueta; esta tabla dice a dónde van
   de verdad. Las anclas de sección (#pricing, #faq, #scale…) no están: desplazan la propia página.
   Los "Choose" de precios ya salen del diseño con su enlace de pago de Stripe (mensual o anual según
   el interruptor) y se abren fuera del marco: ver landingTarget(). */
const TARGETS: Record<string, LandingTarget> = {
  "#login": { kind: "route", to: "/auth" },
  // Alta con prueba gratuita de 14 días (11-11-2026): plan, cuenta y tarjeta.
  "#signup": { kind: "route", to: "/empezar" },
  // "Book a demo" / "See it in action" / "Talk to sales": reservar una llamada.
  "#demo": { kind: "external", to: DEMO_URL },
  "#contact": { kind: "external", to: CONTACT },
  "#partners": mail("Partners · Funnyleads"),
  "#about": mail("About Funnyleads"),
  "#careers": mail("Careers · Funnyleads"),
  "#docs": mail("Docs · Funnyleads"),
  "#api": mail("API · Funnyleads"),
  "#status": mail("Status · Funnyleads"),
  "#privacy": mail("Privacy policy · Funnyleads"),
  "#terms": mail("Terms · Funnyleads"),
};

/** Botones de alta del diseño ("Start free trial", "Start free", "Start now →"): en el diseño son
 *  "#pricing", igual que el enlace de menú "Pricing", así que se distinguen por su TEXTO. */
const CTA_ALTA = /^\s*start\s+(free(\s+trial)?|now)\b/i;
export function esBotonDeAlta(href: string | null | undefined, texto: string | null | undefined): boolean {
  return (href || "").trim().toLowerCase() === "#pricing" && CTA_ALTA.test(texto || "");
}

/** Enlaces de pago de Stripe del diseño ("Choose" de cada plan): con la prueba con tarjeta, primero
 *  se crea la cuenta y luego se pide la tarjeta, así que llevan al alta con ese plan elegido. */
export const ENLACES_PLAN_DISENO: Record<string, { plan: PlanLanding; periodo: Periodo }> = {
  "https://buy.stripe.com/aFa28kcYmbhy0e55o42ZO0g": { plan: "starter", periodo: "month" },
  "https://buy.stripe.com/5kQbIUcYm4Ta0e5bMs2ZO0h": { plan: "starter", periodo: "year" },
  "https://buy.stripe.com/dRm14ggaydpG7Gx6s82ZO0i": { plan: "growth", periodo: "month" },
  "https://buy.stripe.com/00w7sE7E299q6Ct17O2ZO0j": { plan: "growth", periodo: "year" },
  "https://buy.stripe.com/8x200c0bA2L2e4V17O2ZO0k": { plan: "scale", periodo: "month" },
  "https://buy.stripe.com/5kQcMYe2q85m2mddUA2ZO0l": { plan: "scale", periodo: "year" },
};

/** Destino real de un enlace de la landing, o null si debe comportarse como en el diseño
 *  (anclas de sección como #pricing o #faq, que desplazan la propia página). `texto` = el texto del
 *  enlace, para distinguir "Start free trial" (alta) del menú "Pricing" (desplazar). */
export function landingTarget(href: string | null | undefined, texto?: string | null): LandingTarget | null {
  if (!href) return null;
  const h = href.trim();
  if (esBotonDeAlta(h, texto)) return { kind: "route", to: "/empezar" };
  const plan = ENLACES_PLAN_DISENO[h.replace(/[?#].*$/, "")];
  if (plan) return { kind: "route", to: `/empezar?plan=${plan.plan}&periodo=${plan.periodo}` };
  // Enlaces absolutos (pago de Stripe, agenda) y correos: fuera del marco, en la ventana de arriba.
  // Stripe no se deja incrustar, y además la URL del navegador debe cambiar de verdad.
  if (/^(https?:)?\/\//i.test(h) || /^mailto:/i.test(h)) return { kind: "external", to: h };
  return TARGETS[h.toLowerCase()] ?? null;
}

/** ¿Ha terminado de desempaquetarse y ha pintado su contenido? */
export function landingIsPainted(doc: Document | null | undefined): boolean {
  if (!doc || !doc.body) return false;
  const h1 = doc.querySelector("h1");
  const titular = !!h1 && (h1.textContent || "").trim().length > 0;
  // Página .dc.html de Claude Design: su runtime monta #dc-root (y conserva una miniatura oculta
  // con id __bundler_thumbnail, que aquí no cuenta). Hasta que #dc-root existe, lo que hay es la plantilla.
  if (doc.getElementById("dc-root")) return titular;
  if (doc.querySelector("x-dc")) return false;
  // Página empaquetada antigua: mientras está su miniatura/carga, no está lista.
  if (doc.getElementById("__bundler_thumbnail") || doc.getElementById("__bundler_loading")) return false;
  return titular;
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
  return { kind: "route", to: `/empezar?plan=${tier}&periodo=${periodo}` };
}
