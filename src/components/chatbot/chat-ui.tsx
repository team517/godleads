import type { ReactNode } from "react";
import { House, MessageSquareText, CircleHelp } from "lucide-react";
import { SparkMark } from "@/components/SparkMark";
import { TEAM_PHOTOS } from "@/components/chatbot/TeamAvatars";
import { cn } from "@/lib/utils";

/* Piezas comunes del chat flotante (rediseño 11-11-2026, calcado de las capturas del dueño):
   la baldosa blanca de la cabecera, el cuadrado lila de las burbujas, la pila de fotos con el punto
   verde, el degradado de la cabecera y la barra de abajo Inicio / Mensajes / Ayuda. */

/** Pantallas del chat: las tres de la barra de abajo y la conversación. */
export type ChatScreen = "home" | "messages" | "help" | "chat";

/** Degradado de la cabecera: índigo arriba a la izquierda → violeta → azul abajo. */
export const HEADER_GRADIENT =
  "radial-gradient(120% 90% at 78% 108%, rgba(86,156,255,.95) 0%, rgba(86,156,255,0) 52%), " +
  "radial-gradient(90% 80% at 105% 30%, rgba(146,92,255,.9) 0%, rgba(146,92,255,0) 60%), " +
  "linear-gradient(140deg, #2F1FCB 0%, #4B2FE0 42%, #6A45F0 100%)";

/** Baldosa blanca con la estrella (cabecera). */
export function HeaderTile({ size = 44 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center bg-white shadow-[0_4px_14px_rgba(20,10,80,.18)]"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}>
      <SparkMark variant="star" size={Math.round(size * 0.56)} />
    </span>
  );
}

/** Cuadrado lila con la estrella (avatar del Asistente IA en las burbujas y en Mensajes). */
export function AiTile({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center bg-[#F0EDFE] dark:bg-primary/15", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden="true">
      <SparkMark variant="star" size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Las tres fotos del equipo con borde blanco y el punto verde de "conectado" en la primera. */
export function TeamStack({ size = 36, online = true, border = "border-white" }: { size?: number; online?: boolean; border?: string }) {
  const overlap = Math.round(size * 0.12);
  const width = size * TEAM_PHOTOS.length - overlap * (TEAM_PHOTOS.length - 1);
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <div className="relative flex shrink-0 items-center" style={{ width, minWidth: width }} role="img" aria-label="Equipo de Funnyleads">
      {TEAM_PHOTOS.map((src, i) => (
        <img key={src} src={src} alt="" width={size} height={size} draggable={false}
          className={cn("rounded-full border-2 object-cover", border)}
          style={{ width: size, height: size, marginLeft: i === 0 ? 0 : -overlap, zIndex: 3 - i }} />
      ))}
      {online && (
        <span className="absolute rounded-full border-2 border-white bg-emerald-500"
          style={{ width: dot, height: dot, left: size - dot + 1, top: size - dot + 1, zIndex: 4 }} aria-hidden="true" />
      )}
    </div>
  );
}

/** La onda clara de abajo a la derecha de la cabecera. */
export function HeaderWave() {
  return (
    <svg aria-hidden="true" viewBox="0 0 400 200" preserveAspectRatio="none" className="pointer-events-none absolute bottom-0 right-0 h-[62%] w-[78%]">
      <path d="M0 200 C 90 170, 170 110, 260 92 C 320 80, 370 60, 400 34 L 400 200 Z" fill="rgba(255,255,255,.10)" />
      <path d="M90 200 C 170 176, 240 140, 310 128 C 350 121, 380 108, 400 96 L 400 200 Z" fill="rgba(255,255,255,.08)" />
    </svg>
  );
}

const TABS: { key: Exclude<ChatScreen, "chat">; label: string; icon: ReactNode }[] = [
  { key: "home", label: "Inicio", icon: <House className="h-5 w-5" strokeWidth={1.9} /> },
  { key: "messages", label: "Mensajes", icon: <MessageSquareText className="h-5 w-5" strokeWidth={1.9} /> },
  { key: "help", label: "Ayuda", icon: <CircleHelp className="h-5 w-5" strokeWidth={1.9} /> },
];

/** Barra fija de abajo: Inicio, Mensajes (con los no leídos del equipo) y Ayuda. */
export function ChatBottomTabs({ active, unread, onChange }: { active: ChatScreen; unread: number; onChange: (s: ChatScreen) => void }) {
  return (
    <nav className="grid shrink-0 grid-cols-3 border-t border-[#F1EFF8] bg-white px-5 pb-[9px] pt-[10px] dark:border-border dark:bg-card" aria-label="Secciones del chat">
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)} aria-current={on ? "page" : undefined}
            className={cn("relative mx-auto flex h-[52px] w-[92px] flex-col items-center justify-center gap-[3px] rounded-2xl text-[12.5px] font-semibold transition-colors",
              on ? "bg-[#F0EDFE] text-[#6E58F1] dark:bg-primary/15 dark:text-primary" : "text-slate-500 hover:text-slate-700 dark:text-muted-foreground dark:hover:text-foreground")}>
            <span className="relative">
              {t.icon}
              {t.key === "messages" && unread > 0 && (
                <span className="absolute -right-2.5 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#EF3B4C] px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-white dark:ring-card"
                  aria-label={`${unread} sin leer`}>
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
