import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bot, Loader2, PencilLine, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DraftRow {
  id: string;
  rule_id: string | null;
  ai_response: string;
  draft_subject: string | null;
}

/**
 * Borrador que el agente de respuestas ha dejado para el mensaje abierto en el
 * Unibox. "Enviar" reutiliza EXACTAMENTE el mismo camino que una respuesta
 * manual (misma función send-email, mismo hilo, mismos límites): este panel solo
 * se encarga de marcar la fila del registro cuando el envío ha ido bien.
 */
export function ReplyDraftPanel({
  messageId,
  onSendDraft,
  onEditDraft,
}: {
  messageId: string | null;
  /** Devuelve true solo si el correo ha salido de verdad. */
  onSendDraft: (body: string) => Promise<boolean>;
  onEditDraft: (body: string) => void;
}) {
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [agentName, setAgentName] = useState<string>("");
  const [busy, setBusy] = useState<null | "send" | "discard">(null);

  const load = useCallback(async () => {
    if (!messageId) { setDraft(null); setAgentName(""); return; }
    const { data, error } = await supabase
      .from("auto_reply_log")
      .select("id, rule_id, ai_response, draft_subject")
      .eq("inbox_message_id", messageId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) { setDraft(null); setAgentName(""); return; }
    const row = data as unknown as DraftRow;
    setDraft(row);
    if (row.rule_id) {
      const { data: rule } = await supabase
        .from("auto_reply_rules")
        .select("name")
        .eq("id", row.rule_id)
        .maybeSingle();
      setAgentName((rule as { name?: string } | null)?.name || "");
    } else {
      setAgentName("");
    }
  }, [messageId]);

  useEffect(() => { load(); }, [load]);

  if (!draft) return null;

  const body = draft.ai_response || "";

  const handleSend = async () => {
    if (busy) return;
    setBusy("send");
    try {
      const ok = await onSendDraft(body);
      if (!ok) return; // el toast de error ya lo ha mostrado el envío
      const { error } = await supabase
        .from("auto_reply_log")
        .update({ status: "sent", reviewed_at: new Date().toISOString(), sent_at: new Date().toISOString() })
        .eq("id", draft.id);
      if (error) toast.error(`Se envió, pero no pude marcar el borrador: ${error.message}`);
      setDraft(null);
    } finally {
      setBusy(null);
    }
  };

  const handleDiscard = async () => {
    if (busy) return;
    setBusy("discard");
    const { error } = await supabase
      .from("auto_reply_log")
      .update({ status: "discarded", reviewed_at: new Date().toISOString() })
      .eq("id", draft.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Borrador descartado");
    setDraft(null);
  };

  return (
    <div className="mb-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-primary">
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Borrador del agente{agentName ? ` ${agentName}` : ""}</span>
        </span>
      </div>
      {draft.draft_subject && (
        <p className="mb-1.5 text-[11px] text-muted-foreground">Asunto: {draft.draft_subject}</p>
      )}
      {/* Texto plano a propósito: nunca inyectamos el HTML del modelo en la página. */}
      <p className="mb-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground/80">
        {body}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={handleSend} disabled={busy !== null}>
          {busy === "send" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Enviar
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1.5 text-xs"
          onClick={() => { onEditDraft(body); setDraft(null); }}
          disabled={busy !== null}
        >
          <PencilLine className="h-3 w-3" /> Editar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={handleDiscard}
          disabled={busy !== null}
        >
          {busy === "discard" ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          Descartar
        </Button>
      </div>
    </div>
  );
}

export default ReplyDraftPanel;
