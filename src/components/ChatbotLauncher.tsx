import { useEffect, useState, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { SparkMark } from "@/components/SparkMark";
import { isMobileAppPath, isPhoneDevice } from "@/lib/mobile-app";
import { lazyWithRetry } from "@/lib/lazy-retry";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalProfile } from "@/contexts/ProfileContext";
import { teamThread, teamUnread, visitorId } from "@/lib/chat-hub-client";
import { OPEN_CHATBOT } from "@/lib/chatbot-events";

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
    // Entrada de clientes de una agencia: es SU página, sin el asistente de Funnyleads.
    || pathname.startsWith("/acceso")
    || isMobileAppPath(pathname);
}

/** Milisegundos de reposo antes de calentar el trozo del chat en ordenador. */
export const CHATBOT_WARM_DELAY_MS = 5_000;

/** Cada cuánto se mira si el equipo ha respondido (sólo si hay un hilo abierto con él). */
export const LAUNCHER_UNREAD_POLL_MS = 30_000;

function Bubble({ onOpen, unread = 0 }: { onOpen: () => void; unread?: number }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 chip-pop">
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => { void loadChatbot().catch(() => {}); }}
        onFocus={() => { void loadChatbot().catch(() => {}); }}
        aria-label={unread > 0 ? `Abrir el chat: ${unread} respuesta(s) nueva(s) del equipo` : "Abrir el Asistente IA de Funnyleads"}
        className="relative block rounded-[18px] shadow-[0_12px_28px_rgba(98,64,255,.28)] transition-transform hover:-translate-y-[2px]"
      >
        <SparkMark size={58} className="rounded-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

export function ChatbotLauncher() {
  const location = useLocation();
  const [mounted, setMounted] = useState(false);
  const [unread, setUnread] = useState(0);
  const { user } = useAuth();
  // Las cuentas de cliente de una agencia no ven el asistente de Funnyleads (su soporte es su
  // agencia; "hablar con el equipo" llegaría a Funnyleads, no a ella).
  const clientLogin = !!useOptionalProfile()?.client_login_of;
  const hidden = chatbotHiddenAt(location.pathname) || clientLogin;

  // Chat en directo: si en este navegador hay un hilo abierto con el equipo, se mira cada 30 s si
  // han respondido, para poner el número en el botón aunque el chat no se haya abierto todavía.
  useEffect(() => {
    if (mounted || hidden) return;
    const uid = user?.id ?? null;
    if (!teamThread(uid)) return;
    let vivo = true;
    const tick = () => teamUnread(uid ? null : visitorId()).then((r) => { if (vivo) setUnread(r.unread || 0); }, () => { /* */ });
    void tick();
    const t = setInterval(() => void tick(), LAUNCHER_UNREAD_POLL_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [mounted, hidden, user?.id]);

  // «Pregunta a la IA» (barra de arriba): monta el chat abierto. Si ya está montado, lo abre él.
  useEffect(() => {
    if (mounted) return;
    const abrir = () => setMounted(true);
    window.addEventListener(OPEN_CHATBOT, abrir);
    return () => window.removeEventListener(OPEN_CHATBOT, abrir);
  }, [mounted]);

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
        <ColdEmailChatbot initialOpen initialUnread={unread} />
      </Suspense>
    );
  }
  if (hidden) return null;
  return <Bubble unread={unread} onOpen={() => setMounted(true)} />;
}
