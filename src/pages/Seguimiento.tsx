import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CalendarClock, Search, Sparkles, Send, Loader2, Mail, User, X, Clock, RefreshCw } from "lucide-react";

// Seguimiento — connect team@onepulso.online, import a person's whole conversation, reply, and
// schedule follow-ups in a calendar. AI proposes a reply from the conversation context.
const TEAM_ACCOUNT = "a638362a-dff1-4d44-9d27-f2e7390d15fc"; // team@onepulso.online mailbox
const cleanBody = (h?: string | null) => (h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const dayLabel = (iso: string) => {
  const d = new Date(iso); const t = new Date(); const tm = new Date(); tm.setDate(t.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, t)) return "Hoy"; if (same(d, tm)) return "Mañana";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" });
};

export default function Seguimiento() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState<{ email: string; name?: string } | null>(null);
  const [conv, setConv] = useState<any[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [thread, setThread] = useState<{ inReplyTo: string; references: string }>({ inReplyTo: "", references: "" });
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [followups, setFollowups] = useState<any[]>([]);

  const loadFollowups = async () => {
    try { const { data } = await (supabase as any).from("follow_ups").select("*").in("status", ["scheduled", "sent"]).order("scheduled_at", { ascending: true }).limit(100); setFollowups((data as any[]) || []); } catch { /* */ }
  };
  useEffect(() => { loadFollowups(); const iv = setInterval(loadFollowups, 60000); return () => clearInterval(iv); }, []);

  const doSearch = async () => {
    const q = query.trim().replace(/[,()%]/g, " ").trim();
    if (!q) return;
    setSearching(true);
    try {
      const { data: inb } = await (supabase as any).from("inbox_messages").select("from_email, from_name, subject, received_at").eq("account_id", TEAM_ACCOUNT).or(`from_email.ilike.%${q}%,from_name.ilike.%${q}%,subject.ilike.%${q}%`).order("received_at", { ascending: false }).limit(80);
      const map = new Map<string, any>();
      for (const m of (inb as any[]) || []) { const e = (m.from_email || "").toLowerCase(); if (!e) continue; if (!map.has(e)) map.set(e, { email: e, name: m.from_name || "", last: m.received_at, subject: m.subject }); }
      const { data: snt } = await (supabase as any).from("sent_emails").select("to_email, subject, sent_at").ilike("to_email", `%${q}%`).order("sent_at", { ascending: false }).limit(50);
      for (const m of (snt as any[]) || []) { const e = (m.to_email || "").toLowerCase(); if (!e || map.has(e)) continue; map.set(e, { email: e, name: "", last: m.sent_at, subject: m.subject }); }
      // If they typed a full email, offer it directly even if no history yet.
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q.toLowerCase()) && !map.has(q.toLowerCase())) map.set(q.toLowerCase(), { email: q.toLowerCase(), name: "", last: null, subject: "" });
      setContacts([...map.values()].sort((a, b) => new Date(b.last || 0).getTime() - new Date(a.last || 0).getTime()));
    } catch { toast.error("No se pudo buscar"); }
    setSearching(false);
  };

  const openContact = async (email: string, name?: string) => {
    setActive({ email, name }); setLoadingConv(true); setConv([]);
    try {
      const { data: inb } = await (supabase as any).from("inbox_messages").select("id, from_email, from_name, subject, body_text, body_html, received_at, message_id, ref_chain").eq("account_id", TEAM_ACCOUNT).ilike("from_email", email).order("received_at", { ascending: true }).limit(200);
      const { data: snt } = await (supabase as any).from("sent_emails").select("id, to_email, subject, body, sent_at").ilike("to_email", email).order("sent_at", { ascending: true }).limit(200);
      const items = [
        ...((inb as any[]) || []).map((m) => ({ dir: "in", who: m.from_name || m.from_email, subject: m.subject, body: cleanBody(m.body_text || m.body_html), at: m.received_at, message_id: m.message_id, ref_chain: m.ref_chain })),
        ...((snt as any[]) || []).map((m) => ({ dir: "out", who: "Tú · team@", subject: m.subject, body: cleanBody(m.body), at: m.sent_at })),
      ].filter((x) => x.at).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      setConv(items);
      const lastIn = [...((inb as any[]) || [])].reverse()[0];
      setThread({ inReplyTo: lastIn?.message_id || "", references: [lastIn?.ref_chain, lastIn?.message_id].filter(Boolean).join(" ") });
      const lastSubj = items.length ? items[items.length - 1].subject : "";
      setSubject(lastSubj ? "Re: " + String(lastSubj).replace(/^\s*((re|rv|fwd)\s*:\s*)+/i, "") : "Seguimiento");
      setBodyText("");
    } catch { toast.error("No se pudo cargar la conversación"); }
    setLoadingConv(false);
  };

  const proposeAI = async () => {
    if (!active) { toast.error("Elige un contacto primero"); return; }
    setAiLoading(true);
    try {
      const history = conv.map((c) => ({ role: c.dir === "in" ? "user" : "assistant", text: (c.body || "").slice(0, 600) }));
      const lastIn = [...conv].reverse().find((c) => c.dir === "in");
      const { data } = await supabase.functions.invoke("client-service-agent", { body: { action: "chat", company: active.name || active.email, history, message: lastIn?.body || "Propón un buen mensaje de seguimiento para retomar el contacto." } });
      const reply = (data as any)?.reply;
      if (reply) { setBodyText(reply); toast.success("Propuesta de la IA lista — revísala antes de enviar"); }
      else toast.error("La IA no devolvió propuesta");
    } catch { toast.error("No se pudo generar la propuesta"); }
    setAiLoading(false);
  };

  const doSend = async (isNow: boolean) => {
    if (!active?.email) { toast.error("Elige un contacto"); return; }
    if (!bodyText.trim()) { toast.error("Escribe el mensaje"); return; }
    if (!isNow && !scheduleAt) { toast.error("Elige fecha y hora para programar"); return; }
    const whenISO = isNow ? new Date().toISOString() : new Date(scheduleAt).toISOString();
    if (!isNow && new Date(whenISO).getTime() < Date.now() - 60000) { toast.error("La fecha debe ser futura"); return; }
    setSending(true);
    try {
      const { error } = await (supabase as any).from("follow_ups").insert({ account_id: TEAM_ACCOUNT, contact_email: active.email, contact_name: active.name || null, subject: subject || "Seguimiento", body: bodyText, scheduled_at: whenISO, in_reply_to: thread.inReplyTo || null, references_hdr: thread.references || null });
      if (error) throw error;
      if (isNow) {
        await supabase.functions.invoke("send-followups", { body: { limit: 5 } });
        toast.success(`Mensaje enviado a ${active.email}`);
        setBodyText(""); setTimeout(() => active && openContact(active.email, active.name), 2000);
      } else {
        toast.success(`Follow-up programado para ${fmt(whenISO)}`);
        setBodyText(""); setScheduleAt("");
      }
      loadFollowups();
    } catch (e: any) { toast.error(`No se pudo: ${e?.message || e}`); }
    setSending(false);
  };

  const cancelFollowup = async (id: string) => {
    try { await (supabase as any).from("follow_ups").update({ status: "canceled" }).eq("id", id); setFollowups((prev) => prev.filter((f) => f.id !== id)); } catch { /* */ }
  };

  if (!user) return null;
  if ((user.email || "").toLowerCase() !== "hello@onepulso.blog") return <Navigate to="/dashboard" replace />;

  // Group scheduled (future) follow-ups by day for the calendar/agenda.
  const scheduled = followups.filter((f) => f.status === "scheduled");
  const byDay: Record<string, any[]> = {};
  for (const f of scheduled) { const k = new Date(f.scheduled_at).toDateString(); (byDay[k] = byDay[k] || []).push(f); }
  const dayKeys = Object.keys(byDay).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><CalendarClock className="h-6 w-6 text-primary" /> Seguimiento</h1>
        <p className="text-sm text-muted-foreground">Conectado a <b className="text-foreground">team@onepulso.online</b>. Busca a una persona, importa toda vuestra conversación, responde y programa follow-ups en el calendario. La IA te propone la respuesta según el contexto.</p>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} placeholder="Buscar por nombre, email o asunto…" className="pl-8" />
          </div>
          <Button onClick={doSearch} disabled={searching} className="gap-1.5">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Contacts */}
        <Card className="h-fit">
          <CardHeader className="py-3"><CardTitle className="text-sm">Contactos</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {contacts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Busca para ver con quién has hablado desde team@.</p>
            ) : contacts.map((c) => (
              <button key={c.email} onClick={() => openContact(c.email, c.name)} className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${active?.email === c.email ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                <p className="truncate font-medium text-foreground">{c.name || c.email}</p>
                <p className="truncate text-[11px] text-muted-foreground">{c.email}{c.last ? ` · ${fmt(c.last)}` : ""}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Conversation + compose */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
              <CardTitle className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-primary" /> {active ? (active.name || active.email) : "Conversación"}</CardTitle>
              {active && <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openContact(active.email, active.name)}><RefreshCw className="h-4 w-4" /> Actualizar</Button>}
            </CardHeader>
            <CardContent>
              {!active ? (
                <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Elige un contacto para importar toda vuestra conversación.</p>
              ) : loadingConv ? (
                <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Importando la conversación…</p>
              ) : conv.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">Sin mensajes con este contacto todavía. Puedes escribirle abajo.</p>
              ) : (
                <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                  {conv.map((m, i) => (
                    <div key={i} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${m.dir === "out" ? "bg-primary/10 text-foreground" : "bg-muted text-foreground"}`}>
                        <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">{m.dir === "out" ? <Send className="h-3 w-3" /> : <User className="h-3 w-3" />}{m.who} · {fmt(m.at)}</p>
                        {m.subject && <p className="text-[11px] font-semibold">{m.subject}</p>}
                        <p className="whitespace-pre-wrap break-words">{m.body || "(sin texto)"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Compose */}
          {active && (
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Responder a {active.email}</CardTitle></CardHeader>
              <CardContent className="space-y-2.5">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto" className="text-sm" />
                <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Escribe el mensaje… o pulsa IA para una propuesta" className="min-h-[120px] text-sm" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={proposeAI} disabled={aiLoading}>{aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />} IA: proponer respuesta</Button>
                  <Button size="sm" className="gap-1.5" onClick={() => doSend(true)} disabled={sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar ahora</Button>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs" />
                  <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => doSend(false)} disabled={sending || !scheduleAt}><Clock className="h-4 w-4" /> Programar follow-up</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Calendar / agenda of scheduled follow-ups */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-primary" /> Calendario de seguimientos <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{scheduled.length} programados</span></CardTitle>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={loadFollowups}><RefreshCw className="h-4 w-4" /> Actualizar</Button>
        </CardHeader>
        <CardContent>
          {dayKeys.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No hay follow-ups programados. Escribe un mensaje arriba, elige fecha y hora, y pulsa "Programar follow-up".</p>
          ) : (
            <div className="space-y-4">
              {dayKeys.map((k) => (
                <div key={k}>
                  <p className="mb-1.5 text-xs font-semibold capitalize text-muted-foreground">{dayLabel(byDay[k][0].scheduled_at)}</p>
                  <div className="space-y-1.5">
                    {byDay[k].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()).map((f) => (
                      <div key={f.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{new Date(f.scheduled_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {f.contact_name || f.contact_email}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{f.subject || "Seguimiento"} — {cleanBody(f.body).slice(0, 80)}</p>
                        </div>
                        <button onClick={() => cancelFollowup(f.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Cancelar"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
