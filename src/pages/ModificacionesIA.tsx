import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import html2canvas from "html2canvas";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowUp, Bot, Brain, Check, ChevronDown, Copy, Download, Loader2, MessageSquarePlus, Search, Sparkles, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SparkMark } from "@/components/SparkMark";
import {
  ESTADO_CAMBIO, ESTADO_CAMPANA, SUGERENCIAS, diaCorto, horaMensaje, nombreCliente, puedeVerIaMod,
  type IaCliente, type IaMensaje, type IaTarjeta, type VistaPaso,
} from "@/lib/ia-mod-view";

async function llamar<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ia-modificaciones", { body });
  if (error) {
    // El cuerpo del error trae el mensaje del servidor; si no, el genérico.
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export default function ModificacionesIA() {
  const { user } = useAuth();
  const [clientes, setClientes] = useState<IaCliente[] | null>(null);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<IaCliente | null>(null);
  const [mensajes, setMensajes] = useState<IaMensaje[]>([]);
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState("");
  const [cargando, setCargando] = useState(false);
  const [pensando, setPensando] = useState(false);
  const [texto, setTexto] = useState("");
  const [memoriaAbierta, setMemoriaAbierta] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  const permitido = puedeVerIaMod(user?.email);

  useEffect(() => {
    if (!permitido) return;
    llamar<{ clients: IaCliente[] }>({ action: "clients" })
      .then((r) => setClientes(r.clients))
      .catch((e) => { toast.error(e.message); setClientes([]); });
  }, [permitido]);

  const abrir = useCallback(async (c: IaCliente) => {
    setSel(c);
    setMensajes([]);
    setCargando(true);
    try {
      const r = await llamar<{ messages: IaMensaje[]; notes: string; changes: Record<string, string> }>({ action: "history", client_id: c.id });
      setMensajes(r.messages || []);
      setNotas(r.notes || "");
      setCambios(r.changes || {});
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [mensajes, pensando]);

  const enviar = async (contenido?: string) => {
    const t = (contenido ?? texto).trim();
    if (!t || !sel || pensando) return;
    setTexto("");
    const provisional: IaMensaje = { id: `tmp-${Date.now()}`, role: "user", content: t, cards: [], author_email: user?.email || null, created_at: new Date().toISOString() };
    setMensajes((m) => [...m, provisional]);
    setPensando(true);
    try {
      const r = await llamar<{ message: IaMensaje; changes: Record<string, string> }>({ action: "chat", client_id: sel.id, message: t });
      setMensajes((m) => [...m, r.message]);
      setCambios((c) => ({ ...c, ...(r.changes || {}) }));
      if ((r.message.cards || []).some((k) => k.type === "nota")) {
        llamar<{ notes: string }>({ action: "history", client_id: sel.id }).then((h) => setNotas(h.notes || "")).catch(() => {});
      }
    } catch (e: any) {
      toast.error(e.message || "La IA no ha podido responder");
      setMensajes((m) => m.filter((x) => x.id !== provisional.id));
      setTexto(t);
    } finally {
      setPensando(false);
    }
  };

  const accionCambio = async (change_id: string, action: "confirm" | "cancel" | "undo") => {
    if (!sel) return;
    try {
      const r = await llamar<{ status: string }>({ action, client_id: sel.id, change_id });
      setCambios((c) => ({ ...c, [change_id]: r.status }));
      toast.success(action === "confirm" ? "Hecho" : action === "undo" ? "Cambio deshecho" : "Cancelado");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const nuevaConversacion = async () => {
    if (!sel) return;
    try {
      await llamar({ action: "clear", client_id: sel.id });
      setMensajes([]);
      toast.success("Conversación nueva. La memoria del cliente se mantiene.");
    } catch (e: any) { toast.error(e.message); }
  };

  const guardarMemoria = async () => {
    if (!sel) return;
    try {
      await llamar({ action: "save_notes", client_id: sel.id, notes: notas });
      setMemoriaAbierta(false);
      toast.success("Memoria guardada");
    } catch (e: any) { toast.error(e.message); }
  };

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (clientes || []).filter((c) => !q || [c.company_name, c.full_name, c.email].some((v) => (v || "").toLowerCase().includes(q)));
  }, [clientes, busca]);

  if (!user) return null;
  if (!permitido) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="px-1">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" /> Modificaciones IA
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Elige un cliente y habla con PulseBot: ve sus campañas, mensajes, métricas y respuestas, y crea o cambia sus mensajes calcando los que mejor funcionan.
        </p>
      </div>

      <div className="flex h-[calc(100dvh-210px)] min-h-[520px] rounded-lg border bg-card overflow-hidden">
        {/* Clientes */}
        <aside className={`${sel ? "hidden md:flex" : "flex"} w-full md:w-[290px] flex-shrink-0 flex-col border-r bg-muted/20`}>
          <div className="p-3 border-b bg-card">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente…" className="pl-9 h-8 text-sm bg-muted/40 border-0 focus-visible:ring-1" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {clientes === null && (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            )}
            {clientes !== null && lista.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">No hay clientes</p>
            )}
            {lista.map((c) => {
              const activo = sel?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => abrir(c)}
                  className={`w-full text-left px-4 py-3 border-b border-border/30 border-l-2 transition-colors ${activo ? "bg-primary/8 border-l-primary" : "border-l-transparent hover:bg-muted/50"}`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-8 w-8 flex-shrink-0 rounded-md flex items-center justify-center text-[13px] font-semibold text-white"
                      style={{ background: c.brand_color || "#6E58F1" }}
                    >
                      {nombreCliente(c)[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{nombreCliente(c)}</span>
                      <span className="block text-xs text-muted-foreground truncate">{c.email}</span>
                    </span>
                    {c.active > 0 && (
                      <span className="flex-shrink-0 rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                        {c.active} activa{c.active === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Chat */}
        <section className={`${sel ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col`}>
          {!sel ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center"><Bot className="h-8 w-8 text-primary" /></div>
              <p className="text-[15px] font-medium text-foreground">Selecciona un cliente para empezar</p>
              <p className="text-xs max-w-sm">PulseBot entra en la información de su cuenta (sin tocar su sesión) y trabaja sólo sobre ese cliente.</p>
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button className="md:hidden text-muted-foreground" onClick={() => setSel(null)} aria-label="Volver a clientes"><X className="h-4 w-4" /></button>
                  <span className="h-9 w-9 flex-shrink-0 rounded-md flex items-center justify-center font-semibold text-white" style={{ background: sel.brand_color || "#6E58F1" }}>
                    {nombreCliente(sel)[0]?.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold truncate">{nombreCliente(sel)}</p>
                    <p className="text-xs text-muted-foreground truncate">{sel.email} · {sel.campaigns} campañas{sel.active ? ` · ${sel.active} activas` : ""}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMemoriaAbierta(true)}>
                    <Brain className="h-3.5 w-3.5" /> Memoria
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={nuevaConversacion} disabled={pensando || !mensajes.length}>
                    <MessageSquarePlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Nueva conversación</span>
                  </Button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 bg-muted/10">
                {cargando && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
                {!cargando && mensajes.length === 0 && (
                  <div className="mx-auto max-w-xl text-center space-y-4 pt-8">
                    <p className="text-[15px] text-muted-foreground">
                      Pregunta lo que quieras de <strong className="text-foreground">{nombreCliente(sel)}</strong> o pídele cambios. Lo que borre o meta en medio de una secuencia te lo pedirá confirmar, y todo cambio se puede deshacer.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {SUGERENCIAS.map((s) => (
                        <button key={s} onClick={() => enviar(s)} className="rounded-full border bg-card px-3 py-1.5 text-[13px] text-foreground/80 hover:border-primary/40 hover:text-primary transition-colors">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {mensajes.map((m) => (
                  <Burbuja key={m.id} m={m} cambios={cambios} onCambio={accionCambio} />
                ))}
                {pensando && (
                  <div className="flex items-start gap-3">
                    <Avatar />
                    <div className="rounded-lg border bg-card px-4 py-3 text-[14px] text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> PulseBot está mirando la cuenta y trabajando…
                    </div>
                  </div>
                )}
                <div ref={finRef} />
              </div>

              <div className="border-t bg-card p-3">
                <div className="flex items-end gap-2 rounded-lg border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-primary/40">
                  <Textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                    placeholder={`Escribe a PulseBot sobre ${nombreCliente(sel)}…`}
                    rows={1}
                    className="min-h-[40px] max-h-40 resize-none border-0 p-1 shadow-none focus-visible:ring-0 text-[15px]"
                    disabled={pensando}
                  />
                  <Button size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => enviar()} disabled={pensando || !texto.trim()} aria-label="Enviar">
                    {pensando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Intro para enviar · Mayús + Intro para salto de línea</p>
              </div>
            </>
          )}
        </section>
      </div>

      <Dialog open={memoriaAbierta} onOpenChange={setMemoriaAbierta}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Memoria de {sel ? nombreCliente(sel) : "este cliente"}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Lo que PulseBot debe recordar siempre de este cliente: qué vende, a quién, quién firma, su dato de resultado, su enlace de reserva, el tono… Él también la va completando cuando le cuentas cosas.
          </p>
          <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={10} placeholder="- Vende placas solares a naves industriales&#10;- Firma Simone&#10;- Dato: ahorran entre un 30 y un 40 % en la factura" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoriaAbierta(false)}>Cancelar</Button>
            <Button onClick={guardarMemoria}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Avatar() {
  return (
    <span className="h-8 w-8 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
      <Sparkles className="h-4 w-4 text-primary" />
    </span>
  );
}

function Burbuja({ m, cambios, onCambio }: { m: IaMensaje; cambios: Record<string, string>; onCambio: (id: string, a: "confirm" | "cancel" | "undo") => void }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2.5 text-[15px] text-primary-foreground whitespace-pre-wrap">
          {m.content}
          <p className="mt-1 text-[11px] opacity-70 text-right">{m.author_email?.split("@")[0]} · {horaMensaje(m.created_at)}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-3">
        {m.content && (
          <div className="rounded-lg border bg-card px-4 py-3 text-[15px] leading-relaxed">
            <div className="max-w-none [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-bold [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[13px] [&_pre]:my-2 [&_pre]:whitespace-pre-wrap [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-[13px]">
              <ReactMarkdown>{m.content}</ReactMarkdown>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">PulseBot · {horaMensaje(m.created_at)}</p>
          </div>
        )}
        {(m.cards || []).map((t, i) => <Tarjeta key={i} t={t} cambios={cambios} onCambio={onCambio} />)}
      </div>
    </div>
  );
}

function Tarjeta({ t, cambios, onCambio }: { t: IaTarjeta; cambios: Record<string, string>; onCambio: (id: string, a: "confirm" | "cancel" | "undo") => void }) {
  if (t.type === "metricas") return <TarjetaMetricas t={t} />;
  if (t.type === "mensajes") return <TarjetaMensajes t={t} />;
  if (t.type === "nota") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-card px-3 py-2 text-[13px] text-muted-foreground">
        <Brain className="h-3.5 w-3.5 text-primary" /> Guardado en la memoria: <span className="text-foreground">{t.texto}</span>
      </div>
    );
  }
  return <TarjetaCambio t={t} estado={cambios[t.change_id] || (t.type === "pendiente" ? "pending" : "applied")} onCambio={onCambio} />;
}

function Correo({ asunto, cuerpo, cabecera }: { asunto?: string; cuerpo?: string; cabecera?: string }) {
  return (
    <div className="rounded-md border bg-background">
      {cabecera && <p className="border-b px-3 py-1.5 text-[12px] font-medium text-muted-foreground">{cabecera}</p>}
      <div className="px-3 py-2.5">
        <p className="text-[13px]"><span className="text-muted-foreground">Asunto: </span>{asunto ? <strong className="font-semibold">{asunto}</strong> : <span className="italic text-muted-foreground">mismo hilo (Re: del primero)</span>}</p>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed">{cuerpo}</p>
      </div>
    </div>
  );
}

function TarjetaCambio({ t, estado, onCambio }: {
  t: Extract<IaTarjeta, { type: "cambio" | "pendiente" }>; estado: string; onCambio: (id: string, a: "confirm" | "cancel" | "undo") => void;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const [abierto, setAbierto] = useState(true);
  const hacer = async (a: "confirm" | "cancel" | "undo") => { setTrabajando(true); await onCambio(t.change_id, a); setTrabajando(false); };
  const color = estado === "applied" ? "border-success/30 bg-success/5" : estado === "pending" ? "border-warning/40 bg-warning/5" : "border-border bg-card";
  return (
    <div className={`rounded-lg border ${color} p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <button className="flex items-center gap-2 text-left text-[14px] font-medium min-w-0" onClick={() => setAbierto((v) => !v)}>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${abierto ? "" : "-rotate-90"}`} />
          <span className="truncate">{t.summary}</span>
        </button>
        <span className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${
          estado === "applied" ? "border-success/30 text-success" : estado === "pending" ? "border-warning/40 text-warning" : "text-muted-foreground"
        }`}>{ESTADO_CAMBIO[estado] || estado}</span>
      </div>
      {abierto && (
        <div className="space-y-2">
          {t.mensajes?.map((m) => (
            <Correo key={m.posicion} cabecera={`Mensaje ${m.posicion}${m.posicion > 1 ? ` · a los ${m.espera_dias} días` : ""}`} asunto={m.asunto} cuerpo={m.cuerpo} />
          ))}
          {t.cuerpo !== undefined && (
            <Correo
              cabecera={`${t.letra ? `Variante ${t.letra} · ` : ""}Mensaje ${t.posicion ?? ""}${t.espera_dias !== undefined && (t.posicion ?? 1) > 1 ? ` · a los ${t.espera_dias} días` : ""}`}
              asunto={t.asunto} cuerpo={t.cuerpo}
            />
          )}
          {t.aviso && <p className="text-[12px] text-muted-foreground">{t.aviso}</p>}
          {t.activa && estado === "applied" && <p className="text-[12px] text-muted-foreground">La campaña está activa: se usa desde el próximo envío.</p>}
        </div>
      )}
      <div className="flex gap-2">
        {estado === "pending" && (
          <>
            <Button size="sm" className="gap-1.5" disabled={trabajando} onClick={() => hacer("confirm")}>
              {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmar
            </Button>
            <Button size="sm" variant="outline" disabled={trabajando} onClick={() => hacer("cancel")}>Cancelar</Button>
          </>
        )}
        {estado === "applied" && (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={trabajando} onClick={() => hacer("undo")}>
            {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Deshacer
          </Button>
        )}
      </div>
    </div>
  );
}

function TarjetaMensajes({ t }: { t: Extract<IaTarjeta, { type: "mensajes" }> }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setAbierto((v) => !v)}>
        <span className="flex items-center gap-2 text-[14px] font-medium min-w-0">
          <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${abierto ? "" : "-rotate-90"}`} />
          <span className="truncate">{t.campaign_name}</span>
        </span>
        <span className="flex-shrink-0 text-[12px] text-muted-foreground">{ESTADO_CAMPANA[t.status] || t.status} · {t.steps.length} mensajes</span>
      </button>
      {abierto && t.steps.map((p: VistaPaso) => (
        <div key={p.step_id} className="space-y-2">
          <Correo cabecera={`Mensaje ${p.posicion}${p.posicion > 1 ? ` · a los ${p.espera_dias} días` : ""}`} asunto={p.asunto} cuerpo={p.cuerpo} />
          {p.variantes.map((v) => (
            <div key={v.letra} className="ml-4">
              <Correo cabecera={`Variante ${v.letra}${v.encendida ? "" : " · apagada"}`} asunto={v.asunto} cuerpo={v.cuerpo} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// "6.424" y no "6424": el español no agrupa los números de 4 cifras por defecto.
const fmt = (n: number) => Number(n || 0).toLocaleString("es-ES", { useGrouping: "always" } as unknown as Intl.NumberFormatOptions);

function TarjetaMetricas({ t }: { t: Extract<IaTarjeta, { type: "metricas" }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const datos = t.serie.map((d) => ({ dia: diaCorto(d.day), Envíos: d.sends, Respuestas: d.replies }));
  const tiles = [
    { k: `Envíos (${t.dias} días)`, v: fmt(t.totales.enviados_periodo) },
    { k: `Respuestas (${t.dias} días)`, v: fmt(t.totales.respuestas_periodo) },
    { k: "Contactados en total", v: fmt(t.totales.contactados) },
    { k: "Respuestas en total", v: fmt(t.totales.respuestas) },
    { k: "Tasa de respuesta", v: `${t.totales.tasa_respuesta.toLocaleString("es-ES")} %` },
    { k: "Interesados", v: fmt(t.totales.interesados) },
  ];

  const imagen = async (): Promise<Blob | null> => {
    if (!ref.current) return null;
    const canvas = await html2canvas(ref.current, { backgroundColor: "#FFFFFF", scale: 2, useCORS: true });
    return await new Promise((r) => canvas.toBlob((b) => r(b), "image/png"));
  };
  const descargar = async () => {
    setOcupado(true);
    try {
      const b = await imagen();
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `metricas-${t.titulo.replace(/[^\w-]+/g, "-").toLowerCase()}-${t.dias}d.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally { setOcupado(false); }
  };
  const copiar = async () => {
    setOcupado(true);
    try {
      const b = await imagen();
      if (!b) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
      toast.success("Imagen copiada: pégala donde quieras");
    } catch {
      toast.error("Tu navegador no deja copiar imágenes; usa Descargar");
    } finally { setOcupado(false); }
  };

  return (
    <div className="space-y-2">
      {/* Lo que va dentro de ref es la "foto": colores fijos para que salga igual en tema oscuro. */}
      <div ref={ref} className="rounded-lg border border-[#E6E1F5] bg-white p-5 text-[#1B1535] max-w-[720px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-wide text-[#6E58F1]">Métricas · últimos {t.dias} días</p>
            <p className="mt-0.5 font-display text-[20px] font-semibold tracking-[-0.02em]">{t.titulo}</p>
            <p className="text-[13px] text-[#6B6485]">{t.subtitulo}</p>
          </div>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#6E58F1]"><SparkMark className="h-4 w-4" /> OnePulso</span>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {tiles.map((x) => (
            <div key={x.k} className="rounded-md border border-[#EEEAF8] bg-[#FBFAFE] px-3 py-2">
              <p className="text-[11px] text-[#6B6485]">{x.k}</p>
              <p className="text-[19px] font-semibold tabular-nums">{x.v}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEEAF8" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#6B6485" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="e" tick={{ fontSize: 11, fill: "#6B6485" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#6B6485" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="e" dataKey="Envíos" fill="#C9BEFA" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar yAxisId="r" dataKey="Respuestas" fill="#6E58F1" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {t.campanas.length > 0 && (
          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="text-left text-[#6B6485]">
                <th className="py-1 font-medium">Campaña</th>
                <th className="py-1 font-medium text-right">Envíos {t.dias}d</th>
                <th className="py-1 font-medium text-right">Resp. {t.dias}d</th>
                <th className="py-1 font-medium text-right">Tasa total</th>
                <th className="py-1 font-medium text-right">Interesados</th>
              </tr>
            </thead>
            <tbody>
              {t.campanas.slice(0, 8).map((c) => (
                <tr key={c.nombre} className="border-t border-[#EEEAF8]">
                  <td className="py-1.5 pr-2">{c.nombre} <span className="text-[#6B6485]">· {ESTADO_CAMPANA[c.estado] || c.estado}</span></td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.enviados_periodo)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.respuestas_periodo)}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.contactados ? `${(Math.round((c.respuestas / c.contactados) * 1000) / 10).toLocaleString("es-ES")} %` : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.interesados)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={descargar} disabled={ocupado}>
          {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Descargar imagen
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copiar} disabled={ocupado}>
          <Copy className="h-3.5 w-3.5" /> Copiar imagen
        </Button>
      </div>
    </div>
  );
}
