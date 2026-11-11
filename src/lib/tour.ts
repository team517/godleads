// Tutorial guiado (11-11-2026, ampliado el mismo día): Funny, el guía, recorre la plataforma REAL de
// la cuenta y la USA de verdad: abre menús, pulsa «Crear campaña», escribe el nombre, crea una
// campaña de ejemplo (en borrador), escribe los correos con variables, añade un seguimiento y una
// variante B, la apaga y la enciende, abre los ajustes, los leads, la analítica… y recorre cada
// sección abriendo sus ventanas para enseñarlas (y cerrándolas sin guardar). En algunos pasos el
// cliente lo hace él mismo («Ahora tú»).
//
// Aquí vive sólo la lógica (sin React) para poder probarla: a quién se ofrece, los capítulos y los
// pasos, qué puede pulsar el guía (lista cerrada) y el recuerdo del recorrido para seguir tras una
// recarga. La parte visual está en src/components/tour/.

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

/* ── Qué puede pulsar o escribir el guía ──────────────────────────────────────────────────────
 * Lista CERRADA. Cada acción de cada paso lleva una de estas claves, y tour-dom.ts comprueba en la
 * página que el elemento es de verdad ese (texto, atributos y, en lo de la campaña, que es la
 * campaña de ejemplo del propio tutorial). Lo único que CREA algo es «create-submit» (la campaña de
 * ejemplo, en borrador). Lo que cambia algo lo cambia SOLO en esa campaña de ejemplo. Lo demás abre,
 * enseña o cierra sin guardar. Nunca: Lanzar, Enviar prueba, Añadir cuenta (guardar), Importar,
 * Guardar un agente, pagar, cerrar sesión. */
export const SAFE_IDS = [
  "nav",                // enlace del menú lateral
  "create-open",        // «Crear campaña» (abre la ventana)
  "create-name",        // el nombre en esa ventana (escribir)
  "create-submit",      // «Crear» → campaña de ejemplo en BORRADOR (lo único que crea)
  "campaign-row",       // abrir la campaña de ejemplo desde la lista
  "campaign-tab",       // Analítica · Editor · Leads · Ajustes (de la campaña de ejemplo)
  "campaign-back",      // volver a la lista de campañas
  "seq-first-step",     // «Crear primer paso» (campaña de ejemplo)
  "seq-add-step",       // «Añadir paso» (campaña de ejemplo)
  "seq-step-card",      // abrir un correo de la secuencia (campaña de ejemplo)
  "seq-subject",        // escribir el asunto (campaña de ejemplo)
  "seq-body",           // escribir el cuerpo (campaña de ejemplo)
  "seq-delay",          // días de espera del seguimiento (campaña de ejemplo)
  "seq-add-variant",    // «Añadir variante» (campaña de ejemplo)
  "seq-variant-chip",   // elegir la versión A / B (campaña de ejemplo)
  "seq-variant-off",    // apagar la versión B (campaña de ejemplo)
  "seq-variant-on",     // encenderla otra vez (campaña de ejemplo)
  "seq-preview",        // vista previa (sólo mirar)
  "seq-insert-var",     // abrir la lista de variables (sólo mirar)
  "settings-subtab",    // Cuentas · Horario · Opciones · Bajas (campaña de ejemplo, sólo mirar)
  "leads-import-open",  // abrir «Importar CSV» de la campaña (y cerrarla sin importar)
  "dialog-close",       // la X de una ventana (cerrar sin guardar)
  "accounts-add-open",  // «Añadir cuenta» (abre la ventana; nunca se guarda)
  "accounts-single",    // «Conectar una cuenta»
  "accounts-provider",  // Gmail / Outlook / SMTP (enseña el formulario)
  "accounts-email",     // escribir un correo de ejemplo en ese formulario (no se guarda)
  "leads-add-open",     // «Añadir lead» (abre la ventana; nunca se guarda)
  "leads-email",        // escribir un correo de ejemplo en esa ventana (no se guarda)
  "unibox-filter",      // filtros del Unibox (sólo cambian lo que se ve)
  "agent-create-open",  // «Crear agente» (abre el editor o su menú; nunca se guarda)
  "agent-kind",         // en ese menú, «Agente de respuestas» (abre el editor)
  "agent-section",      // apartados del editor del agente
  "agent-back",         // salir del editor sin guardar
  "deliv-mode",         // modo de la prueba de entregabilidad (sólo cambia lo que se ve)
  "settings-tab",       // Perfil · Plan · Envío
  "search-input",       // escribir en el buscador (y vaciarlo)
  "notifications",      // abrir las notificaciones
  "account-menu",       // abrir el menú de la cuenta
  "chat-open",          // abrir el chat
  "chat-close",         // cerrarlo
] as const;
export type SafeId = typeof SAFE_IDS[number];

/** Las acciones que cambian datos. Todas, menos crear la campaña, SOLO en la campaña de ejemplo. */
export const MUTATING_SAFE: readonly SafeId[] = [
  "create-submit", "seq-first-step", "seq-add-step", "seq-subject", "seq-body", "seq-delay",
  "seq-add-variant", "seq-variant-off", "seq-variant-on",
];
/** Lo único que crea algo nuevo en la cuenta. */
export const CREATING_SAFE: readonly SafeId[] = ["create-submit"];

/** Nombre de la campaña de ejemplo que crea el tutorial. */
export const TOUR_CAMPAIGN_NAME = "Campaña de ejemplo · Tutorial";

/* ── Pasos ───────────────────────────────────────────────────────────────────────────────── */

/** Un elemento de la página real: selector CSS y, si hace falta, el texto que debe tener.
 *  `{campaign}` en el selector = el id de la campaña de ejemplo. `nth` = el n-ésimo que cumpla.
 *  `up` = señalar su contenedor (n niveles hacia arriba). */
export interface TourTarget { sel: string; text?: RegExp; nth?: number; up?: number }

export type TourAction =
  /** El guía pulsa (cursor + clic de verdad). */
  | { do: "click"; target: TourTarget[]; safe: SafeId; skipIf?: TourTarget[]; skipIfCount?: { sel: string; min: number }; skipIfCampaign?: boolean; optional?: boolean }
  /** El guía escribe letra a letra. */
  | { do: "type"; target: TourTarget[]; safe: SafeId; text: string; cps?: number; blur?: boolean }
  /** Cierra un menú o desplegable (tecla Escape). */
  | { do: "escape" }
  /** Espera un momento (que la pantalla termine de cambiar). */
  | { do: "wait"; ms: number };

export type ChapterId =
  | "inicio" | "crear" | "secuencia" | "variantes" | "ajustes" | "leads-campana" | "lanzar"
  | "buzones" | "leads" | "unibox" | "agentes" | "personalizacion" | "entregabilidad" | "estadisticas"
  | "funny-team" | "cuenta" | "atajos" | "fin";

export interface TourChapter { id: ChapterId; label: string }

