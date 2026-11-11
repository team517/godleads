import { Loader2, Plus, Trash2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { haceCuanto, type ChatConversation } from "@/lib/chat-hub-client";
import { AiTile, TeamStack } from "@/components/chatbot/chat-ui";

/* Pestaña "Mensajes" del chat: las conversaciones guardadas (con el Asistente IA y con el equipo),
   la más reciente arriba, y "Nueva conversación". Sustituye al antiguo panel de historial. */
export function ChatMessagesList({ conversations, currentId, unreadId, loading, isVisitor, onOpen, onNew, onDelete }: {
  conversations: ChatConversation[];
  currentId: string | null;
  /** Conversación con respuestas del equipo sin leer (se pinta en negrita). */
  unreadId: string | null;
  loading: boolean;
  isVisitor: boolean;
  onOpen: (c: ChatConversation) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Mensajes">
      <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
        <h2 className="font-display text-[22px] font-semibold tracking-tight text-[#0E1330] dark:text-foreground">Mensajes</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading && <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>}
        {!loading && conversations.length === 0 && (
          <p className="px-4 py-10 text-center text-[14px] text-slate-500 dark:text-muted-foreground">Todavía no tienes conversaciones. Empieza una nueva y te ayudamos.</p>
        )}
        <ul className="space-y-1.5">
          {!loading && conversations.map((c) => {
            const conEquipo = c.team_status === "open" || c.team_status === "closed";
            const sinLeer = unreadId === c.id;
            return (
              <li key={c.id} className={cn("group flex items-center gap-3 rounded-[18px] bg-white px-3 py-3 shadow-[0_1px_2px_rgba(20,10,80,.05)] ring-1 ring-[#EFEDF7] transition-colors hover:ring-[#DCD5FB] dark:bg-card dark:ring-border",
                c.id === currentId && "ring-[#CFC6FA]")}>
                <button type="button" onClick={() => onOpen(c)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {conEquipo ? <TeamStack size={26} online={c.team_status === "open"} /> : <AiTile size={40} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-[14.5px] text-[#0E1330] dark:text-foreground", sinLeer ? "font-bold" : "font-semibold")}>
                        {conEquipo ? "Equipo de Funnyleads" : "Asistente IA"}
                      </span>
                      <span className={cn("shrink-0 text-[12px]", sinLeer ? "font-semibold text-[#6E58F1]" : "text-slate-400")}>{haceCuanto(c.last_message_at)}</span>
                    </span>
                    <span className={cn("mt-0.5 block truncate text-[13.5px]", sinLeer ? "font-semibold text-[#0E1330] dark:text-foreground" : "text-slate-500 dark:text-muted-foreground")}>
                      {c.title || "Nueva conversación"}
                    </span>
                  </span>
                  {sinLeer ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#EF3B4C]" aria-label="Sin leer" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />}
                </button>
                {onDelete && (
                  <button type="button" onClick={() => onDelete(c.id)} aria-label="Borrar conversación"
                    className="rounded-lg p-1.5 text-slate-400 opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {isVisitor && !loading && conversations.length > 0 && (
          <p className="px-3 pt-3 text-center text-[12px] text-slate-400">Como visitante sólo se guarda tu conversación actual en este navegador.</p>
        )}
      </div>
      <div className="shrink-0 px-5 pb-3">
        <button type="button" onClick={onNew}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#6E58F1] text-[15px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(110,88,241,.55)] hover:bg-[#5F49E6]">
          <Plus className="h-[18px] w-[18px]" aria-hidden="true" /> Nueva conversación
        </button>
      </div>
    </div>
  );
}
