// Alta con prueba gratuita de 14 días (11-11-2026). Parte pura del flujo de /empezar: qué plan y
// periodo vienen preseleccionados, cuánto se cobrará al acabar la prueba, en qué paso se está y
// las validaciones del formulario. La interfaz está en src/components/signup/SignupFlow.tsx.
import { PLAN_CONFIG } from "@/contexts/SubscriptionContext";

export type SignupPlan = "starter" | "growth" | "scale";
export type SignupPeriod = "month" | "year";
export type SignupStep = "plan" | "cuenta" | "tarjeta" | "listo";

export const SIGNUP_TRIAL_DAYS = 14;
export const SIGNUP_PLANS: SignupPlan[] = ["starter", "growth", "scale"];
/** Lo que se recuerda entre la ida a Stripe (o la confirmación del correo) y la vuelta. */
export const SIGNUP_STORAGE_KEY = "fl_signup_choice_v1";

const PLAN_ALIAS: Record<string, SignupPlan> = { starter: "starter", basico: "starter", "básico": "starter", basic: "starter", growth: "growth", scale: "scale" };
const PERIOD_ALIAS: Record<string, SignupPeriod> = { month: "month", mes: "month", mensual: "month", monthly: "month", year: "year", "año": "year", ano: "year", anual: "year", yearly: "year", annual: "year" };

export interface SignupChoice { plan: SignupPlan; period: SignupPeriod }

/** Plan y periodo de la URL (?plan=growth&periodo=year); lo que no se entiende → Starter mensual. */
export function choiceFromParams(params: URLSearchParams, saved?: SignupChoice | null): SignupChoice {
  const plan = PLAN_ALIAS[(params.get("plan") || "").trim().toLowerCase()];
  const period = PERIOD_ALIAS[(params.get("periodo") || params.get("period") || "").trim().toLowerCase()];
  return { plan: plan ?? saved?.plan ?? "starter", period: period ?? saved?.period ?? "month" };
}

export function parseSavedChoice(raw: string | null | undefined): SignupChoice | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (SIGNUP_PLANS.includes(j?.plan) && (j?.period === "month" || j?.period === "year")) return { plan: j.plan, period: j.period };
  } catch { /* nada */ }
  return null;
}

/** Paso pedido en la URL (?paso=…). El paso "listo" sólo pinta la espera: el acceso lo da el servidor. */
export function stepFromParams(params: URLSearchParams): SignupStep | null {
  const p = (params.get("paso") || "").trim().toLowerCase();
  return p === "plan" || p === "cuenta" || p === "tarjeta" || p === "listo" ? p : null;
}

/** Price id de Stripe del plan y periodo (los mismos que acepta create-checkout). */
export function priceIdFor(c: SignupChoice): string {
  const cfg = PLAN_CONFIG[c.plan];
  return c.period === "year" ? cfg.annual.priceId : cfg.monthly.priceId;
}

/** Enlaces de pago de Stripe de Funnyleads (14 días gratis, tarjeta obligatoria). 11-11-2026: si no
 *  se puede abrir el checkout de la app (clave de Stripe mal o Stripe caído), el alta usa el enlace
 *  del plan con el usuario en client_reference_id y el webhook le da la prueba a ESA cuenta. */
export const SIGNUP_PAYMENT_LINKS: Record<SignupPlan, Record<SignupPeriod, string>> = {
  starter: { month: "https://buy.stripe.com/aFa28kcYmbhy0e55o42ZO0g", year: "https://buy.stripe.com/5kQbIUcYm4Ta0e5bMs2ZO0h" },
  growth: { month: "https://buy.stripe.com/dRm14ggaydpG7Gx6s82ZO0i", year: "https://buy.stripe.com/00w7sE7E299q6Ct17O2ZO0j" },
  scale: { month: "https://buy.stripe.com/8x200c0bA2L2e4V17O2ZO0k", year: "https://buy.stripe.com/5kQcMYe2q85m2mddUA2ZO0l" },
};

/** Enlace de pago del plan para ESTE usuario: su id (para asignarle la suscripción aunque cambie el
 *  correo en Stripe), su correo ya puesto y Stripe en español. */
