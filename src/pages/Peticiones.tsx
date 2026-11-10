import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { CheckCircle2, Clock, Loader2, Mail, MessageSquare, RefreshCw, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { isAgencyAccount } from "@/lib/access";
import { callChatHub, fechaCorta, loadMessages, type StoredMessage } from "@/lib/chat-hub-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TeamAvatars } from "@/components/chatbot/TeamAvatars";
import { cn } from "@/lib/utils";

/* Peticiones (10-11-2026): lo que entra por el chatbot. Sólo el equipo (hello@, support@, equipo@,
   gestores y admins). "Peticiones" = quien ha pedido hablar con el equipo (con transcripción y
   estado); "Conversaciones" = últimas conversaciones de usuarios y visitantes. */

type Peticion = {
  id: string; name: string; email: string; company: string | null; phone: string | null; topic: string | null;
  message: string; transcript: { role: string; content: string; created_at?: string }[] | null;
  source: "visitor" | "user"; status: "new" | "contacted" | "closed"; handled_by: string | null;
  notified_at: string | null; notify_error: string | null; created_at: string; conversation_id: string | null; user_id: string | null;
};
type Conversacion = { id: string; user_id: string | null; visitor_id: string | null; title: string | null; mode: string; message_count: number; last_message_at: string };

const ESTADO: Record<Peticion["status"], { label: string; cls: string }> = {
  new: { label: "Nueva", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  contacted: { label: "Contactado", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  closed: { label: "Cerrada", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
};

export default function Peticiones() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { isAdmin, loading: subLoading } = useSubscription();
  const [tab, setTab] = useState<"peticiones" | "conversaciones">("peticiones");
  const [filtro, setFiltro] = useState<"" | "new" | "contacted" | "closed">("");
  const [peticiones, setPeticiones] = useState<Peticion[]>([]);
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [abierta, setAbierta] = useState<Peticion | null>(null);
  const [convAbierta, setConvAbierta] = useState<{ conv: Conversacion; messages: StoredMessage[] } | null>(null);
  const [cargandoConv, setCargandoConv] = useState(false);

  const esEquipo = isAgencyAccount(user?.email ?? null, !!profile.is_client_manager) || isAdmin;

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        callChatHub<{ requests: Peticion[] }>({ action: "list_requests", status: filtro || undefined }),
        (supabase as any).from("chat_conversations").select("id, user_id, visitor_id, title, mode, message_count, last_message_at").order("last_message_at", { ascending: false }).limit(200),
      ]);
      setPeticiones(r.requests || []);
      if (c.error) toast.error(`Conversaciones: ${c.error.message}`); else setConversaciones((c.data || []) as Conversacion[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar");
    } finally { setLoading(false); }
  }, [filtro]);

  useEffect(() => { if (esEquipo) void cargar(); }, [esEquipo, cargar]);

  const cambiarEstado = async (p: Peticion, status: Peticion["status"]) => {
    try {
      await callChatHub({ action: "update_request", id: p.id, status });
      setPeticiones((prev) => prev.map((x) => (x.id === p.id ? { ...x, status, handled_by: user?.email || null } : x)));
      if (abierta?.id === p.id) setAbierta({ ...abierta, status, handled_by: user?.email || null });
      toast.success(status === "contacted" ? "Marcada como contactada" : status === "closed" ? "Petición cerrada" : "Reabierta");
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo actualizar"); }
  };

  const abrirConversacion = async (conv: Conversacion) => {
    setCargandoConv(true);
    try { setConvAbierta({ conv, messages: await loadMessages(conv.id) }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo abrir"); }
    finally { setCargandoConv(false); }
  };

  const resumen = useMemo(() => ({
    nuevas: peticiones.filter((p) => p.status === "new").length,
    total: peticiones.length,
  }), [peticiones]);

  if (!subLoading && !esEquipo) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TeamAvatars size={36} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Peticiones del chat</h1>
            <p className="text-sm text-muted-foreground">Quién ha pedido hablar con el equipo y qué se habla con el asistente.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void cargar()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "peticiones"} onClick={() => setTab("peticiones")} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === "peticiones" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            Peticiones{resumen.nuevas > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10.5px] font-bold text-white">{resumen.nuevas}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "conversaciones"} onClick={() => setTab("conversaciones")} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === "conversaciones" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            Conversaciones
          </button>
        </div>
        {tab === "peticiones" && (
          <div className="ml-auto flex items-center gap-1 text-xs">
            {([["", "Todas"], ["new", "Nuevas"], ["contacted", "Contactadas"], ["closed", "Cerradas"]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setFiltro(v)} className={cn("rounded-full border px-2.5 py-1", filtro === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {tab === "peticiones" && (
        <div className={cn("grid gap-4", abierta ? "lg:grid-cols-[1fr_420px]" : "")}>
          <Card>
            <CardContent className="p-0">
              {loading && peticiones.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
              ) : peticiones.length === 0 ? (
                <div className="px-4 py-16 text-center text-sm text-muted-foreground">
                  <UsersRound className="mx-auto mb-2 h-6 w-6" />
                  Todavía nadie ha pedido hablar con el equipo{filtro ? " con ese estado" : ""}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2.5">Fecha</th><th className="px-4 py-2.5">Persona</th><th className="px-4 py-2.5">Empresa</th><th className="px-4 py-2.5">Qué necesita</th><th className="px-4 py-2.5">Origen</th><th className="px-4 py-2.5">Estado</th><th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {peticiones.map((p) => (
                        <tr key={p.id} className={cn("border-b last:border-0 hover:bg-muted/40", abierta?.id === p.id && "bg-primary/5")}>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fechaCorta(p.created_at)}</td>
                          <td className="px-4 py-3"><div className="font-medium">{p.name}</div><a href={`mailto:${p.email}`} className="text-xs text-primary hover:underline">{p.email}</a></td>
                          <td className="px-4 py-3">{p.company || <span className="text-muted-foreground">—</span>}</td>
                          <td className="max-w-[320px] truncate px-4 py-3" title={p.message}>{p.message}</td>
                          <td className="px-4 py-3"><Badge variant="outline" className="font-normal">{p.source === "visitor" ? "Visitante" : "Usuario"}</Badge></td>
                          <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ESTADO[p.status].cls)}>{ESTADO[p.status].label}</span></td>
                          <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAbierta(p)}>Ver</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {abierta && (
            <Card className="h-fit">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{abierta.name}</p>
                    <a href={`mailto:${abierta.email}`} className="text-sm text-primary hover:underline">{abierta.email}</a>
                    <p className="text-xs text-muted-foreground">{[abierta.company, abierta.phone].filter(Boolean).join(" · ") || (abierta.source === "visitor" ? "Visitante de la landing" : "Usuario con cuenta")}</p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setAbierta(null)} aria-label="Cerrar"><X className="h-4 w-4" /></Button>
                </div>
                <div className="rounded-lg border-l-[3px] border-primary bg-primary/5 px-3 py-2 text-sm whitespace-pre-wrap">{abierta.message}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> {new Date(abierta.created_at).toLocaleString("es-ES")}
                  {abierta.notified_at ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Mail className="h-3.5 w-3.5" /> aviso enviado a team@</span> : <span className="text-amber-700 dark:text-amber-300">aviso no enviado{abierta.notify_error ? `: ${abierta.notify_error}` : ""}</span>}
                  {abierta.handled_by && <span>· gestionada por {abierta.handled_by}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5" asChild><a href={`mailto:${abierta.email}?subject=${encodeURIComponent("Re: tu petición en Funnyleads")}`}><Mail className="h-3.5 w-3.5" /> Responder</a></Button>
                  {abierta.status !== "contacted" && <Button size="sm" variant="outline" onClick={() => void cambiarEstado(abierta, "contacted")}>Contactado</Button>}
                  {abierta.status !== "closed" && <Button size="sm" variant="outline" className="gap-1" onClick={() => void cambiarEstado(abierta, "closed")}><CheckCircle2 className="h-3.5 w-3.5" /> Cerrar</Button>}
                  {abierta.status === "closed" && <Button size="sm" variant="ghost" onClick={() => void cambiarEstado(abierta, "new")}>Reabrir</Button>}
                </div>
                {abierta.transcript && abierta.transcript.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lo que habló con el chat</p>
                    <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                      {abierta.transcript.map((m, i) => (
                        <div key={i} className={cn("rounded-lg px-2.5 py-1.5 text-[12.5px] whitespace-pre-wrap", m.role === "user" ? "ml-6 bg-primary/10" : "mr-6 bg-muted")}>
                          <span className="mr-1 text-[10px] font-semibold uppercase text-muted-foreground">{m.role === "user" ? "Persona" : "Chat"}</span>{m.content}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "conversaciones" && (
        <div className={cn("grid gap-4", convAbierta ? "lg:grid-cols-[1fr_460px]" : "")}>
          <Card>
            <CardContent className="p-0">
              {conversaciones.length === 0 ? (
                <div className="px-4 py-16 text-center text-sm text-muted-foreground"><MessageSquare className="mx-auto mb-2 h-6 w-6" /> Aún no hay conversaciones guardadas.</div>
              ) : (
                <ul className="divide-y">
                  {conversaciones.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => void abrirConversacion(c)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40", convAbierta?.conv.id === c.id && "bg-primary/5")}>
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.title || "Sin título"}</span>
                          <span className="block text-xs text-muted-foreground">{c.user_id ? "Usuario" : "Visitante"} · {c.mode === "edicion" ? "Modo edición" : c.mode === "visitante" ? "Landing" : "Conversación"} · {c.message_count} mensajes</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{fechaCorta(c.last_message_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {(convAbierta || cargandoConv) && (
            <Card className="h-fit">
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{convAbierta?.conv.title || "Conversación"}</p>
                    <p className="text-xs text-muted-foreground">{convAbierta ? `${convAbierta.conv.user_id ? "Usuario " + convAbierta.conv.user_id.slice(0, 8) : "Visitante"} · ${new Date(convAbierta.conv.last_message_at).toLocaleString("es-ES")}` : ""}</p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setConvAbierta(null)} aria-label="Cerrar"><X className="h-4 w-4" /></Button>
                </div>
                {cargandoConv ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div> : (
                  <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
                    {convAbierta?.messages.map((m, i) => (
                      <div key={m.id || i} className={cn("rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap", m.role === "user" ? "ml-8 bg-primary/10" : m.role === "system" ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" : "mr-8 bg-muted")}>
                        <span className="mr-1 text-[10px] font-semibold uppercase text-muted-foreground">{m.role === "user" ? "Persona" : m.role === "system" ? "Sistema" : m.via === "pulsebot" ? "FunnyBot" : m.via === "equipo" ? "Equipo" : "Chat"}</span>{m.content}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
