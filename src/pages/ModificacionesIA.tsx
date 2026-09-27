import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import html2canvas from "html2canvas";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AtSign, BarChart3, Brain, Check, CheckCheck, ChevronDown, ChevronRight, Clock, Copy, Download, FileSpreadsheet,
  Lightbulb, ListChecks, Loader2, Mail, MessageSquare, MessageSquareReply, Paperclip, Plus, Search, Send, Sparkles, Star, Undo2, Upload, Workflow, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SparkMark } from "@/components/SparkMark";
import {
  ESTADO_CAMBIO, ESTADO_CAMPANA, SUGERENCIAS, conversacionesRecientes, csvMetricas, diaCorto, haceCuanto, horaCorta,
  nombreCliente, puedeVerIaMod, type IaCliente, type IaMensaje, type IaTarjeta, type ImportacionVista, type RespuestaVista, type VistaPaso,
} from "@/lib/ia-mod-view";
import { decodificarArchivo, prepararCsv, trozos, type CsvPreparado } from "@/lib/ia-mod-csv";

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

const TONOS: Record<string, string> = {
  blue: "bg-sky-50 text-sky-600",
  violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-500",
  indigo: "bg-indigo-50 text-indigo-600",
  green: "bg-emerald-50 text-emerald-600",
};
const ICONOS_SUGERENCIA: Record<string, typeof BarChart3> = {
  graficos: BarChart3, mensajes: Mail, asuntos: Lightbulb, secuencia: Workflow, respuestas: MessageSquareReply, cuentas: ListChecks,
};

