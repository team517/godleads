// Cambio de cuenta del equipo ("entrar como cliente", 10-11-2026). Parte pura: la usan la función
// `impersonate` (que es la que MANDA) y el navegador (sólo para decidir si pinta la entrada del menú).
//
// Petición del dueño: sólo desde hello@onepulso.blog y equipo@onepulso.online se puede entrar en la
// cuenta de un cliente sin contraseña y volver a la propia. Para nadie más existe. No es un permiso
// por rol: ni support@ ni un admin por user_roles pueden usarlo.

/** Las ÚNICAS cuentas que pueden entrar en otras. Lista fija: el servidor no la lee de la base. */
export const IMPERSONATION_ACTORS: readonly string[] = ["hello@onepulso.blog", "equipo@onepulso.online"];

/** Cuentas de la agencia: nunca son destino (no se entra en la cuenta de un compañero). */
export const AGENCY_EMAILS: readonly string[] = ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"];

const norm = (e: string | null | undefined) => String(e || "").trim().toLowerCase();

/** ¿Esta cuenta (por su correo de ACCESO) puede usar el cambio de cuenta? */
export function canImpersonate(email: string | null | undefined): boolean {
  return IMPERSONATION_ACTORS.includes(norm(email));
}

export interface TargetInfo {
  id: string;
  email: string | null;
  role?: string | null;              // user_roles.role
  isClientManager?: boolean | null;  // profiles.is_client_manager
}

/** ¿Es del equipo? (admin por rol, gestor de clientes o correo de la agencia) → nunca es destino. */
export function isStaffTarget(t: TargetInfo): boolean {
  return t.role === "admin" || !!t.isClientManager || AGENCY_EMAILS.includes(norm(t.email));
}

export type StartDecision = { ok: true } | { ok: false; status: number; error: string };

/** ¿Puede `actor` entrar en `target`? Todo lo que decide el servidor antes de abrir la sesión. */
export function decideStart(actor: { id: string; email: string | null }, target: TargetInfo | null): StartDecision {
  if (!canImpersonate(actor.email)) return { ok: false, status: 403, error: "Sólo hello@ y equipo@ pueden entrar en las cuentas de los clientes" };
  if (!target || !target.id) return { ok: false, status: 404, error: "Esa cuenta no existe" };
  if (target.id === actor.id) return { ok: false, status: 400, error: "Ya estás en tu cuenta" };
  if (!norm(target.email)) return { ok: false, status: 400, error: "Esa cuenta no tiene correo de acceso" };
  if (isStaffTarget(target)) return { ok: false, status: 403, error: "No se puede entrar en una cuenta del equipo" };
  return { ok: true };
}

export type TipoCuenta = "cliente" | "acceso_cliente" | "registro";

export interface ClienteListado {
  id: string;
  email: string;
  company_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  tipo: TipoCuenta;
  plan_tier: string | null;
  plan_status: string | null;
  active_campaigns: number;
  last_sign_in_at: string | null;
  paused_by_admin_at: string | null;
}

/** Tipo de cuenta para la lista: creada por la agencia (allowed_routes), acceso de un cliente de un
 *  usuario (client_login_of) o registro propio. */
export function tipoDeCuenta(p: { allowed_routes?: string[] | null; client_login_of?: string | null }): TipoCuenta {
  if (p.allowed_routes && p.allowed_routes.length > 0) return "cliente";
  if (p.client_login_of) return "acceso_cliente";
  return "registro";
}

/** Nombre con el que se enseña una cuenta: la empresa, si no el nombre, si no el correo. */
export function nombreCuenta(c: { company_name?: string | null; full_name?: string | null; email?: string | null }): string {
  return (c.company_name || "").trim() || (c.full_name || "").trim() || norm(c.email) || "Sin nombre";
}

/** Orden de la lista: por empresa (sin acentos ni mayúsculas), luego por correo. */
export function ordenarClientes<T extends { company_name?: string | null; full_name?: string | null; email: string }>(xs: T[]): T[] {
  const key = (c: T) => nombreCuenta(c).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return [...xs].sort((a, b) => key(a).localeCompare(key(b)) || a.email.localeCompare(b.email));
}

/** Búsqueda del diálogo: empresa, nombre o correo, sin acentos ni mayúsculas. Vacío = todo. */
export function coincideCliente(c: { company_name?: string | null; full_name?: string | null; email?: string | null }, q: string): boolean {
  const s = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = s(q.trim());
  if (!needle) return true;
  return [c.company_name, c.full_name, c.email].some((v) => s(String(v || "")).includes(needle));
}
