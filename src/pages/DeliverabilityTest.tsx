import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  ShieldCheck, Send, Loader2, RefreshCw, AlertTriangle, HelpCircle, Plus, Trash2, Inbox, ShieldAlert,
  Clock, CheckCircle2, FileText, PencilLine, Lock, Tag as TagIcon,
} from "lucide-react";
import { replaceVariables, variablesUsed } from "@/lib/personalize";
import { textToHtmlBody } from "@/lib/mime-headers";
import {
  contentHints, sampleFieldsFor, summarizePlacement, type PlacementSummary, type SeedResult,
} from "@/lib/placement";
import { cn } from "@/lib/utils";

type Account = { id: string; email: string; status: string; smtp_host: string | null; first_name: string | null; last_name: string | null };
type Seed = { id: string; email: string; provider: string | null; imap_host: string; imap_port: number };
type Campaign = { id: string; name: string; status: string | null };
type Variant = { subject?: string; body?: string };
type Step = { id: string; step_order: number; subject: string | null; body: string | null; variants: Variant[] | null };
type Access = { allowed: boolean; agency?: boolean; ready?: boolean; providers?: string[]; remaining?: number | null; reason?: string };
type HistoryRow = { id: string; from_email: string; subject: string; inbox: number | null; spam: number | null; missing: number | null; seeds: number | null; status: string; created_at: string };

/** Hoja blanca para previsualizar el correo (el HTML del autor trae sus propios colores). */
const PAPER = "rounded-md border border-zinc-200 bg-white text-zinc-900 [color-scheme:light] [&_a]:text-blue-700 [&_a]:underline";
const AUTO_CHECK_FIRST_MS = 40_000;
const AUTO_CHECK_EVERY_MS = 30_000;
const AUTO_CHECK_MAX = 8;

// Auto-detect IMAP host from the email domain for the big providers (gestor de semillas de la agencia).
function detectImap(email: string): { host: string; port: number; provider: string } {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (/gmail|googlemail/.test(d)) return { host: "imap.gmail.com", port: 993, provider: "Gmail" };
  if (/outlook|hotmail|live|msn/.test(d)) return { host: "outlook.office365.com", port: 993, provider: "Outlook" };
  if (/yahoo|ymail/.test(d)) return { host: "imap.mail.yahoo.com", port: 993, provider: "Yahoo" };
  if (/zoho/.test(d)) return { host: "imap.zoho.com", port: 993, provider: "Zoho" };
  return { host: d ? `imap.${d}` : "", port: 993, provider: d || "otro" };
}

const VERDICT: Record<PlacementSummary["verdict"], { title: string; tone: string; icon: typeof Inbox }> = {
  inbox: { title: "Llega a la bandeja de entrada", tone: "border-success/40 bg-success/5 text-success", icon: CheckCircle2 },
  mixed: { title: "Resultado mixto: parte llega a bandeja y parte a spam", tone: "border-warning/40 bg-warning/5 text-warning", icon: AlertTriangle },
  spam: { title: "Cae en spam", tone: "border-destructive/40 bg-destructive/5 text-destructive", icon: ShieldAlert },
  pending: { title: "Todavía no ha llegado", tone: "border-border bg-muted/30 text-muted-foreground", icon: Clock },
  unknown: { title: "Sin resultado", tone: "border-border bg-muted/30 text-muted-foreground", icon: HelpCircle },
};

