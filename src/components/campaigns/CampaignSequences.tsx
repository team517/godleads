import { useState, useEffect, useRef, useReducer } from "react";
import { contarColumnas, corregirVariablesEnTexto, type EstadisticaColumna } from "@/lib/variable-resolver";
import { textToHtmlBody, htmlToPlainText } from "@/lib/mime-headers";
import { replaceVariables } from "@/lib/personalize";
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
import { useConfirm } from "@/hooks/useConfirm";
import {
  addVariantTo, disableAll, disableSlot, enableAll, enableSlot, hasLiveVariants,
  readState, removeSlot, versionsOf, writeSlot, type VariantState,
} from "@/lib/step-variants";
import { toast } from "sonner";
import { Plus, Trash2, Clock, GitBranch, Zap, Eye, ChevronRight, SendHorizonal, Loader2, Bold, Italic, Underline, List, ListOrdered, Smile, Braces, Info, Mail, PowerOff, Save, FileText, Link2, Sparkles, WandSparkles, GripVertical, ShieldCheck, Tag, Maximize2, Undo2, Redo2, Paperclip } from "lucide-react";

interface Props { campaignId: string; }
interface Variant { subject: string; body: string; tag_filter?: string }

/* La corrección de {{variables}} vive en src/lib/variable-resolver.ts (probada aparte). */

// Variable replacement — the SAME function the engine and send-email use, so the preview
// shows exactly what the lead receives (fallbacks included, never a raw {{placeholder}}).
const renderVariables = (text: string, fields: Record<string, string>) => replaceVariables(text || "", fields);

/** The copy preview renders the author's own HTML, which carries ITS OWN colours
 *  (dark text, grey signatures, branded links) written for a white email client.
 *  So the preview is always a sheet of white paper with dark text — in BOTH
 *  themes — otherwise the message is invisible in dark mode. Deliberately has no
 *  `dark:` variants; `[color-scheme:light]` also keeps form controls light. */
const PAPER =
  "rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-sm [color-scheme:light] [&_a]:text-blue-700 [&_a]:underline";

/* ── Piezas de la secuencia ───────────────────────────────────────────────────────────
   El raíl de la izquierda (Paso 1 · Esperar · Paso 2…) con su línea de tiempo, los botones
   de la barra de formato y los de la barra de arriba. Sólo pintura: no saben nada de los
   datos. Los tamaños y colores salen de la capa "suave" de index.css. */

function SeqRail({ Icon, title, sub, last, active, grip, tone = "step", onDelete }: {
  Icon: typeof Mail; title: string; sub: string; last?: boolean; active?: boolean; grip?: boolean; tone?: "step" | "add";
  onDelete?: () => void;
}) {
  return (
    <div className="relative hidden pt-3 md:block">
      <div className={`soft-rail-icon ${active ? "soft-rail-icon-active" : ""} ${tone === "add" ? "opacity-60" : ""}`}>
        <Icon className="h-7 w-7" strokeWidth={1.8} />
      </div>
      {title && <h3 className="mb-[5px] mt-[18px] font-display text-[19px] font-semibold tracking-[-0.02em] text-foreground">{title}</h3>}
      {sub && <p className="text-[14px] leading-[1.35] text-[#727aa7] dark:text-muted-foreground">{sub}</p>}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] border border-transparent px-2 py-1 text-[13px] font-semibold text-[#8b93bd] transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive dark:text-muted-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" /> Eliminar
        </button>
      )}
      {grip && <GripVertical className="absolute -left-4 top-6 h-4 w-4 cursor-grab text-muted-foreground opacity-0 transition-opacity hover:opacity-100 active:cursor-grabbing" />}
      {!last && <span aria-hidden className="soft-rail-line absolute left-[31px] top-[62px] w-px" style={{ bottom: -75 }} />}
    </div>
  );
}

function SeqTool({ Icon, label, onClick, disabled, spin, badge, danger }: {
  Icon: typeof Bold; label: string; onClick: () => void; disabled?: boolean; spin?: boolean; badge?: number; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`relative text-[#131938] transition-colors disabled:pointer-events-none disabled:opacity-40 dark:text-foreground ${
        danger ? "hover:text-destructive" : "hover:text-primary"
      }`}
    >
      <Icon className={`h-[18px] w-[18px] ${spin ? "animate-spin" : ""}`} />
      {badge ? <span className="absolute -right-2 -top-1.5 grid h-3.5 min-w-[14px] place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{badge}</span> : null}
    </button>
  );
}