export const TOUR_CHAPTERS: TourChapter[] = [
  { id: "inicio", label: "Tu panel" },
  { id: "crear", label: "Crear una campaña" },
  { id: "secuencia", label: "La secuencia" },
  { id: "variantes", label: "Variantes A/B" },
  { id: "ajustes", label: "Ajustes de la campaña" },
  { id: "leads-campana", label: "Leads de la campaña" },
  { id: "lanzar", label: "Analítica y lanzar" },
  { id: "buzones", label: "Buzones y warm-up" },
  { id: "leads", label: "Leads" },
  { id: "unibox", label: "Unibox" },
  { id: "agentes", label: "Agentes IA" },
  { id: "personalizacion", label: "Personalización" },
  { id: "entregabilidad", label: "Entregabilidad" },
  { id: "estadisticas", label: "Estadísticas" },
  { id: "funny-team", label: "Funny Team" },
  { id: "cuenta", label: "Tu cuenta y plan" },
  { id: "atajos", label: "Atajos" },
  { id: "fin", label: "Listo" },
];

export interface TourStep {
  id: string;
  chapter: ChapterId;
  title: string;
  text: string;
  /** Pantalla del paso (se entra con un clic en el menú). null = se queda donde está. */
  route: string | null;
  /** Dentro de la campaña de ejemplo: con qué pestaña y sub-pestaña abierta. "list" = en la lista. */
  campaign?: "list" | { tab?: "analytics" | "editor" | "leads" | "settings"; sub?: "Cuentas" | "Horario" | "Opciones" | "Bajas" };
  /** Lo que hace el guía, por orden, antes de señalar. */
  actions?: TourAction[];
  /** «Ahora tú»: el cliente pulsa esto (sólo esto queda libre); si no, «Hazlo tú por mí». */
  user?: { target: TourTarget[]; safe: SafeId; skipIfCampaign?: boolean; skipIf?: TourTarget[] };
  /** Lo que se señala al final. Vacío = sólo explica. */
  point: TourTarget[];
  /** Lo que dice si en esta cuenta no aparece lo que se iba a señalar. */
  missing?: string;
  /** Si el menú de esta cuenta no tiene el enlace a `route`, el paso se salta (permisos). */
  needsNav?: boolean;
  /** Sólo en ordenador (en el móvil esa pieza no existe). */
  desktopOnly?: boolean;
  /** Tras sus acciones, recordar la campaña recién creada (paso de «Crear»). */
  captureCampaign?: boolean;
  /** En el teléfono el Unibox es la app del móvil (/unibox lleva a /m): ahí el paso sólo se
   *  explica con este texto, sin ir; los pasos del Unibox sin él no salen en el teléfono. */
  phoneText?: string;
}

const H1: TourTarget = { sel: "main h1" };
/** Una ventana de la app (nunca el propio tutorial, que también es un role="dialog"). */
const DIALOG = '[role="dialog"]:not([data-testid="guided-tour"])';
const CAMPAIGN_ROOT = '[data-tour-campaign="{campaign}"]';
const CAMPAIGN_BODY: TourTarget = { sel: `${CAMPAIGN_ROOT} > div:nth-of-type(2)` };
const tab = (label: string): TourTarget => ({ sel: 'nav[aria-label="Secciones de la campaña"] button', text: new RegExp(`^${label}$`) });
const subtab = (label: string): TourTarget => ({ sel: `${CAMPAIGN_ROOT} button`, text: new RegExp(`^${label}$`) });
const row = (title: string): TourTarget => ({ sel: `[data-tour-row="${title}"]` });
const CLOSE_DIALOG: TourAction = { do: "click", target: [{ sel: `${DIALOG} button`, text: /^Close$/ }], safe: "dialog-close", optional: true };

const SIN_CAMPANA = "Para esta parte necesito la campaña de ejemplo y no he podido crearla. Te lo cuento igual: ";

