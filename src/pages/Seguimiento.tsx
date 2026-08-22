import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CalendarClock, Search, Sparkles, Send, Loader2, Mail, User, X, Clock, RefreshCw, ArrowLeft, MessageSquare } from "lucide-react";

// Seguimiento — busca EN VIVO (IMAP) los distintos hilos con una persona, importa SOLO el que
// eliges, responde y programa follow-ups en un calendario semanal con arrastrar. Los follow-ups
// los envía solo el cron send-followups (desde team@, con hilo). La IA propone la respuesta.
const TEAM_ACCOUNT = "a638362a-dff1-4d44-9d27-f2e7390d15fc"; // team@onepulso.online
const cleanBody = (h?: string | null) => (h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const fmt = (v?: number | string) => v ? new Date(v).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const dayISO = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export default function Seguimiento() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState<any | null>(null); // {contact_email, contact_name, subject}
  const [conv, setConv] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [refs, setRefs] = useState<{ inReplyTo: string; references: string }>({ inReplyTo: "", references: "" });
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [followups, setFollowups] = useState<any[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [segThreads, setSegThreads] = useState<any[]>([]);
  const [fuDetail, setFuDetail] = useState<any | null>(null); // follow-up abierto en el popup
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const loadFollowups = async () => {
    try { const { data } = await (supabase as any).from("follow_ups").select("*").in("status", ["scheduled", "sent"]).order("scheduled_at", { ascending: true }).limit(200); setFollowups((data as any[]) || []); } catch { /* */ }
  };
  const loadSegThreads = async () => {
    try { const { data } = await (supabase as any).from("seg_threads").select("*").order("last_imported_at", { ascending: false }).limit(100); setSegThreads((data as any[]) || []); } catch { /* */ }
  };
  useEffect(() => { loadFollowups(); loadSegThreads(); const iv = setInterval(() => { loadFollowups(); loadSegThreads(); }, 60000); return () => clearInterval(iv); }, []);
  const hasFu = (email: string) => followups.some((f) => f.status === "scheduled" && (f.contact_email || "").toLowerCase() === (email || "").toLowerCase());
  const deleteSegThread = async (t: any) => {
    try {
      await (supabase as any).from("seg_threads").delete().eq("id", t.id);
      await (supabase as any).from("follow_ups").update({ status: "canceled" }).eq("contact_email", t.contact_email).eq("status", "scheduled");
      setSegThreads((p) => p.filter((x) => x.id !== t.id)); loadFollowups();
      toast.success("Seguimiento eliminado");
    } catch { toast.error("No se pudo eliminar"); }
  };

  const callImap = async (payload: any) => {
    const { data, error } = await supabase.functions.invoke("imap-conversations", { body: payload });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const doSearch = async () => {
    const q = query.trim();
    if (!q) { toast.error("Escribe un nombre o email"); return; }
    setSearching(true); setThreads([]); setActive(null); setConv([]);
    try {
      const d = await callImap({ action: "search", query: q });
      setThreads(d.results || []);
      if (!(d.results || []).length) toast("Sin conversaciones para esa búsqueda");
    } catch (e: any) { toast.error(`No se pudo buscar: ${e?.message || e}`); }
    setSearching(false);
  };

  const openThread = async (t: any) => {
    setActive(t); setImporting(true); setConv([]);
    try {
      const d = await callImap({ action: "import", contactEmail: t.contact_email, subject: t.subject });
      const msgs = (d.messages || []) as any[];
      setConv(msgs);
      const last = msgs[msgs.length - 1];
      setRefs({ inReplyTo: last?.message_id || "", references: [...(last?.references || []), last?.message_id].filter(Boolean).join(" ") });
      setSubject(t.subject ? "Re: " + String(t.subject).replace(/^\s*((re|rv|fwd)\s*:\s*)+/i, "") : "Seguimiento");
      setBodyText("");
      // Guarda este seguimiento (para verlo en "Mis seguimientos" con su nombre).
      try { await (supabase as any).from("seg_threads").upsert({ contact_email: t.contact_email, contact_name: t.contact_name || null, subject: t.subject || "", last_imported_at: new Date().toISOString() }, { onConflict: "owner_id,contact_email,subject" }); loadSegThreads(); } catch { /* */ }
    } catch (e: any) { toast.error(`No se pudo importar: ${e?.message || e}`); }
    setImporting(false);
  };

  const proposeAI = async () => {
    if (!active) return;
    setAiLoading(true);
    try {
      const history = conv.map((c) => ({ role: c.direction === "inbound" ? "user" : "assistant", text: (c.body_text || cleanBody(c.body_html)).slice(0, 600) }));
      const lastIn = [...conv].reverse().find((c) => c.direction === "inbound");
      const { data } = await supabase.functions.invoke("client-service-agent", { body: { action: "chat", company: active.contact_name || active.contact_email, history, message: (lastIn?.body_text || cleanBody(lastIn?.body_html)) || "Propón un buen mensaje de seguimiento para retomar el contacto." } });
      const reply = (data as any)?.reply;
      if (reply) { setBodyText(reply); toast.success("Propuesta lista — revísala antes de enviar"); }
      else toast.error("La IA no devolvió propuesta");
    } catch { toast.error("No se pudo generar la propuesta"); }
    setAiLoading(false);
  };

  const doSend = async (isNow: boolean) => {
    if (!active?.contact_email) { toast.error("Elige una conversación"); return; }
    if (!bodyText.trim()) { toast.error("Escribe el mensaje"); return; }
    if (!isNow && !scheduleAt) { toast.error("Elige fecha y hora"); return; }
    const whenISO = isNow ? new Date().toISOString() : new Date(scheduleAt).toISOString();
    if (!isNow && new Date(whenISO).getTime() < Date.now() - 60000) { toast.error("La fecha debe ser futura"); return; }
    setSending(true);
    try {
      const { error } = await (supabase as any).from("follow_ups").insert({ account_id: TEAM_ACCOUNT, contact_email: active.contact_email, contact_name: active.contact_name || null, subject: subject || "Seguimiento", body: bodyText, scheduled_at: whenISO, in_reply_to: refs.inReplyTo || null, references_hdr: refs.references || null });
      if (error) throw error;
      if (isNow) {
        await supabase.functions.invoke("send-followups", { body: { limit: 5 } });
        toast.success(`Enviado a ${active.contact_email}`);
        setBodyText(""); setTimeout(() => openThread(active), 2500);
      } else { toast.success(`Follow-up programado · ${fmt(whenISO)}`); setBodyText(""); setScheduleAt(""); }
      loadFollowups();
    } catch (e: any) { toast.error(`No se pudo: ${e?.message || e}`); }
    setSending(false);
  };

  const cancelFollowup = async (id: string) => {
    try { await (supabase as any).from("follow_ups").update({ status: "canceled" }).eq("id", id); setFollowups((p) => p.filter((f) => f.id !== id)); } catch { /* */ }
  };
  // Drag a follow-up card onto a day → reprograma a ese día (misma hora).
  const dropOnDay = async (dayStart: Date) => {
    if (!dragId) return;
    const f = followups.find((x) => x.id === dragId); setDragId(null);
    if (!f || f.status !== "scheduled") return;
    const old = new Date(f.scheduled_at); const nd = new Date(dayStart); nd.setHours(old.getHours(), old.getMinutes(), 0, 0);
    if (nd.getTime() < Date.now() - 60000) { toast.error("Ese día ya pasó"); return; }
    try { await (supabase as any).from("follow_ups").update({ scheduled_at: nd.toISOString() }).eq("id", f.id); toast.success(`Movido a ${fmt(nd.toISOString())}`); loadFollowups(); } catch { /* */ }
  };

  if (!user) return null;
  if ((user.email || "").toLowerCase() !== "hello@onepulso.blog") return <Navigate to="/dashboard" replace />;

  const today = dayISO(new Date());
  const scheduled = followups.filter((f) => f.status === "scheduled");
  const fusOn = (d: Date) => scheduled.filter((f) => dayISO(new Date(f.scheduled_at)).getTime() === d.getTime()).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  // Rejilla del MES completo (empieza en lunes), 6 semanas.
  const firstOfMonth = new Date(calMonth.y, calMonth.m, 1);
  const offset = (firstOfMonth.getDay() + 6) % 7; // 0 = lunes
  const gridStart = dayISO(firstOfMonth); gridStart.setDate(gridStart.getDate() - offset);
  const monthCells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return dayISO(d); });
  const monthLabel = firstOfMonth.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const prevMonth = () => setCalMonth((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const nextMonth = () => setCalMonth((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><CalendarClock className="h-6 w-6 text-primary" /> Seguimiento</h1>
        <p className="text-sm text-muted-foreground">Conectado a <b className="text-foreground">team@onepulso.online</b>. Busca a una persona, elige la conversación concreta, impórtala y programa follow-ups en el calendario (arrástralos por día). La IA te propone la respuesta.</p>
      </div>

      {/* Buscar (arriba) */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} placeholder="Buscar por nombre o email (busca en vivo en team@)…" className="pl-8" />
          </div>
          <Button onClick={doSearch} disabled={searching} className="gap-1.5">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar</Button>
        </CardContent>
      </Card>

      {/* Mis seguimientos guardados (lo que ya has importado) */}
      {segThreads.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="flex items-center gap-2 text-sm"><MessageSquare className="h-4 w-4 text-primary" /> Mis seguimientos <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{segThreads.length}</span></CardTitle></CardHeader>
          <CardContent className="grid gap-1.5 sm:grid-cols-2">
            {segThreads.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                <button onClick={() => openThread(t)} className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                    {t.contact_name || t.contact_email}
                    {hasFu(t.contact_email) && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"><Clock className="h-3 w-3" /> follow-up</span>}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{t.subject || t.contact_email}</p>
                </button>
                <button onClick={() => deleteSegThread(t)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Eliminar seguimiento"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Resultados: las diferentes conversaciones/hilos → elige uno */}
      {!active && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Conversaciones encontradas {threads.length > 0 && <span className="text-muted-foreground">· elige una para importarla</span>}</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {searching ? <p className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Buscando en el buzón…</p>
              : threads.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Busca a una persona para ver los distintos hilos que has tenido con ella.</p>
              : threads.map((t, i) => (
                <button key={i} onClick={() => openThread(t)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-border p-3 text-left transition hover:border-primary hover:bg-primary/5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{t.subject || "(sin asunto)"}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.contact_name || t.contact_email} · {t.contact_email}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-muted-foreground">{fmt(t.last_date)}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{t.count} msg</span>
                  </div>
                </button>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Conversación importada + responder */}
      {active && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                <CardTitle className="flex min-w-0 items-center gap-2 text-sm"><Mail className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">{active.subject || active.contact_email}</span></CardTitle>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openThread(active)} title="Reimportar"><RefreshCw className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { setActive(null); setConv([]); }}><ArrowLeft className="h-4 w-4" /> Volver</Button>
                </div>
              </CardHeader>
              <CardContent>
                {importing ? <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Importando este hilo…</p>
                  : conv.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">Hilo vacío. Puedes escribirle abajo.</p>
                  : <div className="max-h-[44vh] space-y-2 overflow-y-auto pr-1">
                      {conv.map((m, i) => (
                        <div key={i} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-xs ${m.direction === "outbound" ? "bg-primary/10" : "bg-muted"}`}>
                            <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">{m.direction === "outbound" ? <Send className="h-3 w-3" /> : <User className="h-3 w-3" />}{m.direction === "outbound" ? "Tú · team@" : (m.from || active.contact_email)} · {fmt(m.date)}</p>
                            <p className="whitespace-pre-wrap break-words text-foreground">{(m.body_text || cleanBody(m.body_html)) || "(sin texto)"}</p>
                          </div>
                        </div>
                      ))}
                    </div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Responder a {active.contact_email}</CardTitle></CardHeader>
              <CardContent className="space-y-2.5">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto" className="text-sm" />
                <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Escribe el mensaje… o pulsa IA" className="min-h-[110px] text-sm" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={proposeAI} disabled={aiLoading}>{aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />} IA: proponer</Button>
                  <Button size="sm" className="gap-1.5" onClick={() => doSend(true)} disabled={sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar ahora</Button>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs" />
                  <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => doSend(false)} disabled={sending || !scheduleAt}><Clock className="h-4 w-4" /> Programar</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Panel lateral: buscar otra */}
          <Card className="h-fit">
            <CardHeader className="py-3"><CardTitle className="flex items-center gap-2 text-sm"><MessageSquare className="h-4 w-4 text-primary" /> Otra conversación</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              <div className="flex gap-1.5">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setActive(null); doSearch(); } }} placeholder="Buscar…" className="h-8 text-xs" />
                <Button size="sm" className="h-8" onClick={() => { setActive(null); doSearch(); }}><Search className="h-4 w-4" /></Button>
              </div>
              {threads.slice(0, 8).map((t, i) => (
                <button key={i} onClick={() => openThread(t)} className={`w-full truncate rounded-lg border px-2 py-1.5 text-left text-xs transition ${active?.subject === t.subject && active?.contact_email === t.contact_email ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                  <span className="font-medium text-foreground">{(t.subject || "(sin asunto)").slice(0, 34)}</span>
                  <span className="block text-[10px] text-muted-foreground">{t.contact_email} · {t.count} msg</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Calendario del MES con arrastrar */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-primary" /> Calendario de follow-ups <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{scheduled.length} programados</span></CardTitle>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={prevMonth} title="Mes anterior">‹</Button>
            <span className="min-w-[130px] text-center text-sm font-semibold capitalize">{monthLabel}</span>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={nextMonth} title="Mes siguiente">›</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { const d = new Date(); setCalMonth({ y: d.getFullYear(), m: d.getMonth() }); }}>Hoy</Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={loadFollowups} title="Actualizar"><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">Arrastra un follow-up a otro día para reprogramarlo (mantiene la hora). Se envían solos a su hora desde team@. Clic en uno para ver el mensaje.</p>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border text-center">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((w) => (
              <div key={w} className="bg-muted/50 py-1 text-[11px] font-semibold text-muted-foreground">{w}</div>
            ))}
            {monthCells.map((d, i) => {
              const items = fusOn(d);
              const isToday = d.getTime() === today.getTime();
              const inMonth = d.getMonth() === calMonth.m;
              const isPast = d.getTime() < today.getTime();
              return (
                <div key={i} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOnDay(d)}
                  className={`min-h-[84px] p-1 text-left align-top ${inMonth ? "bg-card" : "bg-muted/20"} ${isToday ? "ring-1 ring-inset ring-primary" : ""}`}>
                  <p className={`mb-0.5 text-[11px] font-semibold ${isToday ? "text-primary" : inMonth ? (isPast ? "text-muted-foreground/50" : "text-foreground") : "text-muted-foreground/40"}`}>{d.getDate()}</p>
                  <div className="space-y-0.5">
                    {items.map((f) => (
                      <div key={f.id} draggable onDragStart={() => setDragId(f.id)} onDragEnd={() => setDragId(null)} onClick={() => setFuDetail(f)}
                        className="group cursor-pointer rounded border border-primary/30 bg-primary/5 px-1 py-0.5 text-[9px] leading-tight hover:border-primary" title="Ver el mensaje programado">
                        <p className="flex items-center justify-between font-medium text-foreground">
                          <span className="truncate">{new Date(f.scheduled_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} {(f.contact_name || f.contact_email || "").split(/[ @]/)[0]}</span>
                          <button onClick={(e) => { e.stopPropagation(); cancelFollowup(f.id); }} className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" title="Cancelar"><X className="h-2.5 w-2.5" /></button>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Detalle del follow-up programado (clic en el calendario) */}
      <Dialog open={!!fuDetail} onOpenChange={(o) => !o && setFuDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-primary" /> Follow-up programado</DialogTitle>
          </DialogHeader>
          {fuDetail && (
            <div className="space-y-3 py-1 text-sm">
              <div className="rounded-lg bg-muted/40 p-2.5 text-xs">
                <p><b className="text-foreground">Para:</b> {fuDetail.contact_name ? `${fuDetail.contact_name} · ` : ""}{fuDetail.contact_email}</p>
                <p><b className="text-foreground">Se envía:</b> {new Date(fuDetail.scheduled_at).toLocaleString("es-ES", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })} <span className="text-muted-foreground">(desde team@)</span></p>
                <p className="truncate"><b className="text-foreground">Asunto:</b> {fuDetail.subject || "Seguimiento"}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Mensaje programado</p>
                <div className="whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-sm text-foreground">{cleanBody(fuDetail.body) || "(vacío)"}</div>
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { const f = fuDetail; setFuDetail(null); if (f) openThread({ contact_email: f.contact_email, contact_name: f.contact_name, subject: f.subject || "" }); }}><Mail className="h-4 w-4" /> Ver conversación</Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => { if (fuDetail) cancelFollowup(fuDetail.id); setFuDetail(null); }}><X className="h-4 w-4" /> Cancelar follow-up</Button>
              <Button size="sm" onClick={() => setFuDetail(null)}>Cerrar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
