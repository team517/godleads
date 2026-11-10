import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Inbox, Loader2, Mail, RotateCcw, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { TeamAvatars } from "@/components/chatbot/TeamAvatars";
import { callChatHub, haceCuanto } from "@/lib/chat-hub-client";
import { cn } from "@/lib/utils";

/* Bandeja del equipo (10-11-2026), estilo Smartlead / Intercom: a la izquierda los chats con el
   equipo (no leídos en negrita), a la derecha el hilo entero —lo hablado antes con FunnyBot en gris—
   y la caja para responder. La respuesta le aparece al cliente en su chat al momento (y por correo
   si cerró la ventana). Sólo la agencia: chat-hub lo comprueba en el servidor. */

export type InboxConv = {
  id: string; user_id: string | null; visitor_id: string | null; title: string | null;
  team_status: "open" | "closed"; team_unread: number; user_unread: number; last_message_at: string;
  last_client_message_at: string | null; last_team_reply_at: string | null; contact_email: string | null;
  contact_name: string | null; page_url: string | null; team_opened_at: string | null;
  account_email: string | null; full_name: string | null; company: string | null;
  plan: { tier: string; status: string } | null;
  last_message: { role: string; content: string; via: string | null; created_at: string } | null;
};
type ThreadMsg = { id: string; role: "user" | "assistant" | "system"; content: string; via: string | null; author_name?: string | null; author_email?: string | null; created_at: string };

export const INBOX_REFRESH_MS = 5000;

/** Nombre que se enseña de un chat: contacto, nombre de la cuenta, correo, o "Visitante". */
export function nombreDelChat(c: Pick<InboxConv, "contact_name" | "full_name" | "contact_email" | "account_email" | "user_id">): string {
  return c.contact_name || c.full_name || c.contact_email || c.account_email || (c.user_id ? "Usuario" : "Visitante de la landing");
}

/** Vista previa del último mensaje ("Tú: …" si lo último lo escribió el equipo). */
export function vistaPrevia(m: InboxConv["last_message"]): string {
  if (!m) return "";
  const t = String(m.content || "").replace(/\s+/g, " ").trim();
  return m.via === "equipo" && m.role === "assistant" ? `Tú: ${t}` : t;
}

