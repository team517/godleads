import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, X, Send, Loader2, Maximize2, Minimize2, Paperclip, BarChart3, History, UsersRound, MessageCircle, PencilLine, ArrowLeft, Mail } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { lazyWithRetry } from "@/lib/lazy-retry";
import type { ChartData } from "@/components/chatbot/ChatbotCharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SparkMark } from "@/components/SparkMark";
import { useLocation } from "react-router-dom";
import { isMobileAppPath } from "@/lib/mobile-app";
import { contextoParaPulseBot, esOrdenDeAplicar, esPeticionDeCambio, siguePulseBot } from "@/lib/chatbot-intent";
import { TarjetaCambioMini, type AccionCambio, type TarjetaCambioT } from "@/components/chatbot/TarjetaCambioMini";
import { TeamAvatars } from "@/components/chatbot/TeamAvatars";
import { ChatHistoryPanel } from "@/components/chatbot/ChatHistoryPanel";
import { quiereHablarConElEquipo } from "../../supabase/functions/_shared/chat-hub-rules";
import {
  callChatHub, createConversation, deleteConversation, listConversations, loadMessages, rememberTeamThread, rememberVisitorConversation,
  saveMessage, teamContact, teamPoll, teamSend, teamUnread, visitorConversation, visitorId as getVisitorId,
  type ChatConversation, type StoredMessage, type TeamMessage,
} from "@/lib/chat-hub-client";
import type { IaTarjeta } from "@/lib/ia-mod-view";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { format, subDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

// recharts (~100 KB gz) y react-markdown (~50 KB gz) se bajan sólo cuando hay una gráfica o una
// respuesta que pintar — no con el chat, y mucho menos con el botón flotante.
const ChatbotChart = lazyWithRetry(() => import("@/components/chatbot/ChatbotCharts"));
const ChatbotMarkdown = lazyWithRetry(() => import("@/components/chatbot/ChatbotMarkdown"));

/** Modos del chat (10-11-2026): Conversación (consultor + analíticas; visitantes: asistente de
 *  Funnyleads) y Modo edición (PulseBot sobre las campañas de quien habla; sólo con sesión). */
export type ChatMode = "chat" | "edicion";

type Msg = {
  role: "user" | "assistant" | "charts" | "system";
  /** Id guardado (mensajes del hilo con el equipo: evita duplicarlos al sondear). */
  id?: string;
  /** Quién del equipo respondió (chat en directo). */
  author?: string | null;
  content: string;
  images?: string[];
  charts?: ChartData[];
  analyticsSummary?: string;
  /** Tarjetas de PulseBot (cambios en campañas con Confirmar / Deshacer, métricas…). */
  cards?: IaTarjeta[];
  /** Quién contestó: el consultor (stream), PulseBot (herramientas sobre la cuenta), el asistente
   *  de visitantes o el equipo (confirmación de petición). */
  via?: "pulsebot" | "visitante" | "equipo" | "cliente_equipo";
  /** Acción que ofrece el mensaje: pasar a Modo edición con ese texto, abrir "Hablar con el equipo"
   *  o pedir (sin formulario) el correo al que avisar a un visitante. */
  action?: { kind: "modo_edicion"; text: string } | { kind: "equipo" } | { kind: "login" } | { kind: "pedir_email" };
};

/* PulseBot en modo propio: la misma IA con herramientas de "Modificaciones IA", pero sobre la
   cuenta de QUIEN habla. Ve sus campañas y mensajes, propone el cambio con antes/después y lo
   aplica (en campañas activas, tras Confirmar). */
async function llamarPulseBot<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ia-modificaciones", { body: { ...body, self: true } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cold-email-chat`;

/** La sugerencia que abre las analíticas con gráficos (se reconoce por el texto, sin emoji). */
const ANALYTICS_PROMPT = "Analiza mis campañas con gráficos";
const quickPrompts = [
  ANALYTICS_PROMPT,
  "¿Cómo mejoro mi tasa de respuesta?",
  "Dame 5 asuntos con alta tasa de apertura",
  "Escríbeme un email de prospección para SaaS B2B",
  "Crea una secuencia de 3 seguimientos",
];
const editPrompts = [
  "Cambia el asunto del primer correo de mi campaña",
  "Acorta el segundo seguimiento",
  "Pon 3 días de espera entre los pasos",
];
const visitorPrompts = [
  "¿Qué es Funnyleads?",
  "¿Cuánto cuesta?",
  "¿Cómo funciona el warm-up ilimitado?",
  "Quiero una demo",
];

/** Mientras baja el formateador (sólo la primera vez) el texto se enseña sin los ** ni # del
 *  Markdown, para que no asomen asteriscos durante un instante. */
export function textoSinMarcas(t: string): string {
  return String(t || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^[-*]\s+/gm, "• ");
}

/** Lo que se ha dicho hasta ahora, para la transcripción de una petición y para guardar. */
function toStored(m: Msg): StoredMessage | null {
  // Los mensajes del hilo con el equipo los guarda el servidor (chat-hub), no el navegador.
  if (m.role === "charts" || m.role === "system" || m.via === "equipo" || m.via === "cliente_equipo") return null;
  return { role: m.role, content: m.content || "", cards: m.cards && m.cards.length ? m.cards : undefined, via: m.via || null };
}
function fromStored(m: StoredMessage): Msg | null {
  if (m.role === "system") return m.via === "equipo" ? { role: "system", id: m.id, content: m.content } : null;
  return {
    role: m.role, id: m.id, content: m.content, author: m.author_name ?? null,
    cards: Array.isArray(m.cards) ? (m.cards as IaTarjeta[]) : undefined, via: (m.via as Msg["via"]) || undefined,
  };
}
/** Un mensaje del hilo con el equipo, tal como lo devuelve chat-hub. */
function fromTeam(m: TeamMessage): Msg {
  return fromStored(m as StoredMessage) || { role: "system", id: m.id, content: m.content };
}

/** Cada cuánto se sondea el hilo con el equipo con el chat abierto, y los no leídos con él cerrado. */
export const TEAM_POLL_MS = 4000;
export const TEAM_UNREAD_POLL_MS = 30000;

/** `initialOpen`: el botón flotante vive en ChatbotLauncher y monta este componente ya abierto
 *  al primer clic; desde entonces el chat se queda montado (conversación incluida) y pinta su
 *  propio botón al cerrarse, como siempre. */
export function ColdEmailChatbot({ initialOpen = false }: { initialOpen?: boolean } = {}) {
  const [open, setOpen] = useState(initialOpen);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  // Estado real de cada cambio de PulseBot (pending / applied / undone / cancelled), por change_id.
  const [estadosCambio, setEstadosCambio] = useState<Record<string, string>>({});
  const [viaPulseBot, setViaPulseBot] = useState(false);
  const [mode, setMode] = useState<ChatMode>("chat");
  // "Hablar con el equipo": chat en directo con personas del equipo (fotos del equipo en vez de la
  // marca). teamThreadId = conversación con el hilo abierto; se sondea para traer sus respuestas.
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamThreadId, setTeamThreadId] = useState<string | null>(null);
  const [teamUnreadCount, setTeamUnreadCount] = useState(0);
  const teamSinceRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const askedEmailRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const location = useLocation();
  const isVisitor = !user;
  // The Unibox reader lives bottom-right too — hide this floating bubble there
  // so it never covers the "Responder" button. Y en la bienvenida del primer acceso tampoco
  // pinta nada: esa pantalla es sólo cuatro preguntas.
  // Modificaciones IA ya ES el chat de PulseBot: el botón flotante tapaba su panel derecho.
  // La app del móvil (/m) tiene su propia barra abajo: el botón flotante la taparía.
  const hideHere = location.pathname.startsWith("/unibox") || location.pathname.startsWith("/bienvenida") || location.pathname.startsWith("/modificaciones-ia") || isMobileAppPath(location.pathname);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, teamOpen]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  // Sin sesión no hay Modo edición: si se cierra sesión con él activo, vuelve a Conversación.
  useEffect(() => { if (isVisitor && mode === "edicion") setMode("chat"); }, [isVisitor, mode]);

  /** Pinta una conversación ya guardada; si tiene el hilo con el equipo abierto, vuelve a él. */
  const cargarHilo = (convId: string, msgs: Msg[], teamStatus: string | null | undefined) => {
    seenIdsRef.current = new Set(msgs.map((m) => m.id).filter(Boolean) as string[]);
    setMessages(msgs);
    setConversation(convId);
    if (teamStatus === "open" || teamStatus === "closed") {
      setTeamThreadId(convId);
      teamSinceRef.current = new Date().toISOString();
      if (teamStatus === "open") setTeamOpen(true);
      rememberTeamThread(convId, user?.id ?? null);
    }
  };

  // Al abrir: el visitante recupera su última conversación (por chat-hub); el usuario con sesión,
  // un hilo abierto con el equipo si lo tiene (por RLS). Así nadie pierde la respuesta del equipo.
  useEffect(() => {
    if (!open || messages.length > 0) return;
    let cancelado = false;
    if (isVisitor) {
      const convId = visitorConversation();
      if (!convId) return;
      teamPoll({ conversationId: convId, visitorId: getVisitorId() })
        .then((r) => {
          if (cancelado) return;
          const prev = (r.messages || []).map(fromTeam);
          if (prev.length) cargarHilo(convId, prev, r.team_status);
        })
        .catch(() => { /* sin historial: se empieza de cero */ });
    } else {
      (supabase as any).from("chat_conversations").select("id, team_status").eq("team_status", "open")
        .order("last_message_at", { ascending: false }).limit(1)
        .then(async ({ data }: { data: { id: string; team_status: string }[] | null }) => {
          const c = data?.[0];
          if (!c || cancelado) return;
          const prev = (await loadMessages(c.id)).map(fromStored).filter(Boolean) as Msg[];
          if (!cancelado && prev.length) cargarHilo(c.id, prev, c.team_status);
        }, () => { /* sin hilo */ });
    }
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isVisitor]);

  // Hilo abierto y chat abierto: cada 4 s se traen las respuestas nuevas del equipo.
  useEffect(() => {
    if (!open || !teamThreadId) return;
    let vivo = true;
    const tick = async () => {
      try {
        const r = await teamPoll({ conversationId: teamThreadId, visitorId: isVisitor ? getVisitorId() : null, since: teamSinceRef.current });
        if (!vivo) return;
        const nuevos = (r.messages || []).filter((m) => !seenIdsRef.current.has(m.id));
        if (nuevos.length) {
          nuevos.forEach((m) => seenIdsRef.current.add(m.id));
          setMessages((prev) => [...prev, ...nuevos.map(fromTeam)]);
        }
        const ultimo = (r.messages || []).at(-1)?.created_at;
        if (ultimo) teamSinceRef.current = ultimo;
        setTeamUnreadCount(0);
      } catch { /* se reintenta en el siguiente */ }
    };
    void tick();
    const t = window.setInterval(() => void tick(), TEAM_POLL_MS);
    return () => { vivo = false; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teamThreadId, isVisitor]);

  // Chat cerrado con un hilo abierto: cada 30 s se mira si el equipo ha respondido (punto en el botón).
  useEffect(() => {
    if (open || !teamThreadId) return;
    let vivo = true;
    const tick = () => teamUnread(isVisitor ? getVisitorId() : null)
      .then((r) => { if (vivo) setTeamUnreadCount(r.unread || 0); }, () => { /* */ });
    void tick();
    const t = window.setInterval(() => void tick(), TEAM_UNREAD_POLL_MS);
    return () => { vivo = false; window.clearInterval(t); };
  }, [open, teamThreadId, isVisitor]);

  const setConversation = (id: string | null) => { conversationRef.current = id; setConversationId(id); };

  /** Conversación guardada de un usuario con sesión; se crea con el primer mensaje. */
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    if (conversationRef.current) return conversationRef.current;
    try {
      const id = await createConversation(user.id, mode === "edicion" ? "edicion" : "chat");
      setConversation(id);
      return id;
    } catch (e) {
      console.warn("chat: no se pudo crear la conversación:", (e as Error).message);
      return null;
    }
  }, [user, mode]);

  const persist = useCallback(async (m: Msg) => {
    const stored = toStored(m);
    if (!stored || !stored.content.trim()) return;
    const id = await ensureConversation();
    if (id) await saveMessage(id, stored);
  }, [ensureConversation]);

  const nuevaConversacion = () => {
    setMessages([]); setEstadosCambio({}); setConversation(null); setTeamOpen(false); setHistoryOpen(false);
    setTeamThreadId(null); teamSinceRef.current = null; seenIdsRef.current = new Set(); askedEmailRef.current = false;
    rememberTeamThread(null, null);
    if (isVisitor) rememberVisitorConversation(null);
  };

  const abrirHistorial = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      if (isVisitor) {
        const r = await callChatHub<{ conversations: ChatConversation[] }>({ action: "visitor_history", visitor_id: getVisitorId() });
        setConversations(r.conversations || []);
      } else {
        setConversations(await listConversations());
      }
    } catch { setConversations([]); } finally { setHistoryLoading(false); }
  };

  const abrirConversacion = async (id: string) => {
    setHistoryLoading(true);
    try {
      const prev = (await loadMessages(id)).map(fromStored).filter(Boolean) as Msg[];
      const c = conversations.find((x) => x.id === id);
      setTeamOpen(false); setTeamThreadId(null);
      cargarHilo(id, prev, c?.team_status);
      setHistoryOpen(false);
      if (c?.mode === "edicion" && user) setMode("edicion");
    } catch (e) {
      console.warn("chat: no se pudo abrir la conversación:", (e as Error).message);
    } finally { setHistoryLoading(false); }
  };

  const borrarConversacion = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationRef.current === id) nuevaConversacion();
    } catch (e) { console.warn("chat: no se pudo borrar:", (e as Error).message); }
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setPendingImages(prev => [...prev, ev.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  const removePendingImage = useCallback((idx: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // Fetch analytics and generate charts
  const fetchAnalyticsCharts = useCallback(async (): Promise<{ charts: ChartData[]; summary: string } | null> => {
    if (!user) return null;
    setAnalyticsLoading(true);

    try {
      // Fetch campaigns
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, name, status")
        .order("created_at", { ascending: false })
        .limit(15);

      if (!campaigns || campaigns.length === 0) {
        setAnalyticsLoading(false);
        return null;
      }

      const campaignIds = campaigns.map(c => c.id);

      // Fetch sent emails in batches
      let allEmails: any[] = [];
      for (let i = 0; i < campaignIds.length; i += 5) {
        const batch = campaignIds.slice(i, i + 5);
        const { data } = await supabase
          .from("sent_emails")
          .select("campaign_id, status, sent_at, replied_at, bounced_at, opened_at, to_email, subject")
          .in("campaign_id", batch)
          .limit(1000);
        if (data) allEmails.push(...data);
      }

      // Campaign comparison chart
      const campaignComparison = campaigns.map(c => {
        const emails = allEmails.filter(e => e.campaign_id === c.id);
        const sent = emails.filter(e => e.status === "sent" || e.replied_at || e.opened_at).length;
        const replied = emails.filter(e => e.replied_at).length;
        const opened = emails.filter(e => e.opened_at).length;
        const bounced = emails.filter(e => e.bounced_at).length;
        const name = c.name.length > 18 ? c.name.slice(0, 16) + "…" : c.name;
        return { name, sent, replied, opened, bounced, replyRate: sent > 0 ? +((replied / sent) * 100).toFixed(1) : 0 };
      }).filter(c => c.sent > 0);

      // Daily activity (last 30 days)
      const thirtyDaysAgo = subDays(new Date(), 30);
      void thirtyDaysAgo;
      const dailyMap = new Map<string, { sent: number; replied: number; bounced: number }>();
      for (let d = 0; d <= 30; d++) {
        const key = format(subDays(new Date(), 30 - d), "yyyy-MM-dd");
        dailyMap.set(key, { sent: 0, replied: 0, bounced: 0 });
      }
      allEmails.forEach(e => {
        if (e.sent_at) {
          const day = format(parseISO(e.sent_at), "yyyy-MM-dd");
          const entry = dailyMap.get(day);
          if (entry) {
            entry.sent++;
            if (e.replied_at) entry.replied++;
            if (e.bounced_at) entry.bounced++;
          }
        }
      });
      const dailyData = Array.from(dailyMap.entries()).map(([date, vals]) => ({
        date: format(parseISO(date), "dd/MM"),
        ...vals,
      }));

      // Status distribution pie
      const totalSent = allEmails.filter(e => e.status === "sent" || e.replied_at || e.opened_at).length;
      const totalReplied = allEmails.filter(e => e.replied_at).length;
      const totalBounced = allEmails.filter(e => e.bounced_at).length;
      const totalOpened = allEmails.filter(e => e.opened_at && !e.replied_at).length;
      const totalNoResponse = totalSent - totalReplied - totalBounced - totalOpened;
      const pieData = [
        { name: "Respondidos", value: totalReplied },
        { name: "Abiertos", value: Math.max(0, totalOpened) },
        { name: "Sin respuesta", value: Math.max(0, totalNoResponse) },
        { name: "Rebotados", value: totalBounced },
      ].filter(d => d.value > 0);

      const charts: ChartData[] = [];

      if (campaignComparison.length > 0) {
        charts.push({ type: "campaign_comparison", title: "Rendimiento por campaña", data: campaignComparison });
      }
      if (dailyData.some(d => d.sent > 0)) {
        charts.push({ type: "daily_activity", title: "Actividad últimos 30 días", data: dailyData });
      }
      if (pieData.length > 0) {
        charts.push({ type: "status_pie", title: "Distribución de estados", data: pieData });
      }

      const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : "0";
      const openRate = totalSent > 0 ? (((totalOpened + totalReplied) / totalSent) * 100).toFixed(1) : "0";
      const bounceRate = totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : "0";

      const summary = `📊 Analíticas extraídas:
- ${campaigns.length} campañas, ${totalSent} emails enviados
- Reply rate: ${replyRate}% | Open rate: ${openRate}% | Bounce rate: ${bounceRate}%
- Top campaña: "${campaignComparison[0]?.name}" con ${campaignComparison[0]?.replyRate}% reply rate
${campaignComparison.map(c => `  • "${c.name}": ${c.sent} enviados, ${c.replied} respondidos (${c.replyRate}%)`).join("\n")}

Analiza estos datos y dame recomendaciones concretas para mejorar mis resultados y conseguir más reuniones.`;

      setAnalyticsLoading(false);
      return { charts, summary };
    } catch (e) {
      console.error("Error fetching analytics:", e);
      setAnalyticsLoading(false);
      return null;
    }
  }, [user]);

  const injectAnalytics = useCallback(async () => {
    const result = await fetchAnalyticsCharts();
    if (!result || result.charts.length === 0) {
      setMessages(prev => [...prev, { role: "assistant", content: "No tienes campañas con datos suficientes para generar gráficos." }]);
      return;
    }

    // Add charts message
    const chartMsg: Msg = { role: "charts", content: "", charts: result.charts };
    setMessages(prev => [...prev, chartMsg]);

    // Auto-send the summary to AI for analysis
    sendMessage(result.summary, true);
  }, [fetchAnalyticsCharts]);

  const pushAssistant = (m: Omit<Msg, "role"> & { role?: Msg["role"] }) => setMessages((prev) => [...prev, { role: "assistant", ...m } as Msg]);

  const sendMessage = async (text: string, isAutoAnalytics = false) => {
    if ((!text.trim() && pendingImages.length === 0) || isLoading) return;

    const userMsg: Msg = {
      role: "user",
      content: text.trim(),
      images: pendingImages.length > 0 ? [...pendingImages] : undefined,
    };

    // Check if user is asking for analytics/charts
    const isAskingForCharts = !isAutoAnalytics && !isVisitor && /analítica|gráfico|gráfica|chart|analiza mis campaña|rendimiento|métricas|estadística/i.test(text);

    // ── Hablando con el equipo: el mensaje va a las personas (chat-hub), nunca a la IA ──
    if (teamOpen && !isAutoAnalytics) {
      setInput("");
      setPendingImages([]);
      await enviarAlEquipo(text.trim());
      return;
    }

    const newMessages = [...messages, userMsg];
    if (!isAutoAnalytics) {
      setMessages(newMessages);
      void persist(userMsg);
    }
    setInput("");
    setPendingImages([]);

    // ── Visitante sin cuenta: asistente comercial de Funnyleads (chat-hub) ──
    if (isVisitor) {
      await enviarComoVisitante(text.trim());
      return;
    }

    // "Hablar con el equipo": si lo pide con palabras, se le ofrece el formulario además de responder.
    const pideEquipo = !isAutoAnalytics && quiereHablarConElEquipo(text);

    // ── Modo edición: todo va a PulseBot (herramientas sobre la cuenta) ──
    if (mode === "edicion") {
      await enviarAPulseBot(text.trim(), messages);
      if (pideEquipo) pushAssistant({ content: "Si prefieres hablarlo con una persona del equipo, cuéntanoslo aquí y te escribimos.", action: { kind: "equipo" } });
      return;
    }

    // ── Conversación: una petición de cambio NO se aplica aquí; se ofrece el Modo edición ──
    const ultimoAsistente = [...messages].reverse().find((m) => m.role === "assistant");
    if (!isAutoAnalytics && !userMsg.images && (esPeticionDeCambio(text) || esOrdenDeAplicar(text) || siguePulseBot(text, ultimoAsistente?.via === "pulsebot"))) {
      pushAssistant({
        content: "Eso es un cambio en tus campañas. Para aplicarlo de verdad, con el antes y el después y tu confirmación, necesito el **Modo edición**.",
        action: { kind: "modo_edicion", text: text.trim() },
      });
      return;
    }

    if (isAskingForCharts) {
      const result = await fetchAnalyticsCharts();
      if (result && result.charts.length > 0) {
        const chartMsg: Msg = { role: "charts", content: "", charts: result.charts };
        setMessages(prev => [...prev, chartMsg]);
        // Replace the user message content with analytics summary for AI
        const enrichedMessages = [...newMessages.slice(0, -1), { ...userMsg, content: `${text}\n\n${result.summary}` }];
        await streamToAI(enrichedMessages);
        if (pideEquipo) pushAssistant({ content: "Y si quieres verlo con una persona del equipo, déjanos tus datos aquí.", action: { kind: "equipo" } });
        return;
      }
    }

    await streamToAI(isAutoAnalytics ? [...messages, userMsg] : newMessages);
    if (pideEquipo) pushAssistant({ content: "Si quieres hablarlo con una persona del equipo, cuéntanoslo aquí y te escribimos.", action: { kind: "equipo" } });
  };

  /** Pasar a Modo edición y aplicar el texto que el usuario había pedido en Conversación. */
  const activarEdicionY = async (text: string) => {
    if (isVisitor) return;
    setMode("edicion");
    setMessages((prev) => prev.map((m) => (m.action?.kind === "modo_edicion" && m.action.text === text ? { ...m, action: undefined } : m)));
    await enviarAPulseBot(text, messages);
  };

  /** Chat en directo: el mensaje al equipo se guarda en el servidor, que avisa a team@. */
  const enviarAlEquipo = async (texto: string) => {
    if (!texto) return;
    const local: Msg = { role: "user", content: texto, via: "cliente_equipo" };
    setMessages((prev) => [...prev, local]);
    setIsLoading(true);
    try {
      const r = await teamSend({
        conversationId: conversationRef.current, visitorId: isVisitor ? getVisitorId() : null, message: texto,
        page: typeof window !== "undefined" ? window.location.pathname : undefined,
      });
      seenIdsRef.current.add(r.message.id);
      teamSinceRef.current = r.message.created_at;
      setMessages((prev) => prev.map((m) => (m === local ? { ...m, id: r.message.id } : m)));
      setConversation(r.conversation_id);
      setTeamThreadId(r.conversation_id);
      rememberTeamThread(r.conversation_id, user?.id ?? null);
      if (isVisitor) rememberVisitorConversation(r.conversation_id);
      if (r.needs_email && !askedEmailRef.current) {
        askedEmailRef.current = true;
        pushAssistant({ via: "equipo", author: "Equipo de Funnyleads", content: "¡Recibido! ¿A qué correo te avisamos si cierras la ventana?", action: { kind: "pedir_email" } });
      }
    } catch (e) {
      pushAssistant({ role: "system", content: `No se ha podido enviar: ${e instanceof Error ? e.message : "inténtalo de nuevo"}` });
    } finally {
      setIsLoading(false);
    }
  };

  const guardarCorreoContacto = async (email: string) => {
    const conv = conversationRef.current;
    if (!conv) return false;
    try {
      const r = await teamContact({ conversationId: conv, visitorId: isVisitor ? getVisitorId() : null, email });
      setMessages((prev) => prev.map((m) => (m.action?.kind === "pedir_email" ? { ...m, action: undefined } : m)));
      setMessages((prev) => [...prev, { role: "system", content: `Te avisaremos en ${r.contact_email}` }]);
      return true;
    } catch (e) {
      pushAssistant({ role: "system", content: e instanceof Error ? e.message : "No se pudo guardar el correo" });
      return false;
    }
  };

  const enviarComoVisitante = async (texto: string) => {
    setIsLoading(true);
    try {
      const r = await callChatHub<{ conversation_id: string; reply: string; suggest_team?: boolean }>({
        action: "visitor_chat", visitor_id: getVisitorId(), conversation_id: conversationRef.current, message: texto,
      });
      setConversation(r.conversation_id);
      rememberVisitorConversation(r.conversation_id);
      pushAssistant({ content: r.reply, via: "visitante", action: r.suggest_team ? { kind: "equipo" } : undefined });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo responder";
      pushAssistant({ content: msg, via: "visitante", action: /límite/i.test(msg) ? { kind: "equipo" } : undefined });
    } finally {
      setIsLoading(false);
    }
  };

  const enviarAPulseBot = async (texto: string, previos: Msg[]) => {
    setIsLoading(true);
    setViaPulseBot(true);
    try {
      // Lo hablado con el consultor justo antes va como contexto de un solo uso (no se guarda).
      // Si lo último que dijo el asistente fue del consultor (no de PulseBot), PulseBot necesita ver qué se proponía
      // para poder aplicarlo cuando el usuario escribe "aplícalo".
      const ultimoAsistente = [...previos].reverse().find((m) => m.role === "assistant");
      const contexto = ultimoAsistente?.via === "pulsebot" ? "" : contextoParaPulseBot(previos);
      const r = await llamarPulseBot<{ message: { content: string; cards?: IaTarjeta[] }; changes?: Record<string, string> }>({ action: "chat", message: texto, contexto });
      if (r.changes) setEstadosCambio((prev) => ({ ...prev, ...r.changes }));
      const m: Msg = { role: "assistant", content: r.message?.content || "", cards: r.message?.cards || [], via: "pulsebot" };
      setMessages((prev) => [...prev, m]);
      void persist(m);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ ${e instanceof Error ? e.message : "No se pudo aplicar el cambio"}`, via: "pulsebot" }]);
    } finally {
      setIsLoading(false);
      setViaPulseBot(false);
    }
  };

  const accionCambio = async (change_id: string, action: AccionCambio) => {
    try {
      const r = await llamarPulseBot<{ status: string; summary?: string | null; error?: string }>({ action, change_id });
      setEstadosCambio((prev) => ({ ...prev, [change_id]: r.status }));
      // "applied" sólo llega tras releer lo guardado; "failed" trae el motivo y no se ha tocado nada.
      const texto = r.summary || (r.status === "failed" ? `No se ha podido aplicar: ${r.error || "error desconocido"}` : "");
      if (texto) setMessages((prev) => [...prev, { role: "assistant", content: texto, via: "pulsebot" }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ ${e instanceof Error ? e.message : "No se pudo"}`, via: "pulsebot" }]);
    }
  };

  const streamToAI = async (allMessages: Msg[]) => {
    setIsLoading(true);
    let assistantSoFar = "";

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const apiMessages = allMessages
        .filter(m => m.role !== "charts")
        .map(m => {
          if (m.images && m.images.length > 0) {
            return {
              role: m.role,
              content: [
                { type: "text" as const, text: m.content || "Analiza esta imagen:" },
                ...m.images.map(img => ({ type: "image_url" as const, image_url: { url: img } })),
              ],
            };
          }
          return { role: m.role as string, content: m.content };
        });

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Error de conexión" }));
        setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.error || "Error inesperado"}` }]);
        setIsLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      const applyDelta = (content: string) => {
        assistantSoFar += content;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.via && !last.action) {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
          }
          return [...prev, { role: "assistant", content: assistantSoFar }];
        });
      };

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) applyDelta(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) applyDelta(content);
          } catch { /* ignore */ }
        }
      }
      if (assistantSoFar.trim()) void persist({ role: "assistant", content: assistantSoFar });
    } catch (e) {
      console.error("Chat error:", e);
      setMessages(prev => [...prev, { role: "assistant", content: "❌ Error de conexión. Inténtalo de nuevo." }]);
    }

    setIsLoading(false);
  };

  const renderChart = (chart: ChartData, isFullscreen: boolean) => (
    <Suspense fallback={<div style={{ height: isFullscreen ? 260 : 180 }} className="flex items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Cargando gráfico…</div>}>
      <ChatbotChart chart={chart} isFullscreen={isFullscreen} />
    </Suspense>
  );

  /** Avatar del asistente: la marca, o las personas del equipo cuando se habla con él. */
  const BotAvatar = ({ size, team }: { size: number; team: boolean }) =>
    team ? <TeamAvatars size={Math.round(size * 0.85)} /> : <SparkMark size={size} className={size > 40 ? "rounded-xl shadow-sm" : "shrink-0 rounded-[10px]"} />;

  const prompts = isVisitor ? visitorPrompts : mode === "edicion" ? editPrompts : quickPrompts;
  const placeholder = teamOpen ? "Escribe al equipo…" : isVisitor ? "Pregunta lo que quieras sobre Funnyleads…" : mode === "edicion" ? "Dime qué cambiar en tu campaña…" : "Pregunta o pide un análisis de tus campañas…";

  const chatContent = (isFullscreen: boolean) => (
    <div className={`flex flex-col ${isFullscreen ? "h-full" : "max-h-[600px]"} bg-card`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b bg-primary/5 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <BotAvatar size={36} team={teamOpen} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{teamOpen ? "Equipo de Funnyleads" : "FunnyBot"}</p>
            <p className="truncate text-xs text-muted-foreground">{teamOpen ? "Normalmente respondemos en unas horas" : isVisitor ? "Asistente de Funnyleads" : mode === "edicion" ? "Editando tus campañas" : "Tu consultor de cold email"}</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => (historyOpen ? setHistoryOpen(false) : void abrirHistorial())} title="Historial de conversaciones" aria-label="Historial de conversaciones">
            <History className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className={cn("h-8 w-8", teamOpen && "bg-primary/10 text-primary")} onClick={() => setTeamOpen((v) => !v)} title={teamOpen ? "Volver a FunnyBot" : "Hablar con el equipo"} aria-label={teamOpen ? "Volver a FunnyBot" : "Hablar con el equipo"}>
            <UsersRound className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpanded(!expanded)} title={expanded ? "Minimizar" : "Ampliar"}>
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setOpen(false); setExpanded(false); }} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Modo: Conversación | Modo edición. Sólo con sesión: en la landing el visitante no lo ve. */}
      {teamOpen && (
        <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-1.5 shrink-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /> Hablas con personas del equipo
          </span>
          <button type="button" onClick={() => setTeamOpen(false)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10">
            <ArrowLeft className="h-3.5 w-3.5" /> Volver a FunnyBot
          </button>
        </div>
      )}
      {!isVisitor && !teamOpen && (
      <div className="flex items-center gap-1 border-b bg-card px-3 py-1.5 shrink-0" role="tablist" aria-label="Modo del asistente">
        <button type="button" role="tab" aria-selected={mode === "chat"} onClick={() => { setMode("chat"); setTeamOpen(false); }}
          className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors", mode === "chat" ? "bg-primary/10 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:text-foreground")}>
          <MessageCircle className="h-3.5 w-3.5" /> Conversación
        </button>
        <button type="button" role="tab" aria-selected={mode === "edicion"} onClick={() => { setMode("edicion"); setTeamOpen(false); }}
          title="FunnyBot cambia tus campañas y te pide confirmación"
          className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors", mode === "edicion" ? "bg-primary/10 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:text-foreground")}>
          <PencilLine className="h-3.5 w-3.5" /> Modo edición
        </button>
        {conversationId && <span className="ml-auto text-[10.5px] text-muted-foreground">Guardado</span>}
      </div>
      )}

      {historyOpen ? (
        <div className={isFullscreen ? "flex-1 min-h-0" : "min-h-[300px] max-h-[420px]"}>
          <ChatHistoryPanel
            conversations={conversations}
            currentId={conversationId}
            loading={historyLoading}
            onOpen={(id) => void abrirConversacion(id)}
            onNew={nuevaConversacion}
            onDelete={isVisitor ? undefined : (id) => void borrarConversacion(id)}
            onClose={() => setHistoryOpen(false)}
          />
          {isVisitor && <p className="px-4 pb-3 text-[11.5px] text-muted-foreground">Como visitante sólo se guarda tu conversación actual en este navegador. Con una cuenta tendrás todo el historial.</p>}
        </div>
      ) : (
      <>
      {/* Messages */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-4 space-y-4 ${isFullscreen ? "" : "min-h-[300px] max-h-[420px]"}`}
      >
        {messages.length === 0 && !teamOpen && (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5">
              <BotAvatar size={32} team={false} />
              <div className="rounded-2xl rounded-tl-none bg-muted px-4 py-3 text-sm leading-relaxed max-w-[90%]">
                {isVisitor ? (
                  <>¡Hola! Soy <strong>FunnyBot</strong>, el asistente de Funnyleads. Pregúntame qué hace la plataforma, cuánto cuesta o cómo empezar. Si prefieres hablar con una persona, pulsa <strong>Hablar con el equipo</strong>.</>
                ) : mode === "edicion" ? (
                  <>Modo edición activo. Dime qué cambiar en tus campañas (asuntos, mensajes, esperas, variantes, leads) y te enseño el <strong>antes y el después</strong> para que lo confirmes antes de aplicarlo.</>
                ) : (
                  <>¡Hola! Soy <strong>FunnyBot</strong>. Veo <strong>tus campañas y analíticas reales</strong>: te hago gráficos, analizo tu rendimiento y te digo qué cambiar para conseguir más reuniones.<br /><br />Para aplicar cambios activa el <strong>Modo edición</strong>. Para hablar con una persona, <strong>Hablar con el equipo</strong>.</>
                )}
              </div>
            </div>
            <div className={`grid gap-2 pl-10 ${isFullscreen ? "grid-cols-2 max-w-2xl" : "grid-cols-1"}`}>
              {prompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (prompt === ANALYTICS_PROMPT) injectAnalytics();
                    else if (isVisitor && /demo/i.test(prompt)) setTeamOpen(true);
                    else sendMessage(prompt);
                  }}
                  className="text-left text-xs px-3 py-2.5 rounded-xl border bg-background hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    {prompt === ANALYTICS_PROMPT && <BarChart3 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                    {prompt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Charts message
          if (msg.role === "charts" && msg.charts) {
            return (
              <div key={i} className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <BarChart3 className="h-4 w-4 text-primary" />
                </div>
                <div className={`rounded-2xl rounded-tl-none bg-muted p-3 ${isFullscreen ? "max-w-[85%] min-w-[500px]" : "max-w-[92%]"}`}>
                  <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Analíticas de campañas</p>
                  <div className={`space-y-4 ${isFullscreen ? "grid grid-cols-1 gap-4 space-y-0" : ""}`}>
                    {msg.charts.map((chart, j) => (
                      <div key={j} className="bg-background/60 rounded-xl p-3 border">
                        <p className="text-xs font-semibold mb-2">{chart.title}</p>
                        {renderChart(chart, isFullscreen)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          if (msg.role === "system") {
            return (
              <div key={msg.id || i} className="flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{msg.content}</span>
              </div>
            );
          }

          const teamBubble = msg.via === "equipo";
          return (
            <div key={i} className={`flex items-start gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              {msg.role === "user"
                ? <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary"><User className="h-4 w-4 text-primary-foreground" /></div>
                : <BotAvatar size={32} team={teamBubble || (teamOpen && msg.via !== "pulsebot" && msg.via !== "visitante" && !!msg.via)} />}
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${isFullscreen ? "max-w-[75%]" : "max-w-[85%]"} ${msg.role === "user" ? "rounded-tr-none bg-primary text-primary-foreground" : "rounded-tl-none bg-muted"}`}>
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.images.map((img, j) => (
                      <img key={j} src={img} alt="Adjunto" className="rounded-lg max-h-40 max-w-[200px] object-cover border" />
                    ))}
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert [&>p]:my-1.5 [&>ul]:my-1.5 [&>ol]:my-1.5 [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm [&>li]:my-0.5 [&>blockquote]:border-primary/30 [&>blockquote]:bg-primary/5 [&>blockquote]:rounded-lg [&>blockquote]:py-1 [&>pre]:bg-background/80 [&>pre]:rounded-lg [&>pre]:text-xs">
                    {msg.via === "pulsebot" && <p className="!mb-1 !mt-0 text-[10.5px] font-semibold uppercase tracking-wider text-primary/80">FunnyBot · tus campañas</p>}
                    {teamBubble && <p className="!mb-1 !mt-0 text-[10.5px] font-semibold uppercase tracking-wider text-primary/80">{msg.author && msg.author !== "Equipo de Funnyleads" ? `${msg.author} · Equipo de Funnyleads` : "Equipo de Funnyleads"}</p>}
                    {/* Mientras baja react-markdown (sólo la primera vez) el texto se lee en plano. */}
                    <Suspense fallback={<p className="whitespace-pre-wrap">{textoSinMarcas(msg.content)}</p>}>
                      <ChatbotMarkdown>{msg.content}</ChatbotMarkdown>
                    </Suspense>
                    {(msg.cards || []).map((card, j) => (
                      card.type === "cambio" || card.type === "pendiente"
                        ? <TarjetaCambioMini key={card.change_id || j} t={card as TarjetaCambioT} estado={estadosCambio[card.change_id] || (card.type === "pendiente" ? "pending" : "applied")} onAccion={accionCambio} />
                        : card.type === "adjunto" ? null
                        : (card as { summary?: string }).summary
                          ? <p key={j} className="mt-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-[12.5px] text-muted-foreground">{(card as { summary?: string }).summary}</p>
                          : null
                    ))}
                    {msg.action?.kind === "modo_edicion" && (
                      <Button size="sm" className="mt-2 gap-1.5 not-prose" onClick={() => void activarEdicionY((msg.action as { text: string }).text)} disabled={isLoading}>
                        <PencilLine className="h-3.5 w-3.5" /> Activar Modo edición y aplicarlo
                      </Button>
                    )}
                    {msg.action?.kind === "pedir_email" && <CorreoContacto onGuardar={guardarCorreoContacto} />}
                    {msg.action?.kind === "equipo" && !teamOpen && (
                      <Button size="sm" variant="outline" className="mt-2 gap-1.5 not-prose" onClick={() => setTeamOpen(true)}>
                        <UsersRound className="h-3.5 w-3.5" /> Hablar con el equipo
                      </Button>
                    )}
                  </div>
                ) : (
                  msg.content || null
                )}
              </div>
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-start gap-2.5">
            <BotAvatar size={32} team={teamOpen} />
            <div className="rounded-2xl rounded-tl-none bg-muted px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">{teamOpen ? "Enviando…" : viaPulseBot ? "Revisando tu campaña…" : "Pensando…"}</span>
              </div>
            </div>
          </div>
        )}

        {teamOpen && !teamThreadId && (
          <div className="flex items-start gap-2.5">
            <BotAvatar size={32} team />
            <div className="max-w-[85%] rounded-2xl rounded-tl-none bg-muted px-4 py-3 text-sm leading-relaxed">
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-primary/80">Equipo de Funnyleads</p>
              Escríbenos aquí: te responde una persona del equipo en este mismo chat. Si cierras la ventana, te avisamos por correo.
            </div>
          </div>
        )}
      </div>

      {/* Pending images preview */}
      {pendingImages.length > 0 && (
        <div className="px-3 py-2 border-t flex flex-wrap gap-2 bg-muted/30">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img} alt="" className="h-16 w-16 rounded-lg object-cover border" />
              <button
                onClick={() => removePendingImage(i)}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
        className="flex items-center gap-2 border-t px-3 py-3 shrink-0"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
        {!isVisitor && mode === "chat" && !teamOpen && (
          <>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary" onClick={() => fileRef.current?.click()} title="Adjuntar imagen">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary" onClick={injectAnalytics} disabled={analyticsLoading || isLoading} title="Adjuntar analíticas con gráficos">
              {analyticsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            </Button>
          </>
        )}
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="flex-1 border-0 bg-muted/50 focus-visible:ring-0 text-sm"
          disabled={isLoading}
        />
        <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={(!input.trim() && pendingImages.length === 0) || isLoading} aria-label="Enviar">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
      </>
      )}
    </div>
  );

  if (hideHere) return null;

  return (
    <>
      {/* Floating button */}
      <AnimatePresence>
        {!open && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <button
              type="button"
              onClick={() => { setOpen(true); if (teamUnreadCount > 0) setTeamOpen(true); }}
              aria-label={teamUnreadCount > 0 ? `Abrir el chat: ${teamUnreadCount} respuesta(s) nueva(s) del equipo` : "Abrir el asistente"}
              className="relative block rounded-[18px] shadow-[0_12px_28px_rgba(98,64,255,.28)] transition-transform hover:-translate-y-[2px]"
            >
              <SparkMark size={58} className="rounded-[18px]" />
              {teamUnreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white ring-2 ring-background">
                  {teamUnreadCount > 9 ? "9+" : teamUnreadCount}
                </span>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded fullscreen dialog */}
      <Dialog open={open && expanded} onOpenChange={(o) => { if (!o) setExpanded(false); }}>
        <DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 overflow-hidden [&>button]:hidden">
          {chatContent(true)}
        </DialogContent>
      </Dialog>

      {/* Small chat panel */}
      <AnimatePresence>
        {open && !expanded && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-24px)] max-h-[600px] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden"
          >
            {chatContent(false)}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** "¿A qué correo te avisamos?": una sola línea dentro de la burbuja del equipo, no un formulario. */
function CorreoContacto({ onGuardar }: { onGuardar: (email: string) => Promise<boolean> }) {
  const [email, setEmail] = useState("");
  const [guardando, setGuardando] = useState(false);
  const valido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  return (
    <form
      className="not-prose mt-2 flex items-center gap-1.5"
      onSubmit={async (e) => { e.preventDefault(); if (!valido || guardando) return; setGuardando(true); await onGuardar(email.trim()); setGuardando(false); }}
    >
      <label htmlFor="fl-contacto" className="sr-only">Tu correo</label>
      <Input id="fl-contacto" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" className="h-8 flex-1 bg-background text-sm" />
      <Button type="submit" size="sm" className="h-8 gap-1" disabled={!valido || guardando}>
        {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Avisadme
      </Button>
    </form>
  );
}
