import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Trash2, Clock, GitBranch, Zap, Eye, ChevronRight, SendHorizonal, Loader2, Bold, Save, FileText, Link2, Sparkles, WandSparkles, GripVertical } from "lucide-react";

interface Props { campaignId: string; }
interface Variant { subject: string; body: string; }

export default function CampaignSequences({ campaignId }: Props) {
  const { user } = useAuth();
  const [steps, setSteps] = useState<any[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [dynamicVars, setDynamicVars] = useState<{ label: string; tag: string }[]>([]);
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);
  // Test email state
  const [showTestEmail, setShowTestEmail] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [testAccountId, setTestAccountId] = useState<string>("");
  const [campaignLeadEmails, setCampaignLeadEmails] = useState<string[]>([]);
  // Templates state
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<any[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  // AI generation state
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiSelectedVars, setAiSelectedVars] = useState<string[]>([]);
  const [aiNumSteps, setAiNumSteps] = useState("3");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [autoBolding, setAutoBolding] = useState(false);
  const [generatingSubject, setGeneratingSubject] = useState(false);
  const [dragStepId, setDragStepId] = useState<string | null>(null);
  const [dragOverStepId, setDragOverStepId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("campaign_steps").select("*").eq("campaign_id", campaignId).order("step_order");
    setSteps(data || []);
    if (data?.length && !selectedStepId) setSelectedStepId(data[0].id);
  };

  useEffect(() => { load(); loadVariables(); loadAccounts(); loadLeadEmails(); }, [campaignId]);

  const loadVariables = async () => {
    // Get leads assigned to this campaign and extract all custom_field keys
    const { data: campaignLeads } = await supabase
      .from("campaign_leads")
      .select("lead_id, leads(email, custom_fields)")
      .eq("campaign_id", campaignId);

    const keySet = new Set<string>();
    keySet.add("email");
    (campaignLeads || []).forEach((cl: any) => {
      const fields = cl.leads?.custom_fields;
      if (fields && typeof fields === "object") {
        Object.keys(fields).forEach(k => keySet.add(k));
      }
    });

    setDynamicVars(
      Array.from(keySet).map(k => ({ label: k, tag: `{{${k}}}` }))
    );
  };

  const loadAccounts = async () => {
    if (!user) return;
    const { data } = await supabase.from("email_accounts").select("id, email").eq("user_id", user.id).eq("status", "connected");
    setEmailAccounts(data || []);
    if (data?.length) setTestAccountId(data[0].id);
  };

  const loadLeadEmails = async () => {
    const { data } = await supabase
      .from("campaign_leads")
      .select("leads(email)")
      .eq("campaign_id", campaignId)
      .limit(20);
    const emails = (data || []).map((cl: any) => cl.leads?.email).filter(Boolean);
    setCampaignLeadEmails([...new Set(emails)] as string[]);
  };

  const sendTestEmail = async () => {
    if (!testTo || !testAccountId || !selectedStep) return;
    setTestSending(true);
    try {
      // Build sample fields from first lead
      const { data: sampleLead } = await supabase
        .from("campaign_leads")
        .select("leads(email, custom_fields)")
        .eq("campaign_id", campaignId)
        .limit(1)
        .single();

      const sampleFields: Record<string, string> = { email: testTo };
      if (sampleLead?.leads?.custom_fields && typeof sampleLead.leads.custom_fields === "object") {
        Object.entries(sampleLead.leads.custom_fields as Record<string, string>).forEach(([k, v]) => {
          sampleFields[k] = v;
        });
      }

      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          account_id: testAccountId,
          to_email: testTo,
          subject: getCurrentSubject(),
          body: getCurrentBody(),
          custom_fields: sampleFields,
          is_test: true,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Email de prueba enviado a ${testTo}`);
      setShowTestEmail(false);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setTestSending(false);
    }
  };

  const toggleBold = () => {
    const el = document.getElementById("seq-body-editor") as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;
    const selected = val.substring(start, end);
    let newVal: string;
    let newCursorEnd: number;
    if (selected.startsWith("<b>") && selected.endsWith("</b>")) {
      const unwrapped = selected.slice(3, -4);
      newVal = val.substring(0, start) + unwrapped + val.substring(end);
      newCursorEnd = start + unwrapped.length;
    } else {
      const wrapped = `<b>${selected}</b>`;
      newVal = val.substring(0, start) + wrapped + val.substring(end);
      newCursorEnd = start + wrapped.length;
    }
    setCurrentBody(newVal);
    setTimeout(() => { el.focus(); el.setSelectionRange(start, newCursorEnd); }, 0);
  };

  // Link insertion state
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");

  const insertLink = () => {
    if (!linkUrl) return;
    const el = document.getElementById("seq-body-editor") as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;
    const selected = val.substring(start, end);
    const text = linkText || selected || linkUrl;
    const tag = `<a href="${linkUrl}">${text}</a>`;
    const newVal = val.substring(0, start) + tag + val.substring(end);
    setCurrentBody(newVal);
    setLinkUrl("");
    setLinkText("");
    setShowLinkPopover(false);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
  };

  const loadTemplates = async () => {
    if (!user) return;
    const { data } = await supabase.from("email_templates").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setTemplates(data || []);
  };

  const saveTemplate = async () => {
    if (!user || !selectedStep || !templateName) return;
    setSavingTemplate(true);
    const { error } = await supabase.from("email_templates").insert({
      user_id: user.id,
      name: templateName,
      subject: getCurrentSubject(),
      body: getCurrentBody(),
    });
    setSavingTemplate(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Plantilla guardada");
    setShowSaveTemplate(false);
    setTemplateName("");
  };

  const applyTemplate = (tpl: any) => {
    if (!selectedStep) return;
    setCurrentSubject(tpl.subject);
    setCurrentBody(tpl.body);
    setShowLoadTemplate(false);
    toast.success(`Plantilla "${tpl.name}" aplicada`);
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from("email_templates").delete().eq("id", id);
    loadTemplates();
    toast.success("Plantilla eliminada");
  };

  const generateWithAI = async () => {
    if (!aiContext.trim()) { toast.error("Escribe el contexto de tu campaña"); return; }
    setAiGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-sequence", {
        body: { context: aiContext, variables: aiSelectedVars, numSteps: parseInt(aiNumSteps) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const aiSteps = data.steps;
      if (!Array.isArray(aiSteps) || aiSteps.length === 0) throw new Error("No se generaron pasos");

      // Delete existing steps and create new ones
      await supabase.from("campaign_steps").delete().eq("campaign_id", campaignId);

      for (let i = 0; i < aiSteps.length; i++) {
        await supabase.from("campaign_steps").insert({
          campaign_id: campaignId,
          step_order: i + 1,
          subject: aiSteps[i].subject || "",
          body: aiSteps[i].body || "",
          delay_days: aiSteps[i].delay_days ?? (i === 0 ? 0 : 3),
          variants: [] as any,
        });
      }

      toast.success(`${aiSteps.length} pasos generados con IA`);
      setShowAiGenerate(false);
      setSelectedStepId(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Error al generar secuencia");
    } finally {
      setAiGenerating(false);
    }
  };

  const selectedStep = steps.find(s => s.id === selectedStepId);

  // Reset active variant when switching steps
  useEffect(() => { setActiveVariantIndex(0); }, [selectedStepId]);

  const addStep = async () => {
    const order = steps.length + 1;
    const { data } = await supabase.from("campaign_steps").insert({
      campaign_id: campaignId, step_order: order,
      subject: "", body: "",
      delay_days: order === 1 ? 0 : 2,
      variants: [] as any,
    }).select("id").single();
    toast.success(`Step ${order} añadido`);
    load().then(() => { if (data) setSelectedStepId(data.id); });
  };

  const deleteStep = async (id: string) => {
    await supabase.from("campaign_steps").delete().eq("id", id);
    if (selectedStepId === id) setSelectedStepId(null);
    toast.success("Paso eliminado");
    load();
  };

  const addVariant = async (step: any) => {
    const variants: Variant[] = Array.isArray(step.variants) ? step.variants : [];
    const letter = String.fromCharCode(66 + variants.length);
    variants.push({ subject: "", body: "" });
    await supabase.from("campaign_steps").update({ variants: variants as any }).eq("id", step.id);
    toast.success(`Variante ${letter} añadida`);
    load();
  };

  const updateVariantField = async (step: any, idx: number, field: "subject" | "body", value: string) => {
    const variants: Variant[] = [...(step.variants || [])];
    variants[idx] = { ...variants[idx], [field]: value };
    await supabase.from("campaign_steps").update({ variants: variants as any }).eq("id", step.id);
  };

  const removeVariant = async (step: any, idx: number) => {
    const variants: Variant[] = [...(step.variants || [])];
    variants.splice(idx, 1);
    await supabase.from("campaign_steps").update({ variants: variants as any }).eq("id", step.id);
    setActiveVariantIndex(0);
    load();
  };

  const updateStepField = async (id: string, field: string, value: any) => {
    await supabase.from("campaign_steps").update({ [field]: value }).eq("id", id);
  };

  const insertVariable = (tag: string, target: "body" | "subject" = "body") => {
    if (!selectedStep) return;
    const elId = target === "subject" ? "seq-subject-editor" : "seq-body-editor";
    const el = document.getElementById(elId) as HTMLTextAreaElement | HTMLInputElement | null;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const current = el.value;
      const newVal = current.substring(0, start) + tag + current.substring(end);
      el.value = newVal;

      if (target === "subject") {
        setCurrentSubject(newVal);
      } else if (activeVariantIndex === 0) {
        updateStepField(selectedStep.id, "body", newVal);
        setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, body: newVal } : s));
      } else {
        const vi = activeVariantIndex - 1;
        updateVariantField(selectedStep, vi, "body", newVal);
        const newVariants = [...(selectedStep.variants || [])];
        newVariants[vi] = { ...newVariants[vi], body: newVal };
        setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, variants: newVariants } : s));
      }
      setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
    }
  };

  const previewText = (text: string) => {
    let result = text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const map: Record<string, string> = {};
      dynamicVars.forEach(v => {
        const k = v.label;
        map[k] = `[${k}]`;
      });
      map["email"] = "ejemplo@empresa.com";
      return map[key] || `{{${key}}}`;
    });
    // Convert **bold** markdown to <b> tags
    result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    return result;
  };

  const variants: Variant[] = selectedStep ? (Array.isArray(selectedStep.variants) ? selectedStep.variants : []) : [];

  // Get current subject/body based on active variant
  const getCurrentSubject = () => {
    if (!selectedStep) return "";
    if (activeVariantIndex === 0) return selectedStep.subject;
    return variants[activeVariantIndex - 1]?.subject || "";
  };

  const getCurrentBody = () => {
    if (!selectedStep) return "";
    if (activeVariantIndex === 0) return selectedStep.body;
    return variants[activeVariantIndex - 1]?.body || "";
  };

  const setCurrentSubject = (val: string) => {
    if (!selectedStep) return;
    if (activeVariantIndex === 0) {
      setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, subject: val } : s));
      updateStepField(selectedStep.id, "subject", val);
    } else {
      const vi = activeVariantIndex - 1;
      const newVariants = [...variants];
      newVariants[vi] = { ...newVariants[vi], subject: val };
      setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, variants: newVariants } : s));
      updateVariantField(selectedStep, vi, "subject", val);
    }
  };

  const setCurrentBody = (val: string) => {
    if (!selectedStep) return;
    if (activeVariantIndex === 0) {
      setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, body: val } : s));
      updateStepField(selectedStep.id, "body", val);
    } else {
      const vi = activeVariantIndex - 1;
      const newVariants = [...variants];
      newVariants[vi] = { ...newVariants[vi], body: val };
      setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, variants: newVariants } : s));
      updateVariantField(selectedStep, vi, "body", val);
    }
  };

  // All variant labels: A, B, C...
  const variantLabels = ["A", ...variants.map((_, i) => String.fromCharCode(66 + i))];

  return (
    <>
    <div className="flex flex-col sm:flex-row gap-0 sm:h-[calc(100vh-280px)] sm:min-h-[500px]">
      {/* Left sidebar - Steps list */}
      <div className="w-full sm:w-72 shrink-0 border rounded-t-lg sm:rounded-t-none sm:rounded-l-lg bg-card overflow-y-auto max-h-48 sm:max-h-none">
        {steps.map((step, i) => {
          const isSelected = step.id === selectedStepId;
          const stepVariants: Variant[] = Array.isArray(step.variants) ? step.variants : [];
          const isDragging = dragStepId === step.id;
          const isDragOver = dragOverStepId === step.id && dragStepId !== step.id;
          return (
            <div
              key={step.id}
              draggable
              onDragStart={(e) => {
                setDragStepId(step.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverStepId(step.id);
              }}
              onDragLeave={() => {
                if (dragOverStepId === step.id) setDragOverStepId(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                if (!dragStepId || dragStepId === step.id) { setDragStepId(null); setDragOverStepId(null); return; }
                const fromIdx = steps.findIndex(s => s.id === dragStepId);
                const toIdx = steps.findIndex(s => s.id === step.id);
                if (fromIdx === -1 || toIdx === -1) { setDragStepId(null); setDragOverStepId(null); return; }
                const reordered = [...steps];
                const [moved] = reordered.splice(fromIdx, 1);
                reordered.splice(toIdx, 0, moved);
                setSteps(reordered);
                setDragStepId(null);
                setDragOverStepId(null);
                // Update step_order in DB
                for (let j = 0; j < reordered.length; j++) {
                  await supabase.from("campaign_steps").update({ step_order: j + 1 }).eq("id", reordered[j].id);
                }
                load();
              }}
              onDragEnd={() => { setDragStepId(null); setDragOverStepId(null); }}
              className={`${isDragging ? "opacity-40" : ""} ${isDragOver ? "border-t-2 border-t-primary" : ""}`}
            >
              {i > 0 && step.delay_days > 0 && (
                <div className="flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-muted-foreground bg-muted/30 border-y">
                  <Clock className="h-3 w-3" /> Esperar {step.delay_days >= 7 ? `${Math.floor(step.delay_days / 7)} semana${Math.floor(step.delay_days / 7) !== 1 ? "s" : ""}${step.delay_days % 7 ? ` y ${step.delay_days % 7} día${step.delay_days % 7 !== 1 ? "s" : ""}` : ""}` : `${step.delay_days} día${step.delay_days !== 1 ? "s" : ""}`} si no responde
                </div>
              )}
              <button
                onClick={() => setSelectedStepId(step.id)}
                className={`w-full text-left p-3 transition-colors border-b ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/50"}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 cursor-grab active:cursor-grabbing shrink-0" />
                    <span className="text-xs font-semibold">Step {i + 1}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {stepVariants.length > 0 && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1">{stepVariants.length + 1} var</Badge>
                    )}
                    <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${isSelected ? "rotate-90" : ""}`} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {step.subject || "<Sin asunto>"}
                </p>
              </button>
            </div>
          );
        })}

        <button
          onClick={addStep}
          className="w-full p-3 text-left text-sm text-muted-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 border-b"
        >
          <Plus className="h-3.5 w-3.5" /> Añadir step
        </button>

        <button
          onClick={() => setShowAiGenerate(true)}
          className="w-full p-3 text-left text-sm text-muted-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 border-b"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Crear con IA
        </button>

        {selectedStep && (
          <button
            onClick={() => addVariant(selectedStep)}
            className="w-full p-3 text-left text-sm text-muted-foreground hover:bg-muted/50 transition-colors flex items-center gap-2"
          >
            <GitBranch className="h-3.5 w-3.5" /> Añadir variante
          </button>
        )}
      </div>

      {/* Right panel - Editor */}
      {selectedStep ? (
        <div className="flex-1 border sm:border-l-0 border-t-0 sm:border-t rounded-b-lg sm:rounded-b-none sm:rounded-r-lg bg-card flex flex-col min-h-[400px]">
          {/* Variant tabs + actions */}
          <div className="border-b px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              {variantLabels.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setActiveVariantIndex(i)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    activeVariantIndex === i
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={showPreview ? "default" : "outline"}
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Eye className="h-3 w-3" /> Preview
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={() => setShowTestEmail(true)}
              >
                <SendHorizonal className="h-3 w-3" /> Test Email
              </Button>
              {activeVariantIndex > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeVariant(selectedStep, activeVariantIndex - 1)}
                >
                  <Trash2 className="h-3 w-3" /> Eliminar variante
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={() => deleteStep(selectedStep.id)}
              >
                <Trash2 className="h-3 w-3" /> Eliminar step
              </Button>
            </div>
          </div>

          {/* Subject */}
          <div className="border-b p-4 space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Subject — Variante {variantLabels[activeVariantIndex]}
            </span>
            <div className="flex items-center gap-1.5">
              <Input
                id="seq-subject-editor"
                value={getCurrentSubject()}
                onChange={e => setCurrentSubject(e.target.value)}
                placeholder="Tu asunto aquí... Usa {{first_name}} etc."
                className="text-sm flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={generatingSubject || !getCurrentBody().trim()}
                title="Generar asunto con IA"
                onClick={async () => {
                  const body = getCurrentBody();
                  if (!body.trim()) { toast.error("Escribe el cuerpo del email primero"); return; }
                  setGeneratingSubject(true);
                  try {
                    const vars = dynamicVars.map(v => v.label);
                    const { data, error } = await supabase.functions.invoke("generate-subject", {
                      body: { body, variables: vars },
                    });
                    if (error) throw error;
                    if (data?.error) throw new Error(data.error);
                    if (data?.subject) {
                      setCurrentSubject(data.subject);
                      toast.success("Asunto generado con IA");
                    }
                  } catch (e: any) {
                    toast.error(e.message || "Error al generar asunto");
                  } finally {
                    setGeneratingSubject(false);
                  }
                }}
              >
                {generatingSubject ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  {dynamicVars.map(v => (
                    <button
                      key={v.tag}
                      onClick={() => insertVariable(v.tag, "subject")}
                      className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors flex items-center justify-between"
                    >
                      <span>{v.label}</span>
                      <code className="text-[10px] text-muted-foreground">{v.tag}</code>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Body editor / Preview */}
          <div className="flex-1 overflow-y-auto">
            {showPreview ? (
              <div className="p-6 prose prose-sm max-w-none">
                <p className="text-xs text-muted-foreground mb-3 not-prose">Vista previa con datos de ejemplo:</p>
                <div
                  className="whitespace-pre-wrap text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: previewText(getCurrentBody()) }}
                />
              </div>
            ) : (
              <Textarea
                id="seq-body-editor"
                value={getCurrentBody()}
                onChange={e => setCurrentBody(e.target.value)}
                placeholder={`Escribe tu email aquí...\n\nUsa variables del CSV: ${dynamicVars.map(v => v.tag).join(", ") || "importa leads para ver las variables disponibles"}`}
                className="border-0 rounded-none resize-none h-full min-h-[300px] focus-visible:ring-0 focus-visible:ring-offset-0 text-sm leading-relaxed p-6"
              />
            )}
          </div>

          {/* Bottom toolbar */}
          <div className="border-t px-4 py-2 flex items-center gap-1 bg-muted/30">
            <div className="flex items-center gap-1.5 mr-3 pr-3 border-r">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Follow-up tras</span>
              <Select
                value={String(selectedStep.delay_days)}
                onValueChange={(val) => {
                  const days = parseInt(val);
                  setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, delay_days: days } : s));
                  updateStepField(selectedStep.id, "delay_days", days);
                }}
              >
                <SelectTrigger className="w-[140px] h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Inmediato</SelectItem>
                  <SelectItem value="1">1 día</SelectItem>
                  <SelectItem value="2">2 días</SelectItem>
                  <SelectItem value="3">3 días</SelectItem>
                  <SelectItem value="4">4 días</SelectItem>
                  <SelectItem value="5">5 días</SelectItem>
                  <SelectItem value="7">1 semana</SelectItem>
                  <SelectItem value="10">10 días</SelectItem>
                  <SelectItem value="14">2 semanas</SelectItem>
                  <SelectItem value="21">3 semanas</SelectItem>
                  <SelectItem value="30">1 mes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs">
                  <Zap className="h-3 w-3" /> Variables
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                {dynamicVars.map(v => (
                  <button
                    key={v.tag}
                    onClick={() => insertVariable(v.tag, "body")}
                    className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors flex items-center justify-between"
                  >
                    <span>{v.label}</span>
                    <code className="text-[10px] text-muted-foreground">{v.tag}</code>
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={toggleBold}>
              <Bold className="h-3 w-3" /> Negrita
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              disabled={autoBolding || !getCurrentBody().trim()}
              onClick={async () => {
                const body = getCurrentBody();
                if (!body.trim()) return;
                setAutoBolding(true);
                try {
                  const { data, error } = await supabase.functions.invoke("auto-bold", {
                    body: { body },
                  });
                  if (error) throw error;
                  if (data?.error) throw new Error(data.error);
                  if (data?.body) {
                    // Ensure all bold is <b> tags, never markdown **
                    const cleaned = data.body.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
                    setCurrentBody(cleaned);
                    toast.success("Negritas aplicadas automáticamente");
                  }
                } catch (e: any) {
                  toast.error(e.message || "Error al aplicar negritas");
                } finally {
                  setAutoBolding(false);
                }
              }}
            >
              {autoBolding ? <Loader2 className="h-3 w-3 animate-spin" /> : <WandSparkles className="h-3 w-3" />}
              Auto Negrita
            </Button>

            <Popover open={showLinkPopover} onOpenChange={setShowLinkPopover}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs">
                  <Link2 className="h-3 w-3" /> Link
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 space-y-3 p-3" align="start">
                <div className="space-y-1">
                  <Label className="text-xs">URL</Label>
                  <Input
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    placeholder="https://ejemplo.com"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Texto (opcional)</Label>
                  <Input
                    value={linkText}
                    onChange={e => setLinkText(e.target.value)}
                    placeholder="Haz clic aquí"
                    className="h-8 text-xs"
                  />
                </div>
                <Button size="sm" className="w-full h-7 text-xs" onClick={insertLink}>
                  Insertar link
                </Button>
              </PopoverContent>
            </Popover>

            <div className="border-l pl-1 ml-1 flex items-center gap-1">
              <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => { setShowSaveTemplate(true); }}>
                <Save className="h-3 w-3" /> Guardar plantilla
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => { loadTemplates(); setShowLoadTemplate(true); }}>
                <FileText className="h-3 w-3" /> Cargar plantilla
              </Button>
            </div>

            <div className="ml-auto text-[10px] text-muted-foreground">
              Las variantes se rotan automáticamente al enviar
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 border border-l-0 rounded-r-lg bg-card flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Selecciona un step o crea uno nuevo</p>
            <p className="text-xs mt-1">Crea tu secuencia de follow-ups</p>
            <Button size="sm" className="mt-4 gap-1.5" onClick={addStep}>
              <Plus className="h-3.5 w-3.5" /> Crear primer step
            </Button>
          </div>
        </div>
      )}
    </div>

    {/* Test Email Dialog */}
    <Dialog open={showTestEmail} onOpenChange={setShowTestEmail}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar email de prueba</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cuenta de envío</Label>
            <Select value={testAccountId} onValueChange={setTestAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar cuenta" />
              </SelectTrigger>
              <SelectContent>
                {emailAccounts.map(acc => (
                  <SelectItem key={acc.id} value={acc.id}>{acc.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Enviar a</Label>
            <Input
              value={testTo}
              onChange={e => setTestTo(e.target.value)}
              placeholder="email@ejemplo.com"
            />
            {campaignLeadEmails.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="text-[10px] text-muted-foreground mr-1">Leads:</span>
                {campaignLeadEmails.slice(0, 5).map(email => (
                  <button
                    key={email}
                    onClick={() => setTestTo(email)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                  >
                    {email}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-md bg-muted/50 p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Vista previa</p>
            <p className="text-sm font-medium">{getCurrentSubject() || "<Sin asunto>"}</p>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{getCurrentBody()}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Las variables se reemplazarán con datos del primer lead</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowTestEmail(false)}>Cancelar</Button>
          <Button onClick={sendTestEmail} disabled={!testTo || !testAccountId || testSending} className="gap-1.5">
            {testSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
            Enviar prueba
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Save Template Dialog */}
    <Dialog open={showSaveTemplate} onOpenChange={setShowSaveTemplate}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Guardar como plantilla</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nombre de la plantilla</Label>
            <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Ej: Follow-up estándar" />
          </div>
          <div className="rounded-md bg-muted/50 p-3 space-y-1">
            <p className="text-xs font-medium">{getCurrentSubject() || "<Sin asunto>"}</p>
            <p className="text-[10px] text-muted-foreground line-clamp-3">{getCurrentBody()}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowSaveTemplate(false)}>Cancelar</Button>
          <Button onClick={saveTemplate} disabled={!templateName || savingTemplate} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Load Template Dialog */}
    <Dialog open={showLoadTemplate} onOpenChange={setShowLoadTemplate}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Cargar plantilla</DialogTitle></DialogHeader>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No tienes plantillas guardadas</p>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {templates.map(tpl => (
              <div key={tpl.id} className="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50 transition-colors">
                <button className="flex-1 text-left" onClick={() => applyTemplate(tpl)}>
                  <p className="text-sm font-medium">{tpl.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{tpl.subject || "<Sin asunto>"}</p>
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => deleteTemplate(tpl.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* AI Generate Dialog */}
    <Dialog open={showAiGenerate} onOpenChange={setShowAiGenerate}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Crear secuencia con IA
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Contexto de tu campaña</Label>
            <Textarea
              value={aiContext}
              onChange={e => setAiContext(e.target.value)}
              placeholder="Ej: Somos una agencia de marketing digital. Queremos ofrecer nuestros servicios de SEO a empresas medianas que tengan web pero poco tráfico orgánico..."
              className="min-h-[120px] text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Número de emails en la secuencia</Label>
            <Select value={aiNumSteps} onValueChange={setAiNumSteps}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 emails</SelectItem>
                <SelectItem value="3">3 emails</SelectItem>
                <SelectItem value="4">4 emails</SelectItem>
                <SelectItem value="5">5 emails</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {dynamicVars.length > 0 && (
            <div className="space-y-2">
              <Label>Variables a incluir</Label>
              <p className="text-xs text-muted-foreground">Selecciona las variables del CSV que la IA debe usar en los emails</p>
              <div className="flex flex-wrap gap-2">
                {dynamicVars.map(v => (
                  <label key={v.label} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox
                      checked={aiSelectedVars.includes(v.label)}
                      onCheckedChange={(checked) => {
                        setAiSelectedVars(prev =>
                          checked ? [...prev, v.label] : prev.filter(x => x !== v.label)
                        );
                      }}
                    />
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{v.tag}</code>
                  </label>
                ))}
              </div>
            </div>
          )}

          {steps.length > 0 && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-xs text-destructive font-medium">⚠️ Esto reemplazará los {steps.length} pasos actuales de la secuencia</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAiGenerate(false)}>Cancelar</Button>
          <Button onClick={generateWithAI} disabled={aiGenerating || !aiContext.trim()} className="gap-1.5">
            {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {aiGenerating ? "Generando..." : "Generar secuencia"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
