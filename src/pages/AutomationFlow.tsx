import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, ArrowRight, Workflow, Plus, Pencil, Trash2, ChevronRight, UserPlus, GripVertical, Brain, Mail, FileText, MessageSquare, ShieldCheck, CheckCircle2, XCircle, Link2, RefreshCw, Loader2, ImagePlus, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractLogoColor } from "@/lib/logoColor";

type FormResponse = { id: string; form_id: string | null; form_title: string | null; respondent_email: string | null; answers: Record<string, unknown> | null; received_at: string };

// Match an incoming form response to a client in the flow by email, domain or company name.
const norm = (s?: string | null) => (s || "").toLowerCase().trim();
const domainOf = (email?: string | null) => norm(email).split("@")[1] || "";
function clientMatchesResponse(c: { email: string; company: string }, r: FormResponse): boolean {
  const rEmail = norm(r.respondent_email), rDom = domainOf(r.respondent_email);
  const ansText = norm(Object.values(r.answers || {}).map((v) => String(v)).join(" "));
  const cEmail = norm(c.email), cDom = domainOf(c.email), cComp = norm(c.company);
  if (rEmail && cEmail && rEmail === cEmail) return true;          // exact email
  if (rDom && cDom && rDom === cDom) return true;                   // same domain
  if (cComp && cComp.length >= 3 && (ansText.includes(cComp) || rEmail.includes(cComp.replace(/\s+/g, "")))) return true; // company name
  return false;
}

// Owner-only automation module — an EDITABLE flow (N8N-style) of the auto-onboarding +
// customer-service pipeline, organised as separate AI "agents" per phase. It runs on
// DeepSeek (wired up once the backend deploy path is restored).
//
// SAFETY (as the owner explicitly required): this module NEVER touches the sending engine.
//  · The campaign agent creates campaigns as DRAFTS only — never sets them active. The
//    engine only ever sends campaigns the owner approves.
//  · The reply agent escalates anything important to the owner (summary + proposed reply
//    saved as a draft); only routine replies are handled autonomously, rate-limited.
//  · Reports keep their existing per-client throttle. Nothing here mass-sends.
//
// FIRST VERSION: flow definition, clients-in-flow and the AI "brain" (memory + per-agent
// behaviour) are stored in the browser (localStorage) so the owner can shape and author
// everything now. Real persistence + execution plug in on the backend later.

type Node = { id: string; label: string; desc: string; agent: AgentKey };
type FlowClient = { id: string; name: string; email: string; company: string; context: string; step: number; startedAt: string; clientId?: string; onboardingSlug?: string; brandColor?: string; emailStatus?: "sending" | "sent" | "failed"; emailFrom?: string; emailError?: string };
type AgentKey = "onboarding" | "campaign" | "replies" | "manual";
type AIFile = { name: string; url: string };
type AIConfig = {
  globalMemory: string;
  formUrl: string;
  formId: string;
  formName: string;
  onboarding: string;
  campaign: string;
  replies: string;
  autoHandleRoutine: boolean;
  notifyEmail: string;
  files: { global: AIFile[]; onboarding: AIFile[]; campaign: AIFile[]; replies: AIFile[] };
};
type GForm = { id: string; name: string; url: string; modifiedTime: string | null };

const FLOW_KEY = "op_automation_flow_v2";
const CLIENTS_KEY = "op_automation_clients_v2";
const AI_KEY = "op_automation_ai_v1";
const GOOGLE_KEY = "op_automation_google_v1";

// The connection status is written by the backend once OAuth completes. NEVER store the
// client secret here — the secret lives only in Supabase edge-function secrets.
type GoogleConn = { connected: boolean; account: string; connectedAt: string };
const DEFAULT_GOOGLE: GoogleConn = { connected: false, account: "", connectedAt: "" };

const DEFAULT_NODES: Node[] = [
  { id: "n1", label: "Datos del cliente", desc: "Nombre, correo, empresa y contexto. Su logo y colores ya vienen de su perfil.", agent: "manual" },
  { id: "n2", label: "Correo de arranque", desc: "Se le envía el enlace del Google Form + el enlace del onboarding (ve su campaña en tiempo real).", agent: "onboarding" },
  { id: "n3", label: "Cliente responde el Form", desc: "Contesta las preguntas que necesitamos para la campaña.", agent: "onboarding" },
  { id: "n4", label: "IA genera la campaña", desc: "Analiza el Form + tu contexto y crea la(s) campaña(s) en BORRADOR, sin leads, con todos los copys.", agent: "campaign" },
  { id: "n5", label: "Tu aprobación", desc: "Revisas y das Aceptar. Nada se envía hasta aquí.", agent: "manual" },
  { id: "n6", label: "Campaña activa", desc: "Empieza a enviar con el motor de siempre.", agent: "manual" },
  { id: "n7", label: "Atención al cliente (IA)", desc: "Lee el perfil de quien responde, cuenta interesados/preguntas y responde. Importante → borrador + te avisa.", agent: "replies" },
];