export const TOUR_STEPS: TourStep[] = [
  /* ── Tu panel ── */
  {
    id: "hola", chapter: "inicio", route: "/dashboard", point: [],
    title: "¡Hola! Soy Funny",
    text: "Te voy a enseñar Funnyleads usándolo de verdad, sobre tu propia cuenta: crearemos juntos una campaña de ejemplo (en borrador, no envía nada) y recorreremos cada sección. Pasa con Siguiente o con las flechas, pausa cuando quieras.",
  },
  {
    id: "menu", chapter: "inicio", route: "/dashboard", point: [{ sel: "aside nav" }, { sel: "aside" }], desktopOnly: true,
    title: "El menú",
    text: "Aquí tienes todo: campañas, Unibox, buzones, leads, los agentes de IA y la salud de tus envíos. Yo iré pulsando en cada sitio para que veas qué hay dentro.",
  },
  {
    id: "dashboard", chapter: "inicio", route: "/dashboard", point: [{ sel: '[data-tour="dash-stats"]' }, H1],
    title: "Tu panel",
    text: "De un vistazo: correos enviados, respuestas, interesados y reuniones de todas tus campañas. Se actualiza solo mientras trabajas; no tienes que recargar nada.",
  },

  /* ── Crear una campaña ── */
  {
    id: "campanas", chapter: "crear", route: "/campaigns", campaign: "list", point: [{ sel: "main table" }, H1],
    title: "Campañas",
    text: "Cada campaña es una secuencia de correos que sale sola hacia una lista de leads. En la lista ves su estado, la actividad y los resultados, y desde cada fila la pausas, la duplicas o la borras.",
  },
  {
    id: "crear-abrir", chapter: "crear", route: "/campaigns", campaign: "list",
    user: { target: [{ sel: "main button", text: /^\s*Crear campaña\s*$/ }], safe: "create-open", skipIfCampaign: true },
    point: [{ sel: "main button", text: /^\s*Crear campaña\s*$/ }],
    title: "Ahora tú: crea una campaña",
    text: "Pulsa «Crear campaña». Vamos a crear una de ejemplo para que veas todo por dentro. Se queda en borrador: no envía nada hasta que tú la lances.",
  },
  {
    id: "crear-nombre", chapter: "crear", route: "/campaigns", campaign: "list",
    actions: [
      { do: "click", target: [{ sel: "main button", text: /^\s*Crear campaña\s*$/ }], safe: "create-open", skipIf: [{ sel: DIALOG, text: /Crear campaña/ }], skipIfCampaign: true },
      { do: "type", target: [{ sel: `${DIALOG} input[placeholder="Prospección Q1"]` }], safe: "create-name", text: TOUR_CAMPAIGN_NAME, cps: 30 },
    ],
    point: [{ sel: DIALOG, text: /Crear campaña/ }],
    title: "Ponle un nombre",
    text: "Un nombre que te diga qué es y para quién: «Agencias Madrid · enero», «Clínicas dentales · demo»… Solo lo ves tú; tus leads nunca lo ven.",
    missing: "Ya tienes la campaña de ejemplo creada, así que seguimos con ella.",
  },
  {
    id: "crear-ok", chapter: "crear", route: "/campaigns", campaign: "list", captureCampaign: true,
    actions: [
      { do: "click", target: [{ sel: `${DIALOG} button`, text: /^Crear$/ }], safe: "create-submit", skipIfCampaign: true },
      { do: "wait", ms: 900 },
    ],
    point: [{ sel: '[data-tour="campaign-row"][data-campaign-id="{campaign}"]' }],
    title: "¡Campaña creada!",
    text: "Ahí la tienes, en borrador. Una campaña en borrador nunca envía nada: el motor solo trabaja con las campañas que tú lanzas. Ahora la abro para que veas su interior.",
    missing: "Ya está creada, en borrador. Una campaña en borrador nunca envía nada: el motor solo trabaja con las campañas que tú lanzas.",
  },

  /* ── La secuencia ── */
  {
    id: "editor", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    point: [tab("Editor")],
    title: "Dentro de la campaña",
    text: "Arriba tienes sus cuatro partes: Analítica (cómo va), Editor (los correos), Leads (a quién) y Ajustes (desde qué buzones, cuándo y cuántos). Empezamos por el Editor.",
    missing: SIN_CAMPANA + "dentro de cada campaña tienes Analítica, Editor (los correos), Leads (a quién) y Ajustes (desde qué buzones, cuándo y cuántos).",
  },
  {
    id: "primer-paso", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button`, text: /Crear primer paso/ }], safe: "seq-first-step", skipIfCount: { sel: `${CAMPAIGN_ROOT} [data-step-row]`, min: 1 } },
      { do: "wait", ms: 700 },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} [data-step-row]`, nth: 0 }],
    title: "El primer correo",
    text: "Cada campaña empieza con un correo. Lo creo con «Crear primer paso». También podrías pedirle a la IA que te escriba la secuencia entera con «Generar con IA».",
    missing: SIN_CAMPANA + "cada campaña empieza con un primer correo; lo creas con «Crear primer paso» o pides a la IA la secuencia entera.",
  },
  {
    id: "asunto", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "type", target: [{ sel: `${CAMPAIGN_ROOT} #seq-subject-editor` }], safe: "seq-subject", text: "{{first_name}}, una idea para {{company_name}}", cps: 32 },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} #seq-subject-editor`, up: 1 }],
    title: "El asunto, con variables",
    text: "Escribo el asunto con variables entre llaves dobles: {{first_name}} se cambia por el nombre de cada lead y {{company_name}} por su empresa. Salen de las columnas de tu CSV, así que cada correo es personal.",
    missing: SIN_CAMPANA + "el asunto admite variables como {{first_name}} o {{company_name}}, que salen de las columnas de tu CSV.",
  },
  {
    id: "cuerpo", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      {
        do: "type", target: [{ sel: `${CAMPAIGN_ROOT} #seq-body-editor` }], safe: "seq-body", cps: 60, blur: true,
        text: "Hola {{first_name}},\n\n{{personalized_message}}\n\nAyudamos a empresas como {{company_name}} a conseguir más reuniones con clientes nuevos.\n\n¿Te encaja una llamada de 10 minutos esta semana?\n\n{{SenderFirstName}}",
      },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} #seq-body-editor`, up: 1 }],
    title: "El cuerpo del correo",
    text: "Corto y directo. {{personalized_message}} mete un párrafo único por lead escrito con IA (lo preparas en Personalización) y {{SenderFirstName}} firma con el nombre del buzón que envía. Se guarda solo mientras escribes.",
    missing: SIN_CAMPANA + "en el cuerpo usas {{personalized_message}} para un párrafo único por lead y {{SenderFirstName}} para firmar con el nombre del buzón que envía.",
  },
  {
    id: "variables", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button.seq2-tool[aria-label="Insertar variable"]` }], safe: "seq-insert-var" },
      { do: "wait", ms: 400 },
    ],
    point: [{ sel: "[data-radix-popper-content-wrapper]" }, { sel: `${CAMPAIGN_ROOT} button.seq2-tool[aria-label="Insertar variable"]` }],
    title: "La barra de herramientas",
    text: "Desde aquí insertas variables sin escribirlas a mano: las de tus leads aparecen en cuanto importas tu lista, y siempre tienes las del buzón que envía. También hay formato, enlaces, adjuntos y un enlace para reservar llamada.",
    missing: "En la barra del editor insertas variables, das formato, añades enlaces, adjuntos y un enlace para reservar llamada.",
  },
  {
    id: "ia-correo", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [{ do: "escape" }],
    point: [{ sel: `${CAMPAIGN_ROOT} [aria-label="Escribir este correo con IA"]` }],
    title: "Escribir con IA",
    text: "Con este botón la IA te escribe el correo a partir de lo que vendes y a quién. Te lo deja en el editor para que lo retoques: siempre decides tú qué se envía.",
    missing: "En cada correo tienes un botón para que la IA te lo escriba a partir de lo que vendes; tú lo retocas antes de enviar.",
  },
  {
    id: "seguimiento", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button`, text: /^\s*Añadir paso\s*$/ }], safe: "seq-add-step", skipIfCount: { sel: `${CAMPAIGN_ROOT} [data-step-row]`, min: 2 } },
      { do: "wait", ms: 800 },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} [data-step-row]`, nth: 1 }],
    title: "Un seguimiento",
    text: "Con «Añadir paso» creo el segundo correo: un seguimiento para quien no ha contestado. La mayoría de respuestas llegan en el segundo o tercer correo, así que merece la pena.",
    missing: SIN_CAMPANA + "con «Añadir paso» creas seguimientos para quien no contesta; la mayoría de respuestas llegan en el segundo o tercer correo.",
  },
  {
    id: "espera", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "type", target: [{ sel: `${CAMPAIGN_ROOT} input[aria-label="Cuánto esperar"]` }], safe: "seq-delay", text: "3", cps: 8, blur: true },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} input[aria-label="Cuánto esperar"]`, up: 1 }],
    title: "Los días de espera",
    text: "Este seguimiento sale 3 días después del primero, y solo en los días y horas de envío que marques en Ajustes. Y lo más importante: quien responde deja de recibir los siguientes correos automáticamente.",
    missing: "Entre correo y correo marcas los días de espera. Quien responde deja de recibir los siguientes automáticamente.",
  },
  {
    id: "cuerpo-2", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} [data-step-row] .seq2-card`, nth: 1 }], safe: "seq-step-card" },
      { do: "wait", ms: 300 },
      { do: "type", target: [{ sel: `${CAMPAIGN_ROOT} #seq-body-editor` }], safe: "seq-body", cps: 60, blur: true,
        text: "Hola {{first_name}}, te escribí hace unos días por si te encajaba. ¿Lo vemos en 10 minutos?\n\n{{SenderFirstName}}" },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} [data-step-row]`, nth: 1 }],
    title: "Asunto vacío = mismo hilo",
    text: "Dejo el asunto del seguimiento vacío a propósito: así sale como respuesta en el mismo hilo que el primero («Re: …»), que es lo que mejor funciona.",
    missing: "Si dejas vacío el asunto de un seguimiento, sale como respuesta en el mismo hilo que el correo anterior.",
  },
  {
    id: "vista-previa", chapter: "secuencia", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} [data-step-row] .seq2-card`, nth: 0 }], safe: "seq-step-card" },
      { do: "wait", ms: 300 },
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button.seq2-tool[aria-label="Vista previa"]` }], safe: "seq-preview" },
      { do: "wait", ms: 500 },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} [data-step-row]`, nth: 0 }],
    title: "Vista previa",
    text: "Así lo verá tu lead: las variables se cambian por datos de ejemplo (con tus leads importados, por los suyos). Antes de lanzar, repásalo siempre aquí.",
    missing: "Con la vista previa ves el correo como lo recibirá tu lead, con las variables ya cambiadas.",
  },

  /* ── Variantes A/B ── */
  {
    id: "variante-b", chapter: "variantes", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button.seq2-tool[aria-label="Vista previa"]` }], safe: "seq-preview", skipIf: [{ sel: `${CAMPAIGN_ROOT} #seq-body-editor` }] },
      { do: "wait", ms: 300 },
    ],
    user: { target: [{ sel: `${CAMPAIGN_ROOT} [aria-label="Añadir variante"]`, nth: 0 }], safe: "seq-add-variant", skipIf: [{ sel: `${CAMPAIGN_ROOT} .seq2-chip button`, text: /^B$/ }] },
    point: [{ sel: `${CAMPAIGN_ROOT} [aria-label="Añadir variante"]`, nth: 0 }],
    title: "Ahora tú: añade una variante",
    text: "Pulsa el «+» de la derecha del primer correo. Crea una versión B del mismo correo para probar cuál responde mejor (una prueba A/B).",
    missing: "Con el «+» de la derecha de cada correo creas una versión B para probar cuál responde mejor.",
  },
  {
    id: "variante-b-texto", chapter: "variantes", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} [aria-label="Añadir variante"]`, nth: 0 }], safe: "seq-add-variant", skipIf: [{ sel: `${CAMPAIGN_ROOT} .seq2-chip button`, text: /^B$/ }] },
      { do: "wait", ms: 400 },
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} .seq2-chip button`, text: /^B$/ }], safe: "seq-variant-chip" },
      { do: "wait", ms: 300 },
      { do: "type", target: [{ sel: `${CAMPAIGN_ROOT} #seq-subject-editor` }], safe: "seq-subject", text: "¿Hablamos, {{first_name}}?", cps: 32 },
      { do: "type", target: [{ sel: `${CAMPAIGN_ROOT} #seq-body-editor` }], safe: "seq-body", cps: 60, blur: true,
        text: "Hola {{first_name}},\n\n{{personalized_message}}\n\n¿Te cuento en 10 minutos cómo lo hacemos?\n\n{{SenderFirstName}}" },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} .seq2-chip`, text: /^B/ }, { sel: `${CAMPAIGN_ROOT} [data-step-row]`, nth: 0 }],
    title: "La versión B",
    text: "Le pongo otro asunto y otro texto. Cada lead recibe una sola versión: el reparto es a partes iguales entre las que estén encendidas, y en Analítica ves cuál tiene más respuestas.",
    missing: "Cada lead recibe una sola versión; se reparten a partes iguales entre las encendidas y en Analítica ves cuál gana.",
  },
  {
    id: "variante-off", chapter: "variantes", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button[role="switch"][title^="Apagar la versión B"]` }], safe: "seq-variant-off" },
      { do: "wait", ms: 500 },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} .seq2-chip`, text: /^B/ }],
    title: "Apagar una versión",
    text: "Cuando una versión va peor, la apagas con su interruptor: deja de enviarse al momento, pero no se borra (la tienes guardada para otra vez). Si la apagas todas menos una, ya no hay prueba A/B.",
    missing: "Con el interruptor de cada versión la apagas: deja de enviarse pero no se borra.",
  },
  {
    id: "variante-on", chapter: "variantes", route: "/campaigns", campaign: { tab: "editor" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button[role="switch"][title^="Encender la versión B"]` }], safe: "seq-variant-on" },
      { do: "wait", ms: 500 },
    ],
    point: [{ sel: `${CAMPAIGN_ROOT} .seq2-chip`, text: /^B/ }],
    title: "Y encenderla otra vez",
    text: "La vuelvo a encender y vuelve al reparto. Con la «A/B Testing con IA» de Ajustes, la plataforma puede incluso decidir sola cuál gana cuando hay suficientes datos.",
    missing: "Se enciende igual que se apaga, y vuelve al reparto.",
  },

  /* ── Ajustes de la campaña ── */
  {
    id: "ajustes-cuentas", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Cuentas" },
    point: [CAMPAIGN_BODY],
    title: "Desde qué buzones se envía",
    text: "En Cuentas eliges qué buzones envían esta campaña (sueltos o por etiqueta). El envío se reparte entre ellos para que ninguno se queme. Aquí aparecerán los buzones que conectes.",
    missing: SIN_CAMPANA + "en Ajustes → Cuentas eliges qué buzones envían la campaña; el envío se reparte entre ellos.",
  },
  {
    id: "ajustes-horario", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Horario" },
    point: [{ sel: `${CAMPAIGN_ROOT} label`, text: /Ventana de envío/, up: 1 }, CAMPAIGN_BODY],
    title: "Cuándo se envía",
    text: "La ventana de envío marca las horas (por ejemplo, de 9 a 17) en la zona horaria de tus leads, y debajo eliges los días. Fuera de ahí no sale nada, ni los seguimientos.",
    missing: "En Horario marcas las horas, la zona horaria y los días de envío; fuera de ahí no sale nada.",
  },
  {
    id: "ajustes-dias", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Horario" },
    point: [{ sel: `${CAMPAIGN_ROOT} label`, text: /Días de envío/, up: 1 }, CAMPAIGN_BODY],
    title: "Los días de envío",
    text: "Lo normal es de lunes a viernes. Los correos se reparten a lo largo de la ventana con esperas aleatorias entre uno y otro, como lo haría una persona.",
    missing: "Lo normal es enviar de lunes a viernes, repartido a lo largo del día.",
  },
  {
    id: "ajustes-limite", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Opciones" },
    point: [row("Límite diario de envíos"), CAMPAIGN_BODY],
    title: "El límite diario",
    text: "Cuántos correos manda la campaña al día. En «Auto» sube solo a medida que tus buzones calientan; con un tope fijo, al llegar para hasta el día siguiente.",
    missing: "En Opciones fijas el límite diario de la campaña (o lo dejas en automático).",
  },
  {
    id: "ajustes-respuesta", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Opciones" },
    point: [row("Parar al recibir respuesta")],
    title: "Parar al recibir respuesta",
    text: "Si un lead contesta, se cancelan sus seguimientos. Así nadie recibe «¿viste mi correo?» después de haberte respondido.",
    missing: "Si un lead contesta, se cancelan sus seguimientos.",
  },
  {
    id: "ajustes-ooo", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Opciones" },
    point: [row("Fuera de oficina: esperar a que vuelva")],
    title: "Fuera de oficina",
    text: "Si alguien contesta con un «estoy fuera hasta el día 20», no le escribimos más hasta ese día, y ese mismo día recibe el siguiente correo. Lo detectamos en cualquier idioma.",
    missing: "Si alguien está fuera de la oficina, esperamos a que vuelva y ese día recibe el siguiente correo.",
  },
  {
    id: "ajustes-reparto", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Opciones" },
    point: [row("Reparto del día: leads nuevos y seguimientos"), row("Priorizar nuevos leads")],
    title: "Nuevos y seguimientos",
    text: "Decides cómo se reparte el día entre leads nuevos y seguimientos: automático, o con el porcentaje que tú quieras.",
    missing: "Puedes decidir cómo se reparte el día entre leads nuevos y seguimientos.",
  },
  {
    id: "ajustes-rampa", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Opciones" },
    point: [row("Aumento gradual")],
    title: "Aumento gradual (slow ramp)",
    text: "La campaña empieza con pocos correos por buzón y día, y sube un poco cada día. Es la forma segura de arrancar sin que los proveedores te marquen como spam.",
    missing: "Con el aumento gradual la campaña empieza con pocos correos y sube cada día, para arrancar sin riesgo.",
  },
  {
    id: "ajustes-baja", chapter: "ajustes", route: "/campaigns", campaign: { tab: "settings", sub: "Opciones" },
    point: [row("Incluir enlace de baja")],
    title: "Enlace de baja y más",
    text: "Puedes añadir un enlace de baja; quien lo pulse no vuelve a recibir nada de ninguna campaña. Más abajo hay opciones de entrega avanzadas: límite por empresa, emparejar proveedor, rotación…",
    missing: "Puedes añadir un enlace de baja y opciones avanzadas de entrega.",
  },

  /* ── Leads de la campaña ── */
  {
    id: "leads-tab", chapter: "leads-campana", route: "/campaigns", campaign: { tab: "leads" },
    point: [CAMPAIGN_BODY],
    title: "A quién se envía",
    text: "En Leads metes la gente a la que escribe esta campaña: con un CSV, a mano, o desde una de tus carpetas de leads. Aquí verás a cada uno con su estado.",
    missing: SIN_CAMPANA + "en la pestaña Leads metes a quién escribe la campaña: CSV, a mano o desde tus carpetas.",
  },
  {
    id: "leads-csv", chapter: "leads-campana", route: "/campaigns", campaign: { tab: "leads" },
    actions: [
      { do: "click", target: [{ sel: `${CAMPAIGN_ROOT} button`, text: /Importar CSV/ }], safe: "leads-import-open", skipIf: [{ sel: DIALOG, text: /Importar leads desde CSV/ }] },
      { do: "wait", ms: 500 },
    ],
    point: [{ sel: DIALOG, text: /Importar leads desde CSV/ }],
    title: "Importar un CSV",
    text: "Solo hace falta la columna email; cada columna más se convierte en una variable ({{first_name}}, {{company_name}}, {{city}}…). Puedes revisar duplicados antes de importar. No importo nada: solo te lo enseño.",
    missing: "Al importar un CSV, cada columna se convierte en una variable para tus correos.",
  },
  {
    id: "leads-ia", chapter: "leads-campana", route: "/campaigns", campaign: { tab: "leads" },
    actions: [CLOSE_DIALOG, { do: "wait", ms: 300 }],
    point: [{ sel: `${CAMPAIGN_ROOT} button`, text: /Personalizar/ }, CAMPAIGN_BODY],
    title: "Personalizar y verificar",
    text: "Con tus leads dentro, puedes personalizarlos con IA (rellena {{personalized_message}}) y verificar sus correos para no rebotar. Menos rebotes = mejor reputación.",
    missing: "Con los leads dentro puedes personalizarlos con IA y verificar sus correos.",
  },

  /* ── Analítica y lanzar ── */
  {
    id: "analitica", chapter: "lanzar", route: "/campaigns", campaign: { tab: "analytics" },
    point: [{ sel: `${CAMPAIGN_BODY.sel} > div > :first-child` }, CAMPAIGN_BODY],
    title: "La analítica",
    text: "Cuando la campaña envíe, aquí verás cada día los envíos, aperturas, respuestas, interesados y rebotes, y qué versión del correo funciona mejor.",
    missing: SIN_CAMPANA + "en Analítica ves cada día los envíos, respuestas, interesados y rebotes.",
  },
  {
    id: "lanzar", chapter: "lanzar", route: "/campaigns", campaign: { tab: "analytics" },
    point: [{ sel: `${CAMPAIGN_ROOT} [data-tour="campaign-launch"]` }],
    title: "Lanzar",
    text: "Con buzones, leads y correos listos, pulsas «Lanzar» y la plataforma hace el resto. Yo NO la lanzo: tu campaña de ejemplo se queda en borrador. Al final te pregunto si quieres conservarla.",
    missing: "Con buzones, leads y correos listos, pulsas «Lanzar» y la plataforma hace el resto.",
  },
  {
    id: "volver", chapter: "lanzar", route: "/campaigns", campaign: "list",
    point: [{ sel: '[data-tour="campaign-row"][data-campaign-id="{campaign}"]' }, { sel: "main table" }],
    title: "De vuelta a la lista",
    text: "Tu campaña aparece en la lista con su estado. Cuando esté activa, verás aquí su progreso y sus resultados sin entrar.",
  },

  /* ── Buzones ── */
  {
    id: "buzones", chapter: "buzones", route: "/email-accounts", needsNav: true, point: [{ sel: "main table" }, H1],
    title: "Tus buzones",
    text: "Aquí conectas los buzones que envían: Gmail, Outlook o cualquier SMTP. Cuantos más buzones, más correos al día sin forzar ninguno.",
  },
  {
    id: "buzon-anadir", chapter: "buzones", route: "/email-accounts", needsNav: true,
    actions: [
      { do: "click", target: [{ sel: "main button.soft-primary", text: /^Añadir cuenta/ }], safe: "accounts-add-open", skipIf: [{ sel: DIALOG, text: /Añadir cuenta de email/ }] },
      { do: "wait", ms: 500 },
    ],
    point: [{ sel: DIALOG, text: /Añadir cuenta de email/ }],
    title: "Añadir un buzón",
    text: "Puedes conectar uno a uno, o cientos de golpe con un CSV (Bulk connect). Te enseño el formulario; no conecto nada.",
  },
  {
    id: "buzon-smtp", chapter: "buzones", route: "/email-accounts", needsNav: true,
    actions: [
      { do: "click", target: [{ sel: `${DIALOG} button[aria-pressed]`, text: /Conectar una cuenta/ }], safe: "accounts-single", skipIf: [{ sel: `${DIALOG} #acc-email` }] },
      { do: "wait", ms: 300 },
      { do: "click", target: [{ sel: `${DIALOG} button`, text: /^\s*SMTP\s*$/ }], safe: "accounts-provider", skipIf: [{ sel: `${DIALOG} #acc-email` }] },
      { do: "wait", ms: 400 },
      { do: "type", target: [{ sel: `${DIALOG} #acc-email` }], safe: "accounts-email", text: "tu@tuempresa.com", cps: 30 },
    ],
    point: [{ sel: `${DIALOG} #acc-smtp-host`, up: 2 }, { sel: DIALOG }],
    title: "Los datos de conexión",
    text: "Con Gmail u Outlook solo pones el correo y una contraseña de aplicación. Con SMTP pones el servidor de salida (SMTP) y el de entrada (IMAP): el primero envía y el segundo trae las respuestas a tu Unibox.",
  },
  {
    id: "buzon-limite", chapter: "buzones", route: "/email-accounts", needsNav: true,
    point: [{ sel: `${DIALOG} #acc-limit`, up: 1 }, { sel: DIALOG }],
    title: "Límite diario y warm-up",
    text: "Cada buzón tiene su límite diario. El warm-up lo calienta solo: intercambia correos con otros buzones reales para que los proveedores confíen en él. Empieza con 15-30 al día y sube poco a poco.",
  },
  {
    id: "buzon-cerrar", chapter: "buzones", route: "/email-accounts", needsNav: true,
    actions: [CLOSE_DIALOG, { do: "wait", ms: 300 }],
    point: [{ sel: "main table" }, H1],
    title: "Cerrado sin guardar",
    text: "Cierro sin guardar. Cuando conectes tus buzones, en esta tabla verás su estado, el warm-up, lo enviado hoy y si alguno tiene un problema de conexión (se reintenta solo).",
  },

  /* ── Leads ── */
  {
    id: "leads", chapter: "leads", route: "/leads", needsNav: true, point: [{ sel: "main label", text: /CSV/ }, H1],
    title: "Tus leads",
    text: "Tu base de contactos, ordenada en carpetas. Subes un CSV y cada columna se convierte en una variable para tus correos. Después los metes en las campañas que quieras.",
  },
  {
    id: "lead-anadir", chapter: "leads", route: "/leads", needsNav: true,
    actions: [
      { do: "click", target: [{ sel: "main button", text: /Añadir\s*Lead/ }], safe: "leads-add-open", skipIf: [{ sel: DIALOG, text: /Añadir lead/ }] },
      { do: "wait", ms: 400 },
      { do: "type", target: [{ sel: `${DIALOG} input[placeholder="lead@empresa.com"]` }], safe: "leads-email", text: "ana@empresa.com", cps: 30 },
    ],
    point: [{ sel: DIALOG, text: /Añadir lead/ }],
    title: "Un lead a mano",
    text: "También puedes añadir leads uno a uno: email, nombre, empresa y carpeta. No lo guardo, es solo para que lo veas.",
  },
  {
    id: "lead-bloquear", chapter: "leads", route: "/leads", needsNav: true,
    actions: [CLOSE_DIALOG, { do: "wait", ms: 300 }],
    point: [{ sel: "main button", text: /Eliminar\/bloquear|Eliminar/ }, H1],
    title: "Verificar y bloquear",
    text: "Verifica tus leads antes de enviar para no rebotar, y bloquea correos o dominios enteros (competencia, clientes actuales…): nunca recibirán nada de ninguna campaña.",
  },

  /* ── Unibox ── */
  {
    id: "unibox", chapter: "unibox", route: "/unibox", needsNav: true, point: [{ sel: '[data-tour="unibox-filters"]' }, H1],
    title: "Unibox: todas tus respuestas",
    text: "Las respuestas de todos tus buzones llegan aquí, y la IA las clasifica sola: Interesados, Preguntas, No interesados, No contactar, Fuera / Auto… Respondes desde aquí sin abrir cada buzón.",
    phoneText: "En el móvil, el Unibox es la app de Funnyleads (la abres desde «Unibox» en el menú): todas las respuestas de tus buzones, clasificadas solas por la IA (Interesados, Preguntas, No interesados, Fuera / Auto…), y respondes desde ahí. Puedes instalarla en la pantalla de inicio.",
  },
  {
    id: "unibox-filtro", chapter: "unibox", route: "/unibox", needsNav: true,
    actions: [
      { do: "click", target: [{ sel: '[data-tour="unibox-filters"] button', text: /^Interesados/ }], safe: "unibox-filter" },
      { do: "wait", ms: 600 },
    ],
    point: [{ sel: '[data-tour="unibox-filters"]' }],
    title: "Filtra por lo que importa",
    text: "Pulsa «Interesados» y ves solo a quien quiere hablar contigo. Cuando entra uno, te avisamos al momento (también en el móvil si activas las notificaciones).",
  },
  {
    id: "unibox-responder", chapter: "unibox", route: "/unibox", needsNav: true,
    actions: [
      { do: "click", target: [{ sel: '[data-tour="unibox-filters"] button', text: /^Todos/ }], safe: "unibox-filter" },
      { do: "wait", ms: 400 },
    ],
    point: [{ sel: "main button", text: /Carpeta/ }, H1],
    title: "Responder y organizar",
    text: "Al abrir una conversación ves todo el hilo y respondes desde el mismo buzón, con la firma. Si tienes un agente de IA, te deja un borrador listo para revisar. Y con «+ Carpeta» organizas como quieras.",
  },

  /* ── Agentes IA ── */
  {
    id: "agentes", chapter: "agentes", route: "/ai-prompts", needsNav: true, point: [H1],
    title: "Agentes IA",
    text: "Un agente contesta a tus leads por ti, con tu objetivo y tu tono. Puede dejarte borradores para revisar o responder solo.",
  },
  {
    id: "agente-crear", chapter: "agentes", route: "/ai-prompts", needsNav: true,
    actions: [
      { do: "escape" },
      // El botón directo (pantalla vacía o tarjeta «Crear agente»); si no, el de arriba, que abre un
      // menú y ahí «Agente de respuestas».
      {
        do: "click", safe: "agent-create-open", skipIf: [{ sel: "main nav button", text: /^Objetivo y alcance$/ }],
        target: [{ sel: "main section[data-fit-scale] button", text: /Crear agente/ }, { sel: "main button.border-dashed", text: /^Crear agente/ }, { sel: "main button", text: /^Crear agente$/ }],
      },
      { do: "wait", ms: 400 },
      { do: "click", target: [{ sel: '[role="menuitem"]', text: /^Agente de respuestas/ }], safe: "agent-kind", optional: true, skipIf: [{ sel: "main nav button", text: /^Objetivo y alcance$/ }] },
      { do: "wait", ms: 600 },
    ],
    point: [{ sel: "main nav", up: 1 }],
    title: "El editor del agente",
    text: "Se configura por apartados. Primero, el objetivo: conseguir una reunión, resolver dudas, cualificar… y a qué respuestas se aplica (toda la cuenta, unas campañas o unos buzones).",
  },
  {
    id: "agente-categorias", chapter: "agentes", route: "/ai-prompts", needsNav: true,
    actions: [{ do: "click", target: [{ sel: "main nav button", text: /^Categorías de lead$/ }], safe: "agent-section" }, { do: "wait", ms: 300 }],
    point: [{ sel: "main nav", up: 1 }],
    title: "A qué categorías responde",
    text: "Eliges a qué respuestas contesta: solo a los interesados, también a las preguntas… Las demás las deja para ti.",
  },
  {
    id: "agente-modo", chapter: "agentes", route: "/ai-prompts", needsNav: true,
    actions: [{ do: "click", target: [{ sel: "main nav button", text: /^Modo de respuesta$/ }], safe: "agent-section" }, { do: "wait", ms: 300 }],
    point: [{ sel: "main nav", up: 1 }],
    title: "Borrador o automático",
    text: "En modo borrador te deja la respuesta escrita en el Unibox y tú la envías. En automático responde solo, con un retraso natural para que no parezca un robot.",
  },
  {
    id: "agente-tono", chapter: "agentes", route: "/ai-prompts", needsNav: true,
    actions: [{ do: "click", target: [{ sel: "main nav button", text: /^Tono y longitud$/ }], safe: "agent-section" }, { do: "wait", ms: 300 }],
    point: [{ sel: "main nav", up: 1 }],
    title: "Tono y contexto",
    text: "Le dices cómo hablar (cercano, formal…) y cuánto escribir, y en «Contexto y guía» le cuentas qué vendes, precios y preguntas frecuentes. Cuanto más contexto, mejores respuestas.",
  },
  {
    id: "agente-salir", chapter: "agentes", route: "/ai-prompts", needsNav: true,
    actions: [{ do: "click", target: [{ sel: 'main button[aria-label="Volver"]' }], safe: "agent-back" }, { do: "wait", ms: 400 }],
    point: [H1],
    title: "Salgo sin guardar",
    text: "Salgo sin guardar. Cuando crees el tuyo, con «Guardar» queda activo y aparece en esta lista, donde puedes pausarlo o ver su actividad.",
  },

  /* ── Personalización ── */
  {
    id: "personalizacion", chapter: "personalizacion", route: "/personalizacion", needsNav: true,
    point: [{ sel: "main span", text: /^1\. Sube tu CSV de leads$/, up: 2 }, H1],
    title: "Personalización con IA",
    text: "Subes una lista, escribes un prompt con sus {columnas} y la IA escribe un mensaje distinto para cada lead a partir de su web y su empresa.",
  },
  {
    id: "personalizacion-uso", chapter: "personalizacion", route: "/personalizacion", needsNav: true,
    point: [{ sel: "main span", text: /^¿Cómo funciona\?$/, up: 2 }, H1],
    title: "Y luego, a la campaña",
    text: "Cuando termina, descargas el CSV o lo mandas directamente a una campaña. El texto entra en tus correos con {{personalized_message}}: un párrafo único por lead, sin escribirlo tú.",
  },

  /* ── Entregabilidad ── */
  {
    id: "entregabilidad", chapter: "entregabilidad", route: "/deliverability", needsNav: true,
    actions: [{ do: "click", target: [{ sel: "main button[aria-pressed]", text: /Copy de una campaña/ }], safe: "deliv-mode" }, { do: "wait", ms: 300 }],
    point: [{ sel: "main button[aria-pressed]", text: /Copy de una campaña/, up: 1 }, H1],
    title: "¿Llega a la bandeja principal?",
    text: "Antes de lanzar, envías tu correo (de una campaña o pegado) a buzones de prueba y te decimos si cae en principal, promociones o spam, y qué tocar si algo falla.",
  },

  /* ── Estadísticas ── */
  {
    id: "estadisticas", chapter: "estadisticas", route: "/stats", needsNav: true, point: [{ sel: "main section[data-fit-scale]" }, H1],
    title: "Estadísticas",
    text: "La foto completa: envíos, respuestas, interesados y reuniones por día, por campaña y por buzón. Puedes elegir una campaña concreta o verlas todas juntas.",
  },

  /* ── Funny Team ── */
  {
    id: "funny-team", chapter: "funny-team", route: "/funny-team", needsNav: true, point: [{ sel: 'main [aria-label="Elige día y hora"]' }, H1],
    title: "Funny Team",
    text: "¿Quieres que te ayudemos en persona? Elige día y hora y reservas una videollamada de 15 minutos con el equipo. Déjanos una nota con lo que quieres ver.",
  },

  /* ── Tu cuenta y plan ── */
  {
    id: "plan", chapter: "cuenta", route: "/settings",
    actions: [{ do: "click", target: [{ sel: 'main [role="tab"]', text: /^Plan$/ }], safe: "settings-tab" }, { do: "wait", ms: 400 }],
    point: [{ sel: 'main [role="tabpanel"] > :first-child' }, { sel: 'main [role="tabpanel"]' }, H1],
    title: "Tu plan",
    text: "Aquí ves tu plan, lo que llevas usado este mes y cuándo se renueva. Desde aquí cambias de plan o gestionas el pago (yo no toco nada de eso).",
  },
  {
    id: "perfil", chapter: "cuenta", route: "/settings",
    actions: [{ do: "click", target: [{ sel: 'main [role="tab"]', text: /^Perfil$/ }], safe: "settings-tab" }, { do: "wait", ms: 300 }],
    point: [{ sel: 'main [role="tabpanel"]' }, H1],
    title: "Tu perfil",
    text: "Tu nombre, tu empresa y tu correo de contacto. Y en «Envío», cómo se espacian los correos entre sí.",
  },

  /* ── Atajos ── */
  {
    id: "buscar", chapter: "atajos", route: "/dashboard", desktopOnly: true,
    actions: [{ do: "type", target: [{ sel: 'input[placeholder="Buscar campañas, leads, correos..."]' }], safe: "search-input", text: "ejemplo", cps: 14 }, { do: "wait", ms: 700 }],
    point: [{ sel: 'input[placeholder="Buscar campañas, leads, correos..."]', up: 1 }],
    title: "El buscador",
    text: "Encuentra al momento cualquier campaña, lead o correo. Mira: escribo «ejemplo» y sale tu campaña de ejemplo.",
  },
  {
    id: "notificaciones", chapter: "atajos", route: "/dashboard",
    actions: [
      { do: "type", target: [{ sel: 'input[placeholder="Buscar campañas, leads, correos..."]' }], safe: "search-input", text: "", cps: 40, blur: true },
      { do: "escape" },
      { do: "click", target: [{ sel: 'button[aria-label="Notificaciones"]' }], safe: "notifications" },
      { do: "wait", ms: 400 },
    ],
    point: [{ sel: "[data-radix-popper-content-wrapper]" }, { sel: 'button[aria-label="Notificaciones"]' }],
    title: "Avisos",
    text: "Activa las notificaciones y te avisamos al momento de cada lead interesado, también en el móvil.",
  },
  {
    id: "cuenta-menu", chapter: "atajos", route: "/dashboard",
    actions: [
      { do: "escape" },
      { do: "click", target: [{ sel: 'button[aria-label="Cuenta"]' }], safe: "account-menu" },
      { do: "wait", ms: 400 },
    ],
    point: [{ sel: "button", text: /Ver el tutorial/ }, { sel: "[data-radix-popper-content-wrapper]" }],
    title: "Repetir el tutorial",
    text: "En el menú de tu cuenta tienes «Ver el tutorial» para repasarlo cuando quieras, además de tu perfil y tus clientes.",
  },
  {
    id: "funnybot", chapter: "atajos", route: "/dashboard",
    actions: [
      { do: "escape" },
      { do: "click", target: [{ sel: 'button[aria-label^="Abrir el"]' }], safe: "chat-open", skipIf: [{ sel: '[role="dialog"][aria-label="Asistente IA"]' }] },
      { do: "wait", ms: 600 },
    ],
    point: [{ sel: '[role="dialog"][aria-label="Asistente IA"]' }, { sel: 'button[aria-label^="Abrir el"]' }],
    title: "FunnyBot, siempre a mano",
    text: "Desde este chat me preguntas lo que quieras, me pides que analice tus campañas o hablas directamente con el equipo. En modo edición puedo cambiar tus campañas, siempre enseñándote antes el cambio.",
    missing: "Desde el botón de chat de abajo a la derecha me preguntas lo que quieras o hablas con el equipo.",
  },

  /* ── Fin ── */
  {
    id: "fin", chapter: "fin", route: "/dashboard",
    actions: [{ do: "click", target: [{ sel: '[aria-label="Asistente IA"] button[aria-label="Cerrar"]' }], safe: "chat-close", optional: true }],
    point: [],
    title: "¡Listo! Ya vas por libre",
    text: "Ya lo has visto todo. Tu camino: conecta un buzón, deja que caliente unos días, importa tus leads, escribe tu secuencia y lanza. Si quieres repasar algo, «Ver el tutorial» está en el menú de tu cuenta.",
  },
];

