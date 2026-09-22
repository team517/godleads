/**
 * "Nombre de empresa" de un dominio, para reconocer a la MISMA empresa con otra terminación:
 * acme.fr, acme.com, acme.co.uk y mail.acme.es → "acme".
 * Una respuesta de alguien que no está en los leads pero cuya empresa coincide así con la de un
 * lead de campaña se trata como respuesta de esa campaña (Unibox → Campaigns + aviso al móvil).
 *
 * ESPEJO EXACTO de la función SQL public.domain_brand (migración 20260922210000): si cambias una,
 * cambia la otra (los tests comparan los dos con los mismos casos).
 */
export const BRAND_SUFFIX_RE = /\.((com|co|org|net|gob|gov|edu|ac|or|ne|nom|gv|gouv)\.)?[a-z]{2,}$/;
// Nombres que NO identifican a una empresa: correo gratuito y palabras genéricas.
export const GENERIC_BRANDS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|protonmail|proton|aol|gmx|mail|email|correo|zoho|yandex|fastmail|tutanota|orange|wanadoo|free|libero|virgilio|telefonica|movistar|terra|info|web|online|group|grupo|groupe|gruppo|shop|tienda|home|test|example|company|empresa|consulting|global|digital|services|servicios|solutions|soluciones|international)$/;
export const MIN_BRAND_LEN = 4;

export function domainBrand(domain: string | null | undefined): string | null {
  const v = String(domain || "").trim().toLowerCase();
  if (!v) return null;
  const rest = v.replace(BRAND_SUFFIX_RE, "");
  const brand = rest.replace(/^.*\./, "");
  if (!brand || brand.length < MIN_BRAND_LEN || GENERIC_BRANDS.test(brand)) return null;
  return brand;
}
