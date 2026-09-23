/**
 * ¿Hay que ofrecerle a este cliente activar los avisos del móvil, y de qué manera?
 *
 * Hasta el 23-09-2026 el ofrecimiento sólo salía si la app estaba INSTALADA en la pantalla de
 * inicio, así que un cliente que entra desde el navegador no lo veía nunca: 5 de 26 cuentas
 * tenían avisos. Ahora:
 *   · navegador con soporte (ordenador y Android) → se ofrece activar ahí mismo;
 *   · iPhone/iPad en una pestaña → no puede suscribirse, así que se explica cómo instalar la app;
 *   · ya concedido, ya denegado, aplazado o sin soporte → no se molesta a nadie.
 */
export type PushOffer = "hidden" | "ask" | "install";

export function pushOfferState(input: {
  supported: boolean;
  permission: NotificationPermission | "unknown";
  standalone: boolean;
  isIos: boolean;
  snoozedUntil?: number | null;
  now?: number;
}): PushOffer {
  const now = input.now ?? Date.now();
  if (input.snoozedUntil && now < input.snoozedUntil) return "hidden";
  // iPhone/iPad fuera de la app instalada: Safari no deja suscribirse, sólo cabe explicarlo.
  if (input.isIos && !input.standalone) return input.supported && input.permission === "granted" ? "hidden" : "install";
  if (!input.supported) return "hidden";
  // "granted" → ya está. "denied" → sólo se puede deshacer en los ajustes del navegador.
  return input.permission === "default" ? "ask" : "hidden";
}

/** iPhone o iPad (incluido el iPad que se hace pasar por Mac con pantalla táctil). */
export function isIosDevice(ua: string, maxTouchPoints = 0): boolean {
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && maxTouchPoints > 1;
}