/* ── Tiempos ─────────────────────────────────────────────────────────────────────────────── */

/** Lo que tarda en leerse un texto, para el modo automático (mín. 4 s). */
export function readingMs(text: string): number {
  return Math.max(4000, Math.round(text.length * 55) + 1500);
}

/** Minutos aproximados del recorrido (para la pregunta inicial). */
export function tourMinutes(steps: TourStep[] = TOUR_STEPS): number {
  const ms = steps.reduce((s, st) => {
    const typing = (st.actions || []).reduce((t, a) => t + (a.do === "type" ? (a.text.length * 1000) / (a.cps || TYPE_CPS) : a.do === "click" ? 900 : 0), 0);
    return s + readingMs(st.text) + typing + 1500;
  }, 0);
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

/** Lo que tapan dos rectángulos a la vez (en px²). */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Lado donde se pone Funny con su bocadillo (abajo a la izquierda o a la derecha): el que menos
 *  tape lo señalado. A igualdad, la izquierda. */
export function dockSide(r: Box | null, vw: number, vh: number, bubble = { w: 530, h: 310 }): "left" | "right" {
  if (!r) return "left";
  const top = vh - 24 - bubble.h;
  const left = overlapArea(r, { left: 24, top, width: bubble.w, height: bubble.h });
  const right = overlapArea(r, { left: vw - 24 - bubble.w, top, width: bubble.w, height: bubble.h });
  return right < left ? "right" : "left";
}

/** Siguiente / anterior sin salirse. */
export function clampStep(i: number, steps: TourStep[] = TOUR_STEPS): number {
  return Math.max(0, Math.min(steps.length - 1, i));
}

/** Primer paso de cada capítulo (para el menú de capítulos). */
export function chapterStarts(steps: TourStep[] = TOUR_STEPS): { chapter: TourChapter; index: number }[] {
  const out: { chapter: TourChapter; index: number }[] = [];
  for (const c of TOUR_CHAPTERS) {
    const i = steps.findIndex((s) => s.chapter === c.id);
    if (i >= 0) out.push({ chapter: c, index: i });
  }
  return out;
}

/** El selector de un objetivo con la campaña de ejemplo puesta (o null si hace falta y no hay). */
export function resolveSel(sel: string, campaignId: string | null): string | null {
  if (!sel.includes("{campaign}")) return sel;
  if (!campaignId || !/^[0-9a-f-]{36}$/i.test(campaignId)) return null;
  return sel.split("{campaign}").join(campaignId);
}

/** ¿Este paso trabaja sobre la campaña de ejemplo? */
export function needsCampaign(step: TourStep): boolean {
  return !!step.campaign && step.campaign !== "list";
}

/* ── Recordar el recorrido (para seguir tras recargar o salir) ───────────────────────────── */

export const TOUR_RUN_KEY = "fl_tour_run_v2";
/** Más tiempo que esto sin tocarlo y ya no se ofrece seguir. */
export const TOUR_RUN_TTL_MS = 3 * 60 * 60 * 1000;

export interface TourRun { index: number; stepId?: string; campaignId: string | null; at: number }

type MiniStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): MiniStorage | null => { try { return window.sessionStorage; } catch { return null; } };