export default function DeliverabilityTest() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [access, setAccess] = useState<Access | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [mode, setMode] = useState<"campaign" | "paste">("campaign");
  const [campaignId, setCampaignId] = useState("");
  const [stepKey, setStepKey] = useState(""); // "<stepId>:<0 = original, 1.. = variante>"
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [leadFields, setLeadFields] = useState<Record<string, unknown> | null>(null);
  const [fieldEdits, setFieldEdits] = useState<Record<string, string>>({});
  const [fromId, setFromId] = useState("");

  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [results, setResults] = useState<SeedResult[] | null>(null);
  const [summary, setSummary] = useState<PlacementSummary | null>(null);
  const [autoChecks, setAutoChecks] = useState(0);
  const timer = useRef<number | null>(null);

  // Gestor de buzones semilla (sólo agencia)
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [nsEmail, setNsEmail] = useState("");
  const [nsHost, setNsHost] = useState("");
  const [nsPort, setNsPort] = useState(993);
  const [nsUser, setNsUser] = useState("");
  const [nsPass, setNsPass] = useState("");
  const [addingSeed, setAddingSeed] = useState(false);

  const senders = useMemo(() => accounts.filter((a) => a.status === "connected" && a.smtp_host), [accounts]);
  const sender = senders.find((a) => a.id === fromId) || null;

  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any).from("placement_tests")
      .select("id, from_email, subject, inbox, spam, missing, seeds, status, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(8);
    setHistory((data || []) as HistoryRow[]);
  }, [user]);

  const loadSeeds = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any).from("placement_seeds").select("id, email, provider, imap_host, imap_port").eq("user_id", user.id);
    setSeeds((data || []) as Seed[]);
  }, [user]);

  const loadAccess = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("placement-test", { body: { action: "access" } });
    if (error || !data) { setAccess({ allowed: true, ready: true }); return; } // un fallo de red no debe enseñar el muro de pago
    setAccess(data as Access);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [accRes, campRes] = await Promise.all([
        supabase.from("email_accounts").select("id, email, status, smtp_host, first_name, last_name").eq("user_id", user.id).order("email"),
        supabase.from("campaigns").select("id, name, status").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);
      const list = (accRes.data || []) as Account[];
      setAccounts(list);
      setCampaigns((campRes.data || []) as Campaign[]);
      const first = list.find((a) => a.status === "connected" && a.smtp_host);
      if (first) setFromId((cur) => cur || first.id);
      if (!(campRes.data || []).length) setMode("paste");
    })();
    loadAccess(); loadHistory(); loadSeeds();
  }, [user, loadAccess, loadHistory, loadSeeds]);

  // Campaña elegida → sus pasos + un lead real (el más completo) para rellenar las variables.
  useEffect(() => {
    if (!campaignId) { setSteps([]); setStepKey(""); setLeadFields(null); return; }
    let cancelled = false;
    (async () => {
      const [stepRes, leadRes] = await Promise.all([
        supabase.from("campaign_steps").select("id, step_order, subject, body, variants").eq("campaign_id", campaignId).order("step_order", { ascending: true }),
        supabase.from("campaign_leads").select("leads(email, custom_fields)").eq("campaign_id", campaignId).limit(25),
      ]);
      if (cancelled) return;
      const st = ((stepRes.data || []) as unknown as Step[]).map((s) => ({ ...s, variants: Array.isArray(s.variants) ? s.variants : [] }));
      setSteps(st);
      setStepKey(st.length ? `${st[0].id}:0` : "");
      const filled = (cf: unknown) => Object.values((cf as Record<string, unknown>) || {}).filter((v) => v != null && String(v).trim() !== "").length;
      const leads = ((leadRes.data || []) as any[]).map((r) => r.leads).filter((l) => l && l.email);
      const richest = leads.sort((a, b) => filled(b.custom_fields) - filled(a.custom_fields))[0];
      setLeadFields(richest ? { ...(richest.custom_fields || {}), email: richest.email, Email: richest.email } : null);
      setFieldEdits({});
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  // Paso / variante elegida → carga su copy (editable: se puede retocar antes de probar).
  useEffect(() => {
    if (mode !== "campaign" || !stepKey) return;
    const [id, idx] = stepKey.split(":");
    const step = steps.find((s) => s.id === id);
    if (!step) return;
    const v = Number(idx) > 0 ? (step.variants || [])[Number(idx) - 1] : null;
    // Un asunto vacío en un paso de seguimiento significa "mismo hilo": hereda el del primer paso.
    const ownSubject = (v ? v.subject : step.subject) || "";
    setSubject(ownSubject.trim() ? ownSubject : (steps[0]?.subject || ""));
    setBody((v ? v.body : step.body) || "");
  }, [mode, stepKey, steps]);

  const variables = useMemo(() => variablesUsed(`${subject}\n${body}`).filter((v) => !/^sender/i.test(v.replace(/[_\-\s]/g, ""))), [subject, body]);
  const fields = useMemo(() => {
    const base = sampleFieldsFor(variables, mode === "campaign" ? leadFields : null);
    return { ...base, ...fieldEdits };
  }, [variables, leadFields, fieldEdits, mode]);
  const renderFields = useMemo(() => {
    const f: Record<string, string> = { ...fields };
    if (sender?.first_name) f["SenderFirstName"] = sender.first_name;
    if (sender?.last_name) f["SenderLastName"] = sender.last_name;
    if (sender?.email) f["SenderEmail"] = sender.email;
    return f;
  }, [fields, sender]);
  const previewSubject = useMemo(() => replaceVariables(subject, renderFields), [subject, renderFields]);
  const previewHtml = useMemo(() => DOMPurify.sanitize(textToHtmlBody(replaceVariables(body, renderFields).trim())), [body, renderFields]);
  const hints = useMemo(() => contentHints(previewSubject, replaceVariables(body, renderFields)), [previewSubject, body, renderFields]);

  const stopTimer = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stopTimer, []);

  const checkTest = useCallback(async (id: string, attempt: number) => {
    setChecking(true);
    const { data, error } = await supabase.functions.invoke("placement-test", { body: { action: "check", test_id: id } });
    setChecking(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Error al comprobar"); return; }
    const res = (data.results || []) as SeedResult[];
    const sum = (data.summary as PlacementSummary) || summarizePlacement(res);
    setResults(res); setSummary(sum); setAutoChecks(attempt);
    loadHistory();
    stopTimer();
    // Sigue mirando solo mientras falte alguno por llegar.
    if (sum.missing > 0 && attempt < AUTO_CHECK_MAX) {
      timer.current = window.setTimeout(() => checkTest(id, attempt + 1), AUTO_CHECK_EVERY_MS);
    }
  }, [loadHistory]);

  const runTest = async () => {
    if (!fromId) { toast.error("Elige la cuenta desde la que se envía"); return; }
    if (!subject.trim()) { toast.error("Escribe el asunto"); return; }
    if (!body.trim()) { toast.error("Escribe el cuerpo del correo"); return; }
    stopTimer();
    setSending(true); setResults(null); setSummary(null); setTestId(null); setAutoChecks(0);
    const { data, error } = await supabase.functions.invoke("placement-test", {
      body: { action: "run", account_id: fromId, subject, body, fields, campaign_id: mode === "campaign" && campaignId ? campaignId : undefined },
    });
    setSending(false);
    let msg = data?.error as string | undefined;
    if (error && !msg) { try { msg = (await (error as any).context?.json?.())?.error; } catch { /* */ } }
    if (error || msg) { toast.error(msg || error?.message || "No se pudo enviar la prueba"); loadAccess(); return; }
    setTestId(data.test_id);
    toast.success("Prueba enviada. En menos de un minuto miramos dónde ha caído.");
    loadAccess();
    timer.current = window.setTimeout(() => checkTest(data.test_id, 1), AUTO_CHECK_FIRST_MS);
  };

  // ── Semillas (agencia) ──
  const onSeedEmail = (v: string) => { setNsEmail(v); const d = detectImap(v); setNsHost(d.host); setNsPort(d.port); if (!nsUser) setNsUser(v); };
  const addSeed = async () => {
    if (!user) return;
    if (!nsEmail || !nsHost || !nsUser || !nsPass) { toast.error("Rellena email, host IMAP, usuario y contraseña"); return; }
    setAddingSeed(true);
    const { error } = await (supabase as any).from("placement_seeds").insert({
      user_id: user.id, email: nsEmail.trim().toLowerCase(), provider: detectImap(nsEmail).provider,
      imap_host: nsHost.trim(), imap_port: nsPort, imap_user: (nsUser || nsEmail).trim(), imap_pass: nsPass,
    });
    setAddingSeed(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Buzón semilla ${nsEmail} añadido`);
    setNsEmail(""); setNsHost(""); setNsUser(""); setNsPass(""); setNsPort(993);
    loadSeeds(); loadAccess();
  };
  const deleteSeed = async (id: string) => { await (supabase as any).from("placement_seeds").delete().eq("id", id); loadSeeds(); loadAccess(); };

  const header = (
    <div>
      <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-[-0.03em] flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-primary" /> Entregabilidad</h1>
      <p className="text-xs sm:text-[15px] text-muted-foreground">Prueba tu copy antes de lanzarlo: lo enviamos desde tu cuenta a buzones reales de prueba y te decimos si llega a <strong>Bandeja de entrada</strong> o a <strong>Spam</strong>.</p>
    </div>
  );

  if (access && !access.allowed) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10"><Lock className="h-5 w-5 text-primary" /></span>
            <p className="font-display text-lg font-semibold">Incluido en los planes de pago</p>
            <p className="max-w-md text-[15px] text-muted-foreground">{access.reason || "El test de entregabilidad está incluido en los planes de pago."} Con él compruebas cada copy en buzones reales antes de enviarlo a tus leads.</p>
            <Button onClick={() => navigate("/settings")}>Ver planes</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const verdict = summary ? VERDICT[summary.verdict] : null;
  const notReady = access?.allowed && access.ready === false;
  const outOfTests = access?.remaining === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {header}

      {/* 1 · Qué se prueba */}
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2">
            {([["campaign", "Copy de una campaña", FileText], ["paste", "Escribir o pegar mi copy", PencilLine]] as const).map(([key, label, Icon]) => (
              <button key={key} type="button" onClick={() => setMode(key)} aria-pressed={mode === key}
                className={cn("flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-[13px] font-semibold transition-colors",
                  mode === key ? "border-primary/50 bg-primary/5 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted/40")}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {mode === "campaign" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dl-campaign">Campaña</Label>
                <select id="dl-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">{campaigns.length ? "Elige una campaña…" : "Aún no tienes campañas"}</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dl-step">Correo de la secuencia</Label>
                <select id="dl-step" value={stepKey} onChange={(e) => setStepKey(e.target.value)} disabled={!steps.length} className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60">
                  {!steps.length && <option value="">{campaignId ? "Esta campaña no tiene correos" : "—"}</option>}
                  {steps.flatMap((s, i) => [
                    <option key={`${s.id}:0`} value={`${s.id}:0`}>{`Correo ${i + 1}${(s.variants || []).length ? " · versión A" : ""}`}</option>,
                    ...(s.variants || []).map((_, vi) => <option key={`${s.id}:${vi + 1}`} value={`${s.id}:${vi + 1}`}>{`Correo ${i + 1} · versión ${String.fromCharCode(66 + vi)}`}</option>),
                  ])}
                </select>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dl-subject">Asunto</Label>
            <Input id="dl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Una idea para {{company_name}}" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dl-body">Cuerpo del correo</Label>
            <Textarea id="dl-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="text-sm leading-relaxed"
              placeholder={"Hola {{first_name}},\n\nEscribe o pega aquí tu copy. Puedes usar variables como {{company_name}}."} />
            {mode === "campaign" && campaignId && <p className="text-[12px] text-muted-foreground">Puedes retocar el texto para probar variaciones: la campaña no se modifica.</p>}
          </div>

          {variables.length > 0 && (
            <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold"><TagIcon className="h-3.5 w-3.5 text-primary" /> Datos con los que se envía</p>
              <p className="text-[12px] text-muted-foreground">La prueba sale con las variables ya cambiadas{mode === "campaign" && leadFields ? " (datos de un lead real de la campaña)" : ""}. Cámbialos si quieres.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {variables.map((v) => (
                  <div key={v} className="space-y-1">
                    <Label htmlFor={`dl-var-${v}`} className="text-[12px] text-muted-foreground">{`{{${v}}}`}</Label>
                    <Input id={`dl-var-${v}`} value={fields[v] ?? ""} onChange={(e) => setFieldEdits((p) => ({ ...p, [v]: e.target.value }))} className="h-8 text-sm" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(subject.trim() || body.trim()) && (
            <div className="space-y-1.5">
              <Label>Así lo recibe el destinatario</Label>
              <div className={cn(PAPER, "p-4")}>
                <p className="border-b border-zinc-200 pb-2 text-sm"><span className="text-zinc-500">Asunto: </span><span className="font-semibold">{previewSubject || "—"}</span></p>
                <div className="pt-3 text-sm leading-relaxed [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          )}

          {hints.length > 0 && (
            <ul className="space-y-1.5">
              {hints.map((h, i) => (
                <li key={i} className={cn("flex gap-2 text-[13px]", h.level === "warn" ? "text-warning" : "text-muted-foreground")}>
                  {h.level === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />} <span>{h.text}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 2 · Desde qué cuenta y enviar */}
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="space-y-1.5">
            <Label htmlFor="dl-from">Cuenta desde la que se envía</Label>
            <select id="dl-from" value={fromId} onChange={(e) => setFromId(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">{senders.length ? "Elige una cuenta…" : "No tienes cuentas conectadas"}</option>
              {senders.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
            <p className="text-[12px] text-muted-foreground">La entregabilidad depende del copy <strong>y</strong> de la cuenta: prueba con la que vayas a usar en la campaña.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runTest} disabled={sending || !senders.length || !!notReady || outOfTests} className="gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Enviando la prueba…" : "Probar entregabilidad"}
            </Button>
            {typeof access?.remaining === "number" && <span className="text-[12px] text-muted-foreground">Te quedan {access.remaining} pruebas hoy</span>}
          </div>
          {!senders.length && <p className="flex items-center gap-1 text-xs font-medium text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Conecta primero una cuenta en «Cuentas Email».</p>}
          {notReady && <p className="flex items-center gap-1 text-xs font-medium text-warning"><AlertTriangle className="h-3.5 w-3.5" /> {access?.agency ? "Añade al menos un buzón semilla abajo." : "El test no está disponible ahora mismo. Inténtalo más tarde."}</p>}
        </CardContent>
      </Card>

      {/* 3 · Resultado */}
      {testId && (
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            {!summary ? (
              <div className="flex items-center gap-3 text-[15px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Prueba enviada. Esperando a que llegue para ver en qué carpeta cae…
              </div>
            ) : verdict && (
              <>
                <div className={cn("flex items-start gap-3 rounded-md border p-4", verdict.tone)}>
                  <verdict.icon className="mt-0.5 h-5 w-5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold text-foreground">{verdict.title}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {summary.verdict === "pending"
                        ? (autoChecks >= AUTO_CHECK_MAX ? "Han pasado varios minutos y no aparece en bandeja ni en spam: es posible que el servidor de destino lo haya rechazado." : "Algunos servidores tardan un par de minutos. Seguimos mirando automáticamente.")
                        : `${summary.inbox + summary.promotions} de ${summary.inbox + summary.promotions + summary.spam} en bandeja de entrada${summary.inboxPct != null ? ` (${summary.inboxPct}%)` : ""}${summary.missing ? ` · ${summary.missing} todavía sin llegar` : ""}.`}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {summary.byProvider.map((p) => (
                    <div key={p.provider} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <span className="font-semibold">{p.provider}</span>
                      <span className="flex flex-wrap gap-1.5">
                        {p.inbox > 0 && <Badge className="border-success/30 bg-success/10 text-success">Bandeja{p.inbox > 1 ? ` ×${p.inbox}` : ""}</Badge>}
                        {p.promotions > 0 && <Badge className="border-primary/30 bg-primary/10 text-primary">Promociones{p.promotions > 1 ? ` ×${p.promotions}` : ""}</Badge>}
                        {p.spam > 0 && <Badge className="border-destructive/30 bg-destructive/10 text-destructive">Spam{p.spam > 1 ? ` ×${p.spam}` : ""}</Badge>}
                        {p.missing > 0 && <Badge className="border-warning/30 bg-warning/10 text-warning">Sin llegar{p.missing > 1 ? ` ×${p.missing}` : ""}</Badge>}
                        {p.error > 0 && <Badge variant="outline">No se pudo comprobar{p.error > 1 ? ` ×${p.error}` : ""}</Badge>}
                      </span>
                    </div>
                  ))}
                </div>

                {access?.agency && results && results.some((r) => r.email) && (
                  <details className="text-[13px] text-muted-foreground">
                    <summary className="cursor-pointer font-medium">Detalle por buzón semilla (sólo lo ve la agencia)</summary>
                    <ul className="mt-2 space-y-1">{results.map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{r.email}</span><span>{r.folder}</span></li>)}</ul>
                  </details>
                )}

                {summary.verdict === "spam" || summary.verdict === "mixed" ? (
                  <p className="text-[13px] text-muted-foreground">Qué probar: quita enlaces e imágenes del primer correo, acorta el texto, evita palabras comerciales, y repite la prueba con otra cuenta para saber si el problema es el copy o la reputación del dominio.</p>
                ) : null}
                {summary.promotions > 0 && <p className="text-[12px] text-muted-foreground"><HelpCircle className="mr-1 inline h-3 w-3" />«Promociones» es una pestaña de la bandeja de Gmail, no spam; pero un correo en frío rinde mejor en Principal.</p>}
              </>
            )}
            <Button onClick={() => testId && checkTest(testId, autoChecks + 1)} disabled={checking} variant="secondary" size="sm" className="gap-2">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {checking ? "Comprobando…" : "Comprobar ahora"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Historial */}
      {history.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4 sm:p-5">
            <p className="text-sm font-semibold">Últimas pruebas</p>
            {history.map((h) => {
              const located = (h.inbox || 0) + (h.spam || 0);
              return (
                <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{h.subject}</p>
                    <p className="truncate text-muted-foreground">{h.from_email} · {new Date(h.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  {located === 0
                    ? <Badge variant="outline">Sin resultado</Badge>
                    : (h.spam || 0) === 0
                      ? <Badge className="border-success/30 bg-success/10 text-success">Bandeja</Badge>
                      : (h.inbox || 0) === 0
                        ? <Badge className="border-destructive/30 bg-destructive/10 text-destructive">Spam</Badge>
                        : <Badge className="border-warning/30 bg-warning/10 text-warning">{Math.round(((h.inbox || 0) / located) * 100)}% bandeja</Badge>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Buzones semilla — sólo la agencia los gestiona; son los que usa toda la plataforma */}
      {access?.agency && (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Buzones semilla de la plataforma</span>
              <Badge variant={seeds.length ? "secondary" : "outline"}>{seeds.length}</Badge>
            </div>
            <p className="text-[12px] text-muted-foreground">A estos buzones se envían las pruebas de todos los clientes. Ellos nunca ven las direcciones: sólo el resultado. No entran en el Unibox ni en el motor de envío.</p>
            {seeds.length > 0 && (
              <div className="space-y-1.5">
                {seeds.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <span className="truncate">{s.email} <span className="text-xs text-muted-foreground">({s.provider} · {s.imap_host})</span></span>
                    <button onClick={() => deleteSeed(s.id)} aria-label={`Quitar ${s.email}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Plus className="h-3.5 w-3.5" /> Añadir buzón semilla (Gmail, Yahoo, Zoho…)</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input placeholder="email@gmail.com" value={nsEmail} onChange={(e) => onSeedEmail(e.target.value)} className="text-sm" />
                <Input placeholder="Host IMAP" value={nsHost} onChange={(e) => setNsHost(e.target.value)} className="text-sm" />
                <Input placeholder="Usuario IMAP (= email)" value={nsUser} onChange={(e) => setNsUser(e.target.value)} className="text-sm" />
                <Input placeholder="Contraseña de aplicación" type="password" value={nsPass} onChange={(e) => setNsPass(e.target.value)} className="text-sm" autoComplete="new-password" />
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={nsPort} onChange={(e) => setNsPort(parseInt(e.target.value) || 993)} className="w-24 text-sm" aria-label="Puerto IMAP" />
                <Button size="sm" onClick={addSeed} disabled={addingSeed} className="gap-1.5">
                  {addingSeed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Añadir semilla
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
