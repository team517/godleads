import { useEffect, useState, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { SparkMark } from "@/components/SparkMark";
import { isMobileAppPath, isPhoneDevice } from "@/lib/mobile-app";
import { lazyWithRetry } from "@/lib/lazy-retry";

/* El botón flotante de PulseBot, SIN el chat detrás.
 *
 * Antes <ColdEmailChatbot/> se montaba en todas las páginas y con él bajaban recharts,
 * react-markdown y framer-motion (+166 KB gz) aunque nadie abriera el chat. Ahora en cada
 * página sólo vive este botón (la misma marca, en el mismo sitio); el chat entero se baja al
 * primer clic (o, en ordenador, se calienta en la caché a los 5 s de reposo para que el clic
 * sea instantáneo). Una vez abierto, el chat se queda montado y conserva la conversación
 * exactamente como antes. */

const loadChatbot = () => import("@/components/ColdEmailChatbot").then((m) => ({ default: m.ColdEmailChatbot }));
const ColdEmailChatbot = lazyWithRetry(loadChatbot);

/** Dónde NO se pinta el botón: el lector de la Unibox vive abajo a la derecha (taparía
 *  "Responder"); la bienvenida son sólo cuatro preguntas; Modificaciones IA ya ES el chat de
 *  PulseBot; la app del móvil (/m) tiene su propia barra abajo. Pura — con prueba. */
export function chatbotHiddenAt(pathname: string): boolean {
  return pathname.startsWith("/unibox")
    || pathname.startsWith("/bienvenida")
    || pathname.startsWith("/modificaciones-ia")
    || isMobileAppPath(pathname);
}

/** Milisegundos de reposo antes de calentar el trozo del chat en ordenador. */
export const CHATBOT_WARM_DELAY_MS = 5_000;

function Bubble({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 chip-pop">
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => { void loadChatbot().catch(() => {}); }}
        onFocus={() => { void loadChatbot().catch(() => {}); }}
        aria-label="Preguntar a la IA de OnePulso"
        className="block rounded-[18px] shadow-[0_12px_28px_rgba(98,64,255,.28)] transition-transform hover:-translate-y-[2px]"
      >
        <SparkMark size={58} className="rounded-[18px]" />
      </button>
    </div>
  );
}

export function ChatbotLauncher() {
  const location = useLocation();
  const [mounted, setMounted] = useState(false);
  const hidden = chatbotHiddenAt(location.pathname);

  // Ordenador, en reposo: el trozo del chat se baja a la caché (no se monta) para que el primer
  // clic abra al instante. En el teléfono no: allí casi nadie abre el chat y los datos cuestan.
  useEffect(() => {
    if (mounted || hidden || isPhoneDevice()) return;
    const t = setTimeout(() => { void loadChatbot().catch(() => {}); }, CHATBOT_WARM_DELAY_MS);
    return () => clearTimeout(t);
  }, [mounted, hidden]);

  if (mounted) {
    // Mientras baja el trozo (primer clic) el botón sigue ahí; el chat decide por sí mismo si se
    // esconde en las rutas de arriba, igual que antes, sin perder la conversación.
    return (
      <Suspense fallback={hidden ? null : <Bubble onOpen={() => {}} />}>
        <ColdEmailChatbot initialOpen />
      </Suspense>
    );
  }
  if (hidden) return null;
  return <Bubble onOpen={() => setMounted(true)} />;
}
