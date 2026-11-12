// Funny Pro (12-11-2026): formación 1:1 de 350 € con el equipo. Parte pura del navegador.
import { FUNNY_PRO_PAY_URL } from "../../supabase/functions/_shared/funny-pro";

export { FUNNY_PRO_PAY_URL };
export const FUNNY_PRO_PRICE = "350 €";

/** Enlace de pago con la cuenta del usuario dentro (el webhook asigna la compra a ESA cuenta). */
export function funnyProPayUrl(user: { id: string; email?: string | null } | null | undefined): string {
  const u = new URL(FUNNY_PRO_PAY_URL);
  if (user?.id) u.searchParams.set("client_reference_id", user.id);
  if (user?.email) u.searchParams.set("prefilled_email", user.email);
  u.searchParams.set("locale", "es");
  return u.toString();
}

/** La fila de my_funny_pro() → ¿pagado? (sin fila = no). */
export function funnyProPagado(data: unknown): { paid: boolean; paidAt: string | null } {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { paid: false, paidAt: null };
  const r = row as { paid?: boolean; paid_at?: string | null };
  return { paid: r.paid === true, paidAt: r.paid_at ?? null };
}