const DEFAULT_AI: AIConfig = {
  globalMemory:
    "Eres el asistente de OnePulso. Tono cercano, profesional y directo, en el idioma del cliente. Nunca prometas resultados garantizados. Marca (colores, logo, nombre) según el perfil de cada cliente. Ante la duda, escala al dueño en vez de improvisar.",
  formUrl: "https://forms.gle/QuZsPwTcwkmB6qoF7",
  formId: "",
  formName: "",
  onboarding:
    "Al arrancar, envía un correo con el enlace del Google Form (preguntas para la campaña) y el enlace del onboarding (para que vea su campaña en tiempo real). Cuando termine una fase, actualiza el onboarding en silencio — NO envíes correos por cada fase.",
  campaign:
    "Cuando el cliente responda el Form, coge toda la info + el contexto del dueño, analízalo y crea la(s) campaña(s) en BORRADOR (sin leads), con toda la secuencia y los copys. No actives nunca la campaña: la aprueba el dueño.",
  replies:
    "Cuando responda un lead, lee el perfil del cliente (propuesta, tono, oferta). Clasifica: interesado, pregunta, objeción, no interesado. Responde desde ese perfil. Si es importante o dudoso, prepara un borrador y avisa al dueño con un resumen. Solo respondes tú lo rutinario.",
  autoHandleRoutine: true,
  notifyEmail: "team@onepulso.online",
  files: { global: [], onboarding: [], campaign: [], replies: [] },
};

const AGENT_META: Record<AgentKey, { label: string; color: string }> = {
  onboarding: { label: "Onboarding", color: "bg-blue-500/10 text-blue-600" },
  campaign: { label: "Campaña", color: "bg-violet-500/10 text-violet-600" },
  replies: { label: "Atención", color: "bg-emerald-500/10 text-emerald-600" },
  manual: { label: "Tú", color: "bg-muted text-muted-foreground" },
};

const load = <T,>(key: string, fallback: T): T => {
  try { const r = localStorage.getItem(key); return r ? { ...(fallback as object), ...JSON.parse(r) } as T : fallback; } catch { return fallback; }
};
const loadArr = <T,>(key: string, fallback: T[]): T[] => {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T[] : fallback; } catch { return fallback; }
};
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } };
const uid = () => "x" + Math.random().toString(36).slice(2, 9);

// Calls the (already deployed) admin-users edge function with the owner's session — used
// to create the real client account + its onboarding profile straight from this flow.
async function callAdmin(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  return resp.json().catch(() => ({ error: "bad response" }));
}
const slugify = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const genPassword = () => Math.random().toString(36).slice(2, 10) + "Aa1!" + Math.random().toString(36).slice(2, 5);

// Maps the flow step to the 6 onboarding phases (kickoff, dominios, calentamiento, listas,
// copywriting, lanzamiento) so the client's onboarding fills in ON ITS OWN as the flow runs.
function onboardingStatusForFlow(step: number): ("pending" | "in_progress" | "done")[] {
  // Phases: 0 kickoff/estrategia · 1 dominios · 2 calentamiento · 3 listas · 4 copywriting · 5 lanzamiento
  const s: ("pending" | "in_progress" | "done")[] = ["pending", "pending", "pending", "pending", "pending", "pending"];
  if (step >= 1) s[0] = "in_progress";                                       // arranque → kickoff en curso
  if (step >= 3) { s[0] = "done"; s[1] = "done"; s[2] = "done"; s[3] = "in_progress"; } // form respondido → estrategia + dominios + calentamiento hechos, listas en curso
  if (step >= 4) { s[3] = "done"; s[4] = "in_progress"; }                    // IA genera → listas ok, copys en curso
  if (step >= 5) { s[4] = "done"; s[5] = "in_progress"; }                    // aprobado/activa → copys listos, lanzamiento
  if (step >= 6) { s[5] = "done"; }                                          // atención → lanzamiento hecho
  return s;
}

// The flow is editable, so we locate the key steps by their node (never a hard-coded index):
// the "Correo de arranque" node and the "Cliente responde el Form" node. Fall back to the
// default positions (1, 2) only if a matching node isn't found.
const emailNodeIdx = (ns: Node[]) => { const i = ns.findIndex((n) => /correo|arranque/i.test(n.label)); return i >= 0 ? i : 1; };
const formNodeIdx = (ns: Node[]) => { const i = ns.findIndex((n) => /responde/i.test(n.label) && /form/i.test(n.label)); return i >= 0 ? i : 2; };

