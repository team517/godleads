import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkflowCanvas, EdgeData } from "@/components/workflows/WorkflowCanvas";
import { WorkflowNodeData } from "@/components/workflows/WorkflowNode";
import { Plus, ArrowLeft, Save, Workflow, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { Json } from "@/integrations/supabase/types";

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  nodes: Json;
  edges: Json;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function Workflows() {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nodes, setNodes] = useState<WorkflowNodeData[]>([]);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchWorkflows = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("workflows")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    setWorkflows((data as WorkflowRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchWorkflows();
  }, [user]);

  const createWorkflow = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("workflows")
      .insert({ user_id: user.id, name: "Nuevo workflow" })
      .select()
      .single();
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    const row = data as WorkflowRow;
    openEditor(row);
    fetchWorkflows();
  };

  const openEditor = (wf: WorkflowRow) => {
    setEditingId(wf.id);
    setName(wf.name);
    setNodes((wf.nodes as unknown as WorkflowNodeData[]) || []);
    setEdges((wf.edges as unknown as EdgeData[]) || []);
  };

  const saveWorkflow = async () => {
    if (!editingId) return;
    setSaving(true);
    const { error } = await supabase
      .from("workflows")
      .update({
        name,
        nodes: nodes as unknown as Json,
        edges: edges as unknown as Json,
      })
      .eq("id", editingId);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Guardado", description: "Workflow guardado correctamente" });
      fetchWorkflows();
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("workflows").update({ is_active: !current }).eq("id", id);
    fetchWorkflows();
  };

  const deleteWorkflow = async (id: string) => {
    await supabase.from("workflows").delete().eq("id", id);
    fetchWorkflows();
    toast({ title: "Eliminado", description: "Workflow eliminado" });
  };

  const closeEditor = () => {
    setEditingId(null);
    setNodes([]);
    setEdges([]);
  };

  // Editor view
  if (editingId) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={closeEditor}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm font-semibold h-8 w-60 border-none bg-transparent focus-visible:ring-1"
            />
          </div>
          <Button size="sm" onClick={saveWorkflow} disabled={saving} className="gap-2">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
        <WorkflowCanvas
          nodes={nodes}
          edges={edges}
          onChange={(n, e) => {
            setNodes(n);
            setEdges(e);
          }}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-1">Automatiza procesos con nodos visuales</p>
        </div>
        <Button onClick={createWorkflow} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo workflow
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : workflows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <Workflow className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="font-semibold text-lg mb-1">No hay workflows</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Crea tu primer workflow para automatizar tareas
          </p>
          <Button onClick={createWorkflow} className="gap-2">
            <Plus className="h-4 w-4" />
            Crear workflow
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {workflows.map((wf) => (
            <Card
              key={wf.id}
              className="flex items-center justify-between p-4 hover:bg-accent/30 transition-colors cursor-pointer"
              onClick={() => openEditor(wf)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Workflow className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{wf.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(wf.nodes as any[])?.length || 0} nodos · Editado{" "}
                    {formatDistanceToNow(new Date(wf.updated_at), { addSuffix: true, locale: es })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <Badge variant={wf.is_active ? "default" : "secondary"} className="text-[10px]">
                  {wf.is_active ? "Activo" : "Inactivo"}
                </Badge>
                <Switch checked={wf.is_active} onCheckedChange={() => toggleActive(wf.id, wf.is_active)} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteWorkflow(wf.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
