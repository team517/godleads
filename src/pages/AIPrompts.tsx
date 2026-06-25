import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Brain, Plus, Pencil, Trash2, Tag, Sparkles, Zap, ScrollText, Clock, Mail, CheckCircle2, XCircle, ChevronDown, ChevronUp, AtSign, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface AIPrompt {
  id: string;
  name: string;
  company_info: string;
  prompt: string;
  tags: string[];
  created_at: string;
}

interface AutoReplyRule {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  company_info: string;
  account_tags: string[];
  account_ids: string[];
  is_active: boolean;
  delay_minutes: number;
  created_at: string;
  updated_at: string;
}

interface AutoReplyLogEntry {
  id: string;
  user_id: string;
  rule_id: string | null;
  inbox_message_id: string | null;
  to_email: string;
  subject: string;
  ai_response: string;
  status: string;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
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
          <DialogContent className="max-w-lg">
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
              <div className="flex justify-end gap-2 pt-2">
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

// ─── Auto Reply Tab ───
function AutoReplyTab() {
  const { user } = useAuth();
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; email: string; tags: string[] }[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AutoReplyRule | null>(null);

  const [name, setName] = useState("");
  const [companyInfo, setCompanyInfo] = useState("");
  const [promptText, setPromptText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [delayMinutes, setDelayMinutes] = useState(5);
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");

  const loadRules = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("auto_reply_rules")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRules((data as any as AutoReplyRule[]) || []);
    setLoading(false);
  };

  const loadAccountsAndTags = async () => {
    if (!user) return;
    const { data } = await supabase.from("email_accounts").select("id, email, tags").eq("user_id", user.id);
    const accs = (data || []) as { id: string; email: string; tags: string[] }[];
    setAccounts(accs);
    const allTags = new Set<string>();
    accs.forEach(acc => acc.tags?.forEach(t => allTags.add(t)));
    setAvailableTags(Array.from(allTags).sort());
  };

  useEffect(() => { loadRules(); loadAccountsAndTags(); }, [user]);

  const resetForm = () => { setName(""); setCompanyInfo(""); setPromptText(""); setSelectedTags([]); setSelectedAccountIds([]); setDelayMinutes(5); setEditing(null); };
  const openCreate = () => { resetForm(); setDialogOpen(true); };
  const openEdit = (r: AutoReplyRule) => {
    setEditing(r); setName(r.name); setCompanyInfo(r.company_info); setPromptText(r.prompt);
    setSelectedTags(r.account_tags); setSelectedAccountIds(r.account_ids || []); setDelayMinutes(r.delay_minutes); setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!user || !name.trim()) { toast.error("Pon un nombre a la regla"); return; }
    if (selectedTags.length === 0 && selectedAccountIds.length === 0) { toast.error("Selecciona al menos un tag o una cuenta"); return; }

    const payload = { name, company_info: companyInfo, prompt: promptText, account_tags: selectedTags, account_ids: selectedAccountIds, delay_minutes: delayMinutes };

    if (editing) {
      const { error } = await supabase.from("auto_reply_rules").update(payload).eq("id", editing.id);
      if (error) toast.error(error.message); else toast.success("Regla actualizada");
    } else {
      const { error } = await supabase.from("auto_reply_rules").insert({ ...payload, user_id: user.id });
      if (error) toast.error(error.message); else toast.success("Regla creada");
    }
    setDialogOpen(false); resetForm(); loadRules();
  };

  const handleToggle = async (rule: AutoReplyRule) => {
    const { error } = await supabase.from("auto_reply_rules").update({ is_active: !rule.is_active }).eq("id", rule.id);
    if (error) toast.error(error.message);
    else { toast.success(rule.is_active ? "Regla desactivada" : "Regla activada"); loadRules(); }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("auto_reply_rules").delete().eq("id", id);
    toast.success("Regla eliminada"); loadRules();
  };

