import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

/**
 * Compose box that opens PRE-FILLED with a predetermined (non-AI) draft. The owner
 * reviews / edits the subject + body and sends. `onSend` performs the actual send.
 */
export function ComposeEmailDialog({ to, initialSubject, initialBody, onClose, onSend }: {
  to: string;
  initialSubject: string;
  initialBody: string;
  onClose: () => void;
  onSend: (subject: string, body: string) => Promise<void>;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!subject.trim() || !body.trim()) { toast.error("El asunto y el mensaje no pueden estar vacíos"); return; }
    setSending(true);
    try { await onSend(subject, body); onClose(); } finally { setSending(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Redactar correo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Para</Label><Input value={to} disabled className="bg-muted/40" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Asunto</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mensaje</Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={11}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p className="text-[10px] text-muted-foreground">Texto ya redactado: revísalo o edítalo y pulsa Enviar. No interviene ninguna IA.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button onClick={send} disabled={sending} className="gap-1.5">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
