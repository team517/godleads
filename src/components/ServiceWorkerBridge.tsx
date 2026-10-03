import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { notificationTarget } from "@/lib/mobile-app";

/**
 * Al tocar una notificación con la app ya abierta, el service worker le pide que vaya a la
 * conversación ("open-url") en vez de recargar la página entera. Se contesta por el puerto del
 * mensaje: si nadie contesta (una versión vieja de la app), el service worker navega él mismo.
 */
export function ServiceWorkerBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (!d || d.type !== "open-url" || typeof d.url !== "string" || !d.url.startsWith("/")) return;
      try { e.ports?.[0]?.postMessage({ ok: true }); } catch { /* sin puerto */ }
      navigate(notificationTarget(d.url, pathRef.current));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

  return null;
}
