import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { landingIsPainted, landingTarget } from "@/lib/landing-links";
import { Wordmark } from "@/components/Wordmark";

/* =============================================================================
   Landing pública de OnePulso.

   Es el archivo que exporta Claude Design (`public/landing/onepulso-landing.html`), servido
   TAL CUAL: no se toca ni un byte, así que lo que se ve es exactamente el diseño del
   propietario. Ese archivo es una página autocontenida que se desempaqueta sola y sustituye
   su propio documento, por eso vive en un marco a pantalla completa en vez de incrustarse.

   Lo único que se añade desde FUERA:
   · el destino de sus botones: en el diseño apuntan a anclas de maqueta (#login, #signup,
     #demo…) y aquí llevan al acceso real. Las anclas de sección siguen desplazando la página.
   · la espera: mientras se desempaqueta, el archivo pinta una pantalla entera de color violeta
     (su "miniatura" de carga). El marco se mantiene oculto hasta que la página de verdad está
     pintada, y entretanto se ve el fondo claro de la propia landing con la marca.

   Para cambiar la landing: ver scripts/build-landing.mjs y subir LANDING_VERSION.
   ========================================================================== */

const LANDING_VERSION = "2026-09-17";
const LANDING_SRC = `/landing/onepulso-landing.html?v=${LANDING_VERSION}`;
/** Si algo impide detectar que está lista, se enseña igualmente pasado este tiempo. */
const SHOW_ANYWAY_MS = 12000;

export default function Landing() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = "OnePulso — Turn cold email into booked revenue";
    return () => { document.title = prev; };
  }, []);

  // Vigila el documento del marco hasta que la página real está pintada.
  useEffect(() => {
    if (ready) return;
    const started = Date.now();
    const t = window.setInterval(() => {
      let painted = false;
      try { painted = landingIsPainted(frameRef.current?.contentDocument); } catch { /* aún sin acceso */ }
      if (painted || Date.now() - started > SHOW_ANYWAY_MS) { window.clearInterval(t); setReady(true); }
    }, 80);
    return () => window.clearInterval(t);
  }, [ready]);

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
    <div className="fixed inset-0 bg-[#FBFAFE]">
      {/* Espera: el fondo de la propia landing y la marca, nada de pantallas de color. */}
      <div
        aria-hidden={ready}
        className={`absolute inset-0 flex flex-col items-center justify-center gap-5 transition-opacity duration-300 ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        <Wordmark className="h-8" colorClassName="text-[#6E58F1]" />
        <span className="block h-[3px] w-28 overflow-hidden rounded-full bg-[#EAE7F4]">
          <span className="skeleton-shimmer block h-full w-full rounded-full [background-image:linear-gradient(90deg,#EAE7F4_0%,#8B6BFF_45%,#EAE7F4_90%)]" />
        </span>
      </div>
      <iframe
        ref={frameRef}
        src={LANDING_SRC}
        title="OnePulso"
        onLoad={wire}
        className={`absolute inset-0 block h-[100dvh] w-full border-0 bg-[#FBFAFE] transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
