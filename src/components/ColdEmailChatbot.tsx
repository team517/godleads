import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, User, Sparkles, X, Send, Loader2, Maximize2, Minimize2, Paperclip, BarChart3 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid, Legend,
} from "recharts";
import { format, subDays, parseISO } from "date-fns";

type ChartData = {
  type: "campaign_comparison" | "daily_activity" | "status_pie";
  title: string;
  data: any[];
};

type Msg = {
  role: "user" | "assistant" | "charts";
  content: string;
  images?: string[];
  charts?: ChartData[];
  analyticsSummary?: string;
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cold-email-chat`;

const quickPrompts = [
  "📊 Analiza mis campañas con gráficos",
  "Escríbeme un email de prospección para SaaS B2B",
  "Dame 5 asuntos de email con alto open rate",
  "Crea una secuencia de 3 follow-ups",
  "¿Cómo mejoro mi tasa de respuesta?",
  "Estrategias para captar reuniones en frío",
];

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 173 58% 39%))",
  "hsl(var(--chart-3, 197 37% 24%))",
  "hsl(var(--destructive))",
  "hsl(var(--chart-5, 27 87% 67%))",
];

export function ColdEmailChatbot() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const location = useLocation();
  // The Unibox reader lives bottom-right too — hide this floating bubble there
  // so it never covers the "Responder" button.
  const hideHere = location.pathname.startsWith("/unibox");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

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

  const sendMessage = async (text: string, isAutoAnalytics = false) => {
    if ((!text.trim() && pendingImages.length === 0) || isLoading) return;

    const userMsg: Msg = {
      role: "user",
      content: text.trim(),
      images: pendingImages.length > 0 ? [...pendingImages] : undefined,
    };

    // Check if user is asking for analytics/charts
    const isAskingForCharts = !isAutoAnalytics && /analítica|gráfico|gráfica|chart|analiza mis campaña|rendimiento|métricas|estadística/i.test(text);

    const newMessages = [...messages, userMsg];
    if (!isAutoAnalytics) {
      setMessages(newMessages);
    }
    setInput("");
    setPendingImages([]);

    if (isAskingForCharts) {
      const result = await fetchAnalyticsCharts();
      if (result && result.charts.length > 0) {
        const chartMsg: Msg = { role: "charts", content: "", charts: result.charts };
        setMessages(prev => [...prev, chartMsg]);
        // Replace the user message content with analytics summary for AI
        const enrichedMessages = [...newMessages.slice(0, -1), { ...userMsg, content: `${text}\n\n${result.summary}` }];
        await streamToAI(enrichedMessages);
        return;
      }
    }

    await streamToAI(isAutoAnalytics ? [...messages, userMsg] : newMessages);
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
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
                }
                return [...prev, { role: "assistant", content: assistantSoFar }];
              });
            }
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
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
                }
                return [...prev, { role: "assistant", content: assistantSoFar }];
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error("Chat error:", e);
      setMessages(prev => [...prev, { role: "assistant", content: "❌ Error de conexión. Inténtalo de nuevo." }]);
    }

    setIsLoading(false);
  };

  const renderChart = (chart: ChartData, isFullscreen: boolean) => {
    const h = isFullscreen ? 260 : 180;

    if (chart.type === "campaign_comparison") {
      return (
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={chart.data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="sent" name="Enviados" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="replied" name="Respondidos" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="bounced" name="Rebotados" fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === "daily_activity") {
      return (
        <ResponsiveContainer width="100%" height={h}>
          <AreaChart data={chart.data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={4} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="sent" name="Enviados" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.15} />
            <Area type="monotone" dataKey="replied" name="Respondidos" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.15} />
            <Area type="monotone" dataKey="bounced" name="Rebotados" stroke={CHART_COLORS[3]} fill={CHART_COLORS[3]} fillOpacity={0.15} />
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === "status_pie") {
      return (
        <ResponsiveContainer width="100%" height={h}>
          <PieChart>
            <Pie
              data={chart.data}
              cx="50%"
              cy="50%"
              innerRadius={isFullscreen ? 50 : 35}
              outerRadius={isFullscreen ? 85 : 60}
              paddingAngle={3}
              dataKey="value"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={{ strokeWidth: 1 }}
              style={{ fontSize: isFullscreen ? 11 : 9 }}
            >
              {chart.data.map((_: any, i: number) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    return null;
  };

  const chatContent = (isFullscreen: boolean) => (
    <div className={`flex flex-col ${isFullscreen ? "h-full" : "max-h-[600px]"} bg-card`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-primary/5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-sm">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-bold">GodBot</p>
            <p className="text-xs text-muted-foreground">Experto en Cold Email & Outreach</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Minimizar" : "Ampliar"}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setOpen(false); setExpanded(false); }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-4 space-y-4 ${isFullscreen ? "" : "min-h-[300px] max-h-[420px]"}`}
      >
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="rounded-2xl rounded-tl-none bg-muted px-4 py-3 text-sm leading-relaxed max-w-[90%]">
                ¡Hola! 👋 Soy <strong>GodBot</strong>, tu consultor experto en cold email y outreach B2B.
                <br /><br />
                Tengo acceso a <strong>tus analíticas reales</strong>. Puedo generar gráficos 📊 de tus campañas,
                analizar tu rendimiento y darte recomendaciones concretas para <strong>conseguir más reuniones</strong>.
                <br /><br />
                Usa el botón <strong>📊</strong> para adjuntar tus analíticas con gráficos, o adjunta capturas con 📎.
              </div>
            </div>
            <div className={`grid gap-2 pl-10 ${isFullscreen ? "grid-cols-2 max-w-2xl" : "grid-cols-1"}`}>
              {quickPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (prompt.includes("📊")) injectAnalytics();
                    else sendMessage(prompt);
                  }}
                  className="text-left text-xs px-3 py-2.5 rounded-xl border bg-background hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {prompt}
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
                  <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">📊 Analíticas de campañas</p>
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

          return (
            <div key={i} className={`flex items-start gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${msg.role === "user" ? "bg-primary" : "bg-primary/10"}`}>
                {msg.role === "user"
                  ? <User className="h-4 w-4 text-primary-foreground" />
                  : <Bot className="h-4 w-4 text-primary" />}
              </div>
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
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
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
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="rounded-2xl rounded-tl-none bg-muted px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Analizando...</span>
              </div>
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
          onClick={() => fileRef.current?.click()}
          title="Adjuntar imagen"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
          onClick={injectAnalytics}
          disabled={analyticsLoading || isLoading}
          title="Adjuntar analíticas con gráficos"
        >
          {analyticsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
        </Button>
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta sobre cold email, adjunta gráficos..."
          className="flex-1 border-0 bg-muted/50 focus-visible:ring-0 text-sm"
          disabled={isLoading}
        />
        <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={(!input.trim() && pendingImages.length === 0) || isLoading}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
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
            <Button
              onClick={() => setOpen(true)}
              size="lg"
              className="h-14 w-14 rounded-full shadow-2xl shadow-primary/30 hover:shadow-primary/50 transition-shadow"
            >
              <Sparkles className="h-6 w-6" />
            </Button>
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
            className="fixed bottom-6 right-6 z-50 w-[420px] max-h-[600px] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden"
          >
            {chatContent(false)}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
