import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { landingTarget } from "@/lib/landing-links";

/* =============================================================================
   Landing pública de OnePulso.

   Es el archivo que exporta Claude Design (`public/landing/onepulso-landing.html`), servido
   TAL CUAL: no se toca ni un byte, así que lo que se ve es exactamente el diseño del
   propietario. Ese archivo es una página autocontenida que se desempaqueta sola y sustituye
   su propio documento, por eso vive en un marco a pantalla completa en vez de incrustarse.

   Lo único que se añade desde FUERA es el destino de sus botones: en el diseño apuntan a
   anclas de maqueta (#login, #signup, #demo…) y aquí llevan al acceso real de la aplicación.
   Las anclas de sección (#pricing, #faq…) siguen desplazando la página como en el diseño.

   Para cambiar la landing: sustituir el archivo y subir LANDING_VERSION.
   ========================================================================== */

const LANDING_VERSION = "2026-09-17";
const LANDING_SRC = `/landing/onepulso-landing.html?v=${LANDING_VERSION}`;

export default function Landing() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const prev = document.title;
    document.title = "OnePulso — Turn cold email into booked revenue";
    return () => { document.title = prev; };
  }, []);

  // El marco es del mismo origen, así que se puede escuchar su documento. El oyente va en el
  // objeto Document (no en <html>, que la página sustituye al desempaquetarse) y en captura,
  // para decidir antes que el propio enlace.
  const wire = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || (doc as any).__opWired) return;
    (doc as any).__opWired = true;
    doc.addEventListener("click", (e) => {
      if (e.defaultPrevented || (e as MouseEvent).button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      const target = landingTarget(a?.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      if (target.kind === "route") navigate(target.to);
      else window.location.href = target.to;
    }, true);
  }, [navigate]);

  return (
    <iframe
      ref={frameRef}
      src={LANDING_SRC}
      title="OnePulso"
      onLoad={wire}
      className="fixed inset-0 block h-[100dvh] w-full border-0 bg-[#8B6BFF]"
    />
  );
}