// Sends the intro email from one of the owner's connected accounts (is_test:true → doesn't
// touch daily limits / the sent log). Same send-email fn the Onboarding page uses.
async function sendIntroEmail(accountId: string, to: string, subject: string, html: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ account_id: accountId, to_email: to, subject, body: html, is_test: true }),
  });
  return resp.json().catch(() => ({ error: "bad response" }));
}
const escHtml = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function introEmailHtml(opts: { name: string; company: string; formUrl: string; onboardingUrl: string; color: string }) {
  const hi = opts.name ? `Hola ${escHtml(opts.name)}` : (opts.company ? `Hola ${escHtml(opts.company)}` : "Hola");
  const c = opts.color || "#6E58F1";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6">
  <p>${hi} 👋</p>
  <p>¡Encantados de empezar! Para preparar tu campaña necesitamos que respondas unas preguntas rápidas:</p>
  <p style="margin:20px 0"><a href="${escHtml(opts.formUrl)}" style="background:${c};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Responder el formulario →</a></p>
  <p>Y aquí tienes tu <b>portal de seguimiento</b>, donde podrás ver el progreso de tu proyecto <b>en directo</b>:</p>
  <p style="margin:20px 0"><a href="${escHtml(opts.onboardingUrl)}" style="border:1px solid ${c};color:${c};text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Ver mi proyecto en directo →</a></p>
  <p>En cuanto respondas el formulario, nos ponemos con tu campaña. Cualquier duda, responde a este correo.</p>
  <p>Un saludo,<br/>El equipo de OnePulso</p>
</div>`;
}

export default function AutomationFlow() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [clients, setClients] = useState<FlowClient[]>([]);
  const [ai, setAi] = useState<AIConfig>(DEFAULT_AI);
  const [google, setGoogle] = useState<GoogleConn>(DEFAULT_GOOGLE);
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [newClient, setNewClient] = useState(false); // se abre solo al pulsar "Nuevo cliente", no al entrar
  const [aiOpen, setAiOpen] = useState(false);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);

  const [forms, setForms] = useState<GForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [respMatch, setRespMatch] = useState<Record<string, string>>({});

  const loadResponses = async () => {
    try {
      const { data } = await (supabase as any)
        .from("form_responses")
        .select("id, form_id, form_title, respondent_email, answers, received_at")
        .order("received_at", { ascending: false })
        .limit(100);
      setResponses((data || []) as FormResponse[]);
    } catch { /* ignore */ }
  };

  const loadForms = async () => {
    setFormsLoading(true);
    try {
      let list: GForm[] = [];
      // Preferred: live list via the edge function (needs Google creds set).
      try {
        const { data } = await supabase.functions.invoke("google-forms-list");
        list = ((data as any)?.forms || []) as GForm[];
      } catch { /* ignore */ }
      // Fallback: the server-synced snapshot table.
      if (!list.length) {
        const { data } = await (supabase as any)
          .from("google_forms")
          .select("form_id, name, url, modified_time")
          .order("modified_time", { ascending: false });
        list = ((data || []) as any[]).map((f) => ({ id: f.form_id, name: f.name, url: f.url, modifiedTime: f.modified_time }));
      }
      setForms(list);
    } catch { setForms([]); } finally { setFormsLoading(false); }
  };

  const checkGoogle = async () => {
    try {
      const { data } = await supabase.rpc("my_google_connection" as never);
      const row = Array.isArray(data) ? (data[0] as any) : (data as any);
      if (row && row.connected) { setGoogle({ connected: true, account: row.email || "", connectedAt: row.connected_at || "" }); loadForms(); }
      else setGoogle(DEFAULT_GOOGLE);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    setNodes(loadArr(FLOW_KEY, DEFAULT_NODES));
    setClients(loadArr(CLIENTS_KEY, []));
    setAi(load(AI_KEY, DEFAULT_AI));
    checkGoogle();
    loadResponses();
    const onFocus = () => { checkGoogle(); loadResponses(); };
    window.addEventListener("focus", onFocus);
    // Auto-refresh the responses list every minute (the DB cron pulls new ones every 2 min).
    const iv = setInterval(() => loadResponses(), 60000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistNodes = (n: Node[]) => { setNodes(n); save(FLOW_KEY, n); };
  const persistClients = (c: FlowClient[]) => { setClients(c); save(CLIENTS_KEY, c); };
  const updateFlowClient = (id: string, patch: Partial<FlowClient>) => setClients((prev) => { const next = prev.map((c) => c.id === id ? { ...c, ...patch } : c); save(CLIENTS_KEY, next); return next; });
  const persistAi = (a: AIConfig) => { setAi(a); save(AI_KEY, a); };

  // When a form response matches a client (email / domain / company), advance that client
  // to the step AFTER "responde el Form" so the flow continues on its own.
  useEffect(() => {
    if (!responses.length || !clients.length) return;
    const respondedStep = Math.min(formNodeIdx(nodes) + 1, nodes.length - 1); // node right after "responde Form"
    const map: Record<string, string> = {};
    let changed = false;
    const next = clients.map((c) => ({ ...c }));
    for (const r of responses) {
      const idx = next.findIndex((c) => clientMatchesResponse(c, r));
      if (idx >= 0) {
        map[r.id] = next[idx].company || next[idx].name || next[idx].email;
        if (next[idx].step < respondedStep) { next[idx].step = respondedStep; changed = true; syncOnboarding(next[idx].clientId, respondedStep); }
      }
    }
    setRespMatch(map);
    if (changed) persistClients(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses, clients, nodes]);

  if (!user) return null;
  if ((user.email || "").toLowerCase() !== "hello@onepulso.blog") return <Navigate to="/dashboard" replace />;

  const addNode = () => { const n = [...nodes, { id: uid(), label: "Nuevo paso", desc: "Describe qué hace este paso", agent: "manual" as AgentKey }]; persistNodes(n); setEditNode(n[n.length - 1]); };
  const saveNode = (node: Node) => { persistNodes(nodes.map((n) => n.id === node.id ? node : n)); setEditNode(null); };
  const deleteNode = (id: string) => { persistNodes(nodes.filter((n) => n.id !== id)); setEditNode(null); };

  // Push the client's onboarding phases to match the flow step (fire-and-forget).
  const syncOnboarding = (clientId: string | undefined, step: number) => {
    if (!clientId) return;
    callAdmin({ action: "update_client", user_id: clientId, onboarding_status: onboardingStatusForFlow(step) }).catch(() => {});
  };
  const advance = (c: FlowClient) => {
    const ns = Math.min(c.step + 1, nodes.length - 1);
    persistClients(clients.map((x) => x.id === c.id ? { ...x, step: ns } : x));
    syncOnboarding(c.clientId, ns);
  };
  const removeClient = (id: string) => persistClients(clients.filter((x) => x.id !== id));

  // The client whose run is being visualised on the flow (defaults to the most recent).
  const activeClient = clients.find((c) => c.id === activeClientId) || clients[0] || null;
  const activeStep = activeClient ? activeClient.step : -1;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Workflow className="h-5 w-5" /></span>
          <div>
            <h1 className="font-display text-2xl font-bold">Automatización</h1>
            <p className="text-sm text-muted-foreground">Onboarding y atención al cliente automáticos · editable · agentes de IA.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAiOpen(true)}><Brain className="h-4 w-4" /> Cómo actúa la IA</Button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" /> DeepSeek
          </span>
        </div>
      </div>

      {/* ── Google Forms connection status ── */}
      <Card className={google.connected ? "border-emerald-500/40" : ""}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${google.connected ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              <Link2 className="h-5 w-5" />
            </span>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                Conexión con Google Forms
                {google.connected
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Conectado</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> No conectado</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {google.connected
                  ? `Cuenta: ${google.account || "—"}. La IA ya puede leer las respuestas del Form.`
                  : "Aún no conectado. Se activará cuando cableemos el backend (OAuth). Te avisaré en cuanto quede conectado."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { checkGoogle(); toast.info("Estado actualizado"); }}>
              <RefreshCw className="h-4 w-4" /> Actualizar
            </Button>
            {!google.connected && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                if (!user?.id) return;
                window.open(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-oauth?owner=${user.id}`, "_blank");
                toast.info("Autoriza en la pestaña de Google. Al volver, pulsa Actualizar.");
              }}>
                <Link2 className="h-4 w-4" /> Conectar con Google
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Your Google Forms (only when connected) ── */}
      {google.connected && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Tus Google Forms
              {ai.formId && <span className="ml-1 text-xs font-normal text-emerald-600">· elegido: {ai.formName}</span>}
            </CardTitle>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { loadForms(); loadResponses(); }} disabled={formsLoading}>
              <RefreshCw className={`h-4 w-4 ${formsLoading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {formsLoading ? (
              <p className="text-sm text-muted-foreground">Cargando tus formularios…</p>
            ) : forms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No aparecen formularios aún. Si acabas de conectar, pulsa <b className="text-foreground">Actualizar</b>. Se listan los Google Forms de la cuenta conectada.</p>
            ) : (
              <div className="space-y-1.5">
                {forms.map((f) => {
                  const sel = ai.formId === f.id;
                  return (
                    <button key={f.id} onClick={() => { const a = { ...ai, formId: f.id, formName: f.name, formUrl: f.url }; persistAi(a); loadResponses(); toast.success(`Formulario elegido: ${f.name}`); }}
                      className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition ${sel ? "border-emerald-500/50 bg-emerald-500/5" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{f.name}</p>
                        <a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-muted-foreground hover:underline">Abrir en Google ↗</a>
                      </div>
                      {sel ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <span className="shrink-0 text-xs text-muted-foreground">Elegir</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Responses for the selected form — only the respondent (email); the system reads the answers. */}
            {ai.formId && (() => {
              const mine = responses.filter((r) => r.form_id === ai.formId);
              return (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted-foreground">Respuestas de "{ai.formName}" · {mine.length}</p>
                  {mine.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                      Aún no hay respuestas de este formulario.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {mine.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm">{r.respondent_email || "sin correo"}</span>
                          </span>
                          {respMatch[r.id]
                            ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {respMatch[r.id]}</span>
                            : <span className="shrink-0 text-xs text-muted-foreground/70">{r.received_at ? new Date(r.received_at).toLocaleDateString() : ""}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ── Editable flow ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">El flujo <span className="ml-1 text-xs font-normal text-muted-foreground">· clic en un paso para editarlo</span></CardTitle>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={addNode}><Plus className="h-4 w-4" /> Añadir paso</Button>
        </CardHeader>
        <CardContent>
          {/* Which client's run we're watching — the flow lights up for this one, like N8N */}
          {clients.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Viendo:</span>
              {clients.map((c) => (
                <button key={c.id} onClick={() => setActiveClientId(c.id)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${activeClient?.id === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"}`}>
                  {c.company || c.name || c.email}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto pb-2">
            <div className="flex w-max items-stretch gap-1">
              {nodes.map((s, i) => {
                const state = !activeClient ? "idle" : i < activeStep ? "done" : i === activeStep ? "current" : "pending";
                const waitForm = /responde/i.test(s.label) && /form/i.test(s.label);
                return (
                  <div key={s.id} className="flex items-stretch gap-1">
                    <button
                      onClick={() => setEditNode(s)}
                      className={`group flex w-48 flex-col rounded-xl border p-3 text-left transition-all ${
                        state === "done" ? "border-emerald-500/50 bg-emerald-500/10"
                        : state === "current" ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                        : state === "pending" ? "border-border bg-muted/20 opacity-60"
                        : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${AGENT_META[s.agent].color}`}>{AGENT_META[s.agent].label}</span>
                        {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          : state === "current" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          : <Pencil className="h-3 w-3 text-muted-foreground/0 transition-colors group-hover:text-primary" />}
                      </div>
                      <p className="text-sm font-semibold">{i + 1}. {s.label}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {state === "current"
                          ? (waitForm ? "Esperando la respuesta del Form…"
                            : (/correo|arranque/i.test(s.label) && activeClient?.emailStatus === "sending") ? "Enviando el correo…"
                            : (/correo|arranque/i.test(s.label) && activeClient?.emailStatus === "failed") ? "⚠ No se pudo enviar el correo"
                            : "En curso…")
                          : s.desc}
                      </p>
                    </button>
                    {i < nodes.length - 1 && <div className={`flex items-center px-0.5 ${activeClient && i < activeStep ? "text-emerald-500" : "text-muted-foreground/30"}`}><ArrowRight className="h-4 w-4" /></div>}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Clients in flow ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Clientes en el flujo</CardTitle>
          <Button size="sm" className="gap-1.5" onClick={() => setNewClient(true)}><UserPlus className="h-4 w-4" /> Nuevo cliente</Button>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Mete los datos de un cliente con <b className="text-foreground">"Nuevo cliente"</b> y arranca su flujo. Aquí lo verás avanzar por cada paso en tiempo real.
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => {
                const node = nodes[c.step] || nodes[0];
                const pct = Math.round(((c.step + 1) / nodes.length) * 100);
                const isFinal = c.step >= nodes.length - 1;
                const waitingForm = /responde/i.test(node?.label || "") && /form/i.test(node?.label || "");
                const isApproval = /aprobaci|aprobar|revis/i.test(node?.label || "");
                return (
                  <div key={c.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.company || c.name || c.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.email}{c.context ? ` · ${c.context}` : ""}</p>
                        {c.onboardingSlug && <a href={`/o/${c.onboardingSlug}`} target="_blank" rel="noreferrer" className="block text-xs text-primary hover:underline">Onboarding: /o/{c.onboardingSlug} ↗</a>}
                        {c.emailStatus === "sending" && <p className="flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" /> Enviando el correo…</p>}
                        {c.emailStatus === "sent" && <p className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Correo enviado desde {c.emailFrom || "la cuenta de envío"}</p>}
                        {c.emailStatus === "failed" && <p className="text-xs text-destructive">⚠ Correo no enviado{c.emailError ? `: ${c.emailError}` : ""}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${AGENT_META[node?.agent || "manual"].color}`}>
                          {!isFinal && <Loader2 className="h-3 w-3 animate-spin" />}
                          {c.step + 1}. {node?.label}
                        </span>
                        {isApproval
                          ? <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => { advance(c); toast.success("Aprobado — se envían los copys al cliente"); }}><CheckCircle2 className="h-3.5 w-3.5" /> Revisar y aprobar</Button>
                          : <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => advance(c)} disabled={isFinal}><ChevronRight className="h-3.5 w-3.5" /> Siguiente</Button>}
                        <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => removeClient(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    {/* Real-time status line — the "ruedecita" while it waits/works on this step */}
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {waitingForm
                        ? <><Loader2 className="h-3 w-3 animate-spin text-primary" /> Esperando la respuesta del Form…</>
                        : isFinal
                          ? <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Atención al cliente activa</>
                          : <><Loader2 className="h-3 w-3 animate-spin text-primary" /> {node?.desc}</>}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p>
          <b className="text-foreground">Aislado y seguro:</b> no toca el motor de envío. La IA crea campañas <b className="text-foreground">en borrador</b> (nunca las activa), lo importante se escala a ti como borrador + aviso, y nada envía correos en masa. Por ahora el flujo y la memoria se guardan en tu navegador; cuando restauremos el deploy, se conecta al backend para persistir y ejecutarse solo.
        </p>
      </div>

      {/* Edit node dialog */}
      <Dialog open={!!editNode} onOpenChange={(o) => !o && setEditNode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><GripVertical className="h-4 w-4 text-muted-foreground" /> Editar paso</DialogTitle></DialogHeader>
          {editNode && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label className="text-xs">Nombre del paso</Label><Input value={editNode.label} onChange={(e) => setEditNode({ ...editNode, label: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Qué hace</Label>
                <textarea value={editNode.desc} onChange={(e) => setEditNode({ ...editNode, desc: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Agente responsable</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(AGENT_META) as AgentKey[]).map((k) => (
                    <button key={k} onClick={() => setEditNode({ ...editNode, agent: k })}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${editNode.agent === k ? "ring-2 ring-primary " + AGENT_META[k].color : AGENT_META[k].color + " opacity-70"}`}>
                      {AGENT_META[k].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="justify-between gap-2 sm:justify-between">
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => editNode && deleteNode(editNode.id)}><Trash2 className="mr-1.5 h-4 w-4" /> Eliminar</Button>
            <Button onClick={() => editNode && saveNode(editNode)}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New client dialog — creates the REAL client account + its onboarding profile */}
      <NewClientDialog
        open={newClient}
        onClose={() => setNewClient(false)}
        onCreate={async (data) => {
          // 1) Create the real client account (login + branding).
          const cr = await callAdmin({
            action: "create_user",
            email: data.email.toLowerCase(),
            password: genPassword(),
            company_name: data.company || null,
            brand_color: data.brandColor || null,
            logo_url: data.logoUrl || null,
            allowed_routes: ["/dashboard", "/campaigns", "/unibox", "/stats"],
          });
          if (cr.error || !cr.user_id) { toast.error(cr.error || "No se pudo crear el cliente"); return false; }
          // 2) Auto-create its onboarding profile (a stable /o/:slug portal + 6 phases).
          const base = slugify(data.company || data.name || data.email.split("@")[0]) || "cliente";
          const slug = `${base}-${Math.random().toString(36).slice(2, 5)}`;
          await callAdmin({ action: "update_client", user_id: cr.user_id, onboarding_slug: slug });
          // 3) Add to the flow at the "Correo de arranque" step, marked as SENDING (the node
          //    stays loading until the email is REALLY sent — no jumping ahead).
          const flowId = uid();
          const emailStep = emailNodeIdx(nodes);
          persistClients([{ id: flowId, step: emailStep, startedAt: new Date().toISOString(), clientId: cr.user_id, onboardingSlug: slug, emailStatus: "sending", ...data }, ...clients]);
          setNewClient(false);
          toast.success(`Cliente creado con onboarding: /o/${slug}`);
          // 4) Send the intro email IN THE BACKGROUND, then reflect the REAL result on the flow.
          (async () => {
            try {
              const onboardingUrl = `${window.location.origin}/o/${slug}`;
              const formUrl = ai.formUrl || "https://forms.gle/QuZsPwTcwkmB6qoF7";
              const { data: prof } = await (supabase as any).from("profiles").select("onboarding_from_account_id").eq("user_id", user.id).maybeSingle();
              let fromAcc: string | null = prof?.onboarding_from_account_id || null;
              let fromEmail = "";
              if (fromAcc) {
                const { data: a } = await (supabase as any).from("email_accounts").select("email").eq("id", fromAcc).maybeSingle();
                fromEmail = a?.email || "";
              } else {
                const { data: acc } = await (supabase as any).from("email_accounts").select("id, email").eq("user_id", user.id).eq("status", "connected").limit(1).maybeSingle();
                fromAcc = acc?.id || null; fromEmail = acc?.email || "";
              }
              if (!fromAcc) {
                updateFlowClient(flowId, { emailStatus: "failed", emailError: "sin cuenta de envío" });
                toast.error("Cliente creado, pero no hay cuenta de envío (Onboarding → Avisos al cliente).");
                return;
              }
              const html = introEmailHtml({ name: data.name, company: data.company, formUrl, onboardingUrl, color: data.brandColor });
              const r = await sendIntroEmail(fromAcc, data.email, "Empezamos con tu campaña 🚀", html);
              if (r?.success) {
                const formStep = formNodeIdx(nodes);
                updateFlowClient(flowId, { emailStatus: "sent", emailFrom: fromEmail, step: formStep });
                syncOnboarding(cr.user_id, formStep);
                toast.success(`Correo enviado desde ${fromEmail}`);
              } else {
                updateFlowClient(flowId, { emailStatus: "failed", emailError: r?.error || "error de envío" });
                toast.error(`No se pudo enviar el correo: ${r?.error || "error"}`);
              }
            } catch (e) {
              updateFlowClient(flowId, { emailStatus: "failed", emailError: String(e) });
            }
          })();
          return true;
        }}
      />

      {/* AI brain / memory dialog */}
      <AIConfigDialog open={aiOpen} onClose={() => setAiOpen(false)} value={ai} onSave={(a) => { persistAi(a); setAiOpen(false); toast.success("Memoria de la IA guardada"); }} />
    </div>
  );
}

function NewClientDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (d: { name: string; email: string; company: string; context: string; brandColor: string; logoUrl: string }) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [context, setContext] = useState("");
  const [brandColor, setBrandColor] = useState("#6E58F1");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setName(""); setEmail(""); setCompany(""); setContext(""); setBrandColor("#6E58F1"); setLogoUrl(""); setUploading(false); setCreating(false); } }, [open]);

  const uploadLogo = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) { toast.error("El logo debe pesar menos de 3 MB"); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `client-logos/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error } = await supabase.storage.from("godtube-media").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      setLogoUrl(supabase.storage.from("godtube-media").getPublicUrl(path).data.publicUrl);
      const color = await extractLogoColor(file);   // auto brand color from the logo
      if (color) setBrandColor(color);
      toast.success("Logo subido");
    } catch (e: any) { toast.error(e?.message || "Error al subir el logo"); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (!email.trim()) { toast.error("El correo es obligatorio"); return; }
    setCreating(true);
    await onCreate({ name: name.trim(), email: email.trim(), company: company.trim(), context: context.trim(), brandColor, logoUrl });
    setCreating(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !creating && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserPlus className="h-5 w-5" /></div>
          <DialogTitle className="text-center font-display text-xl">Crear cliente y arrancar</DialogTitle>
          <p className="text-center text-sm text-muted-foreground">Se crea la cuenta + su <b>onboarding</b>, y se le <b>envía el correo</b> con el formulario y el enlace de seguimiento en directo.</p>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label className="text-xs">Nombre</Label><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del contacto" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Correo *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Empresa</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nombre de la empresa" /></div>
          <div className="space-y-1.5">
            <Label className="text-xs">Logo</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
                {logoUrl ? <img src={logoUrl} alt="logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Subiendo…</> : <><ImagePlus className="h-4 w-4" /> {logoUrl ? "Cambiar logo" : "Subir logo"}</>}
              </Button>
              {logoUrl && <button type="button" onClick={() => setLogoUrl("")} className="text-xs text-muted-foreground hover:text-destructive">Quitar</button>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Color de marca <span className="text-muted-foreground">(auto del logo)</span></Label>
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-8 w-14 cursor-pointer rounded border border-border bg-background" />
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Contexto para la IA <span className="text-muted-foreground">(opcional)</span></Label>
            <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} placeholder="Sector, oferta, tono, a quién quiere llegar…" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={creating}>Ahora no</Button>
          <Button onClick={submit} size="lg" className="gap-1.5" disabled={creating}>
            {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creando…</> : <><ArrowRight className="h-4 w-4" /> Crear y arrancar</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Attach memory / behaviour files (uploaded to storage; the URL+name is kept in the AI config).
function MemoryFiles({ files, onChange }: { files: AIFile[]; onChange: (f: AIFile[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) { toast.error("El archivo debe pesar menos de 8 MB"); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `ai-memory/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("godtube-media").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const url = supabase.storage.from("godtube-media").getPublicUrl(path).data.publicUrl;
      onChange([...(files || []), { name: file.name, url }]);
      toast.success("Archivo adjuntado");
    } catch (e: any) { toast.error(e?.message || "Error al subir el archivo"); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div className="space-y-1">
      {(files || []).map((f, i) => (
        <div key={i} className="flex items-center justify-between gap-2 rounded border border-border/60 bg-muted/30 px-2 py-1 text-xs">
          <a href={f.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 truncate text-foreground hover:underline"><Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{f.name}</span></a>
          <button type="button" onClick={() => onChange((files || []).filter((_, j) => j !== i))} className="shrink-0 text-muted-foreground hover:text-destructive">Quitar</button>
        </div>
      ))}
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
        {uploading ? <><Loader2 className="h-3 w-3 animate-spin" /> Subiendo…</> : <><Paperclip className="h-3 w-3" /> Adjuntar memoria/comportamiento</>}
      </Button>
    </div>
  );
}