export function paymentLinkFor(c: SignupChoice, u: { id: string; email?: string | null }): string {
  const q = new URLSearchParams({ client_reference_id: u.id, locale: "es" });
  if (u.email) q.set("prefilled_email", u.email);
  return `${SIGNUP_PAYMENT_LINKS[c.plan][c.period]}?${q.toString()}`;
}

/** Estados de user_entitlements que ya dan acceso (la prueba ha empezado). */
export function entitlementGivesAccess(status: string | null | undefined): boolean {
  return status === "trialing" || status === "active";
}

/** Precio por mes que se enseña (el anual, prorrateado) y lo que se cobra de una vez. */
export function priceInfo(c: SignupChoice): { perMonth: number; charge: number; chargeLabel: string } {
  const cfg = PLAN_CONFIG[c.plan];
  if (c.period === "year") return { perMonth: cfg.annual.perMonth, charge: cfg.annual.price, chargeLabel: `${fmtEur(cfg.annual.price)} al año` };
  return { perMonth: cfg.monthly.price, charge: cfg.monthly.price, chargeLabel: `${fmtEur(cfg.monthly.price)} al mes` };
}

export function fmtEur(n: number): string {
  return `${n.toLocaleString("es-ES")} €`;
}

/** Día en que termina la prueba (y se haría el primer cobro), contado desde hoy. */
export function trialEndDate(nowMs = Date.now()): Date {
  return new Date(nowMs + SIGNUP_TRIAL_DAYS * 86_400_000);
}
export function fmtDay(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
}

/* ── Formulario de cuenta ───────────────────────────────────────────────────────────────────── */

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

/** Fuerza de la contraseña: 0 (no vale) a 3 (fuerte). Mínimo para crear la cuenta: 2. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string; ok: boolean } {
  const s = String(pw || "");
  if (s.length < 8) return { score: 0, label: "Mínimo 8 caracteres", ok: false };
  let score = 1;
  const letras = /[a-zA-ZÀ-ÿ]/.test(s), numeros = /\d/.test(s), otros = /[^a-zA-Z0-9À-ÿ]/.test(s), mayus = /[A-ZÀ-Ý]/.test(s) && /[a-zà-ÿ]/.test(s);
  if (letras && numeros) score = 2;
  if (score === 2 && (otros || mayus) && s.length >= 10) score = 3;
  const label = score === 1 ? "Añade letras y números" : score === 2 ? "Buena" : "Muy segura";
  return { score: score as 1 | 2 | 3, label, ok: score >= 2 };
}

export interface AccountForm { name: string; company: string; email: string; password: string; terms: boolean }

/** Errores por campo (vacío = todo bien). Sólo se enseñan los campos que el usuario ya ha tocado. */
export function accountErrors(f: AccountForm): Partial<Record<keyof AccountForm, string>> {
  const e: Partial<Record<keyof AccountForm, string>> = {};
  if (f.name.trim().length < 2) e.name = "Escribe tu nombre";
  if (!isValidEmail(f.email)) e.email = "Escribe un correo válido";
  if (!passwordStrength(f.password).ok) e.password = passwordStrength(f.password).label;
  if (!f.terms) e.terms = "Necesitamos que aceptes las condiciones";
  return e;
}

/** Mensaje claro para los errores de Supabase al registrarse. */
export function signupErrorMessage(raw: string | null | undefined): { text: string; alreadyRegistered: boolean } {
  const m = String(raw || "");
  if (/already registered|already_registered|already exists|user_already_exists/i.test(m)) {
    return { text: "Ya hay una cuenta con este correo. Inicia sesión y activa tu prueba desde ahí.", alreadyRegistered: true };
  }
  if (/password/i.test(m)) return { text: "La contraseña no es válida: usa al menos 8 caracteres con letras y números.", alreadyRegistered: false };
  if (/rate|too many/i.test(m)) return { text: "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.", alreadyRegistered: false };
  if (/mail_unavailable/i.test(m)) return { text: "No hemos podido enviarte el correo de verificación. Inténtalo de nuevo en unos minutos.", alreadyRegistered: false };
  if (/non-2xx|edge function|failed to fetch|network/i.test(m)) return { text: "No se pudo crear la cuenta. Revisa tu conexión e inténtalo de nuevo.", alreadyRegistered: false };
  return { text: m || "No se pudo crear la cuenta. Inténtalo de nuevo.", alreadyRegistered: false };
}
