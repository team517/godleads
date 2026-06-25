import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { Send, Image, FileText, Save, Shield, X, Trash2, MessageCircle, ArrowLeft, Plus, Hash } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { containsProfanity } from "@/lib/profanity-filter";

interface CommunityMessage {
  id: string;
  user_id: string;
  user_name: string;
  content: string;
  message_type: string;
  template_snapshot: { name: string; subject: string; body: string } | null;
  media_url: string | null;
  moderation_status: string;
  created_at: string;
  thread_id: string | null;
  reply_count: number;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export default function Community() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarMap, setAvatarMap] = useState<Record<string, string | null>>({});
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [threadReplies, setThreadReplies] = useState<CommunityMessage[]>([]);
  const [threadInput, setThreadInput] = useState("");
  const [sendingThread, setSendingThread] = useState(false);
  const [createThreadOpen, setCreateThreadOpen] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userName = profile.full_name || user?.email?.split("@")[0] || "Usuario";

  const loadAvatars = useCallback(async (userIds: string[]) => {
    const newIds = userIds.filter(id => !(id in avatarMap));
    if (newIds.length === 0) return;
    const { data } = await supabase.from("profiles").select("user_id, avatar_url").in("user_id", newIds);
    if (data) {
      setAvatarMap(prev => {
        const updated = { ...prev };
        data.forEach((p: any) => { updated[p.user_id] = p.avatar_url || null; });
        newIds.forEach(id => { if (!(id in updated)) updated[id] = null; });
        return updated;
      });
    }
  }, [avatarMap]);

  // Fetch top-level threads (messages without thread_id)
  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("community_messages")
        .select("*")
        .is("thread_id", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) {
        const msgs = data as unknown as CommunityMessage[];
        setMessages(msgs);
        const ids = [...new Set(msgs.map(m => m.user_id))];
        if (ids.length > 0) {
          const { data: profiles } = await supabase.from("profiles").select("user_id, avatar_url").in("user_id", ids);
          if (profiles) {
            const map: Record<string, string | null> = {};
            profiles.forEach((p: any) => { map[p.user_id] = p.avatar_url || null; });
            setAvatarMap(map);
          }
        }
      }
    };
    fetchMessages();

    const channel = supabase
      .channel("community-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_messages" }, (payload) => {
        const newMsg = payload.new as CommunityMessage;
        if (newMsg.moderation_status === "blocked" && newMsg.user_id !== user?.id) return;
        if (!newMsg.thread_id) {
          setMessages(prev => [newMsg, ...prev]);
        } else if (newMsg.thread_id === activeThread) {
          setThreadReplies(prev => [...prev, newMsg]);
        }
        // Update reply count on parent
        if (newMsg.thread_id) {
          setMessages(prev => prev.map(m =>
            m.id === newMsg.thread_id ? { ...m, reply_count: m.reply_count + 1 } : m
          ));
        }
        loadAvatars([newMsg.user_id]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "community_messages" }, (payload) => {
        const oldId = (payload.old as any).id;
        setMessages(prev => prev.filter(m => m.id !== oldId));
        setThreadReplies(prev => prev.filter(m => m.id !== oldId));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "community_messages" }, (payload) => {
        const updated = payload.new as CommunityMessage;
        setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
        setThreadReplies(prev => prev.map(m => m.id === updated.id ? updated : m));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const updated = payload.new as any;
        if (updated.user_id) {
          setAvatarMap(prev => ({ ...prev, [updated.user_id]: updated.avatar_url || null }));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, activeThread]);

  // Load thread replies when a thread is selected
  useEffect(() => {
    if (!activeThread) { setThreadReplies([]); return; }
    const loadReplies = async () => {
      const { data } = await supabase
        .from("community_messages")
        .select("*")
        .eq("thread_id", activeThread)
        .order("created_at", { ascending: true })
        .limit(200);
      if (data) {
        const msgs = data as unknown as CommunityMessage[];
        setThreadReplies(msgs);
        const ids = [...new Set(msgs.map(m => m.user_id))];
        if (ids.length > 0) loadAvatars(ids);
      }
    };
    loadReplies();
  }, [activeThread]);

  useEffect(() => {
    threadScrollRef.current?.scrollTo({ top: threadScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [threadReplies]);

  const moderate = async (content: string): Promise<string> => {
    try {
      const { data, error } = await supabase.functions.invoke("moderate-community-message", { body: { content } });
      if (error) return "normal";
      return data?.status || "normal";
    } catch { return "normal"; }
  };

  const sendMessage = useCallback(async (type: string = "text", extra: Partial<CommunityMessage> = {}) => {
    if (!user) return;
    const content = type === "text" ? input.trim() : (extra.content || "");
    if (type === "text" && !content) return;

    // Client-side profanity check
    if (type === "text" && containsProfanity(content)) {
      toast({ title: "Mensaje bloqueado", description: "Tu mensaje contiene lenguaje inapropiado.", variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      const modStatus = type === "text" ? await moderate(content) : "safe";
      if (modStatus === "blocked") {
        toast({ title: "Mensaje bloqueado", description: "Tu mensaje contiene contenido inapropiado y no se puede enviar.", variant: "destructive" });
        setSending(false);
        return;
      }

      const { error } = await supabase.from("community_messages").insert({
        user_id: user.id,
        user_name: userName,
        content,
        message_type: type,
        moderation_status: modStatus,
        ...extra,
      } as any);

      if (error) throw error;
      if (type === "text") setInput("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }, [user, input, userName]);

  const sendThreadReply = useCallback(async () => {
    if (!user || !activeThread || !threadInput.trim()) return;

    if (containsProfanity(threadInput)) {
      toast({ title: "Mensaje bloqueado", description: "Tu mensaje contiene lenguaje inapropiado.", variant: "destructive" });
      return;
    }

    setSendingThread(true);
    try {
      const modStatus = await moderate(threadInput.trim());
      if (modStatus === "blocked") {
        toast({ title: "Mensaje bloqueado", description: "Contenido inapropiado.", variant: "destructive" });
        setSendingThread(false);
        return;
      }

      const { error } = await supabase.from("community_messages").insert({
        user_id: user.id,
        user_name: userName,
        content: threadInput.trim(),
        message_type: "text",
        moderation_status: modStatus,
        thread_id: activeThread,
      } as any);

      if (error) throw error;

      // Increment reply_count on parent
      await supabase.from("community_messages")
        .update({ reply_count: (messages.find(m => m.id === activeThread)?.reply_count || 0) + 1 } as any)
        .eq("id", activeThread);

      setThreadInput("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSendingThread(false);
    }
  }, [user, activeThread, threadInput, userName, messages]);

  const createThread = async () => {
    if (!user || !newThreadTitle.trim()) return;

    if (containsProfanity(newThreadTitle)) {
      toast({ title: "Título bloqueado", description: "Contiene lenguaje inapropiado.", variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      const modStatus = await moderate(newThreadTitle.trim());
      if (modStatus === "blocked") {
        toast({ title: "Bloqueado", description: "Contenido inapropiado.", variant: "destructive" });
        setSending(false);
        return;
      }

      const { error } = await supabase.from("community_messages").insert({
        user_id: user.id,
        user_name: userName,
        content: newThreadTitle.trim(),
        message_type: "text",
        moderation_status: modStatus,
      } as any);

      if (error) throw error;
      setNewThreadTitle("");
      setCreateThreadOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) { toast({ title: "Solo imágenes o vídeos", variant: "destructive" }); return; }
    if (file.size > 10 * 1024 * 1024) { toast({ title: "Máximo 10MB", variant: "destructive" }); return; }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("community-media").upload(path, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("community-media").getPublicUrl(path);
      const extra: any = { media_url: urlData.publicUrl, content: file.name };
      if (activeThread) extra.thread_id = activeThread;
      await sendMessage(isImage ? "image" : "video", extra);
    } catch (e: any) {
      toast({ title: "Error al subir", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const shareTemplate = async (t: EmailTemplate) => {
    setTemplateDialogOpen(false);
    const extra: any = {
      content: `📄 Plantilla: ${t.name}`,
      template_snapshot: { name: t.name, subject: t.subject, body: t.body },
    };
    if (activeThread) {
      // Send as thread reply
      setSendingThread(true);
      try {
        const { error } = await supabase.from("community_messages").insert({
          user_id: user!.id,
          user_name: userName,
          content: extra.content,
          message_type: "template",
          template_snapshot: extra.template_snapshot,
          moderation_status: "safe",
          thread_id: activeThread,
        } as any);
        if (error) throw error;
        await supabase.from("community_messages")
          .update({ reply_count: (messages.find(m => m.id === activeThread)?.reply_count || 0) + 1 } as any)
          .eq("id", activeThread);
      } catch (e: any) {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      } finally {
        setSendingThread(false);
      }
    } else {
      await sendMessage("template", extra);
    }
  };

  const saveTemplate = async (snapshot: { name: string; subject: string; body: string }) => {
    if (!user) return;
    const { error } = await supabase.from("email_templates").insert({
      user_id: user.id,
      name: `${snapshot.name} (copiada)`,
      subject: snapshot.subject,
      body: snapshot.body,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "¡Plantilla guardada!" });
  };

  const fetchTemplates = async () => {
    if (!user) return;
    const { data } = await supabase.from("email_templates").select("*").eq("user_id", user.id);
    if (data) setTemplates(data);
  };

  const deleteMessage = async (msgId: string) => {
    const { error } = await supabase.from("community_messages").delete().eq("id", msgId);
    if (error) toast({ title: "Error al eliminar", description: error.message, variant: "destructive" });
  };

  const statusColor = (s: string) => {
    if (s === "safe") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    if (s === "blocked") return "bg-destructive/10 text-destructive border-destructive/30";
    return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  };

  const statusLabel = (s: string) => {
    if (s === "safe") return "Apto";
    if (s === "blocked") return "No apto";
    return "Normal";
  };

  const activeThreadMsg = activeThread ? messages.find(m => m.id === activeThread) : null;

  const renderBubble = (msg: CommunityMessage, isOwn: boolean) => {
    const isBlocked = msg.moderation_status === "blocked";
    return (
      <div className={`rounded-xl px-3 py-2 text-sm ${
        isBlocked && isOwn
          ? "bg-destructive/10 text-muted-foreground line-through opacity-50"
          : isOwn
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground"
      }`}>
        {msg.message_type === "image" && msg.media_url && (
          <img src={msg.media_url} alt="media" className="rounded-lg max-w-full max-h-60 mb-1" loading="lazy" />
        )}
        {msg.message_type === "video" && msg.media_url && (
          <video src={msg.media_url} controls className="rounded-lg max-w-full max-h-60 mb-1" />
        )}
        {msg.message_type === "template" && msg.template_snapshot ? (
          <Card className="p-3 bg-background/50 border border-border space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm text-foreground">{(msg.template_snapshot as any).name}</span>
            </div>
            <p className="text-xs text-muted-foreground"><strong>Asunto:</strong> {(msg.template_snapshot as any).subject}</p>
            <p className="text-xs text-muted-foreground line-clamp-3">{(msg.template_snapshot as any).body}</p>
            {!isOwn && (
              <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => saveTemplate(msg.template_snapshot as any)}>
                <Save className="h-3 w-3 mr-1" /> Guardar plantilla
              </Button>
            )}
          </Card>
        ) : (
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          {activeThread && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActiveThread(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">
              {activeThread ? "Hilo" : "Comunidad"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {activeThread
                ? `${threadReplies.length} respuestas`
                : `${messages.length} hilos · Chat en tiempo real`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!activeThread && (
            <Dialog open={createThreadOpen} onOpenChange={setCreateThreadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Nuevo hilo
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Crear nuevo hilo</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                  <Input
                    placeholder="¿De qué quieres hablar?"
                    value={newThreadTitle}
                    onChange={e => setNewThreadTitle(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && createThread()}
                  />
                  <Button className="w-full gap-2" onClick={createThread} disabled={sending || !newThreadTitle.trim()}>
                    <Hash className="h-4 w-4" /> Crear hilo
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          <Badge variant="outline" className={statusColor("safe")}>🟢 Apto</Badge>
          <Badge variant="outline" className={statusColor("normal")}>🟡 Normal</Badge>
        </div>
      </div>

      {activeThread ? (
        /* ── Thread view ── */
        <>
          {/* Original thread message */}
          {activeThreadMsg && (
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-start gap-3">
                <Avatar className="h-9 w-9 flex-shrink-0">
                  <AvatarImage src={(activeThreadMsg.user_id === user?.id ? profile.avatar_url : avatarMap[activeThreadMsg.user_id]) || undefined} />
                  <AvatarFallback className="bg-primary/20 text-xs font-bold text-primary">
                    {activeThreadMsg.user_name?.[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{activeThreadMsg.user_name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(activeThreadMsg.created_at), "d MMM, HH:mm", { locale: es })}
                    </span>
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{activeThreadMsg.content}</p>
                </div>
              </div>
            </div>
          )}

          {/* Thread replies */}
          <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {threadReplies.length === 0 && (
              <div className="text-center text-muted-foreground py-10">
                <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Sé el primero en responder</p>
              </div>
            )}
            {threadReplies.map(msg => {
              const isOwn = msg.user_id === user?.id;
              return (
                <div key={msg.id} className={`group flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                  <Avatar className="h-7 w-7 flex-shrink-0">
                    <AvatarImage src={(isOwn ? profile.avatar_url : avatarMap[msg.user_id]) || undefined} />
                    <AvatarFallback className="bg-primary/20 text-[10px] font-bold text-primary">
                      {msg.user_name?.[0]?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`max-w-[75%] flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"}`}>
                    <div className={`flex items-center gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                      <span className="text-[11px] font-medium">{msg.user_name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(msg.created_at), "HH:mm", { locale: es })}
                      </span>
                      {isOwn && (
                        <button onClick={() => deleteMessage(msg.id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-opacity">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {renderBubble(msg, isOwn)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Thread reply input */}
          <div className="border-t border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} />
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Image className="h-4 w-4" />
              </Button>

              <Dialog open={templateDialogOpen} onOpenChange={(o) => { setTemplateDialogOpen(o); if (o) fetchTemplates(); }}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                    <FileText className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[95vw] sm:max-w-md">
                  <DialogHeader><DialogTitle>Compartir plantilla en hilo</DialogTitle></DialogHeader>
                  <ScrollArea className="max-h-60">
                    {templates.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No tienes plantillas guardadas</p>}
                    {templates.map((t) => (
                      <button key={t.id} onClick={() => shareTemplate(t)} className="w-full text-left px-3 py-2 hover:bg-muted rounded-lg transition-colors">
                        <p className="text-sm font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                      </button>
                    ))}
                  </ScrollArea>
                </DialogContent>
              </Dialog>

              <Input
                value={threadInput}
                onChange={e => setThreadInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendThreadReply(); } }}
                placeholder="Responder al hilo..."
                className="flex-1"
                disabled={sendingThread}
              />
              <Button size="icon" className="h-9 w-9 shrink-0" onClick={sendThreadReply} disabled={sendingThread || !threadInput.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        /* ── Thread list view ── */
        <>
          <ScrollArea className="flex-1 px-3 sm:px-4 py-3">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground py-20">
                <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">¡Crea el primer hilo de la comunidad!</p>
              </div>
            )}
            <div className="space-y-2">
              {messages.map(msg => {
                const isOwn = msg.user_id === user?.id;
                const isBlocked = msg.moderation_status === "blocked";

                return (
                  <button
                    key={msg.id}
                    onClick={() => setActiveThread(msg.id)}
                    className="w-full text-left group"
                  >
                    <div className="flex items-start gap-3 rounded-xl border border-border p-4 hover:bg-muted/50 transition-colors">
                      <Avatar className="h-9 w-9 flex-shrink-0">
                        <AvatarImage src={(isOwn ? profile.avatar_url : avatarMap[msg.user_id]) || undefined} alt={msg.user_name} />
                        <AvatarFallback className="bg-primary/20 text-xs font-bold text-primary">
                          {msg.user_name?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold">{msg.user_name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true, locale: es })}
                          </span>
                          <Badge variant="outline" className={`text-[9px] px-1 py-0 ${statusColor(msg.moderation_status)}`}>
                            {statusLabel(msg.moderation_status)}
                          </Badge>
                          {isOwn && (
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteMessage(msg.id); }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-opacity ml-auto"
                              title="Eliminar hilo"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <p className={`text-sm ${isBlocked && isOwn ? "line-through opacity-50" : ""}`}>
                          {msg.message_type === "image" && "📷 "}
                          {msg.message_type === "video" && "🎥 "}
                          {msg.message_type === "template" && "📄 "}
                          {msg.content}
                        </p>
                        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                          <MessageCircle className="h-3 w-3" />
                          <span>{msg.reply_count} {msg.reply_count === 1 ? "respuesta" : "respuestas"}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {/* Quick message input (creates a new thread) */}
          <div className="border-t border-border px-3 sm:px-4 py-3">
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} />
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Image className="h-4 w-4" />
              </Button>

              <Dialog open={templateDialogOpen} onOpenChange={(o) => { setTemplateDialogOpen(o); if (o) fetchTemplates(); }}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                    <FileText className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[95vw] sm:max-w-md">
                  <DialogHeader><DialogTitle>Compartir plantilla</DialogTitle></DialogHeader>
                  <ScrollArea className="max-h-60">
                    {templates.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No tienes plantillas guardadas</p>}
                    {templates.map((t) => (
                      <button key={t.id} onClick={() => shareTemplate(t)} className="w-full text-left px-3 py-2 hover:bg-muted rounded-lg transition-colors">
                        <p className="text-sm font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                      </button>
                    ))}
                  </ScrollArea>
                </DialogContent>
              </Dialog>

              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Escribe para crear un hilo..."
                className="flex-1"
                disabled={sending}
              />
              <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => sendMessage()} disabled={sending || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {uploading && <p className="text-xs text-muted-foreground mt-1">Subiendo archivo...</p>}
          </div>
        </>
      )}
    </div>
  );
}
