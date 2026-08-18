import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, ArrowRight, Workflow, Plus, Pencil, Trash2, ChevronRight, UserPlus, GripVertical, Brain, Mail, FileText, MessageSquare, ShieldCheck, CheckCircle2, XCircle, Link2 } from "lucide-react";
import { toast } from "sonner";

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
type FlowClient = { id: string; name: string; email: string; company: string; context: string; step: number; startedAt: string };
type AgentKey = "onboarding" | "campaign" | "replies" | "manual";
type AIConfig = {
  globalMemory: string;
  formUrl: string;
  onboarding: string;
  campaign: string;
  replies: string;
  autoHandleRoutine: boolean;
  notifyEmail: string;
};

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
  formUrl: "",
  onboarding:
    "Al arrancar, envía un correo con el enlace del Google Form (preguntas para la campaña) y el enlace del onboarding (para que vea su campaña en tiempo real). Cuando termine una fase, actualiza el onboarding en silencio — NO envíes correos por cada fase.",
  campaign:
    "Cuando el cliente responda el Form, coge toda la info + el contexto del dueño, analízalo y crea la(s) campaña(s) en BORRADOR (sin leads), con toda la secuencia y los copys. No actives nunca la campaña: la aprueba el dueño.",
  replies:
    "Cuando responda un lead, lee el perfil del cliente (propuesta, tono, oferta). Clasifica: interesado, pregunta, objeción, no interesado. Responde desde ese perfil. Si es importante o dudoso, prepara un borrador y avisa al dueño con un resumen. Solo respondes tú lo rutinario.",
  autoHandleRoutine: true,
  notifyEmail: "team@onepulso.online",
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

export default function AutomationFlow() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [clients, setClients] = useState<FlowClient[]>([]);
  const [ai, setAi] = useState<AIConfig>(DEFAULT_AI);
  const [google, setGoogle] = useState<GoogleConn>(DEFAULT_GOOGLE);
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [newClient, setNewClient] = useState(true); // el flujo arranca pidiendo los datos del cliente
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    setNodes(loadArr(FLOW_KEY, DEFAULT_NODES));
    setClients(loadArr(CLIENTS_KEY, []));
    setAi(load(AI_KEY, DEFAULT_AI));
    setGoogle(load(GOOGLE_KEY, DEFAULT_GOOGLE));
  }, []);
  const persistNodes = (n: Node[]) => { setNodes(n); save(FLOW_KEY, n); };
  const persistClients = (c: FlowClient[]) => { setClients(c); save(CLIENTS_KEY, c); };
  const persistAi = (a: AIConfig) => { setAi(a); save(AI_KEY, a); };

  if (!user) return null;
  if ((user.email || "").toLowerCase() !== "hello@onepulso.blog") return <Navigate to="/dashboard" replace />;

  const addNode = () => { const n = [...nodes, { id: uid(), label: "Nuevo paso", desc: "Describe qué hace este paso", agent: "manual" as AgentKey }]; persistNodes(n); setEditNode(n[n.length - 1]); };
  const saveNode = (node: Node) => { persistNodes(nodes.map((n) => n.id === node.id ? node : n)); setEditNode(null); };
  const deleteNode = (id: string) => { persistNodes(nodes.filter((n) => n.id !== id)); setEditNode(null); };

  const advance = (c: FlowClient) => persistClients(clients.map((x) => x.id === c.id ? { ...x, step: Math.min(x.step + 1, nodes.length - 1) } : x));
  const removeClient = (id: string) => persistClients(clients.filter((x) => x.id !== id));

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
          {!google.connected && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toast.info("Falta desplegar el backend (OAuth de Google). En cuanto haya deploy, se conecta y esto pasa a Conectado.")}>
              <Link2 className="h-4 w-4" /> Conectar con Google
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Editable flow ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">El flujo <span className="ml-1 text-xs font-normal text-muted-foreground">· haz clic en un paso para editarlo</span></CardTitle>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={addNode}><Plus className="h-4 w-4" /> Añadir paso</Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-2">
            <div className="flex w-max items-stretch gap-1">
              {nodes.map((s, i) => (
                <div key={s.id} className="flex items-stretch gap-1">
                  <button
                    onClick={() => setEditNode(s)}
                    className="group flex w-48 flex-col rounded-xl border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${AGENT_META[s.agent].color}`}>{AGENT_META[s.agent].label}</span>
                      <Pencil className="h-3 w-3 text-muted-foreground/0 transition-colors group-hover:text-primary" />
                    </div>
                    <p className="text-sm font-semibold">{i + 1}. {s.label}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{s.desc}</p>
                  </button>
                  {i < nodes.length - 1 && <div className="flex items-center px-0.5 text-muted-foreground/30"><ArrowRight className="h-4 w-4" /></div>}
                </div>
              ))}
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
                return (
                  <div key={c.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.company || c.name || c.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.email}{c.context ? ` · ${c.context}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${AGENT_META[node?.agent || "manual"].color}`}>
                          {c.step + 1}. {node?.label}
                        </span>
                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => advance(c)} disabled={c.step >= nodes.length - 1}><ChevronRight className="h-3.5 w-3.5" /> Siguiente</Button>
                        <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => removeClient(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
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

      {/* New client dialog */}
      <NewClientDialog
        open={newClient}
        onClose={() => setNewClient(false)}
        onAdd={(data) => {
          persistClients([{ id: uid(), step: 0, startedAt: new Date().toISOString(), ...data }, ...clients]);
          setNewClient(false);
          toast.success("Cliente añadido al flujo");
        }}
      />

      {/* AI brain / memory dialog */}
      <AIConfigDialog open={aiOpen} onClose={() => setAiOpen(false)} value={ai} onSave={(a) => { persistAi(a); setAiOpen(false); toast.success("Memoria de la IA guardada"); }} />
    </div>
  );
}

function NewClientDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (d: { name: string; email: string; company: string; context: string }) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [context, setContext] = useState("");
  useEffect(() => { if (open) { setName(""); setEmail(""); setCompany(""); setContext(""); } }, [open]);
  const submit = () => {
    if (!email.trim()) { toast.error("El correo es obligatorio"); return; }
    onAdd({ name: name.trim(), email: email.trim(), company: company.trim(), context: context.trim() });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserPlus className="h-5 w-5" /></div>
          <DialogTitle className="text-center font-display text-xl">Comienza un nuevo flujo</DialogTitle>
          <p className="text-center text-sm text-muted-foreground">Rellena los datos del cliente para arrancar. Empezará en el paso 1.</p>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label className="text-xs">Nombre</Label><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del contacto" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Correo *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Empresa</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nombre de la empresa" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Contexto para la IA <span className="text-muted-foreground">(opcional)</span></Label>
            <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} placeholder="Sector, oferta, tono, a quién quiere llegar…" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={onClose}>Ahora no</Button>
          <Button onClick={submit} size="lg" className="gap-1.5"><ArrowRight className="h-4 w-4" /> Comenzar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentBlock({ icon, title, hint, value, onChange }: { icon: React.ReactNode; title: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2"><span className="text-primary">{icon}</span><Label className="text-sm font-semibold">{title}</Label></div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
    </div>
  );
}

function AIConfigDialog({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: AIConfig; onSave: (a: AIConfig) => void }) {
  const [cfg, setCfg] = useState<AIConfig>(value);
  useEffect(() => { if (open) setCfg(value); }, [open, value]);
  const set = (patch: Partial<AIConfig>) => setCfg((c) => ({ ...c, ...patch }));
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
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Enlace del Google Form</Label>
            <Input value={cfg.formUrl} onChange={(e) => set({ formUrl: e.target.value })} placeholder="https://forms.gle/…" />
            <p className="text-xs text-muted-foreground">Es el que la IA envía al cliente para recoger la info de la campaña.</p>
          </div>

          <AgentBlock icon={<Mail className="h-4 w-4" />} title="Agente Onboarding" hint="Envía el correo de arranque (Form + onboarding) y actualiza las fases en silencio." value={cfg.onboarding} onChange={(v) => set({ onboarding: v })} />
          <AgentBlock icon={<FileText className="h-4 w-4" />} title="Agente Campaña" hint="Analiza el Form + tu contexto y crea la campaña en borrador con los copys. Nunca la activa." value={cfg.campaign} onChange={(v) => set({ campaign: v })} />
          <AgentBlock icon={<MessageSquare className="h-4 w-4" />} title="Agente Atención al cliente" hint="Lee el perfil de quien responde y contesta. Lo importante lo deja en borrador y te avisa." value={cfg.replies} onChange={(v) => set({ replies: v })} />

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