function AgentBlock({ icon, title, hint, value, onChange, files, onFilesChange }: { icon: React.ReactNode; title: string; hint: string; value: string; onChange: (v: string) => void; files: AIFile[]; onFilesChange: (f: AIFile[]) => void }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2"><span className="text-primary">{icon}</span><Label className="text-sm font-semibold">{title}</Label></div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
      <MemoryFiles files={files} onChange={onFilesChange} />
    </div>
  );
}

function AIConfigDialog({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: AIConfig; onSave: (a: AIConfig) => void }) {
  const [cfg, setCfg] = useState<AIConfig>(value);
  useEffect(() => { if (open) setCfg(value); }, [open, value]);
  const set = (patch: Partial<AIConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const f = cfg.files || { global: [], onboarding: [], campaign: [], replies: [] };
  const setFilesFor = (k: keyof AIConfig["files"], v: AIFile[]) => set({ files: { global: f.global || [], onboarding: f.onboarding || [], campaign: f.campaign || [], replies: f.replies || [], [k]: v } });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Cómo actúa la IA</DialogTitle>
          <p className="text-sm text-muted-foreground">La memoria y el comportamiento de cada agente según la fase. Escríbelo como quieras — cada bloque es un agente distinto.</p>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /><Label className="text-sm font-semibold">Memoria general</Label></div>
            <p className="text-xs text-muted-foreground">Cómo debe actuar siempre: tono, marca, principios. Aquí subes tu "memoria" de cómo hacerlo.</p>
            <textarea value={cfg.globalMemory} onChange={(e) => set({ globalMemory: e.target.value })} rows={4} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <MemoryFiles files={f.global} onChange={(v) => setFilesFor("global", v)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Enlace del Google Form</Label>
            <Input value={cfg.formUrl} onChange={(e) => set({ formUrl: e.target.value })} placeholder="https://forms.gle/…" />
            <p className="text-xs text-muted-foreground">Es el que la IA envía al cliente para recoger la info de la campaña.</p>
          </div>

          <AgentBlock icon={<Mail className="h-4 w-4" />} title="Agente Onboarding" hint="Envía el correo de arranque (Form + onboarding) y actualiza las fases en silencio." value={cfg.onboarding} onChange={(v) => set({ onboarding: v })} files={f.onboarding} onFilesChange={(v) => setFilesFor("onboarding", v)} />
          <AgentBlock icon={<FileText className="h-4 w-4" />} title="Agente Campaña" hint="Analiza el Form + tu contexto y crea la campaña en borrador con los copys. Nunca la activa." value={cfg.campaign} onChange={(v) => set({ campaign: v })} files={f.campaign} onFilesChange={(v) => setFilesFor("campaign", v)} />
          <AgentBlock icon={<MessageSquare className="h-4 w-4" />} title="Agente Atención al cliente" hint="Lee el perfil de quien responde y contesta. Lo importante lo deja en borrador y te avisa." value={cfg.replies} onChange={(v) => set({ replies: v })} files={f.replies} onFilesChange={(v) => setFilesFor("replies", v)} />

          <div className="space-y-2 rounded-lg border border-border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={cfg.autoHandleRoutine} onChange={(e) => set({ autoHandleRoutine: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-border" />
              <span><b>La IA responde sola lo rutinario.</b> <span className="text-muted-foreground">Lo importante o dudoso siempre se queda en borrador y te avisa. Si lo desactivas, TODO queda en borrador para que tú lo apruebes.</span></span>
            </label>
            <div className="space-y-1.5"><Label className="text-xs">Correo para avisos importantes</Label><Input type="email" value={cfg.notifyEmail} onChange={(e) => set({ notifyEmail: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(cfg)}>Guardar memoria</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
