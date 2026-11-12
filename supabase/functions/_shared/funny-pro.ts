// Funny Pro (12-11-2026): formación 1:1 de 350 € (pago único) con el equipo. El enlace de pago es el
// de la cuenta de Stripe conectada (el mismo del botón "Book your training" de la landing).
export const FUNNY_PRO_LINK_ID = "plink_1UaCgv2ObXNkJIexcP7spbRi";
export const FUNNY_PRO_PAY_URL = "https://buy.stripe.com/14AeV64rQgBSbWN03K2ZO0m";

export interface SesionPago {
  mode?: string | null;
  payment_status?: string | null;
  payment_link?: string | null;
  metadata?: Record<string, string> | null;
}

/** ¿Este checkout completado es un pago de Funny Pro ya cobrado? Puro (con pruebas). */
export function esPagoFunnyPro(s: SesionPago | null | undefined): boolean {
  if (!s || s.mode !== "payment" || s.payment_status !== "paid") return false;
  return s.payment_link === FUNNY_PRO_LINK_ID || s.metadata?.plan === "formacion";
}
