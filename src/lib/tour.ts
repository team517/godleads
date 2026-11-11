// Mini tutorial (11-11-2026): un recorrido animado por la plataforma, "como un mini vídeo", que se
// ofrece UNA vez a las cuentas nuevas con suscripción (plan activo o prueba con tarjeta).
//
// Aquí vive sólo la lógica (sin React) para poder probarla: a quién se ofrece, los capítulos y el
// reloj del reproductor. Las escenas animadas están en src/components/tour/.

import { isActiveSubscriberStatus } from "@/lib/access";
import { WELCOME_PATH } from "@/lib/first-run";

/** Lo que contestó la cuenta. null = aún no se le ha preguntado. */
export type TourState = "done" | "skipped" | null;

export interface TourOfferInput {
  /** useSubscription().status */
  subscriptionStatus: string | null | undefined;
  /** ¿Ya se sabe qué contestó? (false mientras carga o si la consulta falló) */
  stateLoaded: boolean;
  tourState: TourState;
  /** La bienvenida de primer acceso ya está hecha. */
  welcomeDone: boolean;
  /** Alguien del equipo dentro de la cuenta (cambio de cuenta): no se le pregunta en nombre del cliente. */
  impersonating: boolean;
  pathname: string;
}

/** ¿Hay que ofrecer el tutorial ahora? Sólo una vez, sólo a suscriptores, y nunca a ciegas. */
export function shouldOfferTour(i: TourOfferInput): boolean {
  if (!isActiveSubscriberStatus(i.subscriptionStatus)) return false; // portal de la agencia, staff, sin plan…
  if (!i.stateLoaded) return false;                                   // cargando, o la consulta falló: no molestar
  if (i.tourState !== null) return false;                             // ya contestó (sí o no)
  if (!i.welcomeDone) return false;                                   // primero la bienvenida
  if (i.impersonating) return false;
  if (i.pathname === WELCOME_PATH || i.pathname.startsWith("/m")) return false;
  return true;
}

/** ¿Puede volver a verlo desde el menú de la cuenta? Suscriptores y equipo. */
export function canReplayTour(subscriptionStatus: string | null | undefined, isStaff: boolean): boolean {
  return isStaff || isActiveSubscriberStatus(subscriptionStatus);
}

export type ChapterId =
  | "dashboard" | "accounts" | "leads" | "sequence" | "variants" | "settings" | "unibox" | "ai" | "help";

export interface TourChapter {
  id: ChapterId;
  /** Lo que pone en la barra de progreso. */
  short: string;
  title: string;
  text: string;
  /** Duración del capítulo, en milisegundos. */
  ms: number;
}

export const TOUR_CHAPTERS: TourChapter[] = [
  {
    id: "dashboard", short: "Panel", ms: 11000,
    title: "Tu panel",
    text: "Aquí ves de un vistazo cómo van tus envíos: cuántos correos salen, cuántos te responden y cuántos están interesados. Se actualiza solo.",
  },
  {
    id: "accounts", short: "Cuentas", ms: 14000,
    title: "Cuentas de correo",
    text: "Conecta tus buzones de Gmail, Outlook o cualquier SMTP. El warm-up los calienta solo, el límite diario marca cuántos correos envía cada uno y el slow ramp sube el ritmo poco a poco para no quemarlos.",
  },
  {
    id: "leads", short: "Leads", ms: 12000,
    title: "Leads",
    text: "Sube tu CSV y cada columna se convierte en una variable: {{first_name}}, {{company_name}}, {{city}}… Así cada correo sale con los datos de su lead.",
  },
  {
    id: "sequence", short: "Campañas", ms: 13000,
    title: "Campañas y secuencia",
    text: "Una campaña es una secuencia: el primer correo y sus seguimientos, con los días de espera entre uno y otro. Quien te responde deja de recibir los siguientes.",
  },
  {
    id: "variants", short: "Variantes", ms: 14000,
    title: "Variantes A/B",
    text: "Prueba versiones distintas del mismo correo: añade una variante B, usa {{personalized_message}} para un párrafo único por lead escrito con IA, y apaga la que funcione peor sin borrarla.",
  },
  {
    id: "settings", short: "Ajustes", ms: 14000,
    title: "Cuentas, horario y opciones",
    text: "En Ajustes eliges qué buzones envían, qué días y a qué horas, y opciones como esperar a que vuelva quien está fuera de la oficina. Le das a Lanzar y la plataforma se encarga del resto.",
  },
  {
    id: "unibox", short: "Unibox", ms: 13000,
    title: "Unibox: todas tus respuestas",
    text: "Las respuestas de todos tus buzones llegan aquí. La IA las clasifica (Interesado, Pregunta, Fuera / Auto…) y el agente de respuestas te deja un borrador listo para revisar y enviar.",
  },
  {
    id: "ai", short: "Equipo IA", ms: 12000,
    title: "Equipo IA y estadísticas",
    text: "En Personalización la IA escribe un mensaje para cada lead, en Agentes defines cómo responder, en Entregabilidad compruebas si llegas a la bandeja principal y en Estadísticas ves la foto completa.",
  },
  {
    id: "help", short: "Ayuda", ms: 13000,
    title: "FunnyBot y Funny Team",
    text: "¿Dudas? FunnyBot te contesta al momento desde el botón de abajo a la derecha. Y en Funny Team reservas una videollamada con nuestro equipo cuando quieras.",
  },
];

export const TOUR_TOTAL_MS = TOUR_CHAPTERS.reduce((s, c) => s + c.ms, 0);

/** Dónde está el reproductor: capítulo y tiempo dentro de él. */
export interface TourClock { chapter: number; t: number }

/** Avanza el reloj `dt` ms. Al acabar un capítulo pasa al siguiente; tras el último, `finished`. */
export function advanceClock(c: TourClock, dt: number, chapters: TourChapter[] = TOUR_CHAPTERS): TourClock & { finished: boolean } {
  let chapter = c.chapter;
  let t = c.t + Math.max(0, dt);
  while (chapter < chapters.length && t >= chapters[chapter].ms) {
    t -= chapters[chapter].ms;
    chapter += 1;
  }
  if (chapter >= chapters.length) return { chapter: chapters.length, t: 0, finished: true };
  return { chapter, t, finished: false };
}

/** Progreso de 0 a 1 de cada capítulo, para la barra segmentada. */
export function chapterProgress(c: TourClock, index: number, chapters: TourChapter[] = TOUR_CHAPTERS): number {
  if (index < c.chapter) return 1;
  if (index > c.chapter) return 0;
  const ms = chapters[index]?.ms ?? 1;
  return Math.min(1, Math.max(0, c.t / ms));
}

/** Evento global para abrir el reproductor desde cualquier sitio (menú de la cuenta). */
export const OPEN_TOUR_EVENT = "funnyleads:open-tour";
export function openTour() {
  window.dispatchEvent(new CustomEvent(OPEN_TOUR_EVENT));
}
