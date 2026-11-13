import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, X, Send, Loader2, Maximize2, Minimize2, Paperclip, BarChart3, UsersRound, PencilLine, Mail, ChevronLeft, ChevronRight, MoreHorizontal, MessageSquare, Sparkle, CircleHelp, Plus } from "lucide-react";
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
import { ChatMessagesList } from "@/components/chatbot/ChatMessagesList";
import { ChatHelpCenter } from "@/components/chatbot/ChatHelpCenter";
import { AiTile, ChatBottomTabs, HEADER_GRADIENT, HeaderTile, HeaderWave, TeamStack, type ChatScreen } from "@/components/chatbot/chat-ui";
import { useProfile } from "@/contexts/ProfileContext";
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
import { OPEN_CHATBOT } from "@/lib/chatbot-events";

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
export function ColdEmailChatbot({ initialOpen = false, initialUnread = 0 }: { initialOpen?: boolean; initialUnread?: number } = {}) {
  const [open, setOpen] = useState(initialOpen);
  // «Pregunta a la IA» de la barra de arriba: abre el chat en el modo conversación.
  useEffect(() => {
    const abrir = () => { setOpen(true); };
    window.addEventListener(OPEN_CHATBOT, abrir);
    return () => window.removeEventListener(OPEN_CHATBOT, abrir);
  }, []);
  // Rediseño 11-11-2026: Inicio / Mensajes / Ayuda (barra de abajo) y la conversación. Si el
  // equipo ha respondido, se abre directamente en el hilo con el equipo.
  const [screen, setScreen] = useState<ChatScreen>(initialUnread > 0 ? "chat" : "home");
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [teamOpen, setTeamOpen] = useState(initialUnread > 0);
  const [teamThreadId, setTeamThreadId] = useState<string | null>(null);
  const [teamUnreadCount, setTeamUnreadCount] = useState(initialUnread);
  const teamSinceRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const askedEmailRef = useRef(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { profile } = useProfile();
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
  }, [messages, teamOpen, screen]);

  useEffect(() => {
    if (open && inputRef.current && (screen === "chat" || screen === "home")) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open, screen]);

  // El menú "⋯" se cierra al cambiar de pantalla.
  useEffect(() => { setMenuOpen(false); }, [screen, teamOpen, open]);

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

  // Hilo abierto y conversación a la vista: cada 4 s se traen las respuestas nuevas del equipo.
  useEffect(() => {
    if (!open || !teamThreadId || screen !== "chat") return;
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
  }, [open, teamThreadId, isVisitor, screen]);

  // Chat cerrado (o en Inicio / Mensajes / Ayuda) con un hilo abierto: cada 30 s se mira si el
  // equipo ha respondido (número en el botón flotante y en la pestaña Mensajes). Sin marcar leído.
  useEffect(() => {
    if ((open && screen === "chat") || !teamThreadId) return;
    let vivo = true;
    const tick = () => teamUnread(isVisitor ? getVisitorId() : null)
      .then((r) => { if (vivo) setTeamUnreadCount(r.unread || 0); }, () => { /* */ });
    void tick();
    const t = window.setInterval(() => void tick(), TEAM_UNREAD_POLL_MS);
    return () => { vivo = false; window.clearInterval(t); };
  }, [open, teamThreadId, isVisitor, screen]);

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
    setMessages([]); setEstadosCambio({}); setConversation(null); setTeamOpen(false);
    setTeamThreadId(null); teamSinceRef.current = null; seenIdsRef.current = new Set(); askedEmailRef.current = false;
    rememberTeamThread(null, null);
    if (isVisitor) rememberVisitorConversation(null);
  };

  /** Pestaña Mensajes: las conversaciones guardadas. El visitante sólo ve la suya actual. */
  const cargarMensajes = async () => {
    setHistoryLoading(true);
    try {
      if (isVisitor) {
        const actual = conversationRef.current || visitorConversation();
        if (!actual) { setConversations([]); return; }
        const r = await callChatHub<{ conversations: ChatConversation[] }>({ action: "visitor_history", visitor_id: getVisitorId() });
        setConversations((r.conversations || []).filter((c) => c.id === actual)
          .map((c) => ({ ...c, team_status: c.team_status ?? (actual === teamThreadId ? (teamOpen ? "open" : "closed") : null) })));
      } else {
        setConversations(await listConversations());
      }
    } catch { setConversations([]); } finally { setHistoryLoading(false); }
  };

  const irA = (s: ChatScreen) => {
    setScreen(s);
    if (s === "messages") void cargarMensajes();
  };

  const abrirConversacion = async (c: ChatConversation) => {
    const id = c.id;
    // La que ya está en pantalla: sólo se vuelve a ella.
    if (id === conversationRef.current && messages.length > 0) {
      if (c.team_status === "open") setTeamOpen(true);
      setScreen("chat");
      return;
    }
    setHistoryLoading(true);
    try {
      let prev: Msg[];
      let status = c.team_status;
      if (isVisitor) {
        const r = await teamPoll({ conversationId: id, visitorId: getVisitorId() });
        prev = (r.messages || []).map(fromTeam);
        status = r.team_status;
      } else {
        prev = (await loadMessages(id)).map(fromStored).filter(Boolean) as Msg[];
      }
      setTeamOpen(false); setTeamThreadId(null);
      cargarHilo(id, prev, status);
      setMode(c.mode === "edicion" && user ? "edicion" : "chat");
      setScreen("chat");
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

  // Sin useCallback: así usa la conversación de ahora, no la del primer render.
  const injectAnalytics = async () => {
    const result = await fetchAnalyticsCharts();
    if (!result || result.charts.length === 0) {
      setMessages(prev => [...prev, { role: "assistant", content: "No tienes campañas con datos suficientes para generar gráficos." }]);
      return;
    }

    // Add charts message
    const chartMsg: Msg = { role: "charts", content: "", charts: result.charts };
    setMessages(prev => [...prev, chartMsg]);

    // Auto-send the summary to AI for analysis (al consultor, nunca al Modo edición)
    void sendMessage(result.summary, true, { ai: true });
  };

  const pushAssistant = (m: Omit<Msg, "role"> & { role?: Msg["role"] }) => setMessages((prev) => [...prev, { role: "assistant", ...m } as Msg]);

  /** `ai`: el mensaje va al Asistente IA aunque haya un hilo con el equipo abierto (desde Inicio). */
  const sendMessage = async (text: string, isAutoAnalytics = false, opts: { ai?: boolean } = {}) => {
    if ((!text.trim() && pendingImages.length === 0) || isLoading) return;

    const userMsg: Msg = {
      role: "user",
      content: text.trim(),
      images: pendingImages.length > 0 ? [...pendingImages] : undefined,
    };

    // Check if user is asking for analytics/charts
    const isAskingForCharts = !isAutoAnalytics && !isVisitor && /analítica|gráfico|gráfica|chart|analiza mis campaña|rendimiento|métricas|estadística/i.test(text);

    // ── Hablando con el equipo: el mensaje va a las personas (chat-hub), nunca a la IA ──
    if (teamOpen && !isAutoAnalytics && !opts.ai) {
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
    if (mode === "edicion" && !opts.ai) {
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

  /** Avatar del asistente en las burbujas: el cuadrado lila con la estrella, o las personas del equipo. */
  const BotAvatar = ({ team }: { team: boolean }) =>
    team ? <TeamAvatars size={22} className="mt-1" /> : <AiTile size={36} />;

  const prompts = isVisitor ? visitorPrompts : mode === "edicion" ? editPrompts : quickPrompts;
  const nombre = isVisitor ? "" : String(profile?.full_name || "").trim().split(/\s+/)[0] || "";
  const puedeAdjuntar = !isVisitor && mode === "chat" && !teamOpen;

  /** "Habla con nuestro equipo": el chat en directo de siempre, en la pantalla de conversación. */
  const abrirEquipo = () => { setTeamOpen(true); setScreen("chat"); };
  /** Desde Inicio: conversación con el Asistente IA con ese mensaje (consultor o, sin sesión, el
   *  asistente de visitantes). Nunca al equipo ni al Modo edición. */
  const preguntarIA = (texto: string) => {
    if (!texto.trim() || isLoading) return;
    setTeamOpen(false); setMode("chat"); setScreen("chat");
    void sendMessage(texto, false, { ai: true });
  };
  const analizarCampanas = () => { setTeamOpen(false); setMode("chat"); setScreen("chat"); setMenuOpen(false); void injectAnalytics(); };

  const tarjetaInicio = (icon: React.ReactNode, title: string, sub: string, onClick: () => void) => (
    <button type="button" onClick={onClick}
      className="flex min-h-[65px] w-full items-center gap-4 rounded-[18px] bg-white py-3 pl-4 pr-3.5 text-left shadow-[0_6px_18px_-10px_rgba(60,40,170,.22)] ring-1 ring-[#EEEBF8] transition hover:-translate-y-px hover:ring-[#D9D1FB] dark:bg-card dark:ring-border">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[#F0EDFE] text-[#6E58F1] dark:bg-primary/15" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-tight tracking-[-0.005em] text-[#0E1330] dark:text-foreground">{title}</span>
        <span className="mt-[3px] block text-[12.5px] leading-snug tracking-[-0.005em] text-slate-500 dark:text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#6E58F1]" strokeWidth={2.2} aria-hidden="true" />
    </button>
  );

  const botonCerrar = (claro: boolean) => (
    <button type="button" onClick={() => { setOpen(false); setExpanded(false); }} aria-label="Cerrar"
      className={cn("rounded-full p-1.5 transition-colors", claro ? "text-white/95 hover:bg-white/15" : "text-slate-500 hover:bg-slate-100 dark:text-muted-foreground dark:hover:bg-muted")}>
      <X className="h-6 w-6" strokeWidth={2} />
    </button>
  );

  const renderChart = (chart: ChartData, isFullscreen: boolean) => (
    <Suspense fallback={<div style={{ height: isFullscreen ? 260 : 180 }} className="flex items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Cargando gráfico…</div>}>
      <ChatbotChart chart={chart} isFullscreen={isFullscreen} />
    </Suspense>
  );

  /* ── Inicio ─────────────────────────────────────────────────────────────────────────────── */
  const pantallaInicio = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="relative shrink-0 overflow-hidden px-6 pb-[66px] pt-6 text-white"
        style={{ background: HEADER_GRADIENT, WebkitMaskImage: "linear-gradient(to bottom, #000 70%, transparent 100%)", maskImage: "linear-gradient(to bottom, #000 70%, transparent 100%)" }}>
        <HeaderWave />
        <div className="relative flex items-center gap-3">
          <HeaderTile size={38} />
          <span className="min-w-0 flex-1 truncate font-display text-[18px] font-semibold tracking-[-0.01em]">Asistente IA</span>
          <TeamStack size={36} />
          {botonCerrar(true)}
        </div>
        <h2 className="relative mt-[34px] font-display text-[28px] font-semibold leading-[1.04] tracking-[-0.02em]">
          Hola 👋{" "}<br />¿Cómo podemos{" "}<br />ayudarte?
        </h2>
      </div>
      <div className="relative -mt-[42px] space-y-[5px] px-3">
        {tarjetaInicio(<MessageSquare className="h-5 w-5" strokeWidth={1.9} />, "Habla con nuestro equipo", "Te respondemos en menos de 10 minutos", abrirEquipo)}
        {tarjetaInicio(<Sparkle className="h-5 w-5" fill="currentColor" strokeWidth={1.4} />, "Descubre la plataforma", "Conoce todo lo que puedes hacer",
          () => preguntarIA(isVisitor ? "¿Qué es Funnyleads y qué puedo hacer con la plataforma?" : "¿Qué puedo hacer con Funnyleads? Explícame la plataforma paso a paso"))}
        {tarjetaInicio(<CircleHelp className="h-5 w-5" strokeWidth={1.9} />, "Centro de ayuda", "Encuentra respuestas rápidas", () => irA("help"))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); preguntarIA(input); }} className="mt-auto shrink-0 px-3 pb-[13px] pt-[21px]">
        <div className="flex h-12 items-center gap-2 rounded-2xl border border-[#E4E0F5] bg-white pl-4 pr-[6px] focus-within:border-[#B9ABFA] dark:border-border dark:bg-card">
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe un mensaje..." aria-label="Escribe un mensaje"
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-[#0E1330] outline-none placeholder:text-slate-400 dark:text-foreground" />
          <button type="submit" aria-label="Enviar" disabled={!input.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#6E58F1] text-white shadow-[0_6px_14px_-6px_rgba(110,88,241,.9)] transition hover:bg-[#5F49E6]">
            <Send className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </form>
    </div>
  );

  /* ── Conversación ───────────────────────────────────────────────────────────────────────── */
  const itemMenu = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onClick(); }}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-[#1A1D33] hover:bg-[#F3F0FE] dark:text-foreground dark:hover:bg-muted">
      <span className="text-[#6E58F1]" aria-hidden="true">{icon}</span>{label}
    </button>
  );

  const pantallaChat = (isFullscreen: boolean) => (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {menuOpen && <div className="absolute inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      {/* Cabecera violeta */}
      <div className="relative shrink-0 overflow-hidden text-white" style={{ background: HEADER_GRADIENT }}>
        <HeaderWave />
        <div className="relative flex items-center gap-3 px-3 pb-[26px] pt-4">
          <button type="button" onClick={() => setScreen("home")} aria-label="Volver al inicio" className="rounded-full p-1.5 text-white/95 hover:bg-white/15">
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
          </button>
          {teamOpen ? <TeamStack size={30} /> : <HeaderTile size={38} />}
          <div className="min-w-0 flex-1 pr-9">
            <p className="truncate font-display text-[17px] font-semibold leading-tight">{teamOpen ? "Equipo de Funnyleads" : "Asistente IA"}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-white/80">{teamOpen ? "Normalmente respondemos en menos de 10 minutos" : "El equipo también puede ayudarte"}</p>
          </div>
        </div>
      </div>
      <div className="absolute right-3 top-[23px] z-20">
        <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="Más opciones" aria-haspopup="menu" aria-expanded={menuOpen}
          className="rounded-full p-1.5 text-white/95 hover:bg-white/15">
          <MoreHorizontal className="h-6 w-6" strokeWidth={2.2} />
        </button>
        {menuOpen && (
          <div role="menu" aria-label="Opciones del chat"
            className="absolute right-0 top-11 w-[252px] rounded-2xl bg-white p-1.5 shadow-[0_18px_40px_-12px_rgba(30,20,90,.35)] ring-1 ring-[#ECE8FA] dark:bg-popover dark:ring-border">
            {!isVisitor && !teamOpen && itemMenu(<PencilLine className="h-4 w-4" />, mode === "edicion" ? "Salir del Modo edición" : "Modo edición", () => setMode(mode === "edicion" ? "chat" : "edicion"))}
            {!isVisitor && itemMenu(analyticsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />, "Analizar mis campañas con gráficos", analizarCampanas)}
            {teamOpen
              ? itemMenu(<Sparkle className="h-4 w-4" />, "Volver al Asistente IA", () => setTeamOpen(false))
              : itemMenu(<UsersRound className="h-4 w-4" />, "Hablar con el equipo", () => setTeamOpen(true))}
            {itemMenu(expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />, expanded ? "Reducir" : "Ampliar", () => setExpanded(!expanded))}
            {itemMenu(<Plus className="h-4 w-4" />, "Nueva conversación", () => { nuevaConversacion(); setMode("chat"); })}
            {itemMenu(<X className="h-4 w-4" />, "Cerrar el chat", () => { setOpen(false); setExpanded(false); })}
          </div>
        )}
      </div>

      {/* Cuerpo blanco que monta sobre la cabecera */}
      <div className="relative -mt-3.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[22px] bg-white dark:bg-card">
        {mode === "edicion" && !teamOpen && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#EEEAFB] bg-[#F7F5FF] px-4 py-2 text-[12.5px] text-[#4B3BD0] dark:border-border dark:bg-primary/10 dark:text-primary">
            <span className="inline-flex min-w-0 items-center gap-1.5"><PencilLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">Modo edición · cambios en tus campañas con confirmación</span></span>
            <button type="button" onClick={() => setMode("chat")} className="shrink-0 rounded-full px-2 py-0.5 font-semibold hover:bg-[#ECE7FE] dark:hover:bg-primary/15">Salir</button>
          </div>
        )}

        <div ref={scrollRef} className={cn("min-h-0 flex-1 space-y-[18px] overflow-y-auto px-4 pb-4 pt-5", isFullscreen && "px-8")}>
          {messages.length === 0 && !teamOpen && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <BotAvatar team={false} />
                <div className="max-w-[84%] rounded-[22px] bg-[#F5F4F9] px-[18px] py-3.5 text-[15px] leading-[1.5] text-[#1A1D33] dark:bg-muted dark:text-foreground">
                  {mode === "edicion" ? (
                    <p>Modo edición activo. Dime qué cambiar en tus campañas (asuntos, mensajes, esperas, variantes, leads) y te enseño el <strong>antes y el después</strong> para que lo confirmes antes de aplicarlo.</p>
                  ) : (
                    <>
                      <p>Hola{nombre ? `, ${nombre}` : ""}, estás chateando con nuestro Asistente IA. Cuéntame qué necesitas hacer o en qué te gustaría que te ayudemos, y te guiaré paso a paso.</p>
                      <p className="mt-3">Cuanta más información compartas, mejor podré ayudarte.</p>
                    </>
                  )}
                </div>
              </div>
              <div className={cn("flex flex-wrap gap-2 pl-12", isFullscreen && "max-w-3xl")}>
                {prompts.map((prompt) => (
                  <button key={prompt} type="button"
                    onClick={() => {
                      if (prompt === ANALYTICS_PROMPT) void injectAnalytics();
                      else if (isVisitor && /demo/i.test(prompt)) setTeamOpen(true);
                      else void sendMessage(prompt);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#E4E0F5] bg-white px-3.5 py-2 text-left text-[13px] font-medium text-[#4B3BD0] transition-colors hover:border-[#CFC6FA] hover:bg-[#F7F5FF] dark:border-border dark:bg-card dark:text-primary dark:hover:bg-muted">
                    {prompt === ANALYTICS_PROMPT && <BarChart3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === "charts" && msg.charts) {
              return (
                <div key={i} className="flex items-start gap-3">
                  <AiTile size={36} />
                  <div className={cn("rounded-[22px] bg-[#F5F4F9] p-3 dark:bg-muted", isFullscreen ? "min-w-[500px] max-w-[85%]" : "max-w-[86%]")}>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Analíticas de campañas</p>
                    <div className="space-y-4">
                      {msg.charts.map((chart, j) => (
                        <div key={j} className="rounded-2xl border border-[#ECE8FA] bg-white p-3 dark:border-border dark:bg-background/60">
                          <p className="mb-2 text-xs font-semibold">{chart.title}</p>
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
                  <span className="rounded-full bg-[#F5F4F9] px-3 py-1 text-[12px] text-slate-500 dark:bg-muted dark:text-muted-foreground">{msg.content}</span>
                </div>
              );
            }

            if (msg.role === "user") {
              return (
                <div key={i} className="flex items-center justify-end gap-3">
                  <div className={cn("rounded-[22px] bg-gradient-to-r from-[#8B66F8] to-[#6A4BEE] px-[18px] py-3.5 text-[15px] leading-[1.5] text-white shadow-[0_10px_22px_-12px_rgba(110,88,241,.8)]", isFullscreen ? "max-w-[70%]" : "max-w-[78%]")}>
                    {msg.images && msg.images.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {msg.images.map((img, j) => <img key={j} src={img} alt="Adjunto" className="max-h-40 max-w-[200px] rounded-xl border border-white/30 object-cover" />)}
                      </div>
                    )}
                    {msg.content ? <span className="whitespace-pre-wrap break-words">{msg.content}</span> : null}
                  </div>
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#F0EDFE] text-[#6E58F1] dark:bg-primary/15" aria-hidden="true">
                    <User className="h-[18px] w-[18px]" strokeWidth={1.9} />
                  </span>
                </div>
              );
            }

            const teamBubble = msg.via === "equipo";
            return (
              <div key={i} className="flex items-start gap-3">
                <BotAvatar team={teamBubble} />
                <div className={cn("min-w-0 rounded-[22px] bg-[#F5F4F9] px-[18px] py-3.5 text-[15px] leading-[1.5] text-[#1A1D33] dark:bg-muted dark:text-foreground", isFullscreen ? "max-w-[75%]" : "max-w-[84%]")}>
                  <div className="prose max-w-none text-[15px] leading-[1.5] text-inherit dark:prose-invert prose-p:my-2 first:prose-p:mt-0 prose-strong:text-inherit prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-headings:text-inherit [&>h1]:text-base [&>h2]:text-[15px] [&>h3]:text-[15px] [&>blockquote]:rounded-lg [&>blockquote]:border-primary/30 [&>blockquote]:bg-primary/5 [&>blockquote]:py-1 [&>pre]:rounded-lg [&>pre]:bg-background/80 [&>pre]:text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    {msg.via === "pulsebot" && <p className="!mb-1 !mt-0 text-[10.5px] font-semibold uppercase tracking-wider text-[#6E58F1]">Asistente IA · tus campañas</p>}
                    {teamBubble && <p className="!mb-1 !mt-0 text-[10.5px] font-semibold uppercase tracking-wider text-[#6E58F1]">{msg.author && msg.author !== "Equipo de Funnyleads" ? `${msg.author} · Equipo de Funnyleads` : "Equipo de Funnyleads"}</p>}
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
                      <Button size="sm" className="not-prose mt-2 gap-1.5 rounded-xl bg-[#6E58F1] hover:bg-[#5F49E6]" onClick={() => void activarEdicionY((msg.action as { text: string }).text)} disabled={isLoading}>
                        <PencilLine className="h-3.5 w-3.5" /> Activar Modo edición y aplicarlo
                      </Button>
                    )}
                    {msg.action?.kind === "pedir_email" && <CorreoContacto onGuardar={guardarCorreoContacto} />}
                    {msg.action?.kind === "equipo" && !teamOpen && (
                      <Button size="sm" variant="outline" className="not-prose mt-2 gap-1.5 rounded-xl" onClick={() => setTeamOpen(true)}>
                        <UsersRound className="h-3.5 w-3.5" /> Hablar con el equipo
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex items-start gap-3">
              <BotAvatar team={teamOpen} />
              <div className="rounded-[22px] bg-[#F5F4F9] px-4 py-3 dark:bg-muted">
                <span className="flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-[#6E58F1]" />
                  {teamOpen ? "Enviando…" : viaPulseBot ? "Revisando tu campaña…" : "Pensando…"}
                </span>
              </div>
            </div>
          )}

          {teamOpen && !teamThreadId && (
            <div className="flex items-start gap-3">
              <BotAvatar team />
              <div className="max-w-[84%] rounded-[22px] bg-[#F5F4F9] px-[18px] py-3.5 text-[15px] leading-[1.5] text-[#1A1D33] dark:bg-muted dark:text-foreground">
                <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#6E58F1]">Equipo de Funnyleads</p>
                Escríbenos aquí: te responde una persona del equipo en este mismo chat. Si cierras la ventana, te avisamos por correo.
              </div>
            </div>
          )}
        </div>

        {pendingImages.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 px-4 pt-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="group relative">
                <img src={img} alt="" className="h-16 w-16 rounded-xl border object-cover" />
                <button type="button" onClick={() => removePendingImage(i)} aria-label="Quitar imagen"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); void sendMessage(input); }} className="shrink-0 px-4 pb-4 pt-2.5">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileUpload} />
          <div className="flex h-[52px] items-center gap-1 rounded-[18px] border border-[#E4E0F5] bg-white pl-4 pr-[6px] focus-within:border-[#B9ABFA] dark:border-border dark:bg-card">
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe un mensaje..." aria-label="Escribe un mensaje" disabled={isLoading}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-[#0E1330] outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-foreground" />
            {puedeAdjuntar && (
              <button type="button" onClick={() => fileRef.current?.click()} aria-label="Adjuntar imagen" title="Adjuntar imagen"
                className="rounded-xl p-2 text-slate-400 transition-colors hover:text-[#6E58F1]">
                <Paperclip className="h-[19px] w-[19px]" strokeWidth={1.9} />
              </button>
            )}
            <button type="submit" aria-label="Enviar" disabled={(!input.trim() && pendingImages.length === 0) || isLoading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#6E58F1] text-white shadow-[0_6px_14px_-6px_rgba(110,88,241,.9)] transition hover:bg-[#5F49E6]">
              <Send className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  /* ── Panel: la pantalla activa y, fuera de la conversación, la barra de abajo ───────────── */
  const chatContent = (isFullscreen: boolean) => (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#F6F4FD] font-sans dark:bg-background">
      {screen === "home" && pantallaInicio}
      {screen === "messages" && (
        <ChatMessagesList
          conversations={conversations}
          currentId={conversationId}
          unreadId={teamUnreadCount > 0 ? teamThreadId : null}
          loading={historyLoading}
          isVisitor={isVisitor}
          onOpen={(c) => void abrirConversacion(c)}
          onNew={() => { nuevaConversacion(); setMode("chat"); setScreen("chat"); }}
          onDelete={isVisitor ? undefined : (id) => void borrarConversacion(id)}
        />
      )}
      {screen === "help" && <ChatHelpCenter onTalkToTeam={abrirEquipo} />}
      {screen === "chat" && pantallaChat(isFullscreen)}
      {(screen === "messages" || screen === "help") && <div className="absolute right-4 top-4">{botonCerrar(false)}</div>}
      {screen !== "chat" && <ChatBottomTabs active={screen} unread={teamUnreadCount} onChange={irA} />}
    </div>
  );

  if (hideHere) return null;

  return (
    <>
      {/* Botón flotante: la baldosa con la estrella */}
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
              onClick={() => { setOpen(true); if (teamUnreadCount > 0) { setTeamOpen(true); setScreen("chat"); } }}
              aria-label={teamUnreadCount > 0 ? `Abrir el chat: ${teamUnreadCount} respuesta(s) nueva(s) del equipo` : "Abrir el Asistente IA"}
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

      {/* Ampliado */}
      <Dialog open={open && expanded} onOpenChange={(o) => { if (!o) setExpanded(false); }}>
        <DialogContent className="h-[85vh] max-w-4xl gap-0 overflow-hidden rounded-[28px] p-0 sm:rounded-[28px] [&>button]:hidden">
          {chatContent(true)}
        </DialogContent>
      </Dialog>

      {/* Ventana del chat: 380 px y esquinas de 28 px; en el móvil, pantalla completa */}
      <AnimatePresence>
        {open && !expanded && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-label="Asistente IA"
            className={cn("fixed bottom-6 right-6 z-50 flex w-[400px]", screen === "chat" ? "h-[min(680px,calc(100dvh-48px))]" : "h-[min(566px,calc(100dvh-48px))]", " max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[28px] shadow-[0_30px_70px_-22px_rgba(76,56,200,.5),0_10px_30px_-14px_rgba(76,56,200,.3)] ring-1 ring-[#6E58F1]/10 max-sm:inset-0 max-sm:h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:rounded-none")}
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
