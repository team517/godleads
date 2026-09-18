// Primer acceso: qué se le pregunta a quien entra por primera vez y cuándo se le enseña.
//
// Aquí vive sólo la lógica (sin React) para poder probarla: la decisión de enseñar la
// bienvenida, las opciones de cada paso y la limpieza de la web que escribe el usuario.

export type WelcomeStatus = "loading" | "pending" | "done";

export const WELCOME_PATH = "/bienvenida";
/** Como mucho tres objetivos, igual que en el diseño. */
export const MAX_GOALS = 3;

export interface WelcomeGateInput {
  pathname: string;
  status: WelcomeStatus;
  /** Cuenta espejo de "sólo mirar" de un cliente: no se le pregunta nada. */
  clientLogin: boolean;
  /** Prueba caducada: primero el muro de pago, la bienvenida no se cuela delante. */
  trialExpired: boolean;
}

/** ¿Hay que llevar a este usuario a la bienvenida antes que a ninguna otra pantalla? */
export function shouldShowWelcome(i: WelcomeGateInput): boolean {
  if (i.status !== "pending") return false;       // aún cargando, o ya la hizo
  if (i.clientLogin || i.trialExpired) return false;
  return i.pathname !== WELCOME_PATH;
}

export const welcomeDoneKey = (userId: string) => `op:welcome-done:${userId}`;

export interface Choice { id: string; label: string }

/** Paso 1 — cómo nos ha encontrado. El orden es el del diseño. */
export const SOURCES: Choice[] = [
  { id: "ai", label: "ChatGPT / Cualquier IA" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "email", label: "Email" },
  { id: "blog", label: "Blog / Artículo" },
  { id: "facebook", label: "Facebook" },
  { id: "google", label: "Google" },
  { id: "youtube", label: "YouTube" },
  { id: "podcast", label: "Podcast" },
  { id: "reddit", label: "Reddit" },
  { id: "tiktok", label: "TikTok" },
  { id: "x", label: "X (Twitter)" },
  { id: "friend", label: "A través de un amigo" },
  { id: "other", label: "Otro" },
  { id: "private", label: "Prefiero no decirlo" },
];

/** Paso 4 — qué quiere conseguir. Cada uno es una sección real de la plataforma. */
export const GOALS: Choice[] = [
  { id: "cold_email", label: "Correo en frío" },
  { id: "leads", label: "Conseguir leads" },
  { id: "campaigns", label: "Gestionar campañas" },
  { id: "analytics", label: "Analizar resultados" },
  { id: "ai_agents", label: "Agentes de IA" },
  { id: "automation", label: "Automatizaciones" },
  { id: "unibox", label: "Bandeja unificada" },
];

/** Marca o desmarca un objetivo, sin pasar del máximo. Devuelve la lista nueva. */
export function toggleGoal(goals: string[], id: string, max = MAX_GOALS): string[] {
  if (goals.includes(id)) return goals.filter((g) => g !== id);
  if (goals.length >= max) return goals;
  return [...goals, id];
}

/**
 * La web que escribe el usuario, lista para guardar: "acme.es", "www.acme.es/precios" o
 * "HTTPS://Acme.ES" son la misma. Devuelve null si no parece una dirección.
 */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  // Un dominio de verdad: algo.algo, y la extensión con letras.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.startsWith(".") || host.includes("..")) return null;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${host}${path}${url.search}`;
}
