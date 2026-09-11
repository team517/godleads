import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Plus, Pencil, Trash2, Tag, Sparkles, Bot, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ReplyAgentTab } from "@/components/reply-agent/ReplyAgentTab";
import { ReplyAgentLog } from "@/components/reply-agent/ReplyAgentLog";

interface AIPrompt {
  id: string;
  name: string;
  company_info: string;
  prompt: string;
  tags: string[];
  created_at: string;
}

// ─── Prompts Tab (original content) ───
function PromptsTab() {
  const { user } = useAuth();
  const [prompts, setPrompts] = useState<AIPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AIPrompt | null>(null);
  const [name, setName] = useState("");
  const [companyInfo, setCompanyInfo] = useState("");
  const [promptText, setPromptText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const loadPrompts = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("ai_prompts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setPrompts((data as AIPrompt[]) || []);
    setLoading(false);
  };

  const loadTags = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("email_accounts")
      .select("tags")
      .eq("user_id", user.id);
    const allTags = new Set<string>();
    data?.forEach((acc: any) => acc.tags?.forEach((t: string) => allTags.add(t)));
    setAvailableTags(Array.from(allTags).sort());
  };

  useEffect(() => { loadPrompts(); loadTags(); }, [user]);

  const resetForm = () => { setName(""); setCompanyInfo(""); setPromptText(""); setSelectedTags([]); setEditing(null); };
  const openCreate = () => { resetForm(); setDialogOpen(true); };
  const openEdit = (p: AIPrompt) => { setEditing(p); setName(p.name); setCompanyInfo(p.company_info); setPromptText(p.prompt); setSelectedTags(p.tags); setDialogOpen(true); };

  const handleSave = async () => {
    if (!user || !name.trim()) { toast.error("Pon un nombre al prompt"); return; }
    if (editing) {
      const { error } = await supabase.from("ai_prompts").update({ name, company_info: companyInfo, prompt: promptText, tags: selectedTags }).eq("id", editing.id);
      if (error) toast.error(error.message); else toast.success("Prompt actualizado");
    } else {
      const { error } = await supabase.from("ai_prompts").insert({ user_id: user.id, name, company_info: companyInfo, prompt: promptText, tags: selectedTags });
      if (error) toast.error(error.message); else toast.success("Prompt creado");
    }
    setDialogOpen(false); resetForm(); loadPrompts();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("ai_prompts").delete().eq("id", id);
    toast.success("Prompt eliminado"); loadPrompts();
  };

  const toggleTag = (tag: string) => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Configura prompts de IA asociados a tags de tus cuentas. La IA sugerirá respuestas en el Unibox.</p>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Crear prompt</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />{editing ? "Editar prompt" : "Nuevo prompt de IA"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div><label className="text-sm font-medium mb-1.5 block">Nombre</label><Input placeholder="Ej: Ventas GodLeads" value={name} onChange={e => setName(e.target.value)} /></div>
              <div><label className="text-sm font-medium mb-1.5 block">Información de la empresa</label><Textarea placeholder="Describe tu empresa, servicios…" className="min-h-[100px] resize-none" value={companyInfo} onChange={e => setCompanyInfo(e.target.value)} /></div>
              <div><label className="text-sm font-medium mb-1.5 block">Instrucciones para la IA</label><Textarea placeholder="Ej: Responde profesional y cercana…" className="min-h-[100px] resize-none" value={promptText} onChange={e => setPromptText(e.target.value)} /></div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Tags asociados</label>
                <p className="text-xs text-muted-foreground mb-2">Los mensajes recibidos en cuentas con estos tags activarán la sugerencia de IA.</p>
                {availableTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No hay tags en tus cuentas de email.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map(tag => (
                      <button key={tag} onClick={() => toggleTag(tag)} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${selectedTags.includes(tag) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/80"}`}>
                        <Tag className="h-3 w-3" />{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end gap-2 border-t bg-background px-6 py-4">
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
                <Button onClick={handleSave} className="gap-2"><Sparkles className="h-4 w-4" />{editing ? "Guardar cambios" : "Crear prompt"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {prompts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4"><Brain className="h-8 w-8 text-primary" /></div>
            <h3 className="font-display font-semibold text-lg mb-2">Sin prompts configurados</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">Crea un prompt de IA y asócialo a los tags de tus cuentas.</p>
            <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Crear tu primer prompt</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {prompts.map(p => (
            <Card key={p.id} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />{p.name}</CardTitle>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {p.company_info && <p className="text-xs text-muted-foreground line-clamp-2">{p.company_info}</p>}
                {p.prompt && <p className="text-xs text-foreground/70 line-clamp-2 italic">"{p.prompt}"</p>}
                <div className="flex flex-wrap gap-1.5">
                  {p.tags.map(tag => (<Badge key={tag} variant="secondary" className="text-[10px] gap-1"><Tag className="h-2.5 w-2.5" /> {tag}</Badge>))}
                  {p.tags.length === 0 && <span className="text-[10px] text-muted-foreground italic">Sin tags</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───
export default function AIPrompts() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          Asistente IA
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona prompts, configura tus agentes de respuesta y consulta su actividad.
        </p>
      </div>

      <Tabs defaultValue="prompts" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="prompts" className="gap-2"><Sparkles className="h-4 w-4" />Prompts</TabsTrigger>
          <TabsTrigger value="reply-agent" className="gap-2"><Bot className="h-4 w-4" />Agente de respuestas</TabsTrigger>
          <TabsTrigger value="log" className="gap-2"><ScrollText className="h-4 w-4" />Registro</TabsTrigger>
        </TabsList>
        <TabsContent value="prompts"><PromptsTab /></TabsContent>
        <TabsContent value="reply-agent"><ReplyAgentTab /></TabsContent>
        <TabsContent value="log"><ReplyAgentLog /></TabsContent>
      </Tabs>
    </div>
  );
}
