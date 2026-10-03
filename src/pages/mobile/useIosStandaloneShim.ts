import { useLayoutEffect } from "react";
import { isIosDevice } from "@/lib/push-offer";
import { iosBottomShim, isInstalledApp } from "@/lib/mobile-app";

/**
 * iPhone, app instalada, barra de estado transparente: iOS pinta la app en TODA la pantalla pero
 * calcula la página (el 100 %, lo "fixed") con la altura de la pantalla MENOS la barra de estado.
 * Lo de abajo quedaba sin pintar: primero como un hueco y, al estirar sólo la capa de la app, como
 * una franja que cortaba la barra de abajo (lo "fixed" no se pinta fuera de esa página corta).
 *
 * Arreglo (el mismo que en openchamber #2287 / chokin-no-ouchi #5): se mide lo que falta, se
 * alarga el DOCUMENTO entero esa cantidad (clase m-shim + --m-shim en <html>) y la app pasa a
 * "absolute" dentro de él (ver mobile.css). Con el documento ya alargado, la ventana no debe
 * moverse: se devuelve arriba si iOS la desplaza (salvo con el teclado fuera).
 * En Android, en el navegador o con la barra de estado normal no hace nada.
 */
export function useIosStandaloneShim() {
  useLayoutEffect(() => {
    if (!isIosDevice(navigator.userAgent, navigator.maxTouchPoints || 0) || !isInstalledApp()) return;
    const html = document.documentElement;
    // Para leer env(safe-area-inset-top): con la barra de estado normal vale 0 y no hay recorte.
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);

    const keyboardOpen = () => {
      const vv = window.visualViewport;
      return !!vv && window.innerHeight - vv.height > 120;
    };
    const apply = () => {
      if (keyboardOpen()) return;
      const shim = iosBottomShim({
        safeTop: probe.getBoundingClientRect().height,
        portrait: window.matchMedia("(orientation: portrait)").matches,
        screenW: window.screen.width,
        screenH: window.screen.height,
        pageH: html.clientHeight || window.innerHeight,
      });
      if (shim > 0) {
        html.style.setProperty("--m-shim", `${shim}px`);
        html.classList.add("m-shim");
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      } else {
        html.classList.remove("m-shim");
        html.style.removeProperty("--m-shim");
      }
    };
    const onScroll = () => {
      if (html.classList.contains("m-shim") && !keyboardOpen() && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const later = () => window.setTimeout(apply, 60);

    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", later);
    window.addEventListener("pageshow", apply);
    document.addEventListener("visibilitychange", later);
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", later);
      window.removeEventListener("pageshow", apply);
      document.removeEventListener("visibilitychange", later);
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("scroll", onScroll);
      html.classList.remove("m-shim");
      html.style.removeProperty("--m-shim");
      probe.remove();
    };
  }, []);
}
