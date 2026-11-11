// Tutorial guiado (11-11-2026): Funny, el guía, recorre la plataforma REAL de la cuenta. Un cursor
// va a cada sección del menú, entra, señala lo importante y un bocadillo lo explica. Se ofrece UNA
// vez a las cuentas nuevas con suscripción (plan activo o prueba con tarjeta).
//
// Aquí vive sólo la lógica (sin React) para poder probarla: a quién se ofrece, los pasos y las
// cuentas del recorrido. La parte visual está en src/components/tour/.

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

/** Un elemento de la página real: selector CSS y, si hace falta, el texto que debe tener. */
export interface TourTarget { sel: string; text?: RegExp }

export interface TourStep {
  id: string;
  /** Lo que pone en las etiquetas de la pregunta inicial. */
  short: string;
  title: string;
  text: string;
  /** Pantalla a la que se va (con un clic del cursor en el menú). null = se queda donde está. */
  route: string | null;
  /** Lo que se señala, por orden de preferencia. Vacío = sólo explica, sin señalar. */
  targets: TourTarget[];
  /** Clics de verdad SÓLO de lectura (abrir una campaña, cambiar de pestaña), por orden, antes de
   *  señalar. Se saltan si lo que se va a señalar ya está en pantalla. */
  open?: TourTarget[];
  /** Lo que dice si en esta cuenta aún no existe lo que se iba a señalar (cuenta vacía). */
  missing?: string;
  /** Si el menú de esta cuenta no tiene el enlace a `route`, el paso se salta (permisos). */
  needsNav?: boolean;
}

const H1: TourTarget = { sel: "main h1" };
const ROW: TourTarget = { sel: '[data-tour="campaign-row"]' };

export const TOUR_STEPS: TourStep[] = [
  {
    id: "hola", short: "Hola", route: "/dashboard", targets: [],
    title: "¡Hola! Soy Funny",
    text: "Te voy a enseñar Funnyleads sobre tu propia cuenta, sección por sección. Mira el cursor: va a donde está cada cosa. Pasa con Siguiente o con las flechas del teclado.",
  },
  {
    id: "dashboard", short: "Panel", route: "/dashboard", targets: [{ sel: '[data-tour="dash-stats"]' }, H1],
    title: "Tu panel",
    text: "De un vistazo: correos enviados, respuestas, interesados y cómo van tus campañas. Se actualiza solo, no tienes que recargar nada.",
  },
  {
    id: "campaigns", short: "Campañas", route: "/campaigns", targets: [{ sel: "main table" }, H1],
    title: "Campañas",
    text: "Cada campaña es una secuencia de correos para una lista de leads. Desde aquí las creas, las pausas, las reanudas o las duplicas, y ves sus resultados en cada fila.",
  },
  {
    id: "sequence", short: "Secuencia", route: "/campaigns",
    open: [ROW],
    targets: [{ sel: "[data-step-row]" }, { sel: ".seq2-surface" }],
    title: "La secuencia",
    text: "Dentro de una campaña, en Editor escribes el primer correo y los seguimientos, con los días de espera entre uno y otro. Quien responde deja de recibir los siguientes.",
    missing: "Cuando crees tu primera campaña, aquí verás su secuencia: el primer correo y los seguimientos, con los días de espera entre uno y otro. Quien responde deja de recibir los siguientes.",
  },
  {
    id: "variants", short: "Variantes A/B", route: "/campaigns",
    open: [ROW],
    targets: [{ sel: '[aria-label="Añadir variante"]' }],
    title: "Variantes A/B",
    text: "Con este botón añades una variante B (o C…) del mismo correo para ver cuál responde mejor. Usa {{personalized_message}} para un párrafo único por lead escrito con IA, y apaga la variante que peor vaya sin borrarla.",
    missing: "En cada correo de la secuencia puedes añadir una variante B (o C…) para ver cuál responde mejor, usar {{personalized_message}} para un párrafo único por lead escrito con IA y apagar la que peor vaya sin borrarla.",
  },
  {
    id: "campaign-settings", short: "Ajustes", route: "/campaigns",
    open: [ROW, { sel: "main button", text: /^Ajustes$/ }],
    targets: [{ sel: "main button", text: /^Horario$/ }],
    title: "Ajustes de la campaña",
    text: "En Ajustes eliges qué buzones envían, qué días y a qué horas, el límite diario y opciones como esperar a que vuelva quien está fuera de la oficina. Luego le das a Lanzar y la plataforma hace el resto.",
    missing: "En los Ajustes de cada campaña eliges qué buzones envían, qué días y a qué horas, el límite diario y opciones como esperar a que vuelva quien está fuera de la oficina.",
  },
  {
    id: "accounts", short: "Buzones", route: "/email-accounts", needsNav: true, targets: [{ sel: "main table" }, H1],
    title: "Cuentas de correo y warm-up",
    text: "Conecta tus buzones de Gmail, Outlook o SMTP. El warm-up los calienta solo, el límite diario marca cuántos correos manda cada uno y el slow ramp sube el ritmo poco a poco para no quemarlos.",
  },
  {
    id: "leads", short: "Leads", route: "/leads", needsNav: true, targets: [{ sel: "main button, main label", text: /Importar/ }, H1],
    title: "Leads",
    text: "Sube tu CSV y cada columna se convierte en una variable: {{first_name}}, {{company_name}}, {{city}}… Así cada correo sale con los datos de su lead.",
  },
  {
    id: "unibox", short: "Unibox", route: "/unibox", needsNav: true, targets: [{ sel: '[data-tour="unibox-filters"]' }, H1],
    title: "Unibox: todas tus respuestas",
    text: "Las respuestas de todos tus buzones llegan aquí, clasificadas solas: Interesados, Preguntas, No interesados, Fuera / Auto… Respondes desde aquí sin abrir cada buzón.",
  },
  {
    id: "agents", short: "Agentes IA", route: "/ai-prompts", needsNav: true, targets: [H1],
    title: "Agentes IA",
    text: "Le dices al agente cómo contestar y te deja un borrador listo en el Unibox para cada respuesta. Tú lo revisas y lo envías, o dejas que responda solo.",
  },
  {
    id: "personalization", short: "Personalización", route: "/personalizacion", needsNav: true, targets: [H1],
    title: "Personalización con IA",
    text: "Sube una lista y la IA escribe un mensaje distinto para cada lead a partir de su web y su empresa. Lo usas en tus correos con {{personalized_message}}.",
  },
  {
    id: "deliverability", short: "Entregabilidad", route: "/deliverability", needsNav: true, targets: [H1],
    title: "Entregabilidad",
    text: "Comprueba si tus correos llegan a la bandeja principal o a spam antes de lanzar, y qué tocar si algo falla.",
  },
  {
    id: "stats", short: "Estadísticas", route: "/stats", needsNav: true, targets: [H1],
    title: "Estadísticas",
    text: "La foto completa: envíos, respuestas e interesados por día, por campaña y por buzón.",
  },
  {
    id: "funny-team", short: "Funny Team", route: "/funny-team", needsNav: true, targets: [{ sel: "main section", text: /Elige día y hora/ }, H1],
    title: "Funny Team",
    text: "¿Quieres que te ayudemos en persona? Elige día y hora y reservas una videollamada de 15 minutos con nuestro equipo.",
  },
  {
    id: "funnybot", short: "FunnyBot", route: null, targets: [{ sel: 'button[aria-label^="Abrir el"]' }],
    title: "FunnyBot, siempre a mano",
    text: "Desde este botón me preguntas lo que quieras en cualquier momento, o hablas directamente con el equipo.",
    missing: "Desde el botón de chat de abajo a la derecha me preguntas lo que quieras en cualquier momento, o hablas directamente con el equipo.",
  },
  {
    id: "fin", short: "Listo", route: "/dashboard", targets: [],
    title: "¡Listo! Ya vas por libre",
    text: "Ya conoces todo lo importante. Empieza conectando un buzón y creando tu primera campaña. Si quieres repasarlo, está en el menú de tu cuenta: «Ver el tutorial».",
  },
];

