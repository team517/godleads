// Entrada exclusiva de los clientes de una agencia (12-11-2026).
//
// Cada agencia (el usuario de pago que crea clientes) tiene su dirección: /acceso/<slug>. Ahí
// sale SU logo y SU color; al entrar, el cliente ve el suyo propio (lo copia el servidor al
// perfil de su cuenta). Al cerrar sesión vuelve a esa misma entrada, no a la web de Funnyleads.
import { supabase } from "@/integrations/supabase/client";

export const CLIENT_SLUG_KEY = "fl_client_login_slug";
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Enlace que la agencia manda a sus clientes. */
export function agencyLoginUrl(origin: string, slug: string | null | undefined): string {
  const base = String(origin || "").replace(/\/+$/, "");
  return slug ? `${base}/acceso/${slug}` : `${base}/acceso-cliente`;
}

/** "Clínica Vera S.L." → "clinica-vera-sl" (lo mismo que hace el servidor). */
export function slugify(v: string): string {
  const s = String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return s;
}

export function rememberClientSlug(slug: string) {
  try { localStorage.setItem(CLIENT_SLUG_KEY, slug); } catch { /* sin almacenamiento */ }
}

/** A dónde vuelve una cuenta de cliente al cerrar sesión: la entrada de su agencia. */
export async function clientLogoutPath(): Promise<string> {
  try {
    const { data } = await (supabase as any).rpc("my_client_agency_slug");
    if (typeof data === "string" && SLUG_RE.test(data)) { rememberClientSlug(data); return `/acceso/${data}`; }
  } catch { /* sin red: lo recordado */ }
  try {
    const saved = localStorage.getItem(CLIENT_SLUG_KEY);
    if (saved && SLUG_RE.test(saved)) return `/acceso/${saved}`;
  } catch { /* sin almacenamiento */ }
  return "/acceso-cliente";
}
