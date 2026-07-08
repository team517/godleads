import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Inbox, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { getNotificationVolume, isNotificationEnabled } from "@/components/layout/Topbar";
import { hasWarmupCodes, isBounceOrFailure, detectLangHeuristic } from "@/lib/inbox-filters";

interface InboxMessage {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string;
  is_read: boolean;
  labels: string[] | null;
  lead_id: string | null;
  campaign_id: string | null;
}

/** Same clean-bandeja filter the Unibox uses: no warmup codes, no bounce/noise senders,
 *  and no clearly-foreign mail from senders that aren't real leads. Keeps the dashboard
 *  glance showing only genuine replies. */
function isRealMessage(m: Partial<InboxMessage>): boolean {
  if (isBounceOrFailure(m.from_email || "")) return false;
  if (hasWarmupCodes(m.subject || "", m.body_text || "")) return false;
  if (!(m.lead_id || m.campaign_id)) {
    const sample = (m.body_text && m.body_text.trim()) ? m.body_text : (m.subject || "");
    if (detectLangHeuristic(sample) === "other") return false;
  }
  return true;
}

const createNotificationSound = () => {
  const audio = new Audio("/notification.mp3");
  audio.volume = getNotificationVolume();
  return audio;
};

export default function TodayMessages() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const navigate = useNavigate();

  const fetchToday = async () => {
    if (!user) return;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from("inbox_messages")
      .select("id, from_email, from_name, subject, body_text, received_at, is_read, labels, lead_id, campaign_id")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .gte("received_at", todayStart.toISOString())
      .order("received_at", { ascending: false })
      .limit(80); // fetch extra, then drop warmup/noise before showing 20

    setMessages(((data as InboxMessage[]) || []).filter(isRealMessage).slice(0, 20));
    setLoading(false);
    if (!initialLoadDone.current) initialLoadDone.current = true;
  };

  useEffect(() => {
    if (!user) return;
    fetchToday();

    const channel = supabase
      .channel("today-messages-dashboard")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "inbox_messages",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const msg = payload.new as InboxMessage;
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          // Skip warmup / bounce / foreign noise — never show it or ping for it.
          if (new Date(msg.received_at) >= todayStart && !(msg as any).is_archived && isRealMessage(msg)) {
            setMessages((prev) => [msg, ...prev].slice(0, 20));

            // Sound + toast notification
            if (initialLoadDone.current && isNotificationEnabled()) {
              const notifSound = createNotificationSound();
              notifSound.play().catch(() => {});
              toast({
                title: "📩 Nuevo mensaje",
                description: `${msg.from_name || msg.from_email}: ${msg.subject || "(sin asunto)"}`,
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const labelColor = (label: string) => {
    switch (label) {
      case "Interesado": return "bg-success/20 text-success border-success/30";
      case "No interesado": return "bg-destructive/20 text-destructive border-destructive/30";
      case "Reunión": return "bg-info/20 text-info border-info/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="font-display text-base flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          Mensajes de hoy
          {messages.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {messages.length}
            </Badge>
          )}
        </CardTitle>
        <button
          onClick={() => navigate("/unibox")}
          className="text-xs text-primary hover:underline"
        >
          Ver todos
        </button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Inbox className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No hay mensajes hoy</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {messages.map((msg) => (
              <button
                key={msg.id}
                onClick={() => navigate("/unibox")}
                className={`w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent/50 ${
                  !msg.is_read ? "border-primary/30 bg-primary/5" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${!msg.is_read ? "font-semibold" : "font-medium"}`}>
                      {msg.from_name || msg.from_email}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {msg.subject || "(sin asunto)"}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
                    {formatDistanceToNow(new Date(msg.received_at), { addSuffix: true, locale: es })}
                  </span>
                </div>
                {msg.labels && msg.labels.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {msg.labels.map((l) => (
                      <span key={l} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${labelColor(l)}`}>
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
