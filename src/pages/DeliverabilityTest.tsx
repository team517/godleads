import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ShieldCheck, Send, Loader2, RefreshCw, AlertTriangle, HelpCircle, Plus, Trash2 } from "lucide-react";

type Account = { id: string; email: string; status: string; smtp_host: string | null; tags: string[] | null };
type Seed = { id: string; email: string; provider: string | null; imap_host: string; imap_port: number };
type Result = { email: string; provider: string; folder: "inbox" | "spam" | "missing" | "error" };

// Auto-detect IMAP host from the email domain for the big providers.
function detectImap(email: string): { host: string; port: number; provider: string } {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (/gmail|googlemail/.test(d)) return { host: "imap.gmail.com", port: 993, provider: "Gmail" };
  if (/outlook|hotmail|live|msn/.test(d)) return { host: "outlook.office365.com", port: 993, provider: "Outlook" };
  if (/yahoo|ymail/.test(d)) return { host: "imap.mail.yahoo.com", port: 993, provider: "Yahoo" };
  if (/zoho/.test(d)) return { host: "imap.zoho.com", port: 993, provider: "Zoho" };
  return { host: d ? `imap.${d}` : "", port: 993, provider: d || "otro" };
}

export default function DeliverabilityTest() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [fromId, setFromId] = useState("");
  const [subject, setSubject] = useState("¿Podemos hablar esta semana?");
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [inboxPct, setInboxPct] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);

  // Add-seed form
  const [nsEmail, setNsEmail] = useState("");
  const [nsHost, setNsHost] = useState("");
  const [nsPort, setNsPort] = useState(993);
  const [nsUser, setNsUser] = useState("");
  const [nsPass, setNsPass] = useState("");
  const [addingSeed, setAddingSeed] = useState(false);

  const senders = accounts.filter((a) => a.status === "connected" && a.smtp_host);

  const load = async () => {
    if (!user) return;
    const [accRes, seedRes] = await Promise.all([
      supabase.from("email_accounts").select("id, email, status, smtp_host, tags").eq("user_id", user.id),
      (supabase as any).from("placement_seeds").select("id, email, provider, imap_host, imap_port").eq("user_id", user.id),
    ]);
    const list = (accRes.data || []) as Account[];
    setAccounts(list);
    setSeeds((seedRes.data || []) as Seed[]);
    if (!fromId) {
      const first = list.find((a) => a.status === "connected" && a.smtp_host);
      if (first) setFromId(first.id);
    }
  };
  useEffect(() => { load(); }, [user]);

  // When the seed email changes, auto-fill IMAP host/user.
  const onSeedEmail = (v: string) => {
    setNsEmail(v);
    const d = detectImap(v);
    setNsHost(d.host); setNsPort(d.port);
    if (!nsUser || nsUser === "") setNsUser(v);
  };

  const addSeed = async () => {
    if (!user) return;
    if (!nsEmail || !nsHost || !nsUser || !nsPass) { toast.error("Rellena email, host IMAP, usuario y contraseña"); return; }
    setAddingSeed(true);
    const prov = detectImap(nsEmail).provider;
    const { error } = await (supabase as any).from("placement_seeds").insert({
      user_id: user.id, email: nsEmail.trim().toLowerCase(), provider: prov,
      imap_host: nsHost.trim(), imap_port: nsPort, imap_user: (nsUser || nsEmail).trim(), imap_pass: nsPass,
    });
    setAddingSeed(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Buzón semilla ${nsEmail} añadido`);
    setNsEmail(""); setNsHost(""); setNsUser(""); setNsPass(""); setNsPort(993);
    load();
  };

  const deleteSeed = async (id: string) => {
    await (supabase as any).from("placement_seeds").delete().eq("id", id);
    load();
  };

  const runTest = async () => {
    if (!fromId) { toast.error("Elige una cuenta remitente"); return; }
    if (seeds.length === 0) { toast.error("Añade buzones semilla primero"); return; }
    setSending(true); setResults(null); setInboxPct(null); setTestId(null);
    const { data, error } = await supabase.functions.invoke("placement-test", { body: { action: "run", account_id: fromId, subject } });
    setSending(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Error al enviar"); return; }
    setTestId(data.test_id); setSentAt(Date.now());
    toast.success(`Prueba enviada a ${data.sent}/${data.seeds} buzones semilla. Espera 1-2 min y pulsa "Comprobar".`);
  };

  const checkTest = async () => {
    if (!testId) return;
    setChecking(true);
    const { data, error } = await supabase.functions.invoke("placement-test", { body: { action: "check", test_id: testId } });
    setChecking(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Error al comprobar"); return; }
    setResults(data.results); setInboxPct(data.inbox_pct);
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
        <p className="text-xs sm:text-sm text-muted-foreground">Comprueba si tus correos caen en <strong>Bandeja</strong> o <strong>Spam</strong>. Los buzones semilla son un sistema <strong>aparte</strong> — no entran en tu Unibox.</p>
      </div>

      {/* Seeds management */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Buzones semilla (paralelos, no van al Unibox)</span>
            <Badge variant={seeds.length ? "secondary" : "outline"}>{seeds.length}</Badge>
          </div>
          {seeds.length > 0 && (
            <div className="space-y-1.5">
              {seeds.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm">
                  <span className="truncate">{s.email} <span className="text-muted-foreground text-xs">({s.provider} · {s.imap_host})</span></span>
                  <button onClick={() => deleteSeed(s.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
          {/* Add seed */}
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Añadir buzón semilla (Gmail / Outlook / Zoho…)</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="email@gmail.com" value={nsEmail} onChange={(e) => onSeedEmail(e.target.value)} className="text-sm" />
              <Input placeholder="Host IMAP" value={nsHost} onChange={(e) => setNsHost(e.target.value)} className="text-sm" />
              <Input placeholder="Usuario IMAP (= email)" value={nsUser} onChange={(e) => setNsUser(e.target.value)} className="text-sm" />
              <Input placeholder="Contraseña / app password" type="password" value={nsPass} onChange={(e) => setNsPass(e.target.value)} className="text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" value={nsPort} onChange={(e) => setNsPort(parseInt(e.target.value) || 993)} className="w-24 text-sm" />
              <Button size="sm" onClick={addSeed} disabled={addingSeed} className="gap-1.5">
                {addingSeed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Añadir semilla
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              <HelpCircle className="mr-1 inline h-3 w-3" /> El host se autocompleta por el proveedor. En Gmail/Outlook necesitas una <strong>app password</strong> (contraseña de aplicación), no la normal.
            </p>
          </div>
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
            <Label>Asunto de la prueba (parecido al de tu campaña real)</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <Button onClick={runTest} disabled={sending || seeds.length === 0} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Enviando prueba…" : "Enviar prueba a los buzones semilla"}
          </Button>
          {seeds.length === 0 && (
            <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Añade al menos un buzón semilla arriba.</p>
          )}
        </CardContent>
      </Card>

      {/* Check */}
      {testId && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">Prueba enviada hace {secsSince}s. Los correos tardan un poco — <strong>espera 1-2 min</strong> y pulsa comprobar.</p>
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
                <p className="text-[11px] text-muted-foreground"><HelpCircle className="mr-1 inline h-3 w-3" /> "No llegó" = aún no ha llegado (reintenta en 1 min) o lo bloquearon. En Gmail, "Promociones" cuenta como Bandeja aquí.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