  const toggleTag = (tag: string) => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  const toggleAccount = (id: string) => setSelectedAccountIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Crea reglas para que la IA responda automáticamente a emails entrantes como un reply al mismo hilo.</p>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Crear regla</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />{editing ? "Editar regla" : "Nueva regla de auto-respuesta"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div><label className="text-sm font-medium mb-1.5 block">Nombre</label><Input placeholder="Ej: Auto-respuesta ventas" value={name} onChange={e => setName(e.target.value)} /></div>
              <div><label className="text-sm font-medium mb-1.5 block">Información de la empresa</label><Textarea placeholder="Describe tu empresa, servicios…" className="min-h-[80px] resize-none" value={companyInfo} onChange={e => setCompanyInfo(e.target.value)} /></div>
              <div><label className="text-sm font-medium mb-1.5 block">Instrucciones para la IA</label><Textarea placeholder="Ej: Responde de forma profesional, ofrece una llamada si muestran interés…" className="min-h-[80px] resize-none" value={promptText} onChange={e => setPromptText(e.target.value)} /></div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Seleccionar por tags</label>
                <p className="text-xs text-muted-foreground mb-2">Todas las cuentas con estos tags se incluirán.</p>
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
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium block">Seleccionar por cuenta</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 text-primary hover:text-primary"
                    onClick={() => {
                      if (selectedAccountIds.length === accounts.length) {
                        setSelectedAccountIds([]);
                      } else {
                        setSelectedAccountIds(accounts.map(a => a.id));
                      }
                    }}
                  >
                    {selectedAccountIds.length === accounts.length && accounts.length > 0 ? "Deseleccionar todas" : "Seleccionar todas"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-2">También puedes elegir cuentas específicas directamente.</p>
                {selectedAccountIds.length > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-primary text-primary-foreground border border-primary">
                      <Mail className="h-3 w-3" />
                      {selectedAccountIds.length === accounts.length
                        ? `Todas las cuentas (${accounts.length})`
                        : `${selectedAccountIds.length} cuenta${selectedAccountIds.length > 1 ? "s" : ""} seleccionada${selectedAccountIds.length > 1 ? "s" : ""}`}
                    </span>
                    {selectedAccountIds.length < accounts.length && (
                      <button onClick={() => setSelectedAccountIds([])} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <Popover open={accountPopoverOpen} onOpenChange={setAccountPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 text-xs">
                      <AtSign className="h-3.5 w-3.5" />
                      Añadir cuenta
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0 bg-popover border border-border shadow-lg z-50" align="start">
                    <div className="p-2 border-b border-border">
                      <Input
                        placeholder="Buscar cuenta…"
                        value={accountSearch}
                        onChange={e => setAccountSearch(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto p-1">
                      {accounts.filter(a => a.email.toLowerCase().includes(accountSearch.toLowerCase())).length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-3">Sin resultados</p>
                      ) : (
                        accounts.filter(a => a.email.toLowerCase().includes(accountSearch.toLowerCase())).map(acc => (
                          <button
                            key={acc.id}
                            onClick={() => toggleAccount(acc.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors ${
                              selectedAccountIds.includes(acc.id)
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            <AtSign className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{acc.email}</span>
                            {selectedAccountIds.includes(acc.id) && <CheckCircle2 className="h-3.5 w-3.5 ml-auto shrink-0 text-primary" />}
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Delay antes de responder (minutos)</label>
                <Input type="number" min={1} max={60} value={delayMinutes} onChange={e => setDelayMinutes(parseInt(e.target.value) || 5)} className="w-32" />
                <p className="text-xs text-muted-foreground mt-1">La IA esperará este tiempo antes de enviar la respuesta.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>Cancelar</Button>
                <Button onClick={handleSave} className="gap-2"><Zap className="h-4 w-4" />{editing ? "Guardar cambios" : "Crear regla"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {rules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4"><Zap className="h-8 w-8 text-primary" /></div>
            <h3 className="font-display font-semibold text-lg mb-2">Sin reglas de auto-respuesta</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">Crea una regla para que la IA responda automáticamente a los emails que recibas en las cuentas seleccionadas.</p>
            <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Crear primera regla</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rules.map(r => (
            <Card key={r.id} className={`group transition-shadow hover:shadow-md ${r.is_active ? "border-primary/30" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className={`h-4 w-4 ${r.is_active ? "text-primary" : "text-muted-foreground"}`} />
                    {r.name}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Switch checked={r.is_active} onCheckedChange={() => handleToggle(r)} />
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Responde en {r.delay_minutes} min</span>
                  <Badge variant={r.is_active ? "default" : "secondary"} className="text-[10px] ml-auto">
                    {r.is_active ? "Activa" : "Inactiva"}
                  </Badge>
                </div>
                {r.prompt && <p className="text-xs text-foreground/70 line-clamp-2 italic">"{r.prompt}"</p>}
                <div className="flex flex-wrap gap-1.5">
                  {r.account_tags.map(tag => (<Badge key={tag} variant="secondary" className="text-[10px] gap-1"><Tag className="h-2.5 w-2.5" /> {tag}</Badge>))}
                  {(r.account_ids || []).map(aid => {
                    const acc = accounts.find(a => a.id === aid);
                    return acc ? <Badge key={aid} variant="outline" className="text-[10px] gap-1"><AtSign className="h-2.5 w-2.5" /> {acc.email}</Badge> : null;
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Log Tab ───
function LogTab() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AutoReplyLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("auto_reply_log")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setLogs((data as any as AutoReplyLogEntry[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadLogs(); }, [user]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("auto-reply-log-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "auto_reply_log", filter: `user_id=eq.${user.id}` }, () => {
        loadLogs();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  if (logs.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4"><ScrollText className="h-8 w-8 text-primary" /></div>
          <h3 className="font-display font-semibold text-lg mb-2">Sin respuestas registradas</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">Cuando la IA responda automáticamente a un email, aparecerá aquí el registro.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Historial de respuestas automáticas enviadas por la IA. Se actualiza en tiempo real.</p>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Fecha</TableHead>
              <TableHead>Para</TableHead>
              <TableHead>Asunto</TableHead>
              <TableHead>Respuesta IA</TableHead>
              <TableHead className="w-[100px] text-center">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map(log => (
              <>
                <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      {log.to_email}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{log.subject || "(sin asunto)"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[250px]">
                    <div className="flex items-center gap-1">
                      <span className="truncate">{log.ai_response.substring(0, 80)}{log.ai_response.length > 80 ? "…" : ""}</span>
                      {expandedId === log.id ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {log.status === "sent" ? (
                      <Badge variant="default" className="gap-1 text-[10px]"><CheckCircle2 className="h-3 w-3" />Enviado</Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1 text-[10px]"><XCircle className="h-3 w-3" />Fallido</Badge>
                    )}
                  </TableCell>
                </TableRow>
                {expandedId === log.id && (
                  <TableRow key={`${log.id}-expanded`}>
                    <TableCell colSpan={5} className="bg-muted/30 p-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Respuesta completa:</p>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{log.ai_response}</p>
                        {log.error_message && (
                          <div className="mt-2">
                            <p className="text-sm font-medium text-destructive">Error:</p>
                            <p className="text-sm text-destructive/80">{log.error_message}</p>
                          </div>
                        )}
                        {log.sent_at && (
                          <p className="text-xs text-muted-foreground mt-2">Enviado: {format(new Date(log.sent_at), "dd MMM yyyy HH:mm:ss", { locale: es })}</p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </Card>
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
          Gestiona prompts, reglas de respuesta automática y consulta el registro de respuestas.
        </p>
      </div>

      <Tabs defaultValue="prompts" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="prompts" className="gap-2"><Sparkles className="h-4 w-4" />Prompts</TabsTrigger>
          <TabsTrigger value="auto-reply" className="gap-2"><Zap className="h-4 w-4" />Respuesta Automática</TabsTrigger>
          <TabsTrigger value="log" className="gap-2"><ScrollText className="h-4 w-4" />Registro</TabsTrigger>
        </TabsList>
        <TabsContent value="prompts"><PromptsTab /></TabsContent>
        <TabsContent value="auto-reply"><AutoReplyTab /></TabsContent>
        <TabsContent value="log"><LogTab /></TabsContent>
      </Tabs>
    </div>
  );
}
