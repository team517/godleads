import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ShieldCheck, Send, Loader2, RefreshCw, Inbox as InboxIcon, AlertTriangle, HelpCircle } from "lucide-react";

type Seed = { id: string; email: string; status: string; tags: string[] | null };
type Account = { id: string; email: string; status: string; smtp_host: string | null; tags: string[] | null };
type Result = { email: string; provider: string; folder: "inbox" | "spam" | "missing" | "error" };

export default function DeliverabilityTest() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState("");
  const [subject, setSubject] = useState("¿Podemos hablar esta semana?");
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [inboxPct, setInboxPct] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);

  const seeds = accounts.filter((a) => (a.tags || []).includes("seed") && a.status === "connected");
  const senders = accounts.filter((a) => !(a.tags || []).includes("seed") && a.status === "connected" && a.smtp_host);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("email_accounts").select("id, email, status, smtp_host, tags").eq("user_id", user.id);
    const list = (data || []) as Account[];
    setAccounts(list);
    if (!fromId) {
      const firstSender = list.find((a) => !(a.tags || []).includes("seed") && a.status === "connected" && a.smtp_host);
      if (firstSender) setFromId(firstSender.id);
    }
  };
  useEffect(() => { load(); }, [user]);

  const runTest = async () => {
    if (!fromId) { toast.error("Elige una cuenta remitente"); return; }
    if (seeds.length === 0) { toast.error("Añade buzones semilla con el tag 'seed'"); return; }
    setSending(true); setResults(null); setInboxPct(null); setTestId(null);
    const { data, error } = await supabase.functions.invoke("placement-test", {
      body: { action: "run", account_id: fromId, subject },
    });
    setSending(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Error al enviar"); return; }
    setTestId(data.test_id);
    setSentAt(Date.now());
    toast.success(`Prueba enviada a ${data.sent}/${data.seeds} buzones semilla. Espera 1-2 min y pulsa "Comprobar".`);
  };

  const checkTest = async () => {
    if (!testId) return;
    setChecking(true);
    const { data, error } = await supabase.functions.invoke("placement-test", { body: { action: "check", test_id: testId } });
    setChecking(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Error al comprobar"); return; }
    setResults(data.results);
    setInboxPct(data.inbox_pct);
  };

  const secsSince = sentAt ? Math.floor((Date.now() - sentAt) / 1000) : 0;

  const folderChip = (f: Result["folder"]) => {
    if (f === "inbox") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">📥 Bandeja</Badge>;
    if (f === "spam") return <Badge className="bg-red-100 text-red-700 border-red-300">🚫 Spam</Badge>;
    if (f === "missing") return <Badge className="bg-amber-100 text-amber-700 border-amber-300">❓ No llegó</Badge>;
    return <Badge variant="outline">⚠ Error IMAP</Badge>;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-primary" /> Test de entregabilidad</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Mira si tus correos caen en <strong>Bandeja</strong> o en <strong>Spam</strong> antes de mandar a leads reales.</p>
      </div>

      {/* Seeds status */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Buzones semilla</span>
            <Badge variant={seeds.length ? "secondary" : "outline"}>{seeds.length} conectados</Badge>
          </div>
          {seeds.length === 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20">
              <AlertTriangle className="mr-1 inline h-4 w-4" /> Aún no tienes buzones semilla. Ve a <strong>Cuentas Email</strong>, añade 3-6 cuentas de prueba de <strong>Gmail, Outlook, Zoho, Yahoo…</strong> (con su IMAP/SMTP) y ponles el tag <code className="rounded bg-amber-100 px-1">seed</code>. Esas serán las que reciban la prueba.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {seeds.map((s) => <Badge key={s.id} variant="outline" className="text-xs">{s.email}</Badge>)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run test */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Cuenta remitente (la que quieres probar)</Label>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
              <option value="">Elige una cuenta…</option>
              {senders.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Asunto de la prueba (usa uno parecido al de tu campaña real)</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <Button onClick={runTest} disabled={sending || seeds.length === 0} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Enviando prueba…" : "Enviar prueba a los buzones semilla"}
          </Button>
        </CardContent>
      </Card>

      {/* Check */}
      {testId && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Prueba enviada hace {secsSince}s. Los correos tardan un poco en llegar — <strong>espera 1-2 minutos</strong> y pulsa comprobar.
            </p>
            <Button onClick={checkTest} disabled={checking} variant="secondary" className="gap-2">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {checking ? "Comprobando…" : "Comprobar dónde cayó"}
            </Button>

            {results && (
              <div className="space-y-3 pt-2">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-3xl font-bold text-foreground">{inboxPct}%</div>
                  <div className="text-xs text-muted-foreground">en Bandeja principal</div>
                </div>
                <div className="space-y-1.5">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{r.email}</span>
                        <Badge variant="outline" className="text-[10px]">{r.provider}</Badge>
                      </div>
                      {folderChip(r.folder)}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <HelpCircle className="mr-1 inline h-3 w-3" /> "No llegó" puede ser que aún no ha llegado (comprueba otra vez en 1 min) o que lo bloquearon. En Gmail la pestaña <em>Promociones</em> cuenta como Bandeja aquí (no se distingue por IMAP).
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
