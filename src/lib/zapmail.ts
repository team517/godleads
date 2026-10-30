/** Apartado Zapmail (30-10-2026): sólo estas cuentas. La función zapmail-domains aplica la misma lista. */
export const ZAPMAIL_EMAILS = ["hello@onepulso.blog", "support@onepulso.online"];

export function canUseZapmail(email: string | null | undefined): boolean {
  return ZAPMAIL_EMAILS.includes(String(email || "").trim().toLowerCase());
}
