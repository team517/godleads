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
