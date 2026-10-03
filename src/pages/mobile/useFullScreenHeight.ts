import { useLayoutEffect, type RefObject } from "react";
import { isIosDevice } from "@/lib/push-offer";
import { fullScreenHeightFix, isInstalledApp } from "@/lib/mobile-app";

/** Que la app ocupe toda la pantalla del iPhone (ver fullScreenHeightFix). */
export function useFullScreenHeight(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ios = isIosDevice(navigator.userAgent, navigator.maxTouchPoints || 0);
    const installed = isInstalledApp();
    if (!ios || !installed) return;
    const fit = () => {
      const h = fullScreenHeightFix({
        ios, installed,
        portrait: window.matchMedia("(orientation: portrait)").matches,
        screenW: window.screen.width, screenH: window.screen.height,
        // La altura que iOS le da a la página (la más corta de las dos que informa).
        innerH: Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight),
        visualH: window.visualViewport?.height ?? null,
      });
      if (h) { el.style.bottom = "auto"; el.style.height = `${h}px`; }
      else if (!(window.visualViewport && window.innerHeight - window.visualViewport.height > 120)) {
        el.style.bottom = ""; el.style.height = "";
      }
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [ref]);
}
