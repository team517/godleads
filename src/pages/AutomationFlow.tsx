import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, ArrowRight, Workflow, Plus, Pencil, Trash2, ChevronRight, UserPlus, GripVertical } from "lucide-react";
import { toast } from "sonner";

// Owner-only automation module — an EDITABLE flow (N8N-style) of the auto-onboarding +
// customer-service pipeline. Separate module: never touches the sending engine or live
// campaigns. Runs on DeepSeek (wired up once the backend deploy path is restored).
//
// FIRST VERSION: the flow definition + the clients-in-flow are stored in the browser
// (localStorage) so you can shape and edit everything now. The real persistence +
// execution (send the form, generate the campaign, live progress) plugs in on the
// backend later — this is the visual + editing layer.

type Node = { id: string; label: string; desc: string };
type FlowClient = { id: string; name: string; email: string; company: string; step: number; startedAt: string };

const FLOW_KEY = "op_automation_flow_v1";
const CLIENTS_KEY = "op_automation_clients_v1";

const DEFAULT_NODES: Node[] = [
  { id: "n1", label: "Datos del cliente", desc: "Metes nombre, correo, empresa… y arranca el flujo" },
  { id: "n2", label: "Formulario", desc: "Se le envía el formulario de onboarding" },
  { id: "n3", label: "Info recogida", desc: "Se guarda todo lo que necesita la campaña" },
  { id: "n4", label: "Campaña generada", desc: "La IA (DeepSeek) crea la secuencia" },
  { id: "n5", label: "Tu aprobación", desc: "Revisas y das el visto bueno" },
  { id: "n6", label: "Campaña activa", desc: "Empieza a enviar (motor de siempre)" },
  { id: "n7", label: "Atención al cliente", desc: "La IA responde y propone cambios" },
];

const load = <T,>(key: string, fallback: T): T => {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fallback; } catch { return fallback; }
};
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } };
const uid = () => "x" + Math.random().toString(36).slice(2, 9);

export default function AutomationFlow() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [clients, setClients] = useState<FlowClient[]>([]);
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [newClient, setNewClient] = useState(false);

  useEffect(() => { setNodes(load(FLOW_KEY, DEFAULT_NODES)); setClients(load(CLIENTS_KEY, [])); }, []);
  const persistNodes = (n: Node[]) => { setNodes(n); save(FLOW_KEY, n); };
  const persistClients = (c: FlowClient[]) => { setClients(c); save(CLIENTS_KEY, c); };

  if (!user) return null;
  if ((user.email || "").toLowerCase() !== "hello@onepulso.blog") return <Navigate to="/dashboard" replace />;

  const addNode = () => { const n = [...nodes, { id: uid(), label: "Nuevo paso", desc: "Describe qué hace este paso" }]; persistNodes(n); setEditNode(n[n.length - 1]); };
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
            <p className="text-sm text-muted-foreground">Flujo automático de onboarding y atención al cliente · editable.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> IA: DeepSeek
        </span>
      </div>

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
                    className="group flex w-44 flex-col rounded-xl border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Paso {i + 1}</span>
                      <Pencil className="h-3 w-3 text-muted-foreground/0 transition-colors group-hover:text-primary" />
                    </div>
                    <p className="text-sm font-semibold">{s.label}</p>
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
              Mete los datos de un cliente con <b className="text-foreground">"Nuevo cliente"</b> y arranca su flujo. Aquí lo verás avanzar por cada paso.
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
                        <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          Paso {c.step + 1}: {node?.label}
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

      <p className="text-center text-xs text-muted-foreground">
        Módulo independiente: <b className="text-foreground">no toca el motor de envío ni las campañas en marcha</b>. Por ahora el flujo se guarda en tu navegador; cuando restauremos el deploy, lo conecto al backend para que persista y se ejecute solo.
      </p>

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
    </div>
  );
}

function NewClientDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (d: { name: string; email: string; company: string }) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  useEffect(() => { if (open) { setName(""); setEmail(""); setCompany(""); } }, [open]);
  const submit = () => {
    if (!email.trim()) { toast.error("El correo es obligatorio"); return; }
    onAdd({ name: name.trim(), email: email.trim(), company: company.trim() });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">Datos del cliente</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Mete los datos y arranca el flujo. Empezará en el paso 1.</p>
          <div className="space-y-1.5"><Label className="text-xs">Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del contacto" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Correo *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Empresa</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nombre de la empresa" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} className="gap-1.5"><Plus className="h-4 w-4" /> Arrancar flujo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
