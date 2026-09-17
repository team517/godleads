// Conectar UNA cuenta desde "Añadir cuenta": servidores de cada proveedor y la validación /
// limpieza de lo que escribe el cliente antes de guardarlo. Lógica pura (sin red) para poder
// probarla: lo que sale de aquí es exactamente lo que se inserta en email_accounts.

export type ConnectProvider = "gmail" | "outlook" | "custom";

export interface ConnectForm {
  email: string; first_name: string; last_name: string;
  imap_username: string; imap_password: string; imap_host: string; imap_port: string;
  smtp_username: string; smtp_password: string; smtp_host: string; smtp_port: string;
  daily_limit: string;
}

export const PROVIDER_SERVERS: Record<Exclude<ConnectProvider, "custom">, { imap_host: string; imap_port: number; smtp_host: string; smtp_port: number }> = {
  gmail: { imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587 },
  outlook: { imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587 },
};

export interface AccountPayload {
  email: string; first_name: string; last_name: string;
  imap_username: string; imap_password: string; imap_host: string; imap_port: number;
  smtp_username: string; smtp_password: string; smtp_host: string; smtp_port: number;
  daily_limit: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const clean = (v: string | null | undefined) => String(v ?? "").replace(/[﻿\r\n\t]/g, "").trim();
const port = (v: string, fallback: number) => {
  const n = parseInt(clean(v), 10);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : fallback;
};

/** Valida y normaliza el formulario según el proveedor elegido. Gmail y Outlook sólo piden
 *  email + contraseña de aplicación (los servidores los ponemos nosotros, aunque el estado del
 *  formulario traiga otra cosa); SMTP pide los dos servidores completos. */
export function buildAccountPayload(form: ConnectForm, provider: ConnectProvider): { ok: true; payload: AccountPayload } | { ok: false; error: string } {
  const email = clean(form.email).toLowerCase();
  if (!email) return { ok: false, error: "Escribe el email de la cuenta." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "El email no parece válido." };

  const limit = parseInt(clean(form.daily_limit), 10);
  const base = {
    email, first_name: clean(form.first_name), last_name: clean(form.last_name),
    daily_limit: Number.isFinite(limit) && limit > 0 ? limit : 30,
  };

  if (provider !== "custom") {
    // Google enseña la contraseña de aplicación en 4 bloques ("abcd efgh ijkl mnop"): los
    // espacios son sólo de presentación y pegados tal cual hacen fallar el AUTH.
    const password = clean(form.imap_password || form.smtp_password).replace(/\s+/g, "");
    if (!password) return { ok: false, error: "Escribe la contraseña de aplicación." };
    if (provider === "gmail" && password.length !== 16) {
      return { ok: false, error: "La contraseña de aplicación de Google tiene 16 letras. No es tu contraseña normal de Gmail." };
    }
    const s = PROVIDER_SERVERS[provider];
    return { ok: true, payload: { ...base, ...s, imap_username: email, imap_password: password, smtp_username: email, smtp_password: password } };
  }

  const imap_host = clean(form.imap_host).toLowerCase();
  const smtp_host = clean(form.smtp_host).toLowerCase();
  if (!smtp_host) return { ok: false, error: "Falta el servidor SMTP (host)." };
  if (!HOST_RE.test(smtp_host)) return { ok: false, error: "El servidor SMTP no parece válido (ej.: smtp.tudominio.com)." };
  if (!imap_host) return { ok: false, error: "Falta el servidor IMAP (host)." };
  if (!HOST_RE.test(imap_host)) return { ok: false, error: "El servidor IMAP no parece válido (ej.: imap.tudominio.com)." };
  // Lo habitual es un único usuario y contraseña para los dos servidores: lo que falte en uno
  // se toma del otro, y el usuario por defecto es el propio email.
  const smtp_password = clean(form.smtp_password) || clean(form.imap_password);
  const imap_password = clean(form.imap_password) || clean(form.smtp_password);
  if (!smtp_password) return { ok: false, error: "Escribe la contraseña del buzón." };
  const smtp_username = clean(form.smtp_username) || clean(form.imap_username) || email;
  const imap_username = clean(form.imap_username) || clean(form.smtp_username) || email;
  return {
    ok: true,
    payload: {
      ...base,
      imap_username, imap_password, imap_host, imap_port: port(form.imap_port, 993),
      smtp_username, smtp_password, smtp_host, smtp_port: port(form.smtp_port, 587),
    },
  };
}