function SeqAction({ Icon, label, onClick, disabled, spin, on }: {
  Icon: typeof Eye; label: string; onClick: () => void; disabled?: boolean; spin?: boolean; on?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-1.5 rounded-[12px] border px-3.5 text-[13.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-secondary-foreground hover:border-primary hover:text-primary"
      }`}
    >
      <Icon className={`h-4 w-4 ${spin ? "animate-spin" : ""}`} /> {label}
    </button>
  );
}

export default function CampaignSequences({ campaignId }: Props) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [steps, setSteps] = useState<any[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [dynamicVars, setDynamicVars] = useState<{ label: string; tag: string }[]>([]);
  // Cuántos leads de ESTA campaña tienen algo en cada columna: el corrector elige la que más tiene.
  const [fieldStats, setFieldStats] = useState<EstadisticaColumna[]>([]);
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  // Test email state
  const [showTestEmail, setShowTestEmail] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [testAccountId, setTestAccountId] = useState<string>("");
  const [campaignLeadEmails, setCampaignLeadEmails] = useState<string[]>([]);
  const [testLead, setTestLead] = useState<{ email: string; custom_fields: Record<string, string> } | null>(null);
  // Inbox-placement (spam) test state
  const [placTestId, setPlacTestId] = useState<string | null>(null);
  const [placRunning, setPlacRunning] = useState(false);
  const [placChecking, setPlacChecking] = useState(false);
  const [placResults, setPlacResults] = useState<any[] | null>(null);
  const [placPct, setPlacPct] = useState<number | null>(null);
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
    // Primero se guarda lo que estuviera pendiente: si no, releer pisaria lo recien escrito.
    await flushSaves();
    const { data } = await supabase.from("campaign_steps").select("*").eq("campaign_id", campaignId).order("step_order");
    setSteps(data || []);
    if (data?.length && !selectedStepId) setSelectedStepId(data[0].id);
  };

  useEffect(() => { load(); loadVariables(); loadAccounts(); loadLeadEmails(); }, [campaignId]);

  // ── UNDO / REDO ─────────────────────────────────────────────────────────────────────────
  // The editor auto-saves every change straight to the DB, so an accidental delete is instantly
  // persisted. We keep an in-session history of full step snapshots; the back/forward arrows
  // RECONCILE the DB back to a previous snapshot (re-insert deleted steps with their original id,
  // update changed ones, drop added ones) and reload. Resets when you switch campaigns.
  const histStack = useRef<any[][]>([]);
  const histIdx = useRef(-1);
  const histApplying = useRef(false);
  const histPending = useRef<string | null>(null);
  const histTimer = useRef<any>(null);
  const [, bumpHist] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { histStack.current = []; histIdx.current = -1; histPending.current = null; bumpHist(); }, [campaignId]);
  const commitSnap = () => {
    if (histTimer.current) { clearTimeout(histTimer.current); histTimer.current = null; }
    const snap = histPending.current; histPending.current = null;
    if (snap == null) return;
    const cur = histStack.current[histIdx.current];
    if (cur && JSON.stringify(cur) === snap) return; // no real change
    histStack.current = histStack.current.slice(0, histIdx.current + 1);
    histStack.current.push(JSON.parse(snap));
    if (histStack.current.length > 50) histStack.current.shift();
    histIdx.current = histStack.current.length - 1;
    bumpHist();
  };
  useEffect(() => {
    if (histApplying.current) { histApplying.current = false; return; }
    // Debounce so a burst of keystrokes becomes ONE history entry (not one per letter).
    histPending.current = JSON.stringify(steps);
    if (histTimer.current) clearTimeout(histTimer.current);
    histTimer.current = setTimeout(commitSnap, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);
  const reconcileDb = async (target: any[]) => {
    const { data: cur } = await supabase.from("campaign_steps").select("id").eq("campaign_id", campaignId);
    const targetIds = new Set(target.map((s) => s.id));
    const toDelete = ((cur || []) as any[]).map((s) => s.id).filter((id) => !targetIds.has(id));
    if (toDelete.length) await supabase.from("campaign_steps").delete().in("id", toDelete);
    for (const s of target) {
      await supabase.from("campaign_steps").upsert({ id: s.id, campaign_id: campaignId, step_order: s.step_order, subject: s.subject ?? "", body: s.body ?? "", delay_days: s.delay_days ?? 0, variants: (s.variants ?? []) as any, variants_off: (s.variants_off ?? []) as any, attachments: (s.attachments ?? []) as any }, { onConflict: "id" });
    }
  };
  const canUndo = histIdx.current > 0;
  const canRedo = histIdx.current < histStack.current.length - 1;
  const undo = async () => {
    commitSnap(); // flush any pending (debounced) edit into history first
    if (histIdx.current <= 0) return;
    const target = histStack.current[histIdx.current - 1];
    histApplying.current = true;
    await reconcileDb(target);
    histIdx.current -= 1; bumpHist();
    await load();
    toast.success("Cambio deshecho");
  };
  const redo = async () => {
    commitSnap();
    if (histIdx.current >= histStack.current.length - 1) return;
    const target = histStack.current[histIdx.current + 1];
    histApplying.current = true;
    await reconcileDb(target);
    histIdx.current += 1; bumpHist();
    await load();
    toast.success("Cambio rehecho");
  };

  const loadVariables = async () => {
    // Get leads assigned to this campaign and extract all custom_field keys
    const { data: campaignLeads } = await supabase
      .from("campaign_leads")
      .select("lead_id, leads(email, custom_fields)")
      .eq("campaign_id", campaignId);

    const filas = (campaignLeads || []).map((cl: any) => (cl.leads?.custom_fields && typeof cl.leads.custom_fields === "object") ? cl.leads.custom_fields : null);
    const stats = contarColumnas(filas);
    const conEmail = (campaignLeads || []).filter((cl: any) => cl.leads?.email).length;
    setFieldStats([{ key: "email", llenos: conEmail }, ...stats.filter((x) => x.key !== "email")]);

    // En el desplegable de variables salen primero las columnas con más datos; las vacías, al final.
    const keySet = new Set<string>(["email", ...stats.map((x) => x.key)]);
    setDynamicVars(
      Array.from(keySet).map(k => ({ label: k, tag: `{{${k}}}` }))
    );
  };

  const loadAccounts = async () => {
    if (!user) return;
    const { data } = await supabase.from("email_accounts").select("id, email, tags").eq("user_id", user.id).eq("status", "connected");
    setEmailAccounts(data || []);
    // All distinct tags across the user's accounts — the options for the per-variant filter.
    const tags = new Set<string>();
    (data || []).forEach((a: any) => (a.tags || []).forEach((t: string) => { const v = String(t).trim(); if (v) tags.add(v); }));
    setAvailableTags([...tags].sort((a, b) => a.localeCompare(b)));
    if (data?.length) setTestAccountId(data[0].id);
  };

  const loadLeadEmails = async () => {
    const { data } = await supabase
      .from("campaign_leads")
      .select("leads(email, custom_fields)")
      .eq("campaign_id", campaignId)
      .limit(25);
    const leads = (data || []).map((cl: any) => cl.leads).filter((l: any) => l?.email);
    setCampaignLeadEmails([...new Set(leads.map((l: any) => l.email))] as string[]);
    // Keep the richest lead (most NON-EMPTY fields) for the test-email preview.
    const filledCount = (cf: any) => Object.values(cf || {}).filter((v) => v != null && String(v).trim() !== "").length;
    const richest = [...leads].sort((a: any, b: any) => filledCount(b?.custom_fields) - filledCount(a?.custom_fields))[0];
    if (richest) setTestLead({ email: richest.email, custom_fields: (richest.custom_fields || {}) as Record<string, string> });
  };

  const sendTestEmail = async () => {
    if (!testTo || !testAccountId || !selectedStep) return;
    setTestSending(true);
    try {
      // Pull a handful of REAL leads and pick the richest one (most custom fields)
      // so the variables actually resolve to real data — a test with an empty lead
      // would just show {{variables}}, which is exactly what we're fixing.
      const { data: sampleLeads } = await supabase
        .from("campaign_leads")
        .select("leads(email, custom_fields)")
        .eq("campaign_id", campaignId)
        .limit(25);
      const candidates = (sampleLeads || [])
        .map((r: any) => r.leads)
        .filter((l: any) => l && l.email);
      const filledCount = (cf: any) => Object.values(cf || {}).filter((v) => v != null && String(v).trim() !== "").length;
      const richest = candidates.sort((a: any, b: any) => filledCount(b?.custom_fields) - filledCount(a?.custom_fields))[0];

      // Sender fields come from the sending account (SenderFirstName, etc.).
      const { data: sendAcc } = await supabase
        .from("email_accounts")
        .select("email, first_name, last_name")
        .eq("id", testAccountId)
        .maybeSingle();

      // Build the field set EXACTLY like process-campaign-queue does.
      const customFields = (richest?.custom_fields && typeof richest.custom_fields === "object"
        ? richest.custom_fields : {}) as Record<string, string>;
      const sampleFields: Record<string, string> = {
        ...customFields,
        Email: richest?.email || testTo,
        email: richest?.email || testTo,
      };
      if (sendAcc?.first_name) sampleFields["SenderFirstName"] = sendAcc.first_name;
      if (sendAcc?.last_name) sampleFields["SenderLastName"] = sendAcc.last_name;
      if (sendAcc?.email) sampleFields["SenderEmail"] = sendAcc.email;

      // Render on the client with the SAME logic as production, so the test is a
      // faithful copy of the real email (no reliance on any weaker replacer).
      const renderedSubject = renderVariables(getCurrentSubject(), sampleFields);
      const renderedBody = renderVariables(getCurrentBody(), sampleFields);

      // Mirror the campaign's unsubscribe setting so the test shows the baja link too.
      let includeUnsub = false;
      try {
        const { data: camp } = await (supabase as any).from("campaigns")
          .select("include_unsubscribe, unsubscribe_all, unsubscribe_account_ids, unsubscribe_account_tags")
          .eq("id", campaignId).single();
        if (camp?.include_unsubscribe) {
          if (camp.unsubscribe_all ?? true) {
            includeUnsub = true;
          } else if ((camp.unsubscribe_account_ids || []).includes(testAccountId)) {
            includeUnsub = true;
          } else if ((camp.unsubscribe_account_tags || []).length) {
            const { data: acc } = await supabase.from("email_accounts").select("tags").eq("id", testAccountId).single();
            includeUnsub = ((acc?.tags as string[]) || []).some((t) => (camp.unsubscribe_account_tags || []).includes(t));
          }
        }
      } catch { /* default false */ }

      // Carry THIS step's attachments so the test email is a faithful copy of the real send.
      const testAttachments = await resolveAttachmentsForSend();

      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          account_id: testAccountId,
          to_email: testTo,
          subject: renderedSubject,
          body: renderedBody,
          // Already rendered above; pass fields too as a harmless safety net.
          custom_fields: sampleFields,
          is_test: true,
          include_unsubscribe: includeUnsub,
          attachments: testAttachments,
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

  // ── Inbox-placement (spam) test: sends THIS step's real subject+body from the
  // chosen account to the seed mailboxes, then checks by IMAP where each landed. ──
  const runPlacement = async () => {
    if (!testAccountId) { toast.error("Elige la cuenta de envío arriba"); return; }
    setPlacRunning(true); setPlacResults(null); setPlacPct(null); setPlacTestId(null);
    // Send REAL content (variables replaced with a real lead's data), so the spam
    // test measures a representative email — not a broken "{{personalized_message}}".
    const fields = getTestFields();
    const { data, error } = await supabase.functions.invoke("placement-test", {
      body: { action: "run", account_id: testAccountId, campaign_id: campaignId, subject: renderVariables(getCurrentSubject(), fields), body: renderVariables(getCurrentBody(), fields), fields },
    });
    setPlacRunning(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Error al enviar la prueba"); return; }
    setPlacTestId(data.test_id);
    toast.success('Prueba enviada. Espera 1-2 min y pulsa "Comprobar dónde cayó".');
  };
  const checkPlacement = async () => {
    if (!placTestId) return;
    setPlacChecking(true);
    const { data, error } = await supabase.functions.invoke("placement-test", { body: { action: "check", test_id: placTestId } });
    setPlacChecking(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Error al comprobar"); return; }
    setPlacResults(data.results); setPlacPct(data.inbox_pct);
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
    toast.success(`Paso ${order} añadido`);
    load().then(() => { if (data) setSelectedStepId(data.id); });
  };

  const deleteStep = async (id: string) => {
    const { error } = await supabase.from("campaign_steps").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    if (selectedStepId === id) setSelectedStepId(null);
    // Renumber the remaining steps to 1..N so the sequence never shows gaps like
    // "Paso 1 / Paso 3". Order-preserving, so in-flight leads (current_step is a
    // 0-based index into the ordered steps) keep pointing at the same steps.
    const remaining = steps
      .filter((s) => s.id !== id)
      .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
    await Promise.all(
      remaining.map((s, i) =>
        (s.step_order === i + 1)
          ? Promise.resolve()
          : supabase.from("campaign_steps").update({ step_order: i + 1 }).eq("id", s.id)
      )
    );
    toast.success("Paso eliminado");
    load();
  };

  /** Guarda el estado de versiones de un paso: lo que se envia (`variants`) y lo apagado
   *  (`variants_off`, que el motor NO lee). Se pinta al momento y se guarda con el mismo respiro
   *  que el texto. */
  const applyVariantState = (step: any, next: VariantState) => {
    setSteps((prev) => prev.map((x) => (x.id === step.id ? { ...x, variants: next.variants, variants_off: next.off } : x)));
    queueSave(step.id, "variants", next.variants);
    queueSave(step.id, "variants_off", next.off);
  };

  /** Añade una versión nueva (B, C…) y devuelve su hueco. */
  const addVariant = async (step: any): Promise<number> => {
    const { state, slot } = addVariantTo(readState(step), {});
    applyVariantState(step, state);
    toast.success(`Variante ${String.fromCharCode(65 + slot)} añadida`);
    return slot;
  };



  // Per-variant tag filter: only accounts with this tag send this variant. null = sin filtro.
  const setSlotTag = (step: any, slot: number, tag: string | null) => {
    applyVariantState(step, writeSlot(readState(step), slot, { tag_filter: tag || undefined }));
  };

  /** La papelera de una versión: esto SÍ borra lo escrito (apagarla no). */
  const removeVersion = async (step: any, slot: number) => {
    const ok = await confirm({
      title: `¿Eliminar la versión ${String.fromCharCode(65 + slot)}?`,
      description: "Se borra su texto. Si sólo quieres que deje de enviarse, apágala con el interruptor.",
      confirmText: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    applyVariantState(step, removeSlot(readState(step), slot));
    setActiveVariantIndex(0);
    toast.success("Versión eliminada");
  };

  const updateStepField = async (id: string, field: string, value: any) => {
    const { error } = await supabase.from("campaign_steps").update({ [field]: value }).eq("id", id);
    // Surface silent auto-save failures (e.g. delay_days / subject / body) so a
    // lost change is visible instead of the user assuming it saved.
    if (error) toast.error(`No se pudo guardar el cambio: ${error.message}`);
  };

  /* ── Guardado con respiro ─────────────────────────────────────────────────────────────
     Antes se mandaba un guardado a la base de datos POR CADA TECLA: escribir un correo de 1.400
     caracteres eran 1.400 peticiones. Ahora se espera medio segundo sin escribir y se fuerza el
     guardado al salir del campo, al cambiar de paso y al cerrar la pantalla, asi que no se pierde
     nada y la escritura va suelta. */
  const SAVE_DELAY_MS = 500;
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingSaves = useRef<Record<string, { id: string; field: string; value: any }>>({});

  const runSave = (key: string) => {
    const job = pendingSaves.current[key];
    if (!job) return Promise.resolve();
    delete pendingSaves.current[key];
    clearTimeout(saveTimers.current[key]);
    delete saveTimers.current[key];
    return updateStepField(job.id, job.field, job.value);
  };
  const queueSave = (id: string, field: string, value: any) => {
    const key = `${id}:${field}`;
    pendingSaves.current[key] = { id, field, value };
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => runSave(key), SAVE_DELAY_MS);
  };
  const flushSaves = () => Promise.all(Object.keys(pendingSaves.current).map(runSave));
  /** Lo que estuviera esperando para guardarse de un paso que ya no existe. */
  const cancelSaves = (id: string) => {
    for (const key of Object.keys(pendingSaves.current)) {
      if (!key.startsWith(`${id}:`)) continue;
      clearTimeout(saveTimers.current[key]);
      delete saveTimers.current[key];
      delete pendingSaves.current[key];
    }
  };

  useEffect(() => { void flushSaves(); }, [selectedStepId]);
  useEffect(() => {
    const onLeave = () => { void flushSaves(); };
    window.addEventListener("beforeunload", onLeave);
    return () => { window.removeEventListener("beforeunload", onLeave); void flushSaves(); };
  }, []);

  /** El cuadro del correo crece con el texto: se lee el mensaje ENTERO, sin barra interior. */
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const growBody = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(195, el.scrollHeight + 2)}px`;
  };

  // ── Attachments (per step): uploaded to Storage, referenced from campaign_steps.attachments.
  // The engine (process-campaign-queue) downloads each file and sends it with EVERY email of
  // the step. Files live in the shared `godtube-media` bucket under a per-campaign/step path. ──
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingAttach, setUploadingAttach] = useState(false);
  const MAX_ATTACH_BYTES = 5 * 1024 * 1024; // 5 MB per file (provider limits + keeps the SMTP session sane)
  const stepAttachments: any[] = selectedStep && Array.isArray(selectedStep.attachments) ? selectedStep.attachments : [];
  const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  const uploadAttachment = async (file: File) => {
    if (!selectedStep) return;
    if (file.size > MAX_ATTACH_BYTES) { toast.error(`"${file.name}" supera 5 MB — usa un archivo más pequeño`); return; }
    setUploadingAttach(true);
    try {
      const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "archivo";
      const path = `campaign-attachments/${campaignId}/${selectedStep.id}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("godtube-media").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) throw upErr;
      const entry = { name: file.name, path, mime: file.type || "application/octet-stream", size: file.size };
      const next = [...stepAttachments, entry];
      await updateStepField(selectedStep.id, "attachments", next);
      setSteps((prev) => prev.map((s) => (s.id === selectedStep.id ? { ...s, attachments: next } : s)));
      toast.success(`Adjuntado: ${file.name}`);
    } catch (e: any) {
      toast.error(`No se pudo adjuntar: ${e?.message || e}`);
    } finally {
      setUploadingAttach(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  };

  const removeAttachment = async (idx: number) => {
    if (!selectedStep) return;
    const target = stepAttachments[idx];
    const next = stepAttachments.filter((_, i) => i !== idx);
    await updateStepField(selectedStep.id, "attachments", next);
    setSteps((prev) => prev.map((s) => (s.id === selectedStep.id ? { ...s, attachments: next } : s)));
    if (target?.path) { try { await supabase.storage.from("godtube-media").remove([target.path]); } catch { /* non-fatal orphan */ } }
    toast.success("Adjunto quitado");
  };

  // Download this step's attachments from Storage and base64-encode them for send-email
  // ([{filename, mime, base64}]) — used by the Test Email so a test faithfully carries the files.
  const resolveAttachmentsForSend = async (): Promise<{ filename: string; mime: string; base64: string }[]> => {
    const out: { filename: string; mime: string; base64: string }[] = [];
    for (const a of stepAttachments) {
      if (!a?.path) continue;
      try {
        const { data, error } = await supabase.storage.from("godtube-media").download(a.path);
        if (error || !data) continue;
        const buf = new Uint8Array(await data.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) binary += String.fromCharCode(...buf.subarray(i, i + chunk));
        out.push({ filename: a.name || "adjunto", mime: a.mime || "application/octet-stream", base64: btoa(binary) });
      } catch { /* skip unreadable file */ }
    }
    return out;
  };

  // Review every step + variant and fix mistyped variables to match real lead fields.
  const correctAllVariables = async () => {
    // Engine-provided variables (process-campaign-queue fills these from the SENDING account /
    // lead email). They must be treated as valid so the fuzzy matcher never "corrects" them into
    // a lead field: "senderfirstname" CONTAINS "firstname" and was being rewritten to
    // {{first_name}} — the prospect's own name landed in the signature of every email.
    // (Las variables del remitente las excluye el propio corrector: _lib/variable-resolver_.)
    if (!fieldStats.some((x) => x.key !== "email" && x.llenos > 0)) {
      toast.error("Importa leads en esta campaña para poder corregir las variables");
      return;
    }
    setCorrecting(true);
    try {
      const allChanges: { from: string; to: string }[] = [];
      const updates: { id: string; subject: string; body: string; variants: Variant[] }[] = [];
      for (const step of steps) {
        const subj = corregirVariablesEnTexto(step.subject || "", fieldStats);
        const body = corregirVariablesEnTexto(step.body || "", fieldStats);
        const variants: Variant[] = [
          ...(Array.isArray(step.variants) ? step.variants : []),
          ...(Array.isArray(step.variants_off) ? step.variants_off : []),
        ];
        const newVariants = variants.map((vr) => {
          const s = corregirVariablesEnTexto(vr.subject || "", fieldStats);
          const b = corregirVariablesEnTexto(vr.body || "", fieldStats);
          allChanges.push(...s.changes, ...b.changes);
          return { ...vr, subject: s.text, body: b.text };
        });
        allChanges.push(...subj.changes, ...body.changes);
        const changed = subj.text !== (step.subject || "") || body.text !== (step.body || "") || JSON.stringify(newVariants) !== JSON.stringify(variants);
        if (changed) updates.push({ id: step.id, subject: subj.text, body: body.text, variants: newVariants });
      }
      for (const u of updates) {
        await supabase.from("campaign_steps").update({ subject: u.subject, body: u.body, variants: u.variants as any }).eq("id", u.id);
      }
      if (updates.length) {
        setSteps((prev) => prev.map((s) => {
          const u = updates.find((x) => x.id === s.id);
          return u ? { ...s, subject: u.subject, body: u.body, variants: u.variants } : s;
        }));
      }
      if (!allChanges.length) {
        toast.success("Todas las variables ya estaban correctas ✓");
      } else {
        const uniq = [...new Map(allChanges.map((c) => [c.from + ">" + c.to, c])).values()];
        toast.success(`${allChanges.length} variable(s) corregidas: ${uniq.slice(0, 3).map((c) => `{{${c.from}}}→{{${c.to}}}`).join(", ")}${uniq.length > 3 ? "…" : ""}`);
      }
    } catch (e: any) {
      toast.error(`Error al corregir: ${e.message || e}`);
    }
    setCorrecting(false);
  };

  const insertVariable = (tag: string, target: "body" | "subject" = "body") => {
    if (!selectedStep) return;
    void flushSaves();
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
        applyVariantState(selectedStep, writeSlot(readState(selectedStep), activeVariantIndex, { body: newVal }));
      }
      setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
    }
  };

  // Fields used for the test-email PREVIEW — same shape as the real send, built
  // from the richest real lead + the selected sending account.
  const getTestFields = (): Record<string, string> => {
    const acc = emailAccounts.find((a) => a.id === testAccountId);
    const fallback = testLead?.email || testTo || "ejemplo@empresa.com";
    return {
      ...((testLead?.custom_fields || {}) as Record<string, string>),
      Email: testLead?.email || fallback,
      email: testLead?.email || fallback,
      ...(acc?.first_name ? { SenderFirstName: acc.first_name } : {}),
      ...(acc?.last_name ? { SenderLastName: acc.last_name } : {}),
      ...(acc?.email ? { SenderEmail: acc.email } : {}),
    };
  };

  /** Vista previa con párrafos de verdad: convierte el texto (o respeta el HTML) y sustituye
   *  las variables por datos de ejemplo. Antes se pintaba con whitespace-pre-wrap, y un cuerpo
   *  guardado con <p> se veía todo junto (24-09-2026). */
  const previewHtml = (text: string) => textToHtmlBody(previewText(text));

  /** Resumen del paso cerrado: si el cuerpo es HTML lo pasa a texto para no enseñar etiquetas. */
  const plainSnippet = (text: string) => (/<\/?(p|div|br)/i.test(text) ? htmlToPlainText(text) : text);

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

  // Estado de versiones del paso abierto: lo que se envia + lo apagado, y la lista A, B, C...
  const vstate: VariantState = selectedStep ? readState(selectedStep) : { variants: [], off: [] };
  const versions = versionsOf(vstate);
  const activeVersion = versions.find((v) => v.slot === activeVariantIndex) || versions[0];

  // Get current subject/body based on active variant
  const getCurrentSubject = () => {
    if (!selectedStep) return "";
    if (activeVariantIndex === 0) return selectedStep.subject;
    return activeVersion?.variant?.subject || "";
  };

  const getCurrentBody = () => {
    if (!selectedStep) return "";
    if (activeVariantIndex === 0) return selectedStep.body;
    return activeVersion?.variant?.body || "";
  };

  const setCurrentSubject = (val: string) => {
    if (!selectedStep) return;
    if (activeVariantIndex === 0) {
      setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, subject: val } : s));
      queueSave(selectedStep.id, "subject", val);
    } else {
      applyVariantState(selectedStep, writeSlot(vstate, activeVariantIndex, { subject: val }));
    }
  };

  const setCurrentBody = (val: string) => {
    if (!selectedStep) return;
    if (activeVariantIndex === 0) {
      setSteps(prev => prev.map(s => s.id === selectedStep.id ? { ...s, body: val } : s));
      queueSave(selectedStep.id, "body", val);
    } else {
      applyVariantState(selectedStep, writeSlot(vstate, activeVariantIndex, { body: val }));
    }
  };



  /* ── Formato del cuerpo ──────────────────────────────────────────────────────────────
     El cuerpo es texto con etiquetas HTML sencillas (así lo envía el motor), de modo que
     negrita, cursiva y subrayado son envolver la selección, y las listas, prefijar líneas. */
  const bodyEl = () => document.getElementById("seq-body-editor") as HTMLTextAreaElement | null;

  const wrapSelection = (tag: "b" | "i" | "u") => {
    const el = bodyEl();
    if (!el) return;
    const start = el.selectionStart, end = el.selectionEnd, val = el.value;
    const sel = val.substring(start, end);
    const open = `<${tag}>`, close = `</${tag}>`;
    const already = sel.startsWith(open) && sel.endsWith(close);
    const replacement = already ? sel.slice(open.length, -close.length) : `${open}${sel}${close}`;
    const newVal = val.substring(0, start) + replacement + val.substring(end);
    setCurrentBody(newVal);
    setTimeout(() => { el.focus(); el.setSelectionRange(start, start + replacement.length); }, 0);
  };

  const insertAtCursor = (text: string) => {
    const el = bodyEl();
    if (!el) { setCurrentBody((getCurrentBody() || "") + text); return; }
    const start = el.selectionStart, end = el.selectionEnd, val = el.value;
    const newVal = val.substring(0, start) + text + val.substring(end);
    setCurrentBody(newVal);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length); }, 0);
  };

  /** Convierte en lista las líneas seleccionadas (o empieza una donde esté el cursor). */
  const insertList = (ordered: boolean) => {
    const el = bodyEl();
    if (!el) return;
    const val = el.value;
    const start = el.selectionStart, end = el.selectionEnd;
    const from = val.lastIndexOf("\n", start - 1) + 1;
    const toRaw = val.indexOf("\n", end);
    const to = toRaw === -1 ? val.length : toRaw;
    const block = val.substring(from, to);
    const lines = (block || "").split("\n");
    const marked = lines.map((l, i) => {
      const clean = l.replace(/^\s*(?:[•\-*]\s+|\d+[.)]\s+)/, "");
      return `${ordered ? `${i + 1}. ` : "• "}${clean}`;
    }).join("\n");
    const newVal = val.substring(0, from) + marked + val.substring(to);
    setCurrentBody(newVal);
    setTimeout(() => { el.focus(); el.setSelectionRange(from, from + marked.length); }, 0);
  };

  const EMOJIS = ["👋", "🙂", "🙌", "🚀", "✅", "📈", "💡", "🔧", "📩", "📞", "⏱️", "🎯", "🤝", "👀", "🔥", "⭐"];

  /* ── "Escribir con IA" de UN paso ────────────────────────────────────────────────────
     Rellena SOLO este correo (asunto + cuerpo) con el mismo generador de la secuencia,
     pidiéndole un único email. No toca los demás pasos. */
  const [aiOneOpen, setAiOneOpen] = useState(false);
  const [aiOneContext, setAiOneContext] = useState("");
  const [aiOneRunning, setAiOneRunning] = useState(false);

  const writeStepWithAI = async () => {
    if (!selectedStep) return;
    if (!aiOneContext.trim()) { toast.error("Cuéntale de qué va el correo"); return; }
    setAiOneRunning(true);
    try {
      const position = (steps.findIndex((s) => s.id === selectedStep.id) || 0) + 1;
      const role = position === 1 ? "primer email en frío" : `seguimiento número ${position - 1} (el prospecto no ha contestado)`;
      const { data, error } = await supabase.functions.invoke("generate-sequence", {
        body: { context: `${aiOneContext.trim()}\n\nEscribe SOLO el ${role}.`, variables: dynamicVars.map((v) => v.label), numSteps: 1 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const one = Array.isArray(data?.steps) ? data.steps[0] : null;
      if (!one) throw new Error("La IA no ha devuelto ningún correo");
      if (one.subject) setCurrentSubject(one.subject);
      if (one.body) setCurrentBody(one.body);
      setAiOneOpen(false);
      setAiOneContext("");
      toast.success("Correo escrito con IA");
    } catch (e: any) {
      toast.error(e.message || "No se ha podido escribir el correo");
    } finally {
      setAiOneRunning(false);
    }
  };

  /** El interruptor de la tarjeta. NO borra nada:
   *   · en la versión A gobierna toda la prueba A/B (apaga o enciende B, C… de golpe);
   *   · en una variante, la apaga o la enciende sólo a ella.
   *  Una versión apagada se queda escrita pero NO se envía (sale de `variants`, que es lo
   *  único que lee el motor). Para borrarla de verdad está la papelera. */
  const toggleVersion = async (step: any, slot: number) => {
    setSelectedStepId(step.id);
    const state = readState(step);
    const versions = versionsOf(state);
    if (versions.length === 1) {                      // sólo existe la A: se crea la B
      const created = await addVariant(step);
      setActiveVariantIndex(created);
      return;
    }
    if (slot === 0) {
      const live = hasLiveVariants(state);
      applyVariantState(step, live ? disableAll(state) : enableAll(state));
      toast.success(live ? "Prueba A/B apagada: sólo se envía la A" : "Prueba A/B encendida");
      return;
    }
    const target = versions.find((v) => v.slot === slot);
    if (!target) return;
    applyVariantState(step, target.enabled ? disableSlot(state, slot) : enableSlot(state, slot));
    toast.success(target.enabled
      ? `Versión ${target.label} apagada: deja de enviarse`
      : `Versión ${target.label} encendida`);
  };

  /** Eliminar un correo de la secuencia: se pregunta, porque se lleva por delante lo escrito. */
  const askDeleteStep = async (step: any, index: number) => {
    const ok = await confirm({
      title: `¿Eliminar el paso ${index + 1}?`,
      description: "Se borra este correo y lo que hayas escrito en él, también sus variantes. Los pasos que queden se renumeran solos y la campaña sigue funcionando.",
      confirmText: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    cancelSaves(step.id);
    await deleteStep(step.id);
  };

  /** La espera de un paso en número + unidad, como en el diseño (2 días / 1 semana). */
  const delayParts = (days: number) => (days > 0 && days % 7 === 0 ? { n: days / 7, unit: "weeks" as const } : { n: days, unit: "days" as const });
  const setDelay = (step: any, n: number, unit: "days" | "weeks") => {
    const days = Math.max(0, Math.min(180, Math.round(n))) * (unit === "weeks" ? 7 : 1);
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, delay_days: days } : s)));
    updateStepField(step.id, "delay_days", days);
  };

  return (
    <>
    <div className="soft-surface rounded-[25px] px-4 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-[1450px]">
      {/* Lo que afecta a TODA la secuencia, no a un correo suelto. */}
      <div className="soft-card mb-7 flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-display text-[17px] font-semibold text-foreground">Secuencia</span>
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-semibold text-primary">
            {steps.length} {steps.length === 1 ? "paso" : "pasos"}
          </span>
          <span className="hidden truncate text-[13.5px] text-muted-foreground lg:inline">· se envían en orden y se paran en cuanto el lead contesta</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={undo} disabled={!canUndo} title="Deshacer" aria-label="Deshacer"
            className="grid h-9 w-9 place-items-center rounded-[12px] border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-50">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Rehacer" aria-label="Rehacer"
            className="grid h-9 w-9 place-items-center rounded-[12px] border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-50">
            <Redo2 className="h-4 w-4" />
          </button>
          <SeqAction Icon={correcting ? Loader2 : WandSparkles} spin={correcting} label="Corregir variables" onClick={correctAllVariables} disabled={correcting} />
          <SeqAction Icon={Eye} label="Vista previa" onClick={() => setShowPreview(!showPreview)} on={showPreview} />
          <SeqAction Icon={SendHorizonal} label="Enviar prueba" disabled={!selectedStep}
            onClick={() => { if (!testTo || campaignLeadEmails.includes(testTo)) setTestTo(user?.email || "team@onepulso.online"); setShowTestEmail(true); }} />
          <SeqAction Icon={Sparkles} label="Generar secuencia" onClick={() => setShowAiGenerate(true)} />
        </div>
      </div>

      {steps.length === 0 ? (
        <div className="soft-card px-6 py-16 text-center">
          <span className="soft-rail-icon mx-auto"><GitBranch className="h-7 w-7" /></span>
          <p className="mt-5 font-display text-[19px] font-semibold text-foreground">Todavía no hay ningún correo</p>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">Empieza por el primer email y añade los seguimientos que quieras.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <button onClick={addStep} className="soft-ai-btn inline-flex items-center gap-2 text-[15px]"><Plus className="h-4 w-4" /> Crear primer paso</button>
            <button onClick={() => setShowAiGenerate(true)} className="soft-square inline-flex h-[46px] items-center gap-2 px-5 text-[15px] font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Generar con IA</button>
          </div>
        </div>
      ) : (
        <div>
          {steps.map((step, i) => {
            const isSel = step.id === selectedStepId;
            const stepState = readState(step);
            const stepVersions = versionsOf(stepState);
            const stepLive = hasLiveVariants(stepState);
            // El interruptor enseña el estado de LO QUE TIENES DELANTE: la versión abierta,
            // o la prueba A/B entera cuando estás en la A.
            const switchOn = isSel && activeVariantIndex > 0 ? !!activeVersion?.enabled : stepLive;
            const isDragging = dragStepId === step.id;
            const isDragOver = dragOverStepId === step.id && dragStepId !== step.id;
            const body = isSel ? getCurrentBody() : (step.body || "");
            const subject = isSel ? getCurrentSubject() : (step.subject || "");
            const parts = delayParts(step.delay_days ?? 0);

            return (
              <div key={step.id}>
                {/* La espera entre este correo y el anterior */}
                {i > 0 && (
                  <div className="my-9 grid gap-[30px] md:grid-cols-[130px_1fr]">
                    <SeqRail Icon={Clock} title="Esperar" sub="Tiempo entre correos" />
                    <div className="soft-card flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-6 sm:px-10">
                      <span className="text-[17px] font-semibold text-foreground">Esperar</span>
                      <input
                        type="number"
                        min={0}
                        max={180}
                        value={String(parts.n)}
                        onChange={(e) => setDelay(step, Number(e.target.value || 0), parts.unit)}
                        aria-label="Cuánto esperar"
                        className="soft-input-sm w-[75px] px-2 text-center outline-none focus:border-[#765cff]"
                      />
                      <Select value={parts.unit} onValueChange={(u) => setDelay(step, parts.n, u as "days" | "weeks")}>
                        <SelectTrigger className="soft-input-sm w-[145px] px-4"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="days">Días</SelectItem>
                          <SelectItem value="weeks">Semanas</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="soft-info ml-auto hidden items-center gap-2 px-5 py-4 text-[14px] leading-[1.35] md:flex">
                        <Info className="h-4 w-4 shrink-0" />
                        {parts.n === 0
                          ? "Sin espera: saldrá el mismo día que el correo anterior."
                          : "Deja un respiro entre correos: se responde más y se marca menos como spam."}
                      </span>
                    </div>
                  </div>
                )}

                {/* El correo */}
                <div
                  draggable
                  onDragStart={(e) => { setDragStepId(step.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverStepId(step.id); }}
                  onDragLeave={() => { if (dragOverStepId === step.id) setDragOverStepId(null); }}
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
                    for (let j = 0; j < reordered.length; j++) {
                      await supabase.from("campaign_steps").update({ step_order: j + 1 }).eq("id", reordered[j].id);
                    }
                    load();
                  }}
                  onDragEnd={() => { setDragStepId(null); setDragOverStepId(null); }}
                  className={`grid gap-[30px] md:grid-cols-[130px_1fr] ${isDragging ? "opacity-40" : ""} ${isDragOver ? "pt-2" : ""}`}
                >
                  <SeqRail
                    Icon={Mail}
                    title={`Paso ${i + 1}`}
                    sub={i === 0 ? "Email inicial" : "Seguimiento"}
                    last={i === steps.length - 1}
                    active={isSel}
                    grip
                    onDelete={() => { void askDeleteStep(step, i); }}
                  />

                  <div
                    onClick={() => { if (!isSel) setSelectedStepId(step.id); }}
                    className={`soft-card min-w-0 p-[22px] transition-all duration-200 ${isSel ? "soft-card-active" : "cursor-pointer"}`}
                  >
                    {/* Asunto · variable · IA · A/B */}
                    <div className="mb-[18px] grid grid-cols-[1fr_60px_60px] gap-[14px] md:grid-cols-[1fr_60px_60px_120px]">
                      {isSel ? (
                        <input
                          id="seq-subject-editor"
                          value={subject || ""}
                          onChange={e => setCurrentSubject(e.target.value)}
                          onBlur={flushSaves}
                          placeholder={i === 0 ? "Asunto del correo" : "Déjalo vacío para usar el asunto del paso anterior"}
                          className="soft-field"
                        />
                      ) : (
                        <div className="soft-field flex items-center truncate">
                          {subject || <span className="text-[#9299bc] dark:text-muted-foreground">{i === 0 ? "Asunto del correo" : "Mismo asunto del paso anterior"}</span>}
                        </div>
                      )}

                      {/* Variable en el ASUNTO: entra donde esté el cursor (o al final si no se ha tocado). */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title="Insertar una variable en el asunto"
                            aria-label="Insertar variable en el asunto"
                            disabled={!isSel}
                            onClick={(e) => e.stopPropagation()}
                            className="soft-square grid place-items-center disabled:opacity-60"
                          >
                            <Braces className="h-5 w-5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-1" align="end" onClick={(e) => e.stopPropagation()}>
                          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Variable en el asunto</p>
                          {dynamicVars.length === 0 && <p className="px-3 py-2 text-[12px] text-muted-foreground">Importa leads para ver sus variables.</p>}
                          {dynamicVars.map(v => (
                            <button key={v.tag} type="button" onClick={() => insertVariable(v.tag, "subject")}
                              className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted">
                              <span>{v.label}</span>
                              <code className="text-[10px] text-muted-foreground">{v.tag}</code>
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>

                      <button
                        type="button"
                        title="Generar el asunto con IA"
                        aria-label="Generar el asunto con IA"
                        disabled={!isSel || generatingSubject || !body.trim()}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!body.trim()) { toast.error("Escribe el cuerpo del email primero"); return; }
                          setGeneratingSubject(true);
                          try {
                            const vars = dynamicVars.map(v => v.label);
                            const { data, error } = await supabase.functions.invoke("generate-subject", { body: { body, variables: vars } });
                            if (error) throw error;
                            if (data?.error) throw new Error(data.error);
                            if (data?.subject) { setCurrentSubject(data.subject); toast.success("Asunto generado con IA"); }
                          } catch (err: any) {
                            toast.error(err.message || "Error al generar asunto");
                          } finally {
                            setGeneratingSubject(false);
                          }
                        }}
                        className="soft-square soft-ai-tile grid place-items-center disabled:opacity-60"
                      >
                        {generatingSubject && isSel ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void toggleVersion(step, isSel ? activeVariantIndex : 0); }}
                        title={
                          stepVersions.length === 1
                            ? "Probar otra versión de este correo (A/B)"
                            : isSel && activeVariantIndex > 0
                              ? (activeVersion?.enabled ? `Apagar la versión ${activeVersion.label}: dejará de enviarse` : `Encender la versión ${activeVersion?.label}`)
                              : (stepLive ? "Apagar la prueba A/B: sólo se enviará la A" : "Encender la prueba A/B")
                        }
                        className="soft-ab hidden h-[56px] items-center justify-center gap-[13px] font-semibold md:flex"
                      >
                        <span className="font-display text-[15px]">{isSel ? (activeVersion?.label || "A") : "A"}</span>
                        <span className={`soft-switch ${switchOn ? "soft-switch-on" : ""}`}><span /></span>
                      </button>
                    </div>

                    {/* Versiones del correo abierto: A, B, C… Las apagadas siguen aquí, sin enviarse. */}
                    {isSel && versions.length > 1 && (
                      <div className="mb-[18px] flex flex-wrap items-center gap-2">
                        {versions.map((v) => {
                          const vTag = v.variant?.tag_filter;
                          const active = activeVariantIndex === v.slot;
                          return (
                            <button
                              key={v.slot}
                              onClick={() => setActiveVariantIndex(v.slot)}
                              title={!v.enabled ? `Versión ${v.label} apagada: no se envía` : vTag ? `Solo cuentas con la etiqueta "${vTag}"` : undefined}
                              className={`inline-flex items-center gap-1.5 rounded-[11px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                              } ${v.enabled ? "" : "opacity-60 line-through decoration-1"}`}
                            >
                              {!v.enabled && <PowerOff className="h-3 w-3" />}
                              {v.label}{vTag ? <span className="ml-1 opacity-80">· {vTag}</span> : ""}
                            </button>
                          );
                        })}
                        <button
                          onClick={async () => { const created = await addVariant(step); setActiveVariantIndex(created); }}
                          title="Añadir otra versión"
                          aria-label="Añadir versión"
                          className="grid h-[30px] w-[30px] place-items-center rounded-[11px] border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        {activeVariantIndex > 0 && (
                          <button
                            onClick={() => { void removeVersion(selectedStep, activeVariantIndex); }}
                            className="inline-flex items-center gap-1 rounded-[11px] border border-destructive/40 px-3 py-1.5 text-[13px] font-semibold text-destructive transition-colors hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3 w-3" /> Eliminar variante
                          </button>
                        )}
                        <span className="ml-auto hidden text-[12.5px] text-muted-foreground sm:inline">
                          {hasLiveVariants(vstate)
                            ? "Las versiones encendidas se rotan solas al enviar"
                            : "Todas las variantes están apagadas: sólo se envía la A"}
                        </span>
                      </div>
                    )}

                    {/* Aviso de la versión que se está mirando y no se envía */}
                    {isSel && activeVariantIndex > 0 && activeVersion && !activeVersion.enabled && (
                      <div className="mb-[18px] flex flex-wrap items-center gap-2 rounded-[14px] bg-muted/50 px-4 py-3 text-[13px] text-muted-foreground">
                        <PowerOff className="h-3.5 w-3.5" />
                        Esta versión está apagada: se guarda lo que escribas, pero no se envía.
                        <button
                          onClick={() => { void toggleVersion(step, activeVariantIndex); }}
                          className="ml-1 rounded-[9px] border border-border bg-card px-2.5 py-1 text-[12.5px] font-semibold text-primary transition-colors hover:border-primary"
                        >
                          Encender
                        </button>
                      </div>
                    )}

                    {/* Filtro por etiqueta de cuenta */}
                    {isSel && activeVariantIndex > 0 && (
                      <div className="mb-[18px] flex flex-wrap items-center gap-2 rounded-[14px] bg-muted/40 px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground"><Tag className="h-3 w-3" /> Filtro por cuenta:</span>
                        <Select
                          value={activeVersion?.variant?.tag_filter || "__none__"}
                          onValueChange={(v) => setSlotTag(selectedStep, activeVariantIndex, v === "__none__" ? null : v)}
                        >
                          <SelectTrigger className="h-9 w-64 rounded-[11px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sin filtro (cualquier cuenta)</SelectItem>
                            {availableTags.length === 0 && <div className="px-2 py-1.5 text-[11px] text-muted-foreground">No hay etiquetas en tus cuentas de email.</div>}
                            {availableTags.map((t) => <SelectItem key={t} value={t}>Solo cuentas con la etiqueta «{t}»</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {activeVersion?.variant?.tag_filter
                          ? <span className="text-[12px] text-primary">→ esta versión SOLO la envían las cuentas con «{activeVersion.variant.tag_filter}»</span>
                          : <span className="text-[12px] text-muted-foreground">→ la envían todas las cuentas (rotación normal)</span>}
                      </div>
                    )}

                    {/* Cuerpo */}
                    <div className="soft-editor">
                      {isSel && showPreview ? (
                        <div className="p-[22px]">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-[12.5px] text-muted-foreground">Vista previa con datos de ejemplo:</p>
                            <button type="button" onClick={() => setExpandOpen(true)} title="Ver el email completo"
                              className="inline-flex items-center gap-1.5 rounded-[11px] border border-border px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                              <Maximize2 className="h-3.5 w-3.5" /> Ampliar
                            </button>
                          </div>
                          <div className={PAPER + " p-4 text-sm leading-relaxed [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"} dangerouslySetInnerHTML={{ __html: previewHtml(body) }} />
                        </div>
                      ) : isSel ? (
                        <textarea
                          id="seq-body-editor"
                          ref={(el) => { bodyRef.current = el; growBody(el); }}
                          value={body}
                          onBlur={flushSaves}
                          onChange={e => { setCurrentBody(e.target.value); growBody(e.target); }}
                          placeholder={`Escribe tu email aquí...\n\nVariables de tus leads: ${dynamicVars.map(v => v.tag).join(", ") || "importa leads para ver las variables disponibles"}`}
                          className="min-h-[195px] w-full resize-none overflow-hidden border-0 bg-transparent p-[22px] text-[16px] leading-relaxed text-foreground outline-none placeholder:text-[#9299bc] dark:placeholder:text-muted-foreground"
                        />
                      ) : (
                        <div
                          className="max-h-[195px] overflow-hidden whitespace-pre-wrap p-[22px] text-[16px] leading-relaxed text-muted-foreground"
                          style={body.length > 260 ? { maskImage: "linear-gradient(to bottom, #000 62%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, #000 62%, transparent 100%)" } : undefined}
                        >
                          {plainSnippet(body) || "Escribe tu email aquí..."}
                        </div>
                      )}

                      {isSel && (
                        <div className="soft-toolbar flex min-h-[55px] flex-wrap items-center gap-x-[18px] gap-y-2.5 px-5 py-2">
                          <SeqTool Icon={Bold} label="Negrita" onClick={() => wrapSelection("b")} />
                          <SeqTool Icon={Italic} label="Cursiva" onClick={() => wrapSelection("i")} />
                          <SeqTool Icon={Underline} label="Subrayado" onClick={() => wrapSelection("u")} />
                          <Popover open={showLinkPopover} onOpenChange={setShowLinkPopover}>
                            <PopoverTrigger asChild>
                              <button type="button" title="Insertar enlace" aria-label="Insertar enlace" className="text-[#131938] transition-colors hover:text-primary dark:text-foreground">
                                <Link2 className="h-[18px] w-[18px]" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 space-y-3 p-3" align="start">
                              <div className="space-y-1">
                                <Label className="text-xs">URL</Label>
                                <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://ejemplo.com" className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Texto (opcional)</Label>
                                <Input value={linkText} onChange={e => setLinkText(e.target.value)} placeholder="Haz clic aquí" className="h-8 text-xs" />
                              </div>
                              <Button size="sm" className="h-7 w-full text-xs" onClick={insertLink}>Insertar enlace</Button>
                            </PopoverContent>
                          </Popover>
                          <SeqTool Icon={List} label="Lista" onClick={() => insertList(false)} />
                          <SeqTool Icon={ListOrdered} label="Lista numerada" onClick={() => insertList(true)} />
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" title="Emoji" aria-label="Emoji" className="text-[#131938] transition-colors hover:text-primary dark:text-foreground">
                                <Smile className="h-[18px] w-[18px]" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[232px] p-2" align="start">
                              <div className="grid grid-cols-8 gap-1">
                                {EMOJIS.map((em) => (
                                  <button key={em} type="button" onClick={() => insertAtCursor(em)} className="grid h-7 w-7 place-items-center rounded-[6px] text-[16px] transition-colors hover:bg-accent">
                                    {em}
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" title="Insertar variable del lead" aria-label="Insertar variable" className="text-[#131938] transition-colors hover:text-primary dark:text-foreground">
                                <Braces className="h-[18px] w-[18px]" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-52 p-1" align="start">
                              {dynamicVars.length === 0 && <p className="px-3 py-2 text-[12px] text-muted-foreground">Importa leads para ver sus variables.</p>}
                              {dynamicVars.map(v => (
                                <button key={v.tag} onClick={() => insertVariable(v.tag, "body")}
                                  className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted">
                                  <span>{v.label}</span>
                                  <code className="text-[10px] text-muted-foreground">{v.tag}</code>
                                </button>
                              ))}
                            </PopoverContent>
                          </Popover>
                          <SeqTool
                            Icon={autoBolding ? Loader2 : WandSparkles}
                            spin={autoBolding}
                            label="Negritas automáticas"
                            disabled={autoBolding || !body.trim()}
                            onClick={async () => {
                              if (!body.trim()) return;
                              setAutoBolding(true);
                              try {
                                const { data, error } = await supabase.functions.invoke("auto-bold", { body: { body } });
                                if (error) throw error;
                                if (data?.error) throw new Error(data.error);
                                if (data?.body) { setCurrentBody(data.body.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')); toast.success("Negritas aplicadas"); }
                              } catch (err: any) {
                                toast.error(err.message || "Error al aplicar negritas");
                              } finally {
                                setAutoBolding(false);
                              }
                            }}
                          />
                          <input ref={attachInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); }} />
                          <SeqTool Icon={uploadingAttach ? Loader2 : Paperclip} spin={uploadingAttach} label="Adjuntar archivo (máx. 5 MB)" disabled={uploadingAttach} onClick={() => attachInputRef.current?.click()} badge={stepAttachments.length || undefined} />
                          <SeqTool Icon={Save} label="Guardar como plantilla" onClick={() => setShowSaveTemplate(true)} />
                          <SeqTool Icon={FileText} label="Cargar plantilla" onClick={() => { loadTemplates(); setShowLoadTemplate(true); }} />

                          {/* Cuentan y escriben sobre ESTE correo: viajan juntos al plegarse. */}
                          <div className="ml-auto flex items-center gap-3">
                            <span className="text-[14px] tabular-nums text-[#777fa5] dark:text-muted-foreground">{body.length}</span>
                            <button type="button" onClick={() => setAiOneOpen(true)} className="soft-ai-btn inline-flex items-center gap-2 text-[14px]">
                              <Sparkles className="h-4 w-4" /> Escribir con IA
                            </button>
                            <span className="h-5 w-px bg-border" />
                            <SeqTool Icon={Trash2} label="Eliminar este paso" danger onClick={() => { void askDeleteStep(step, i); }} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Adjuntos */}
                    {isSel && stepAttachments.length > 0 && (
                      <div className="mt-[18px] flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground"><Paperclip className="h-3 w-3" /> Adjuntos:</span>
                        {stepAttachments.map((a, ai) => (
                          <span key={a.path || ai} className="inline-flex items-center gap-1 rounded-[11px] border border-border bg-card px-2.5 py-1 text-[12px]">
                            <FileText className="h-3 w-3 text-muted-foreground" />
                            <span className="max-w-[160px] truncate" title={a.name}>{a.name}</span>
                            <span className="text-muted-foreground">· {fmtBytes(a.size || 0)}</span>
                            <button type="button" onClick={() => removeAttachment(ai)} className="ml-0.5 text-muted-foreground transition-colors hover:text-destructive" title="Quitar adjunto">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Añadir otro correo */}
          <div className="mt-9 grid gap-[30px] md:grid-cols-[130px_1fr]">
            <SeqRail Icon={Plus} title="" sub="" last tone="add" />
            <button
              onClick={addStep}
              className="soft-card min-w-0 border-dashed py-6 text-[16px] font-semibold text-muted-foreground transition-colors hover:text-primary"
            >
              <span className="inline-flex items-center gap-2"><Plus className="h-5 w-5" /> Añadir paso</span>
            </button>
          </div>
        </div>
      )}
      </div>
    </div>

    {/* Escribir ESTE correo con IA */}
    <Dialog open={aiOneOpen} onOpenChange={setAiOneOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Escribir este correo con IA</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Cuéntale de qué va: qué vendes, a quién y qué quieres que haga el lead. Sólo se cambia ESTE paso, los demás se quedan como están.
          </p>
          <Textarea
            value={aiOneContext}
            onChange={(e) => setAiOneContext(e.target.value)}
            rows={5}
            placeholder="Ej.: vendemos mantenimiento informático a talleres de Valencia; el objetivo es una llamada de 10 minutos."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAiOneOpen(false)}>Cancelar</Button>
          <Button onClick={writeStepWithAI} disabled={aiOneRunning} className="gap-1.5">
            {aiOneRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Escribir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

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
            <div className="flex flex-wrap items-center gap-1 mt-1">
              <span className="text-[10px] text-muted-foreground mr-1">Rápido:</span>
              {user?.email && (
                <button type="button" onClick={() => setTestTo(user.email!)} className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">{user.email}</button>
              )}
              <button type="button" onClick={() => setTestTo("team@onepulso.online")} className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">team@onepulso.online</button>
            </div>
            <p className="text-[10px] text-muted-foreground">La prueba se envía a TI (a este correo), nunca al prospecto/lead.</p>
          </div>
          <div className="rounded-md bg-muted/50 p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Vista previa</p>
            <p className="text-sm font-medium">{renderVariables(getCurrentSubject(), getTestFields()) || "<Sin asunto>"}</p>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{renderVariables(getCurrentBody(), getTestFields())}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {testLead
                ? "Variables reemplazadas con datos de un lead real de esta campaña."
                : "Aún sin leads con datos en esta campaña — las variables sin datos se mostrarán tal cual."}
            </p>
          </div>

          {/* ── Inbox-placement (spam) test: does THIS email land in inbox or spam? ── */}
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Verificar entregabilidad (spam / bandeja)</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Manda ESTE correo, con las variables ya cambiadas, a buzones reales de prueba y mira si cae en bandeja o en spam. Tienes la versión completa en <strong>Entregabilidad</strong>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" className="h-7 gap-1.5 text-xs" onClick={runPlacement} disabled={placRunning || !testAccountId}>
                {placRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {placRunning ? "Enviando…" : "Probar entregabilidad"}
              </Button>
              {placTestId && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={checkPlacement} disabled={placChecking}>
                  {placChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  {placChecking ? "Comprobando…" : "Comprobar dónde cayó"}
                </Button>
              )}
            </div>
            {placTestId && !placResults && (
              <p className="text-[11px] text-muted-foreground">Enviado. Espera 1-2 min (el correo tarda) y pulsa "Comprobar dónde cayó".</p>
            )}
            {placResults && (
              <div className="space-y-1.5 pt-1">
                <div className="text-center">
                  <span className="text-2xl font-bold text-foreground">{placPct}%</span>
                  <span className="text-xs text-muted-foreground"> en Bandeja</span>
                </div>
                {placResults.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="truncate">{r.email ? <>{r.email} <span className="text-muted-foreground">({r.provider})</span></> : r.provider}</span>
                    <span className={
                      r.folder === "inbox" || r.folder === "promotions" ? "text-emerald-600 dark:text-emerald-400 font-medium"
                      : r.folder === "spam" ? "text-red-600 dark:text-red-400 font-medium"
                      : "text-amber-600 dark:text-amber-400"
                    }>
                      {r.folder === "inbox" ? "Bandeja" : r.folder === "promotions" ? "Promociones" : r.folder === "spam" ? "Spam" : r.folder === "missing" ? "Aún no llegó" : "No se pudo comprobar"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowTestEmail(false)}>Cancelar</Button>
          <Button onClick={sendTestEmail} disabled={!testTo || !testAccountId || testSending} variant={!testTo || !testAccountId ? "secondary" : "default"} className="gap-1.5">
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
          <Button onClick={saveTemplate} disabled={!templateName || savingTemplate} variant={!templateName ? "secondary" : "default"} className="gap-1.5">
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
              <p className="text-xs text-destructive font-medium">Esto reemplazará los {steps.length} pasos actuales de la secuencia</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAiGenerate(false)}>Cancelar</Button>
          <Button onClick={generateWithAI} disabled={aiGenerating || !aiContext.trim()} variant={!aiContext.trim() ? "secondary" : "default"} className="gap-1.5">
            {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {aiGenerating ? "Generando..." : "Generar secuencia"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Ampliar: ver el email completo sin scroll apretado */}
    <Dialog open={expandOpen} onOpenChange={setExpandOpen}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display tracking-[-0.03em] text-base">Email completo</DialogTitle></DialogHeader>
        <div className={PAPER + " p-5"}>
          <p className="mb-3 border-b border-zinc-200 pb-2 text-sm">
            <span className="text-zinc-500">Asunto: </span>
            <span className="font-medium" dangerouslySetInnerHTML={{ __html: previewText(getCurrentSubject()) }} />
          </p>
          <div
            className="text-sm leading-relaxed [&_b]:font-semibold [&_strong]:font-semibold [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: previewHtml(getCurrentBody()) }}
          />
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