export function saveTourRun(run: TourRun, s: MiniStorage | null = store()): void {
  try { s?.setItem(TOUR_RUN_KEY, JSON.stringify(run)); } catch { /* sin almacenamiento */ }
}
export function readTourRun(now = Date.now(), s: MiniStorage | null = store()): TourRun | null {
  try {
    const raw = s?.getItem(TOUR_RUN_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (typeof j?.index !== "number" || typeof j?.at !== "number") return null;
    if (now - j.at > TOUR_RUN_TTL_MS) return null;
    const campaignId = typeof j.campaignId === "string" && /^[0-9a-f-]{36}$/i.test(j.campaignId) ? j.campaignId : null;
    const stepId = typeof j.stepId === "string" ? j.stepId : undefined;
    return { index: Math.max(0, Math.floor(j.index)), stepId, campaignId, at: j.at };
  } catch { return null; }
}
export function clearTourRun(s: MiniStorage | null = store()): void {
  try { s?.removeItem(TOUR_RUN_KEY); } catch { /* nada */ }
}

/** Dónde seguir: por el id del paso (la lista cambia entre ordenador y móvil); si no, el número. */
export function resumeIndex(run: Pick<TourRun, "index" | "stepId"> | null, steps: TourStep[] = TOUR_STEPS): number {
  if (!run) return 0;
  if (run.stepId) {
    const i = steps.findIndex((s) => s.id === run.stepId);
    if (i >= 0) return i;
  }
  return clampStep(run.index, steps);
}

/** Evento global para abrir el tutorial desde cualquier sitio (menú de la cuenta, chip de seguir). */
export const OPEN_TOUR_EVENT = "funnyleads:open-tour";
export function openTour(detail?: { resume?: boolean; finish?: boolean }) {
  window.dispatchEvent(new CustomEvent(OPEN_TOUR_EVENT, { detail }));
}
