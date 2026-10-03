// Cuándo se abre la app del móvil (/m) en lugar del panel.
//
//  - App instalada en un teléfono (pantalla de inicio): SIEMPRE la app del móvil, sea cual sea la
//    ruta — en el móvil sólo se ve la Unibox y la cuenta.
//  - Navegador de un teléfono: la Unibox (/unibox) abre la app del móvil; el resto del panel
//    sigue accesible.
//  - Ordenador (aunque la ventana sea estrecha): nunca.
//  - Una cuenta de cliente sin la Unibox entre sus secciones: nunca.

export const MOBILE_APP_PATH = "/m";

/** ¿Es la app del móvil? (ojo: "/metrics" y "/modificaciones-ia" también empiezan por "/m") */
export function isMobileAppPath(pathname: string): boolean {
  return pathname === MOBILE_APP_PATH || pathname.startsWith(MOBILE_APP_PATH + "/");
}

export function isPhoneDevice(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  const narrow = window.matchMedia("(max-width: 767px)").matches;
  const touch = window.matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints || 0) > 0;
  return narrow && touch;
}

export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** ¿Puede esta cuenta ver la Unibox? (sin restricciones, o con /unibox entre sus secciones) */
export function uniboxAllowed(allowedRoutes: string[] | null | undefined): boolean {
  if (!allowedRoutes || allowedRoutes.length === 0) return true;
  return allowedRoutes.some((r) => r === "/unibox" || r.startsWith("/unibox"));
}

export function shouldOpenMobileApp(input: { pathname: string; phone: boolean; installed: boolean; allowed: boolean }): boolean {
  if (!input.phone || !input.allowed) return false;
  if (input.installed) return true;
  return input.pathname === "/unibox" || input.pathname.startsWith("/unibox/");
}

/** La dirección de la app del móvil que corresponde a una del panel (conserva ?c=<mensaje>). */
export function mobileAppUrl(search: string): string {
  const c = new URLSearchParams(search || "").get("c");
  return c ? `${MOBILE_APP_PATH}?c=${encodeURIComponent(c)}` : MOBILE_APP_PATH;
}

/** Lo que llega de una notificación ("/unibox?c=…") dentro de la app del móvil va a "/m?c=…". */
export function notificationTarget(url: string, currentPath: string): string {
  if (!isMobileAppPath(currentPath)) return url;
  try {
    const u = new URL(url, "https://x.invalid");
    if (u.pathname === "/unibox" || u.pathname === MOBILE_APP_PATH) return mobileAppUrl(u.search);
  } catch { /* url rara: tal cual */ }
  return url;
}