const iniciales = (s: string) => s.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function TeamInbox({ onUnread }: { onUnread?: (n: number) => void }) {
  const [filtro, setFiltro] = useState<"open" | "closed" | "all">("open");
  const [q, setQ] = useState("");
  const [convs, setConvs] = useState<InboxConv[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [hilo, setHilo] = useState<ThreadMsg[]>([]);
  const [cargandoHilo, setCargandoHilo] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const hiloRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await callChatHub<{ conversations: InboxConv[]; unread_total: number }>({ action: "team_inbox", status: filtro });
      setConvs(r.conversations || []);
      onUnread?.(r.unread_total || 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar los mensajes");
    } finally { setCargando(false); }
  }, [filtro, onUnread]);

  useEffect(() => {
    setCargando(true);
    void cargar();
    const t = window.setInterval(() => void cargar(), INBOX_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [cargar]);

  const cargarHilo = useCallback(async (id: string, silencioso = false) => {
    if (!silencioso) setCargandoHilo(true);
    try {
      const r = await callChatHub<{ messages: ThreadMsg[] }>({ action: "team_thread", conversation_id: id });
      setHilo((prev) => {
        const nuevo = r.messages || [];
        return prev.length === nuevo.length && prev.at(-1)?.id === nuevo.at(-1)?.id ? prev : nuevo;
      });
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, team_unread: 0 } : c)));
    } catch (e) {
      if (!silencioso) toast.error(e instanceof Error ? e.message : "No se pudo abrir el chat");
    } finally { if (!silencioso) setCargandoHilo(false); }
  }, []);

  useEffect(() => {
    if (!sel) return;
    void cargarHilo(sel);
    const t = window.setInterval(() => void cargarHilo(sel, true), INBOX_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [sel, cargarHilo]);

  useEffect(() => { const el = hiloRef.current; if (el) el.scrollTop = el.scrollHeight; }, [hilo.length, sel]);

  const visibles = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return convs;
    return convs.filter((c) => [nombreDelChat(c), c.contact_email, c.account_email, c.company, c.last_message?.content]
      .some((v) => String(v || "").toLowerCase().includes(n)));
  }, [convs, q]);

  const actual = convs.find((c) => c.id === sel) || null;

  const responder = async () => {
    const t = texto.trim();
    if (!t || !sel || enviando) return;
    setEnviando(true);
    try {
      const r = await callChatHub<{ message: ThreadMsg }>({ action: "team_reply", conversation_id: sel, message: t });
      setHilo((prev) => [...prev, r.message]);
      setTexto("");
      setConvs((prev) => prev.map((c) => (c.id === sel ? { ...c, team_status: "open", team_unread: 0, last_message: { role: "assistant", via: "equipo", content: t, created_at: r.message.created_at }, last_message_at: r.message.created_at } : c)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally { setEnviando(false); }
  };

  const cambiarEstado = async (accion: "team_close" | "team_reopen") => {
    if (!sel) return;
    try {
      await callChatHub({ action: accion, conversation_id: sel });
      toast.success(accion === "team_close" ? "Conversación cerrada" : "Conversación reabierta");
      void cargar(); void cargarHilo(sel, true);
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo cambiar"); }
  };

  return (
    <div className="grid h-[calc(100vh-220px)] min-h-[520px] overflow-hidden rounded-xl border bg-card lg:grid-cols-[340px_1fr]">
      {/* ── Lista de chats ── */}
      <aside className={cn("flex min-h-0 flex-col border-r", sel && "hidden lg:flex")}>
        <div className="space-y-2 border-b p-3">
          <div className="inline-flex w-full rounded-lg bg-muted p-0.5" role="tablist" aria-label="Filtrar chats">
            {([["open", "Abiertas"], ["closed", "Cerradas"], ["all", "Todas"]] as const).map(([v, l]) => (
              <button key={v} type="button" role="tab" aria-selected={filtro === v} onClick={() => setFiltro(v)}
                className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors", filtro === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="inbox-buscar" className="sr-only">Buscar chats</label>
            <Input id="inbox-buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, correo o texto" className="h-9 pl-8 text-sm" />
          </div>
        </div>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {cargando && convs.length === 0 && (
            <li className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</li>
          )}
          {!cargando && visibles.length === 0 && (
            <li className="px-4 py-12 text-center text-sm text-muted-foreground">
              <Inbox className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              {q ? "Ningún chat coincide con la búsqueda." : filtro === "open" ? "No hay chats abiertos. Cuando alguien escriba al equipo desde el chat, aparecerá aquí." : "No hay chats."}
            </li>
          )}
          {visibles.map((c) => {
            const nombre = nombreDelChat(c);
            const noLeidos = c.team_unread > 0;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setSel(c.id)}
                  className={cn("flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50", sel === c.id && "bg-primary/5")}>
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", c.user_id ? "bg-primary/15 text-primary" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300")}>
                    {iniciales(nombre)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm", noLeidos ? "font-bold text-foreground" : "font-medium")}>{nombre}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{haceCuanto(c.last_message_at)}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{c.user_id ? (c.company || c.account_email || "Usuario") : "Visitante"}{c.team_status === "closed" ? " · cerrada" : ""}</span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={cn("truncate text-[12.5px]", noLeidos ? "font-semibold text-foreground" : "text-muted-foreground")}>{vistaPrevia(c.last_message)}</span>
                      {noLeidos && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-primary-foreground">{c.team_unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ── Hilo ── */}
      <section className={cn("flex min-h-0 flex-col", !sel && "hidden lg:flex")}>
        {!actual ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <TeamAvatars size={40} />
            <p>Elige un chat para ver la conversación y responder.</p>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 px-2 lg:hidden" onClick={() => setSel(null)}>Atrás</Button>
                  <p className="truncate font-semibold">{nombreDelChat(actual)}</p>
                  <Badge variant="outline" className="font-normal">{actual.user_id ? "Usuario" : "Visitante"}</Badge>
                  {actual.plan?.tier && actual.plan.tier !== "free" && <Badge className="bg-primary/10 font-semibold capitalize text-primary hover:bg-primary/10">{actual.plan.tier}{actual.plan.status && actual.plan.status !== "active" ? ` · ${actual.plan.status}` : ""}</Badge>}
                  {actual.team_status === "closed" && <Badge variant="secondary">Cerrada</Badge>}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {(actual.contact_email || actual.account_email) && (
                    <a href={`mailto:${actual.contact_email || actual.account_email}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Mail className="h-3 w-3" aria-hidden="true" />{actual.contact_email || actual.account_email}</a>
                  )}
                  {actual.company && <span>{actual.company}</span>}
                  {actual.page_url && <span className="inline-flex items-center gap-1"><ExternalLink className="h-3 w-3" aria-hidden="true" />desde {actual.page_url}</span>}
                  {!actual.contact_email && !actual.account_email && <span>Sin correo: sólo verá la respuesta si vuelve al chat</span>}
                </p>
              </div>
              {actual.team_status === "open" ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void cambiarEstado("team_close")}><CheckCircle2 className="h-3.5 w-3.5" /> Cerrar</Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void cambiarEstado("team_reopen")}><RotateCcw className="h-3.5 w-3.5" /> Reabrir</Button>
              )}
            </header>

            <div ref={hiloRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/20 px-4 py-4">
              {cargandoHilo && hilo.length === 0 && <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>}
              {hilo.map((m) => {
                if (m.role === "system") {
                  return <div key={m.id} className="flex justify-center"><span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{m.content}</span></div>;
                }
                const delEquipo = m.role === "assistant" && m.via === "equipo";
                const delCliente = m.role === "user" && m.via === "cliente_equipo";
                const conBot = !delEquipo && !delCliente;
                return (
                  <div key={m.id} className={cn("flex", delEquipo ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                      delEquipo && "rounded-br-sm bg-primary text-primary-foreground",
                      delCliente && "rounded-bl-sm border bg-card",
                      conBot && "rounded-bl-sm bg-muted/70 text-[12.5px] text-muted-foreground",
                    )}>
                      {conBot && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider">{m.role === "user" ? "Con FunnyBot · cliente" : "FunnyBot"}</p>}
                      {delEquipo && m.author_name && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground/80">{m.author_name}</p>}
                      {m.content}
                      <p className={cn("mt-1 text-[10px]", delEquipo ? "text-primary-foreground/70" : "text-muted-foreground")}>{haceCuanto(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void responder(); }}>
              <label htmlFor="inbox-respuesta" className="sr-only">Respuesta</label>
              <Textarea
                id="inbox-respuesta"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void responder(); } }}
                placeholder={`Responder a ${nombreDelChat(actual)}… (Intro envía, Mayús+Intro salto de línea)`}
                className="min-h-[44px] flex-1 resize-none text-sm"
                rows={2}
              />
              <Button type="submit" className="h-11 gap-1.5" disabled={!texto.trim() || enviando}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
              </Button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
