import { Loader2, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fechaCorta, type ChatConversation } from "@/lib/chat-hub-client";

/* Historial del chatbot (10-11-2026): lista de conversaciones anteriores, nueva conversación y
   cargar una para seguirla. */
export function ChatHistoryPanel({ conversations, currentId, loading, onOpen, onNew, onDelete, onClose }: {
  conversations: ChatConversation[];
  currentId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-card" aria-label="Historial de conversaciones">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">Historial</p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={onNew}><Plus className="h-3.5 w-3.5" /> Nueva</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Cerrar historial"><X className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading && <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</div>}
        {!loading && conversations.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">Todavía no hay conversaciones guardadas.</p>
        )}
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id} className={cn("group flex items-start gap-2 rounded-lg px-2.5 py-2 hover:bg-muted/70", c.id === currentId && "bg-primary/5 ring-1 ring-primary/20")}>
              <button type="button" onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{c.title || "Nueva conversación"}</span>
                  <span className="block text-[11px] text-muted-foreground">{fechaCorta(c.last_message_at)} · {c.message_count} mensajes{c.mode === "edicion" ? " · edición" : ""}</span>
                </span>
              </button>
              {onDelete && (
                <button type="button" onClick={() => onDelete(c.id)} aria-label="Borrar conversación" className="mt-0.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
