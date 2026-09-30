// "Construyendo tu portal": la pantalla que ve quien termina la bienvenida. Cada paso hace algo
// de verdad: el primero guarda sus respuestas y los demás descargan de antemano el código de cada
// sección del panel, así que al entrar Leads, Campañas, Cuentas o el Unibox abren al instante.

export interface PasoPortal { id: string; label: string; run: () => Promise<unknown> }

/** Tiempo mínimo que se ve cada paso (para que se lea); si tarda más, se espera a que termine. */
export const PASO_MIN_MS = 850;

export const SECCIONES_PORTAL: Omit<PasoPortal, "run">[] = [
  { id: "leads", label: "Creando tu espacio de leads" },
  { id: "campaigns", label: "Creando tu espacio de campañas" },
  { id: "accounts", label: "Preparando tus cuentas de correo" },
  { id: "unibox", label: "Configurando tu Unibox" },
  { id: "stats", label: "Activando tus estadísticas" },
];

export const PRECARGAS: Record<string, () => Promise<unknown>> = {
  leads: () => import("@/pages/Leads"),
  campaigns: () => import("@/pages/Campaigns"),
  accounts: () => import("@/pages/EmailAccounts"),
  unibox: () => import("@/pages/Unibox"),
  stats: () => Promise.all([import("@/pages/Dashboard"), import("@/pages/Stats")]),
};

/** Los pasos en orden: guardar lo que ha contestado → cada sección → abrir el portal. */
export function pasosDelPortal(guardar: () => Promise<unknown>, precargas = PRECARGAS): PasoPortal[] {
  return [
    { id: "prefs", label: "Guardando tus preferencias", run: guardar },
    ...SECCIONES_PORTAL.map((s) => ({ ...s, run: precargas[s.id] || (() => Promise.resolve()) })),
    { id: "open", label: "Abriendo tu portal", run: () => Promise.resolve() },
  ];
}
