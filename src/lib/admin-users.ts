// Panel de admin: quién es cada usuario y en qué situación de pago está. Parte pura (se prueba).
//
// Antes el panel ocultaba a los clientes creados por la agencia y a una lista de correos fija, y
// el plan se preguntaba a Stripe usuario por usuario (sin clave en el servidor, salía siempre
// "sin suscripción"). Ahora se listan TODOS y el plan sale de user_entitlements, que es lo que
// escribe el webhook de Stripe.
import { ADMIN_EMAILS, SPECIAL_FULL_ACCESS_EMAILS, decideAccess, type AccessDecision } from "@/lib/access";

export type TipoUsuario = "equipo" | "cliente" | "invitado" | "registro";

export const TIPO_LABEL: Record<TipoUsuario, string> = {
  equipo: "Equipo",
  cliente: "Cliente creado por ti",
  invitado: "Acceso gratis",
  registro: "Registro propio",
};

export interface AdminUserRaw {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  provider: string | null;
  full_name: string | null;
  company_name: string | null;
  contact_email: string | null;
  role: string;
  is_client_manager: boolean;
  allowed_routes: string[] | null;
  /** Sólo existe para las cuentas que creó la agencia (se guardó al crearlas). */
  client_password: string | null;
  leads_count: number;
  accounts_count: number;
  clients_count: number;
  plan: { tier: string; status: string; current_period_end: string | null; stripe_customer_id: string | null };
}

export function tipoDeUsuario(u: Pick<AdminUserRaw, "email" | "role" | "is_client_manager" | "allowed_routes">): TipoUsuario {
  const email = (u.email || "").toLowerCase();
  if (u.role === "admin" || u.is_client_manager || ADMIN_EMAILS.includes(email)) return "equipo";
  if (u.allowed_routes && u.allowed_routes.length > 0) return "cliente";
  if (SPECIAL_FULL_ACCESS_EMAILS.includes(email)) return "invitado";
  return "registro";
}

/** Paga de verdad: un plan de pago con la suscripción viva (past_due aún no ha perdido el acceso
 *  en Stripe, pero se marca aparte en la interfaz). */
export function estaPagando(plan: AdminUserRaw["plan"] | null | undefined): boolean {
  return !!plan && plan.tier !== "free" && ["active", "trialing", "past_due"].includes(plan.status);
}

export function accesoDe(u: AdminUserRaw, nowMs?: number): AccessDecision {
  return decideAccess({
    email: u.email,
    role: u.role,
    isClientManager: u.is_client_manager,
    allowedRoutes: u.allowed_routes,
    contactEmail: u.contact_email,
    createdAt: u.created_at,
    stripeSubscribed: estaPagando(u.plan),
    nowMs,
  });
}

export type EstadoPanel = "pago" | "gratis" | "prueba" | "caducada";

/** Lo que se pinta en la lista: pagando / gratis (equipo, clientes, cuentas antiguas) / en prueba /
 *  prueba acabada sin pagar (esa persona ya no puede entrar al panel). */
export function estadoPanel(u: AdminUserRaw, nowMs?: number): { estado: EstadoPanel; etiqueta: string } {
  if (estaPagando(u.plan)) {
    return { estado: "pago", etiqueta: u.plan.status === "past_due" ? "Pago pendiente" : "Pagando" };
  }
  const a = accesoDe(u, nowMs);
  switch (a.kind) {
    case "trialing": return { estado: "prueba", etiqueta: a.daysLeft === 1 ? "Prueba: queda 1 día" : `Prueba: quedan ${a.daysLeft} días` };
    case "expired": return { estado: "caducada", etiqueta: "Prueba acabada" };
    default: return { estado: "gratis", etiqueta: "Gratis" };
  }
}

export function coincideBusqueda(u: AdminUserRaw, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [u.email, u.full_name, u.company_name, u.contact_email].some((v) => (v || "").toLowerCase().includes(t));
}