function Insignia({ c, size = 32 }: { c: Pick<IaCliente, "company_name" | "full_name" | "email" | "brand_color">; size?: number }) {
  return (
    <span
      className="flex-shrink-0 rounded-lg flex items-center justify-center font-semibold text-white"
      style={{ background: c.brand_color || "#6E58F1", width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {nombreCliente(c as IaCliente)[0]?.toUpperCase()}
    </span>
  );
}

export default function ModificacionesIA() {
  const { user } = useAuth();
  const [clientes, setClientes] = useState<IaCliente[] | null>(null);
  const [sel, setSel] = useState<IaCliente | null>(null);
  const [mensajes, setMensajes] = useState<IaMensaje[]>([]);
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState("");
  const [campanas, setCampanas] = useState<{ id: string; name: string; status: string }[]>([]);
  const [cargando, setCargando] = useState(false);
  const [pensando, setPensando] = useState(false);
  const [texto, setTexto] = useState("");
  const [memoriaAbierta, setMemoriaAbierta] = useState(false);
  const [menciones, setMenciones] = useState(false);
  const [adjunto, setAdjunto] = useState<{ nombre: string; datos: CsvPreparado } | null>(null);
  const [subida, setSubida] = useState<number | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const entradaRef = useRef<HTMLTextAreaElement>(null);

  const permitido = puedeVerIaMod(user?.email);

  const cargarClientes = useCallback(() => {
    llamar<{ clients: IaCliente[] }>({ action: "clients" })
      .then((r) => setClientes(r.clients))
      .catch((e) => { toast.error(e.message); setClientes((c) => c ?? []); });
  }, []);
  useEffect(() => { if (permitido) cargarClientes(); }, [permitido, cargarClientes]);

  const abrir = useCallback(async (c: IaCliente) => {
    setSel(c);
    setAdjunto(null);
    setMensajes([]);
    setCampanas([]);
    setCargando(true);
    try {
      const [h, k] = await Promise.all([
        llamar<{ messages: IaMensaje[]; notes: string; changes: Record<string, string> }>({ action: "history", client_id: c.id }),
        llamar<{ campaigns: { id: string; name: string; status: string }[] }>({ action: "campaigns", client_id: c.id }),
      ]);
      setMensajes(h.messages || []);
      setNotas(h.notes || "");
      setCambios(h.changes || {});
      setCampanas(k.campaigns || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCargando(false);
      setTimeout(() => entradaRef.current?.focus(), 50);
    }
  }, []);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [mensajes, pensando]);

  const enviar = async (contenido?: string) => {
    const adj = contenido === undefined ? adjunto : null;
    const t = (contenido ?? texto).trim() || (adj ? `Te adjunto el archivo ${adj.nombre}.` : "");
    if (!t || pensando) return;
    if (!sel) return;
    setTexto("");
    if (adj) setAdjunto(null);
    const tarjetaAdjunto: IaTarjeta[] = adj ? [{
      type: "adjunto", upload_id: "", nombre: adj.nombre, tipo: adj.datos.kind, filas: adj.datos.rows.length,
      descartadas: adj.datos.descartadas, columnas: adj.datos.headers,
    }] : [];
    const provisional: IaMensaje = { id: `tmp-${Date.now()}`, role: "user", content: t, cards: tarjetaAdjunto, author_email: user?.email || null, created_at: new Date().toISOString() };
    setMensajes((m) => [...m, provisional]);
    setPensando(true);
    try {
      const upload_id = adj ? await subirAdjunto(sel.id, adj) : undefined;
      setSubida(null);
      const r = await llamar<{ message: IaMensaje; user_message?: IaMensaje; changes: Record<string, string> }>({ action: "chat", client_id: sel.id, message: t, upload_id });
      setMensajes((m) => [...m.map((x) => (x.id === provisional.id && r.user_message ? r.user_message : x)), r.message]);
      setCambios((c) => ({ ...c, ...(r.changes || {}) }));
      setClientes((cs) => (cs || []).map((c) => c.id === sel.id ? { ...c, last_chat_at: r.message.created_at, last_chat_preview: t.slice(0, 90) } : c));
      const tarjetas = r.message.cards || [];
      if (tarjetas.some((k) => k.type === "nota")) {
        llamar<{ notes: string }>({ action: "history", client_id: sel.id }).then((h) => setNotas(h.notes || "")).catch(() => {});
      }
      if (tarjetas.some((k) => k.type === "cambio" && /Campaña/.test(k.summary))) {
        llamar<{ campaigns: typeof campanas }>({ action: "campaigns", client_id: sel.id }).then((k) => setCampanas(k.campaigns || [])).catch(() => {});
      }
    } catch (e: any) {
      toast.error(e.message || "La IA no ha podido responder");
      setMensajes((m) => m.filter((x) => x.id !== provisional.id));
      setTexto(contenido === undefined ? (texto || t) : "");
      if (adj) setAdjunto(adj);
    } finally {
      setPensando(false);
      setSubida(null);
    }
  };

  const accionCambio = async (change_id: string, action: "confirm" | "cancel" | "undo") => {
    if (!sel) return;
    try {
      const r = await llamar<{ status: string; summary?: string | null }>({ action, client_id: sel.id, change_id });
      setCambios((c) => ({ ...c, [change_id]: r.status }));
      toast.success(r.summary || (action === "confirm" ? "Hecho" : action === "undo" ? "Cambio deshecho" : "Cancelado"));
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

  const leerArchivo = async (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) { toast.error("Adjunta un archivo .csv (si es Excel: Archivo → Guardar como → CSV)"); return; }
    if (f.size > 15 * 1024 * 1024) { toast.error("El archivo pesa más de 15 MB; divídelo en varios"); return; }
    const r = prepararCsv(decodificarArchivo(await f.arrayBuffer()));
    if ("error" in r) { toast.error(r.error); return; }
    if (r.kind === "leads" && r.rows.length === 0) { toast.error("Ninguna fila tiene un email válido"); return; }
    setAdjunto({ nombre: f.name, datos: r });
    setTimeout(() => entradaRef.current?.focus(), 30);
  };

  /** Sube el adjunto por trozos y devuelve su id. */
  const subirAdjunto = async (clientId: string, a: { nombre: string; datos: CsvPreparado }): Promise<string> => {
    const { upload_id } = await llamar<{ upload_id: string }>({
      action: "upload_start", client_id: clientId, filename: a.nombre, kind: a.datos.kind,
      headers: a.datos.headers, total: a.datos.rows.length, discarded: a.datos.descartadas,
    });
    const partes = trozos(a.datos.rows);
    for (let i = 0; i < partes.length; i++) {
      setSubida(Math.round((i / partes.length) * 100));
      await llamar({ action: "upload_append", client_id: clientId, upload_id, rows: partes[i] });
    }
    setSubida(100);
    return upload_id;
  };

  const mencionar = (nombre: string) => {
    setMenciones(false);
    setTexto((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}la campaña "${nombre}" `);
    setTimeout(() => entradaRef.current?.focus(), 30);
  };

  const recientes = useMemo(() => conversacionesRecientes(clientes || []), [clientes]);

  if (!user) return null;
  if (!permitido) return <Navigate to="/dashboard" replace />;

  const fondo = "-mx-1 rounded-2xl bg-[radial-gradient(1200px_500px_at_0%_0%,#F3EEFF_0%,transparent_60%),radial-gradient(900px_500px_at_100%_100%,#EAF4FF_0%,transparent_60%)] dark:bg-none p-1 sm:p-2";

  // Primero se elige el cliente, en grande y a toda la pantalla; el chat viene después.
  if (!sel) {
    return (
      <div className={fondo}>
        <PantallaClientes clientes={clientes} recientes={recientes} onElegir={abrir} />
      </div>
    );
  }

  return (
    <div className={fondo}>
      <div className="flex gap-4 h-[calc(100dvh-120px)] min-h-[560px]">
        {/* ── Chat ─────────────────────────────────────────────────────── */}
        <section
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setArrastrando(true); } }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastrando(false); }}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); leerArchivo(e.dataTransfer.files?.[0]); }}
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#ECE8F7] bg-card/90 shadow-[0_8px_30px_-12px_rgba(49,42,99,0.18)] backdrop-blur dark:border-border">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0EDF8] px-4 py-3 sm:px-5 sm:py-4 dark:border-border">
            <div className="flex items-center gap-4 min-w-0">
              <span className="sm:hidden"><SparkMark size={44} className="rounded-xl shadow-[0_6px_20px_-8px_rgba(110,88,241,0.55)]" /></span>
              <span className="hidden sm:block"><SparkMark size={60} className="rounded-2xl shadow-[0_6px_20px_-8px_rgba(110,88,241,0.55)]" /></span>
              <div className="min-w-0">
                <h1 className="font-display text-[22px] sm:text-[26px] font-bold leading-tight tracking-[-0.03em] flex items-center gap-1.5">
                  PulseBot <Sparkles className="h-5 w-5 text-[#8B5CF6] fill-[#8B5CF6]" />
                </h1>
                <p className="text-[14px] sm:text-[15px] text-muted-foreground">Experto en Cold Email & Outreach</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  En línea ·{" "}
                  {sel ? <>trabajando sobre <strong className="font-semibold text-foreground">{nombreCliente(sel)}</strong></> : "elige un cliente para empezar"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="h-10 gap-2 rounded-xl" onClick={() => setSel(null)} title="Cambiar de cliente">
                <Insignia c={sel} size={22} />
                <span className="max-w-[160px] truncate">{nombreCliente(sel)}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
              {sel && (
                <Button variant="outline" className="h-10 gap-1.5 rounded-xl" onClick={() => setMemoriaAbierta(true)}>
                  <Brain className="h-4 w-4 text-primary" /> <span className="hidden sm:inline">Memoria</span>
                </Button>
              )}
              <Button variant="outline" className="h-10 gap-1.5 rounded-xl text-primary hover:text-primary" onClick={nuevaConversacion} disabled={!sel || pensando || !mensajes.length}>
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva conversación</span>
              </Button>
            </div>
          </header>

          {arrastrando && (
            <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-primary/5 text-primary">
              <Upload className="h-8 w-8" />
              <p className="text-[16px] font-semibold">Suelta aquí el CSV</p>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 space-y-5">
            {sel && cargando && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
            {sel && !cargando && mensajes.length === 0 && (
              <Bienvenida cliente={sel} onSugerencia={enviar} />
            )}
            {mensajes.map((m) => (
              <Burbuja key={m.id} m={m} cambios={cambios} onCambio={accionCambio} onPedir={enviar} />
            ))}
            {pensando && (
              <div className="flex items-start gap-3">
                <SparkMark size={40} className="rounded-xl" />
                <div className="rounded-2xl bg-[#F5F3FC] px-4 py-3 text-[15px] text-muted-foreground flex items-center gap-2 dark:bg-muted">
                  <span className="flex gap-1">
                    {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: `${d}ms` }} />)}
                  </span>
                  PulseBot está mirando la cuenta y trabajando…
                </div>
              </div>
            )}
            <div ref={finRef} />
          </div>

          {/* Barra de escribir */}
          <div className="border-t border-[#F0EDF8] px-4 py-3 sm:px-5 dark:border-border">
            {adjunto && (
              <div className="mb-2 flex w-fit max-w-full items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/5 py-2 pl-3 pr-2">
                <FileSpreadsheet className="h-5 w-5 flex-shrink-0 text-emerald-600" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium">{adjunto.nombre}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {adjunto.datos.kind === "leads"
                      ? `${adjunto.datos.rows.length.toLocaleString("es-ES")} leads con email válido${adjunto.datos.descartadas ? ` · ${adjunto.datos.descartadas.toLocaleString("es-ES")} ${adjunto.datos.descartadas === 1 ? "fila" : "filas"} sin email válido` : ""}`
                      : `${adjunto.datos.rows.length.toLocaleString("es-ES")} filas · sin columna de email (sólo para analizar)`}
                    {" · "}{adjunto.datos.headers.length} columnas
                  </span>
                </span>
                <button onClick={() => setAdjunto(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Quitar archivo"><X className="h-4 w-4" /></button>
              </div>
            )}
            {subida !== null && (
              <p className="mb-2 flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Subiendo el archivo… {subida} %</p>
            )}
            <input ref={archivoRef} type="file" accept=".csv,.txt,text/csv" className="hidden"
              onChange={(e) => { leerArchivo(e.target.files?.[0]); e.target.value = ""; }} />
            <div className="flex items-end gap-2">
              <div className="pb-1.5">
                <IconoAtajo titulo="Adjuntar CSV (leads o cualquier tabla)" onClick={() => archivoRef.current?.click()} disabled={pensando}><Paperclip className="h-5 w-5" /></IconoAtajo>
              </div>
              <div className="hidden sm:flex items-center gap-0.5 pb-1.5">
                <IconoAtajo titulo="Métricas en imagen" onClick={() => enviar("Métricas de los últimos 14 días en imagen")} disabled={pensando}><BarChart3 className="h-5 w-5" /></IconoAtajo>
                <Popover open={menciones} onOpenChange={setMenciones}>
                  <PopoverTrigger asChild>
                    <button type="button" title="Mencionar una campaña" disabled={!sel} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:opacity-40">
                      <AtSign className="h-5 w-5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-1">
                    <p className="px-2 py-1.5 text-[12px] font-medium text-muted-foreground">Campañas de {sel ? nombreCliente(sel) : ""}</p>
                    {campanas.length === 0 && <p className="px-2 py-2 text-[13px] text-muted-foreground">No tiene campañas</p>}
                    {campanas.map((c) => (
                      <button key={c.id} onClick={() => mencionar(c.name)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-muted">
                        <span className="truncate">{c.name}</span>
                        <span className={`flex-shrink-0 text-[11px] ${c.status === "active" ? "text-emerald-600" : "text-muted-foreground"}`}>{ESTADO_CAMPANA[c.status] || c.status}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <IconoAtajo titulo="Ideas para mejorar" onClick={() => enviar("Revisa sus campañas y dame las 3 mejoras que más respuestas darían")} disabled={pensando}><Sparkles className="h-5 w-5" /></IconoAtajo>
              </div>
              <Textarea
                ref={entradaRef}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder={sel ? `Pregunta sobre ${nombreCliente(sel)}, pide un mensaje, pide ideas…` : "Elige un cliente para empezar…"}
                rows={1}
                className="min-h-[52px] max-h-40 flex-1 resize-none rounded-xl border-[#E6E1F5] bg-background px-4 py-3.5 text-[15px] shadow-none focus-visible:ring-1 focus-visible:ring-primary/40 dark:border-border"
                disabled={pensando}
              />
              <Button onClick={() => enviar()} disabled={pensando || (!texto.trim() && !adjunto)} className="h-[52px] w-[52px] flex-shrink-0 rounded-xl p-0 shadow-[0_6px_18px_-6px_rgba(110,88,241,0.7)]" aria-label="Enviar">
                {pensando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </section>

        {/* ── Panel derecho ─────────────────────────────────────────────── */}
        <aside className="hidden xl:flex w-[300px] flex-shrink-0 flex-col gap-4 overflow-y-auto">
          <div className="rounded-2xl border border-[#ECE8F7] bg-card/90 p-4 shadow-[0_8px_30px_-16px_rgba(49,42,99,0.18)] dark:border-border">
            <h2 className="mb-3 flex items-center gap-2 font-display text-[17px] font-semibold tracking-[-0.02em]">
              <Sparkles className="h-4 w-4 text-primary" /> Sugerencias
            </h2>
            <div className="space-y-2">
              {SUGERENCIAS.map((s) => {
                const Icono = ICONOS_SUGERENCIA[s.id] || Sparkles;
                return (
                  <button
                    key={s.id}
                    onClick={() => enviar(s.texto)}
                    disabled={pensando}
                    className="flex w-full items-center gap-3 rounded-xl border border-[#EEEAF8] bg-background px-3 py-2.5 text-left text-[14px] leading-snug transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 dark:border-border"
                  >
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${TONOS[s.tono]}`}><Icono className="h-4 w-4" /></span>
                    {s.texto}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-[#ECE8F7] bg-card/90 p-4 shadow-[0_8px_30px_-16px_rgba(49,42,99,0.18)] dark:border-border">
            <h2 className="mb-2 flex items-center gap-2 font-display text-[17px] font-semibold tracking-[-0.02em]">
              <Clock className="h-4 w-4 text-muted-foreground" /> Conversaciones recientes
            </h2>
            {recientes.length === 0 && <p className="py-3 text-[13px] text-muted-foreground">Todavía no hay conversaciones.</p>}
            <div className="space-y-0.5">
              {recientes.map((c) => (
                <button key={c.id} onClick={() => abrir(c)} className={`flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/60 ${sel?.id === c.id ? "bg-primary/5" : ""}`}>
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground"><MessageSquare className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{nombreCliente(c)}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{c.last_chat_preview}</span>
                    <span className="block text-[12px] text-muted-foreground">{haceCuanto(c.last_chat_at!)}</span>
                  </span>
                </button>
              ))}
            </div>
            <Button variant="outline" className="mt-3 w-full gap-1 rounded-xl" onClick={() => setSel(null)}>
              Ver todos los clientes <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </aside>
      </div>

      {/* Memoria */}
      <Dialog open={memoriaAbierta} onOpenChange={setMemoriaAbierta}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Memoria de {sel ? nombreCliente(sel) : "este cliente"}</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Lo que PulseBot debe recordar siempre de este cliente: qué vende, a quién, quién firma, su dato de resultado, su enlace de reserva, el tono… Él también la va completando cuando le cuentas cosas.
          </p>
          <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={10} placeholder={"- Vende placas solares a naves industriales\n- Firma Simone\n- Dato: ahorran entre un 30 y un 40 % en la factura"} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoriaAbierta(false)}>Cancelar</Button>
            <Button onClick={guardarMemoria}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconoAtajo({ titulo, onClick, disabled, children }: { titulo: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={titulo} aria-label={titulo} onClick={onClick} disabled={disabled}
      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:opacity-40">
      {children}
    </button>
  );
}

type Filtro = "todos" | "activas" | "recientes";

/** Primera pantalla: elegir el cliente, grande y a todo el ancho. */
function PantallaClientes({ clientes, recientes, onElegir }: { clientes: IaCliente[] | null; recientes: IaCliente[]; onElegir: (c: IaCliente) => void }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const todos = useMemo(() => clientes || [], [clientes]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todos
      .filter((c) => filtro !== "activas" || c.active > 0)
      .filter((c) => filtro !== "recientes" || !!c.last_chat_at)
      .filter((c) => !q || [c.company_name, c.full_name, c.email].some((v) => (v || "").toLowerCase().includes(q)));
  }, [todos, busca, filtro]);
  const filtros: { id: Filtro; label: string; n: number }[] = [
    { id: "todos", label: "Todos", n: todos.length },
    { id: "activas", label: "Con campaña activa", n: todos.filter((c) => c.active > 0).length },
    { id: "recientes", label: "Con conversación", n: todos.filter((c) => c.last_chat_at).length },
  ];

  return (
    <div className="flex h-[calc(100dvh-120px)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-[#ECE8F7] bg-card/90 shadow-[0_8px_30px_-12px_rgba(49,42,99,0.18)] backdrop-blur dark:border-border">
      <div className="border-b border-[#F0EDF8] px-5 pb-5 pt-6 sm:px-8 dark:border-border">
        <div className="flex items-center gap-4 sm:gap-5">
          <span className="sm:hidden"><SparkMark size={52} className="rounded-2xl shadow-[0_6px_20px_-8px_rgba(110,88,241,0.55)]" /></span>
          <span className="hidden sm:block"><SparkMark size={76} className="rounded-2xl shadow-[0_8px_24px_-8px_rgba(110,88,241,0.55)]" /></span>
          <div className="min-w-0">
            <h1 className="font-display text-[24px] sm:text-[32px] font-bold leading-tight tracking-[-0.03em] flex items-center gap-2">
              PulseBot <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-[#8B5CF6] fill-[#8B5CF6]" />
            </h1>
            <p className="text-[15px] sm:text-[17px] text-muted-foreground">¿Con qué cliente quieres trabajar hoy?</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" /> En línea · entro en su cuenta y veo sus campañas, mensajes, métricas y respuestas
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus
              placeholder="Buscar cliente por empresa, nombre o correo…"
              className="h-12 rounded-xl border-[#E6E1F5] bg-background pl-12 text-[16px] dark:border-border" />
          </div>
          <div className="flex flex-wrap gap-2">
            {filtros.map((f) => (
              <button key={f.id} onClick={() => setFiltro(f.id)}
                className={`h-10 rounded-xl border px-3.5 text-[14px] font-medium transition-colors ${filtro === f.id ? "border-primary bg-primary text-primary-foreground" : "border-[#E6E1F5] bg-background text-foreground/80 hover:border-primary/40 dark:border-border"}`}>
                {f.label} <span className="ml-1 tabular-nums opacity-70">{f.n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6 space-y-7">
        {clientes === null && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}

        {clientes !== null && !busca && filtro === "todos" && recientes.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Clock className="h-4 w-4 text-muted-foreground" /> Seguir donde lo dejaste</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {recientes.slice(0, 4).map((c) => (
                <button key={c.id} onClick={() => onElegir(c)}
                  className="group flex w-full min-w-0 items-start gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_10px_30px_-14px_rgba(110,88,241,0.5)]">
                  <Insignia c={c} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{nombreCliente(c)}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{c.last_chat_preview}</span>
                    <span className="mt-1 block text-[12px] font-medium text-primary">{haceCuanto(c.last_chat_at!)}</span>
                  </span>
                  <ChevronRight className="mt-1 h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}
            </div>
          </section>
        )}

        {clientes !== null && (
          <section>
            <h2 className="mb-3 text-[15px] font-semibold">
              {busca || filtro !== "todos" ? `${lista.length} cliente${lista.length === 1 ? "" : "s"}` : `Todos los clientes · ${todos.length}`}
            </h2>
            {lista.length === 0 ? (
              <p className="rounded-2xl border border-dashed py-12 text-center text-[15px] text-muted-foreground">No hay clientes que coincidan</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {lista.map((c) => (
                  <button key={c.id} onClick={() => onElegir(c)}
                    className="group flex w-full min-w-0 flex-col rounded-2xl border border-[#ECE8F7] bg-background p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_10px_30px_-14px_rgba(49,42,99,0.35)] dark:border-border">
                    <span className="flex items-center gap-3">
                      <Insignia c={c} size={48} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px] font-semibold">{nombreCliente(c)}</span>
                        <span className="block truncate text-[13px] text-muted-foreground">{c.email}</span>
                      </span>
                    </span>
                    <span className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{c.campaigns} campaña{c.campaigns === 1 ? "" : "s"}</span>
                      {c.active > 0 ? (
                        <span className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {c.active} activa{c.active === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="rounded-md px-2 py-0.5 text-muted-foreground">Sin campañas activas</span>
                      )}
                      {c.last_chat_at && <span className="ml-auto text-muted-foreground">{haceCuanto(c.last_chat_at)}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Bienvenida({ cliente, onSugerencia }: { cliente: IaCliente; onSugerencia: (t: string) => void }) {
  return (
    <div className="flex items-start gap-3">
      <SparkMark size={40} className="rounded-xl" />
      <div className="min-w-0 max-w-2xl space-y-3">
        <div className="rounded-2xl bg-[#F5F3FC] px-5 py-4 text-[15px] leading-relaxed dark:bg-muted">
          <p>Hola, soy <strong className="font-bold">PulseBot</strong>. Ya estoy dentro de la cuenta de <strong className="font-bold">{nombreCliente(cliente)}</strong>.</p>
          <p className="mt-2">Puedo ayudarte a:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 marker:text-primary">
            <li>Analizar sus campañas y enseñarte gráficos que puedes descargar</li>
            <li>Escribir y mejorar sus mensajes, calcando los que mejor funcionan</li>
            <li>Crear variantes A/B y follow-ups</li>
            <li>Leer lo que responden sus leads y proponer mejoras</li>
            <li>Recordar lo importante de este cliente</li>
          </ul>
          <p className="mt-2">¿En qué puedo ayudarte hoy?</p>
        </div>
        <div className="flex flex-wrap gap-2 xl:hidden">
          {SUGERENCIAS.map((s) => (
            <button key={s.id} onClick={() => onSugerencia(s.texto)} className="rounded-full border bg-card px-3 py-1.5 text-[13px] text-foreground/80 hover:border-primary/40 hover:text-primary transition-colors">
              {s.texto}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Burbuja({ m, cambios, onCambio, onPedir }: {
  m: IaMensaje; cambios: Record<string, string>; onCambio: (id: string, a: "confirm" | "cancel" | "undo") => void; onPedir: (t: string) => void;
}) {
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground whitespace-pre-wrap shadow-[0_6px_18px_-10px_rgba(110,88,241,0.8)]">
          {m.content}
          {(m.cards || []).filter((t) => t.type === "adjunto").map((t, i) => t.type === "adjunto" && (
            <span key={i} className="mt-2 flex items-center gap-2 rounded-lg bg-white/15 px-2.5 py-1.5 text-[13px]">
              <FileSpreadsheet className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{t.nombre} · {t.filas.toLocaleString("es-ES")} {t.tipo === "leads" ? "leads" : "filas"}</span>
            </span>
          ))}
        </div>
        <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
          {m.author_email ? `${m.author_email.split("@")[0]} · ` : ""}{horaCorta(m.created_at)} <CheckCheck className="h-3.5 w-3.5 text-primary" />
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <SparkMark size={40} className="rounded-xl" />
      <div className="min-w-0 flex-1 space-y-3">
        {m.content && (
          <div className="w-fit max-w-full rounded-2xl rounded-tl-md bg-[#F5F3FC] px-5 py-3.5 text-[15px] leading-relaxed dark:bg-muted">
            <div className="max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_li]:marker:text-primary [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_strong]:font-bold [&_h1]:mb-1.5 [&_h1]:mt-4 [&_h1]:text-[17px] [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-[16px] [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-3.5 [&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:text-[#3B3470] dark:[&_h3]:text-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-white/70 [&_code]:px-1 [&_code]:text-[13px] [&_pre]:my-2 [&_pre]:whitespace-pre-wrap [&_pre]:rounded-lg [&_pre]:bg-white/80 [&_pre]:p-3 [&_pre]:text-[13px] [&_hr]:my-3 [&_hr]:border-[#E6E1F5]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{m.content}</ReactMarkdown>
            </div>
          </div>
        )}
        {(m.cards || []).map((t, i) => <Tarjeta key={i} t={t} cambios={cambios} onCambio={onCambio} onPedir={onPedir} />)}
        <p className="text-[12px] text-muted-foreground">{horaCorta(m.created_at)}</p>
      </div>
    </div>
  );
}

/** Las tablas que escribe PulseBot, como tablas de verdad (con scroll lateral si no caben). */
const MD: Components = {
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-[#E6E1F5] bg-white/80 dark:border-border dark:bg-card">
      <table className="w-full border-collapse text-[13.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#F1EEFE] text-left text-[12.5px] text-[#4A4378] dark:bg-muted dark:text-muted-foreground">{children}</thead>,
  th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-[#EEEAF8] px-3 py-2 tabular-nums dark:border-border">{children}</td>,
};

function Tarjeta({ t, cambios, onCambio, onPedir }: {
  t: IaTarjeta; cambios: Record<string, string>; onCambio: (id: string, a: "confirm" | "cancel" | "undo") => void; onPedir: (t: string) => void;
}) {
  if (t.type === "adjunto") return null;
  if (t.type === "campanas") return <TarjetaCampanas t={t} onPedir={onPedir} />;
  if (t.type === "cuentas") return <TarjetaCuentas t={t} />;
  if (t.type === "respuestas") return <TarjetaRespuestas t={t} />;
  if (t.type === "metricas") return <TarjetaMetricas t={t} onPedir={onPedir} />;
  if (t.type === "mensajes") return <TarjetaMensajes t={t} />;
  if (t.type === "nota") {
    return (
      <div className="flex w-fit items-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-[13px] text-muted-foreground">
        <Brain className="h-3.5 w-3.5 text-primary" /> Guardado en la memoria: <span className="text-foreground">{t.texto}</span>
      </div>
    );
  }
  return <TarjetaCambio t={t} estado={cambios[t.change_id] || (t.type === "pendiente" ? "pending" : "applied")} onCambio={onCambio} />;
}

function Correo({ asunto, cuerpo, cabecera }: { asunto?: string; cuerpo?: string; cabecera?: string }) {
  return (
    <div className="rounded-xl border border-[#ECE8F7] bg-background dark:border-border">
      {cabecera && <p className="flex items-center gap-1.5 border-b border-[#F0EDF8] px-4 py-2 text-[12px] font-medium text-muted-foreground dark:border-border"><Mail className="h-3.5 w-3.5" /> {cabecera}</p>}
      <div className="px-4 py-3">
        <p className="text-[13px]"><span className="text-muted-foreground">Asunto: </span>{asunto ? <strong className="font-bold">{asunto}</strong> : <span className="italic text-muted-foreground">mismo hilo (Re: del primero)</span>}</p>
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
  const marco = estado === "applied" ? "border-emerald-200 bg-emerald-50/50" : estado === "pending" ? "border-amber-200 bg-amber-50/50" : "border-[#ECE8F7] bg-card";
  return (
    <div className={`rounded-2xl border ${marco} p-4 space-y-3 dark:border-border dark:bg-card`}>
      <div className="flex items-center justify-between gap-2">
        <button className="flex items-center gap-2 text-left text-[15px] font-semibold min-w-0" onClick={() => setAbierto((v) => !v)}>
          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${estado === "pending" ? "bg-amber-100 text-amber-600" : estado === "applied" ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
            {estado === "pending" ? <ListChecks className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </span>
          <span className="truncate">{t.summary}</span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${abierto ? "" : "-rotate-90"}`} />
        </button>
        <span className={`flex-shrink-0 rounded-md border px-2 py-0.5 text-[12px] font-medium ${
          estado === "applied" ? "border-emerald-300 text-emerald-700" : estado === "pending" ? "border-amber-300 text-amber-700" : "text-muted-foreground"
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
          {t.importacion && <ResumenImportacion r={t.importacion} />}
          {t.aviso && <p className="text-[13px] text-muted-foreground">{t.aviso}</p>}
          {t.activa && estado === "applied" && <p className="text-[13px] text-muted-foreground">La campaña está activa: se usa desde el próximo envío.</p>}
        </div>
      )}
      <div className="flex gap-2">
        {estado === "pending" && (
          <>
            <Button size="sm" className="gap-1.5 rounded-lg" disabled={trabajando} onClick={() => hacer("confirm")}>
              {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmar
            </Button>
            <Button size="sm" variant="outline" className="rounded-lg" disabled={trabajando} onClick={() => hacer("cancel")}>Cancelar</Button>
          </>
        )}
        {estado === "applied" && (
          <Button size="sm" variant="outline" className="gap-1.5 rounded-lg bg-background" disabled={trabajando} onClick={() => hacer("undo")}>
            {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Deshacer
          </Button>
        )}
      </div>
    </div>
  );
}

const PUNTO_SALUD: Record<string, string> = { ok: "bg-emerald-500", aviso: "bg-amber-500", problema: "bg-red-500" };

function Cifra({ k, v, color = "" }: { k: string; v: number; color?: string }) {
  return (
    <div className="rounded-xl border border-[#EEEAF8] bg-card px-3 py-2.5 text-center dark:border-border">
      <p className={`text-[20px] font-bold tabular-nums leading-tight ${color}`}>{fmt(v)}</p>
      <p className="text-[11.5px] text-muted-foreground">{k}</p>
    </div>
  );
}

function TarjetaCuentas({ t }: { t: Extract<IaTarjeta, { type: "cuentas" }> }) {
  const [todas, setTodas] = useState(false);
  const conProblema = t.cuentas.filter((c) => c.estado !== "ok");
  const resto = t.cuentas.filter((c) => c.estado === "ok");
  return (
    <div className="max-w-[760px] space-y-3 rounded-2xl border border-[#ECE8F7] bg-card p-4 dark:border-border">
      <p className="flex items-center gap-2 text-[15px] font-semibold"><Mail className="h-4 w-4 text-primary" /> Cuentas de correo</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cifra k="Cuentas" v={t.totales.total} />
        <Cifra k="Funcionan bien" v={t.totales.ok} color="text-emerald-600" />
        <Cifra k="Con problema" v={t.totales.problemas + t.totales.avisos} color={t.totales.problemas ? "text-red-600" : t.totales.avisos ? "text-amber-600" : ""} />
        <Cifra k="Enviados en 24 h" v={t.totales.enviados_24h} />
      </div>
      {conProblema.length > 0 ? (
        <div className="space-y-1.5">
          {conProblema.map((c) => (
            <div key={c.email} className={`rounded-xl border px-3 py-2 ${c.estado === "problema" ? "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10" : "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10"}`}>
              <p className="flex items-center gap-2 text-[14px] font-medium">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${PUNTO_SALUD[c.estado]}`} />
                <span className="truncate">{c.email}</span>
                {c.en_campana_activa && <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">en campaña activa</span>}
              </p>
              <p className="mt-0.5 pl-4 text-[13px] text-foreground/80">{c.motivo}</p>
              {c.fallidos_24h > 0 && <p className="pl-4 text-[12px] text-muted-foreground">{c.fallidos_24h} {c.fallidos_24h === 1 ? "envío fallido" : "envíos fallidos"} en 24 h</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[13.5px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check className="h-4 w-4" /> Todas las cuentas funcionan bien.</p>
      )}
      {resto.length > 0 && (
        <div>
          <button onClick={() => setTodas((v) => !v)} className="flex items-center gap-1 text-[13px] font-medium text-primary">
            <ChevronDown className={`h-4 w-4 transition-transform ${todas ? "" : "-rotate-90"}`} /> {todas ? "Ocultar" : "Ver"} las {resto.length} que funcionan
          </button>
          {todas && (
            <div className="mt-2 max-h-[320px] overflow-auto rounded-xl border border-[#EEEAF8] dark:border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-[#F6F4FD] text-left text-muted-foreground dark:bg-muted">
                  <tr><th className="px-3 py-1.5 font-medium">Cuenta</th><th className="px-3 py-1.5 text-right font-medium">Enviados 24 h</th><th className="px-3 py-1.5 text-right font-medium">Límite/día</th><th className="px-3 py-1.5 font-medium">Campañas</th></tr>
                </thead>
                <tbody>
                  {resto.map((c) => (
                    <tr key={c.email} className="border-t border-[#EEEAF8] dark:border-border">
                      <td className="max-w-[240px] truncate px-3 py-1.5">{c.email}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.enviados_24h)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{c.limite_diario ?? "—"}</td>
                      <td className="max-w-[200px] truncate px-3 py-1.5 text-muted-foreground">{c.campanas.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CHIP_VEREDICTO: Record<string, string> = {
  "Interesado": "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  "Pregunta": "border-sky-300 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  "Derivado": "border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
};

function FilaRespuesta({ r }: { r: RespuestaVista }) {
  return (
    <div className="rounded-xl border border-[#EEEAF8] bg-background px-3 py-2.5 dark:border-border">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{r.nombre || r.email.split("@")[0]}</span>
        <span className="text-[12.5px] text-muted-foreground">{r.email}</span>
        <span className={`ml-auto rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${CHIP_VEREDICTO[r.veredicto] || "border-border bg-muted text-muted-foreground"}`}>{r.veredicto}</span>
      </div>
      {r.cita && <p className="mt-1 text-[13.5px] italic text-foreground/85">“{r.cita}”</p>}
      <p className="mt-1 text-[12px] text-muted-foreground">
        {[r.campana, haceCuanto(r.fecha)].filter(Boolean).join(" · ")}
        {r.discrepa && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">la etiqueta decía: {r.etiqueta}</span>}
      </p>
    </div>
  );
}

function TarjetaRespuestas({ t }: { t: Extract<IaTarjeta, { type: "respuestas" }> }) {
  const [verDistintas, setVerDistintas] = useState(false);
  return (
    <div className="max-w-[760px] space-y-3 rounded-2xl border border-[#ECE8F7] bg-card p-4 dark:border-border">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <MessageSquareReply className="h-4 w-4 text-primary" /> Respuestas leídas una a una
        <span className="ml-auto text-[12px] font-normal text-muted-foreground">{t.campana || "todas las campañas"} · {t.dias} días</span>
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Cifra k="Leídas" v={t.totales.leidas} />
        <Cifra k="Interesados" v={t.totales.interesados} color="text-emerald-600" />
        <Cifra k="Preguntas" v={t.totales.preguntas} color="text-sky-600" />
        <Cifra k="No interesados" v={t.totales.no_interesados + t.totales.no_contactar} />
        <Cifra k="Fuera de oficina" v={t.totales.fuera_oficina} />
      </div>
      {t.calientes.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold">A quién contestar primero</p>
          {t.calientes.map((r) => <FilaRespuesta key={r.email} r={r} />)}
        </div>
      ) : (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-[13.5px] text-muted-foreground">Ninguna respuesta con interés o preguntas en este periodo.</p>
      )}
      {t.distintas.length > 0 && (
        <div>
          <button onClick={() => setVerDistintas((v) => !v)} className="flex items-center gap-1 text-[13px] font-medium text-primary">
            <ChevronDown className={`h-4 w-4 transition-transform ${verDistintas ? "" : "-rotate-90"}`} /> {t.distintas.length} más con la etiqueta distinta a lo que dicen
          </button>
          {verDistintas && <div className="mt-2 space-y-1.5">{t.distintas.map((r) => <FilaRespuesta key={r.email} r={r} />)}</div>}
        </div>
      )}
    </div>
  );
}

const ESTILO_ESTADO: Record<string, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  draft: "border-border bg-muted text-muted-foreground",
};

function TarjetaCampanas({ t, onPedir }: { t: Extract<IaTarjeta, { type: "campanas" }>; onPedir: (t: string) => void }) {
  if (!t.campanas.length) {
    return <div className="rounded-2xl border border-dashed p-4 text-[14px] text-muted-foreground">No tiene ninguna campaña.</div>;
  }
  return (
    <div className="grid max-w-[760px] gap-3 sm:grid-cols-2">
      {t.campanas.map((c) => {
        const tasa = c.contactados ? (Math.round((c.respuestas / c.contactados) * 1000) / 10).toLocaleString("es-ES") : null;
        const datos = [
          { k: "Leads", v: fmt(c.leads), sub: c.leads_pendientes ? `${fmt(c.leads_pendientes)} por contactar` : "" },
          { k: "Enviados", v: fmt(c.enviados), sub: c.enviados_7d ? `${fmt(c.enviados_7d)} en 7 días` : "" },
          { k: "Respuestas", v: fmt(c.respuestas), sub: tasa ? `${tasa} % de respuesta` : "" },
          { k: "Interesados", v: fmt(c.interesados), sub: "" },
        ];
        return (
          <div key={c.id} className="rounded-2xl border border-[#ECE8F7] bg-card p-4 dark:border-border">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold">{c.nombre}</p>
                <p className="text-[12px] text-muted-foreground">{c.mensajes} mensaje{c.mensajes === 1 ? "" : "s"} · {c.horario}</p>
              </div>
              <span className={`flex flex-shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] font-medium ${ESTILO_ESTADO[c.estado] || ESTILO_ESTADO.draft}`}>
                {c.estado === "active" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                {ESTADO_CAMPANA[c.estado] || c.estado}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {datos.map((d) => (
                <div key={d.k} className="rounded-lg bg-[#FBFAFE] px-2.5 py-2 dark:bg-muted/40">
                  <p className="text-[11px] text-muted-foreground">{d.k}</p>
                  <p className="text-[18px] font-bold tabular-nums leading-tight">{d.v}</p>
                  {d.sub && <p className="text-[11px] text-muted-foreground">{d.sub}</p>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => onPedir(`Enséñame los mensajes de la campaña "${c.nombre}"`)} className="flex-1 rounded-lg border border-[#ECE8F7] px-2 py-1.5 text-[12.5px] font-medium hover:border-primary/40 hover:bg-primary/5 dark:border-border">Ver mensajes</button>
              <button onClick={() => onPedir(`Métricas de los últimos 14 días de la campaña "${c.nombre}" en imagen`)} className="flex-1 rounded-lg border border-[#ECE8F7] px-2 py-1.5 text-[12.5px] font-medium hover:border-primary/40 hover:bg-primary/5 dark:border-border">Métricas</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResumenImportacion({ r }: { r: ImportacionVista }) {
  const cifras = [
    { k: "Nuevos", v: r.nuevos, c: "text-emerald-600" },
    { k: "Ya estaban (se actualizan)", v: r.actualizados, c: "text-sky-600" },
    { k: "Descartados", v: r.invalidos + r.repetidos, c: "text-muted-foreground" },
  ];
  const cols = Object.keys(r.ejemplo[0] || {}).slice(0, 5);
  return (
    <div className="space-y-2.5 rounded-xl border border-[#ECE8F7] bg-background p-3 dark:border-border">
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> {r.archivo}
        <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-[11px]">{r.formato === "todas" ? "Todas las columnas" : "Con plantilla"}</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        {cifras.map((x) => (
          <div key={x.k} className="rounded-lg border border-[#EEEAF8] px-2 py-2 text-center dark:border-border">
            <p className={`text-[20px] font-bold tabular-nums ${x.c}`}>{x.v.toLocaleString("es-ES")}</p>
            <p className="text-[11px] text-muted-foreground">{x.k}</p>
          </div>
        ))}
      </div>
      {Object.keys(r.renombradas || {}).length > 0 && (
        <p className="text-[12px] text-muted-foreground">Columnas renombradas: {Object.entries(r.renombradas).map(([a, b]) => `${a} → ${b}`).join(", ")}</p>
      )}
      {r.variables_sin_columna.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Los mensajes usan {r.variables_sin_columna.map((v) => `{{${v}}}`).join(", ")} y el archivo no tiene esa columna: esos leads recibirán el texto de respaldo.
        </p>
      )}
      {cols.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-muted-foreground">{cols.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}</tr></thead>
            <tbody>
              {r.ejemplo.map((f, i) => (
                <tr key={i} className="border-t border-border/60">{cols.map((c) => <td key={c} className="max-w-[180px] truncate py-1 pr-3">{f[c]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TarjetaMensajes({ t }: { t: Extract<IaTarjeta, { type: "mensajes" }> }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <div className="rounded-2xl border border-[#ECE8F7] bg-card p-4 space-y-3 dark:border-border">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setAbierto((v) => !v)}>
        <span className="flex items-center gap-2 text-[15px] font-semibold min-w-0">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Mail className="h-4 w-4" /></span>
          <span className="truncate">{t.campaign_name}</span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${abierto ? "" : "-rotate-90"}`} />
        </span>
        <span className="flex-shrink-0 text-[13px] text-muted-foreground">{ESTADO_CAMPANA[t.status] || t.status} · {t.steps.length} mensajes</span>
      </button>
      {abierto && t.steps.map((p: VistaPaso) => (
        <div key={p.step_id} className="space-y-2">
          <Correo cabecera={`Mensaje ${p.posicion}${p.posicion > 1 ? ` · a los ${p.espera_dias} días` : ""}`} asunto={p.asunto} cuerpo={p.cuerpo} />
          {p.variantes.map((v) => (
            <div key={v.letra} className="ml-5">
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
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("es-ES")} %`;

function TarjetaMetricas({ t, onPedir }: { t: Extract<IaTarjeta, { type: "metricas" }>; onPedir: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const datos = t.serie.map((d) => ({ dia: diaCorto(d.day), Envíos: d.sends, Respuestas: d.replies }));
  const tot = t.totales;
  const tiles = [
    { k: `Envíos en ${t.dias} días`, v: fmt(tot.enviados_periodo), sub: `${fmt(tot.enviados)} en total`, icono: Mail, color: "text-[#6E58F1]", fondo: "bg-[#F1EEFE]", tinte: "bg-white" },
    { k: "Contactados", v: fmt(tot.contactados), sub: `${fmt(tot.rebotes)} rebotes`, icono: Send, color: "text-emerald-600", fondo: "bg-emerald-100/70", tinte: "bg-emerald-50/40" },
    { k: "Respuestas", v: fmt(tot.respuestas), sub: `${pct(tot.tasa_respuesta)} de respuesta`, icono: MessageSquareReply, color: "text-sky-600", fondo: "bg-sky-100/70", tinte: "bg-sky-50/40" },
    { k: "Interesados", v: fmt(tot.interesados), sub: tot.respuestas ? `${pct((tot.interesados / tot.respuestas) * 100)} de las respuestas` : "—", icono: Star, color: "text-orange-500", fondo: "bg-orange-100/70", tinte: "bg-orange-50/40" },
  ];

  const imagen = async (): Promise<Blob | null> => {
    if (!ref.current) return null;
    const canvas = await html2canvas(ref.current, { backgroundColor: "#FFFFFF", scale: 2, useCORS: true });
    return await new Promise((r) => canvas.toBlob((b) => r(b), "image/png"));
  };
  const bajar = (blob: Blob, nombre: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const base = `metricas-${t.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "-").toLowerCase()}-${t.dias}d`;
  const descargar = async () => {
    setOcupado(true);
    try { const b = await imagen(); if (b) bajar(b, `${base}.png`); } finally { setOcupado(false); }
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
  const csv = () => bajar(new Blob([csvMetricas(t)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);

  return (
    <div className="space-y-2.5">
      {/* Lo que va dentro de ref es la "foto": colores fijos para que salga igual en tema oscuro. */}
      <div ref={ref} className="max-w-[760px] rounded-2xl border border-[#ECE8F7] bg-white p-5 text-[#1B1535]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#6E58F1]">Rendimiento · últimos {t.dias} días</p>
            <p className="mt-0.5 font-display text-[20px] font-bold tracking-[-0.02em]">{t.titulo}</p>
            <p className="text-[13px] text-[#6B6485]">{t.subtitulo}</p>
          </div>
          <span className="flex items-center gap-1.5 text-[14px] font-bold text-[#1B1535]"><SparkMark size={24} className="rounded-md" /> OnePulso</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((x) => {
            const Icono = x.icono;
            return (
              <div key={x.k} className={`flex flex-col items-center rounded-xl border border-[#EEEAF8] ${x.tinte} px-3 py-3 text-center`}>
                <span className={`flex h-9 w-9 items-center justify-center rounded-full ${x.fondo} ${x.color}`}><Icono className="h-[18px] w-[18px]" /></span>
                <p className="mt-2 text-[22px] font-bold tabular-nums leading-none">{x.v}</p>
                <p className="mt-1 text-[12px] text-[#6B6485]">{x.k}</p>
                <p className={`mt-1 text-[12px] font-semibold ${x.color}`}>{x.sub}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-[#EEEAF8] p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] font-semibold">Tendencia de rendimiento</p>
            <span className="flex items-center gap-4 text-[12px] text-[#6B6485]">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#7C5CF5]" /> Envíos</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#10B981]" /> Respuestas</span>
            </span>
          </div>
          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={datos} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="gEnvios" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C5CF5" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#7C5CF5" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gResp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEEAF8" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#6B6485" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                <YAxis yAxisId="e" tick={{ fontSize: 11, fill: "#6B6485" }} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v) => fmt(v)} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#10B981" }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Area yAxisId="e" type="monotone" dataKey="Envíos" stroke="#7C5CF5" strokeWidth={2.5} fill="url(#gEnvios)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                <Area yAxisId="r" type="monotone" dataKey="Respuestas" stroke="#10B981" strokeWidth={2.5} fill="url(#gResp)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
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
                  <td className="py-1.5 text-right tabular-nums">{c.contactados ? pct((c.respuestas / c.contactados) * 100) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.interesados)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid max-w-[760px] grid-cols-2 gap-2 sm:grid-cols-4">
        <AccionMetricas onClick={descargar} disabled={ocupado} icono={ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-[#6E58F1]" />}>Descargar imagen</AccionMetricas>
        <AccionMetricas onClick={copiar} disabled={ocupado} icono={<Copy className="h-4 w-4 text-sky-600" />}>Copiar imagen</AccionMetricas>
        <AccionMetricas onClick={csv} icono={<FileSpreadsheet className="h-4 w-4 text-emerald-600" />}>Exportar CSV</AccionMetricas>
        <AccionMetricas onClick={() => onPedir(`Con estas métricas de ${t.titulo}, ¿qué me recomiendas para conseguir más respuestas e interesados?`)} icono={<Lightbulb className="h-4 w-4 text-amber-500" />}>Recomendaciones</AccionMetricas>
      </div>
    </div>
  );
}

function AccionMetricas({ onClick, disabled, icono, children }: { onClick: () => void; disabled?: boolean; icono: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center justify-center gap-2 rounded-xl border border-[#ECE8F7] bg-card px-3 py-2.5 text-[13px] sm:text-[14px] font-medium text-[#3B3470] transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 dark:border-border dark:text-foreground">
      {icono} {children}
    </button>
  );
}