/** Lo que tarda en leerse un texto, para el modo automático (mín. 4 s). */
export function readingMs(text: string): number {
  return Math.max(4000, Math.round(text.length * 55) + 1500);
}

/** Minutos aproximados del recorrido (para la pregunta inicial). */
export function tourMinutes(steps: TourStep[] = TOUR_STEPS): number {
  const ms = steps.reduce((s, st) => s + readingMs(st.text) + 1800, 0);
  return Math.max(1, Math.round(ms / 60000));
}

/** Letras que se ven del bocadillo a los `elapsedMs` (efecto de escribir). */
export const TYPE_CPS = 55;
export function typedLength(text: string, elapsedMs: number, cps = TYPE_CPS): number {
  return Math.max(0, Math.min(text.length, Math.floor((Math.max(0, elapsedMs) * cps) / 1000)));
}

/** Un rectángulo en pantalla (como DOMRect, sin depender del DOM). */
export interface Box { left: number; top: number; width: number; height: number }

/** Hueco del foco alrededor del elemento: con margen, y sin salirse de la pantalla. */
export function spotlightBox(r: Box, vw: number, vh: number, pad = 8): Box {
  const left = Math.max(4, r.left - pad);
  const top = Math.max(4, r.top - pad);
  const right = Math.min(vw - 4, r.left + r.width + pad);
  const bottom = Math.min(vh - 4, r.top + r.height + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Lado donde se pone Funny con su bocadillo: si lo señalado está abajo a la izquierda, a la derecha. */
export function dockSide(r: Box | null, vw: number, vh: number): "left" | "right" {
  if (!r) return "left";
  const cx = r.left + r.width / 2;
  const bottom = r.top + r.height;
  if (cx < vw * 0.5 && bottom > vh * 0.55) return "right";
  return "left";
}

/** Siguiente / anterior sin salirse. */
export function clampStep(i: number, steps: TourStep[] = TOUR_STEPS): number {
  return Math.max(0, Math.min(steps.length - 1, i));
}

/** Evento global para abrir el reproductor desde cualquier sitio (menú de la cuenta). */
export const OPEN_TOUR_EVENT = "funnyleads:open-tour";
export function openTour() {
  window.dispatchEvent(new CustomEvent(OPEN_TOUR_EVENT));
}
