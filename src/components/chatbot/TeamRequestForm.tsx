import { useState } from "react";
import { Loader2, PhoneCall, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TeamAvatars } from "@/components/chatbot/TeamAvatars";
import { callChatHub, DEMO_URL } from "@/lib/chat-hub-client";

/* "Hablar con el equipo" (10-11-2026): formulario dentro del chat. Al enviar, chat-hub guarda la
   petición y manda el aviso a team@onepulso.online; aquí sólo se confirma. */
export interface TeamRequestDefaults { name?: string; email?: string; company?: string }

export function TeamRequestForm({ defaults, conversationId, visitorId, onSent, onCancel }: {
  defaults: TeamRequestDefaults;
  conversationId: string | null;
  visitorId: string | null;
  onSent: (email: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaults.name || "");
  const [email, setEmail] = useState(defaults.email || "");
  const [company, setCompany] = useState(defaults.company || "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await callChatHub({ action: "create_request", name, email, company, message, topic: "Hablar con el equipo", conversation_id: conversationId, visitor_id: visitorId });
      onSent(email.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-background p-3.5 space-y-2.5" aria-label="Hablar con el equipo">
      <div className="flex items-center gap-2.5">
        <TeamAvatars size={28} />
        <div>
          <p className="text-sm font-semibold leading-tight">Hablar con el equipo</p>
          <p className="text-[11.5px] text-muted-foreground">Te responde una persona por correo, normalmente el mismo día.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" aria-label="Nombre" required className="h-9 text-sm" />
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Empresa (opcional)" aria-label="Empresa" className="h-9 text-sm" />
      </div>
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tu correo" aria-label="Correo" required className="h-9 text-sm" />
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="¿Qué necesitas? (demo, precio a medida, una duda…)" aria-label="Qué necesitas" required rows={3} className="text-sm" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="gap-1.5" disabled={sending}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar al equipo
        </Button>
        <a href={DEMO_URL} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-foreground hover:bg-muted">
          <PhoneCall className="h-3.5 w-3.5" /> Prefiero una llamada
        </a>
        <button type="button" onClick={onCancel} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
      </div>
    </form>
  );
}
