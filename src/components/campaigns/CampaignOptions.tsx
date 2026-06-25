import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Mail, Settings, Tag, FlaskConical, Sparkles, Trash2, Loader2, TrendingUp, BarChart3, Shield, Zap, Brain, Users, Info, RefreshCw, FileSignature } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props { campaignId: string; }

export default function CampaignOptions({ campaignId }: Props) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [stopOnReply, setStopOnReply] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [saved, setSaved] = useState(true);
  const [slowRampEnabled, setSlowRampEnabled] = useState(false);
  const [slowRampMax, setSlowRampMax] = useState(2);
  const [slowRampIncrement, setSlowRampIncrement] = useState(2);
  const [campaignCreatedAt, setCampaignCreatedAt] = useState<string | null>(null);
  // AB Testing
  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [abSteps, setAbSteps] = useState<any[]>([]);
  const [abSelectedStep, setAbSelectedStep] = useState<string>("");
  const [abStats, setAbStats] = useState<any[]>([]);
  const [abLoading, setAbLoading] = useState(false);
  const [abOptimizing, setAbOptimizing] = useState(false);
  const [abRemoving, setAbRemoving] = useState(false);
  // NEW — Instantly-style options
  const [textOnlyEmails, setTextOnlyEmails] = useState(false);
  const [firstEmailTextOnly, setFirstEmailTextOnly] = useState(false);
  const [prioritizeNewLeads, setPrioritizeNewLeads] = useState(false);
  const [domainLimitEnabled, setDomainLimitEnabled] = useState(false);
  const [domainDailyLimit, setDomainDailyLimit] = useState(3);
  const [providerMatching, setProviderMatching] = useState(false);
  const [aiFilterUnlikely, setAiFilterUnlikely] = useState("send_last");
  const [aiFilterHostile, setAiFilterHostile] = useState("skip");
  const [expertRotation, setExpertRotation] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState("");
  const [showSignaturePreview, setShowSignaturePreview] = useState(false);
  const [breakThreadAfter, setBreakThreadAfter] = useState(0);
  const handleCrossCampaignDedup = async () => {
    if (!user) return;
    setDeduping(true);
    try {
      // Get leads in this campaign
      const { data: thisLeads } = await supabase
        .from("campaign_leads")
        .select("id, lead_id")
        .eq("campaign_id", campaignId);
      if (!thisLeads?.length) { toast.info("No hay leads en esta campaña"); setDeduping(false); return; }

      // Get leads in OTHER campaigns
      const { data: otherLeads } = await supabase
        .from("campaign_leads")
        .select("lead_id, campaign_id")
        .neq("campaign_id", campaignId);

      const otherLeadIds = new Set((otherLeads || []).map((cl: any) => cl.lead_id));
      const duplicates = thisLeads.filter(cl => otherLeadIds.has(cl.lead_id));

      if (!duplicates.length) {
        toast.success("No se encontraron leads duplicados entre campañas");
        setDeduping(false);
        return;
      }

      if (!confirm(`Se encontraron ${duplicates.length} lead(s) que están en otras campañas. ¿Eliminarlos de ESTA campaña?`)) {
        setDeduping(false);
        return;
      }

      const ids = duplicates.map(d => d.id);
      for (let i = 0; i < ids.length; i += 500) {
        await supabase.from("campaign_leads").delete().in("id", ids.slice(i, i + 500));
      }
      toast.success(`${duplicates.length} leads duplicados eliminados de esta campaña`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setDeduping(false);
  };

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    accounts.forEach(a => (a.tags || []).forEach((t: string) => tags.add(t)));
    return Array.from(tags).sort();
  }, [accounts]);

  const tagAccountIds = useMemo(() => {
    const ids = new Set<string>();
    accounts.forEach(a => {
      if ((a.tags || []).some((t: string) => selectedTags.includes(t))) ids.add(a.id);
    });
    return ids;
  }, [accounts, selectedTags]);

  const totalAccountsUsed = useMemo(() => {
    const ids = new Set([...selectedAccounts, ...tagAccountIds]);
    return ids.size;
  }, [selectedAccounts, tagAccountIds]);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const [accRes, caRes, campRes, stepsRes] = await Promise.all([
        supabase.from("email_accounts").select("id, email, status, tags").eq("user_id", user.id).eq("status", "connected"),
        supabase.from("campaign_accounts").select("account_id").eq("campaign_id", campaignId),
        supabase.from("campaigns").select("*").eq("id", campaignId).single(),
        supabase.from("campaign_steps").select("id, step_order, subject").eq("campaign_id", campaignId).order("step_order"),
      ]);
      setAccounts(accRes.data || []);
      setSelectedAccounts((caRes.data || []).map((r: any) => r.account_id));
      const steps = stepsRes.data || [];
      setAbSteps(steps);
      if (steps.length && !abSelectedStep) setAbSelectedStep(steps[0].id);
      if (campRes.data) {
        const d = campRes.data as any;
        setDailyLimit(d.daily_limit || 50);
        setStopOnReply(d.stop_on_reply ?? true);
        setSelectedTags(d.account_tags || []);
        setSlowRampEnabled(d.slow_ramp_enabled ?? false);
        setSlowRampMax(d.slow_ramp_max ?? 2);
        setSlowRampIncrement(d.slow_ramp_increment ?? 2);
        setCampaignCreatedAt(d.created_at || null);
        setAbTestEnabled(d.ab_test_enabled ?? false);
        // New fields
        setTextOnlyEmails(d.text_only_emails ?? false);
        setFirstEmailTextOnly(d.first_email_text_only ?? false);
        setPrioritizeNewLeads(d.prioritize_new_leads ?? false);
        setDomainLimitEnabled(d.domain_limit_enabled ?? false);
        setDomainDailyLimit(d.domain_daily_limit ?? 3);
        setProviderMatching(d.provider_matching ?? false);
        setAiFilterUnlikely(d.ai_filter_unlikely ?? "send_last");
        setAiFilterHostile(d.ai_filter_hostile ?? "skip");
        setExpertRotation(d.expert_rotation ?? false);
        setSignatureHtml(d.signature_html ?? "");
        setBreakThreadAfter(d.break_thread_after ?? 0);
      }
    };
    load();
  }, [campaignId, user]);

  const toggleAccount = async (accountId: string) => {
    if (selectedAccounts.includes(accountId)) {
      await supabase.from("campaign_accounts").delete().eq("campaign_id", campaignId).eq("account_id", accountId);
      setSelectedAccounts(prev => prev.filter(a => a !== accountId));
    } else {
      await supabase.from("campaign_accounts").insert({ campaign_id: campaignId, account_id: accountId });
      setSelectedAccounts(prev => [...prev, accountId]);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
    setSaved(false);
  };

  const markDirty = () => setSaved(false);

  const save = async () => {
    await supabase.from("campaigns").update({
      daily_limit: dailyLimit,
      stop_on_reply: stopOnReply,
      account_tags: selectedTags,
      slow_ramp_enabled: slowRampEnabled,
      slow_ramp_max: slowRampMax,
      slow_ramp_increment: slowRampIncrement,
      ab_test_enabled: abTestEnabled,
      text_only_emails: textOnlyEmails,
      first_email_text_only: firstEmailTextOnly,
      prioritize_new_leads: prioritizeNewLeads,
      domain_limit_enabled: domainLimitEnabled,
      domain_daily_limit: domainDailyLimit,
      provider_matching: providerMatching,
      ai_filter_unlikely: aiFilterUnlikely,
      ai_filter_hostile: aiFilterHostile,
      expert_rotation: expertRotation,
      signature_html: signatureHtml,
      break_thread_after: breakThreadAfter,
    } as any).eq("id", campaignId);
    setSaved(true);
    toast.success("Opciones guardadas");
  };

  const loadAbStats = async (stepId: string) => {
    if (!stepId) return;
    setAbLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ab-test-optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ campaign_id: campaignId, step_id: stepId, action: "get_stats" }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else setAbStats(result.variantStats || []);
    } catch (e: any) { toast.error(e.message); }
    setAbLoading(false);
  };

  const handleOptimize = async () => {
    if (!abSelectedStep) return;
    setAbOptimizing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ab-test-optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ campaign_id: campaignId, step_id: abSelectedStep, action: "optimize" }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(`${result.added} variante(s) nueva(s) creada(s) con IA`);
        loadAbStats(abSelectedStep);
      }
    } catch (e: any) { toast.error(e.message); }
    setAbOptimizing(false);
  };

  const handleRemoveWorst = async () => {
    if (!abSelectedStep) return;
    setAbRemoving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ab-test-optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ campaign_id: campaignId, step_id: abSelectedStep, action: "remove_worst" }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message);
        loadAbStats(abSelectedStep);
      }
    } catch (e: any) { toast.error(e.message); }
    setAbRemoving(false);
  };

  useEffect(() => {
    if (abSelectedStep && abTestEnabled) loadAbStats(abSelectedStep);
  }, [abSelectedStep, abTestEnabled]);

  return (
    <div className="space-y-6 max-w-lg">

      {/* ═══════════ THREADING ═══════════ */}
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Romper hilo</h3>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Visible</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Decide desde qué follow-up dejará de salir como reply y empezará a enviarse como email nuevo.
        </p>
        <div className="rounded-md border bg-background p-3 space-y-3">
          <Label className="text-xs font-medium">Botón de romper hilo</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={breakThreadAfter === 0 ? "default" : "outline"}
              className="h-9"
              onClick={() => { setBreakThreadAfter(0); markDirty(); }}
            >
              Mantener hilo siempre
            </Button>
            {abSteps.slice(1).map((step: any, idx: number) => {
              const followUpNumber = idx + 1;
              const isActive = breakThreadAfter === followUpNumber;

              return (
                <Button
                  key={step.id}
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  className="h-9"
                  onClick={() => { setBreakThreadAfter(followUpNumber); markDirty(); }}
                >
                  Romper en follow-up {followUpNumber}
                </Button>
              );
            })}
          </div>

          {abSteps.length <= 1 && (
            <p className="text-[11px] text-muted-foreground">
              Añade al menos un follow-up en Sequences para poder romper el hilo.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            {breakThreadAfter === 0
              ? "Ahora mismo todos los follow-ups seguirán dentro del mismo hilo."
              : `Ahora mismo el follow-up ${breakThreadAfter} y los siguientes saldrán como mensaje nuevo.`}
          </p>
        </div>
      </div>

      {/* ═══════════ DELIVERY OPTIMIZATION ═══════════ */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Delivery Optimization</h3>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-500/40 bg-green-500/10">
            Recomendado
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Desactiva el tracking de apertura para mejorar la entregabilidad.</p>

        <label className="flex items-center gap-3 cursor-pointer">
          <Checkbox checked={textOnlyEmails} onCheckedChange={(v) => { setTextOnlyEmails(!!v); markDirty(); }} />
          <span className="text-sm">Enviar emails como solo texto (sin HTML)</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <Checkbox checked={firstEmailTextOnly} onCheckedChange={(v) => { setFirstEmailTextOnly(!!v); markDirty(); }} />
          <span className="text-sm">Enviar primer email como solo texto</span>
          <Badge className="text-[10px] px-1.5 py-0 bg-warning text-warning-foreground">Pro</Badge>
        </label>
      </div>

      {/* ═══════════ PRIORITIZE NEW LEADS ═══════════ */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Priorizar Nuevos Leads</h3>
          </div>
          <Checkbox
            checked={prioritizeNewLeads}
            onCheckedChange={(v) => { setPrioritizeNewLeads(!!v); markDirty(); }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Prioriza el contacto con nuevos leads sobre los follow-ups programados.
        </p>
      </div>
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Advanced Deliverability</h3>
        </div>

        {/* Domain limit */}
        <div className="rounded-md bg-muted/40 p-3 space-y-3">
          <div>
            <p className="text-sm font-medium">Limitar emails por empresa</p>
            <p className="text-xs text-muted-foreground">
              Limita cuántos emails se envían al mismo dominio por día para evitar spam flags.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={domainLimitEnabled} onCheckedChange={(v) => { setDomainLimitEnabled(v); markDirty(); }} />
              <span className="text-xs font-medium">Activar para esta campaña</span>
            </div>
          </div>

          {domainLimitEnabled && (
            <div className="flex items-center gap-4 pt-1">
              <div className="space-y-1">
                <Label className="text-xs">Límite diario por dominio</Label>
                <Input
                  type="number"
                  min={1}
                  value={domainDailyLimit}
                  onChange={(e) => { setDomainDailyLimit(parseInt(e.target.value) || 1); markDirty(); }}
                  className="w-24"
                />
              </div>
            </div>
          )}
        </div>

        {/* Provider Matching */}
        <div className="rounded-md bg-muted/40 p-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Provider Matching</p>
              <p className="text-xs text-muted-foreground">
                Empareja el proveedor de email del lead con tu buzón (Outlook → Outlook, Google → Google, etc.)
              </p>
            </div>
            <Checkbox
              checked={providerMatching}
              onCheckedChange={(v) => { setProviderMatching(!!v); markDirty(); }}
            />
          </div>
        </div>
      </div>

      {/* ═══════════ AI LEAD FILTERING ═══════════ */}
      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">AI Lead Filtering</h3>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">Unlikely to reply</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[200px] text-xs">
                Leads con baja probabilidad de respuesta según análisis de IA.
              </TooltipContent>
            </Tooltip>
            <Badge className="text-[10px] px-1.5 py-0 bg-warning text-warning-foreground">Pro</Badge>
          </div>
          <Select value={aiFilterUnlikely} onValueChange={(v) => { setAiFilterUnlikely(v); markDirty(); }}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="send_last">Enviar último</SelectItem>
              <SelectItem value="skip">Omitir</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">Hostile prospects</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[200px] text-xs">
                Leads que podrían marcar tus emails como spam o reportarte.
              </TooltipContent>
            </Tooltip>
            <Badge className="text-[10px] px-1.5 py-0 bg-warning text-warning-foreground">Pro</Badge>
          </div>
          <Select value={aiFilterHostile} onValueChange={(v) => { setAiFilterHostile(v); markDirty(); }}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Omitir</SelectItem>
              <SelectItem value="send_last">Enviar último</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ═══════════ EXPERT ROTATION ═══════════ */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Rotación Experta</h3>
            <Badge className="text-[10px] px-1.5 py-0 bg-warning text-warning-foreground">Pro</Badge>
          </div>
          <Switch checked={expertRotation} onCheckedChange={(v) => { setExpertRotation(v); markDirty(); }} />
        </div>
        <p className="text-xs text-muted-foreground">
          Rota los dominios estratégicamente para mantener alta la reputación de todos tus buzones. 
          El algoritmo calcula automáticamente la distribución óptima considerando:
        </p>
        <ul className="text-xs text-muted-foreground space-y-1 ml-1">
          <li className="flex items-center gap-1.5"><span className="text-primary">✓</span> Calentamiento progresivo por dominio</li>
          <li className="flex items-center gap-1.5"><span className="text-primary">✓</span> Distribución equilibrada entre dominios</li>
          <li className="flex items-center gap-1.5"><span className="text-primary">✓</span> Pausas inteligentes para recuperar reputación</li>
          <li className="flex items-center gap-1.5"><span className="text-primary">✓</span> Priorización de cuentas con mejor salud</li>
        </ul>
        {expertRotation && (
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-xs text-foreground font-medium">🧠 Modo activo</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              La IA distribuirá los envíos inteligentemente entre tus {totalAccountsUsed || 0} cuentas, 
              alternando dominios y respetando los límites de warmup de cada una.
            </p>
          </div>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="space-y-3">
          <Label className="flex items-center gap-2"><Tag className="h-4 w-4" /> Tags de cuentas</Label>
          <p className="text-xs text-muted-foreground">Selecciona tags para incluir automáticamente todas las cuentas con ese tag.</p>
          <div className="flex flex-wrap gap-2">
            {allTags.map(tag => {
              const count = accounts.filter(a => (a.tags || []).includes(tag)).length;
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${isSelected ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}
                >
                  {tag} ({count})
                </button>
              );
            })}
          </div>
          {selectedTags.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {tagAccountIds.size} cuenta{tagAccountIds.size !== 1 ? "s" : ""} incluida{tagAccountIds.size !== 1 ? "s" : ""} por tags
            </p>
          )}
        </div>
      )}

      {/* Individual account selection */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2"><Mail className="h-4 w-4" /> Cuentas individuales</Label>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cuentas conectadas. Ve a Cuentas de Email primero.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map(acc => {
              const fromTag = tagAccountIds.has(acc.id);
              const isChecked = selectedAccounts.includes(acc.id) || fromTag;
              return (
                <label key={acc.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={isChecked} disabled={fromTag} onCheckedChange={() => toggleAccount(acc.id)} />
                  <span className={fromTag ? "text-muted-foreground" : ""}>{acc.email}</span>
                  {fromTag && <Badge variant="outline" className="text-[10px] px-1.5 py-0">vía tag</Badge>}
                  {(acc.tags || []).length > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {(acc.tags || []).join(", ")}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {totalAccountsUsed > 0 && (
          <p className="text-xs font-medium text-primary">{totalAccountsUsed} cuenta{totalAccountsUsed !== 1 ? "s" : ""} total{totalAccountsUsed !== 1 ? "es" : ""} para esta campaña</p>
        )}
      </div>

      <div className="space-y-3">
        <Label className="flex items-center gap-2"><Settings className="h-4 w-4" /> Ajustes de campaña</Label>
        <div className="space-y-1">
          <Label className="text-xs">Límite diario</Label>
          <Input type="number" value={dailyLimit} onChange={e => { setDailyLimit(parseInt(e.target.value) || 0); markDirty(); }} className="w-32" />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Parar al recibir respuesta</p>
            <p className="text-xs text-muted-foreground">Al responder un lead, se detienen los follow-ups</p>
          </div>
          <Switch checked={stopOnReply} onCheckedChange={v => { setStopOnReply(v); markDirty(); }} />
        </div>

        {/* SlowRamp */}
        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">SlowRamp</p>
              <p className="text-xs text-muted-foreground">Incrementa gradualmente los envíos por cuenta cada día</p>
            </div>
            <Switch checked={slowRampEnabled} onCheckedChange={v => { setSlowRampEnabled(v); markDirty(); }} />
          </div>
          {slowRampEnabled && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Inicio (emails/cuenta/día)</Label>
                  <Input type="number" min={1} value={slowRampMax} onChange={e => { setSlowRampMax(parseInt(e.target.value) || 1); markDirty(); }} className="w-full" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Incremento diario</Label>
                  <Input type="number" min={1} value={slowRampIncrement} onChange={e => { setSlowRampIncrement(parseInt(e.target.value) || 1); markDirty(); }} className="w-full" />
                </div>
              </div>
              {campaignCreatedAt && (() => {
                const days = Math.max(0, Math.floor((Date.now() - new Date(campaignCreatedAt).getTime()) / (1000 * 60 * 60 * 24)));
                const effectiveLimit = slowRampMax + days * slowRampIncrement;
                return (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                    📈 Día {days + 1} de campaña → Límite efectivo hoy: <span className="font-semibold text-foreground">{effectiveLimit} emails/cuenta</span>
                    {dailyLimit > 0 && <span> (máx. global: {dailyLimit})</span>}
                  </p>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* A/B Testing IA */}
      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" /> A/B Testing con IA
            </p>
            <p className="text-xs text-muted-foreground">La IA analiza tus variantes y crea mejoras automáticamente (máx. 5 variantes)</p>
          </div>
          <Switch checked={abTestEnabled} onCheckedChange={v => { setAbTestEnabled(v); markDirty(); }} />
        </div>

        {abTestEnabled && (
          <div className="space-y-4 pt-2">
            {abSteps.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Selecciona un step para optimizar</Label>
                <div className="flex flex-wrap gap-1.5">
                  {abSteps.map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => setAbSelectedStep(s.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                        abSelectedStep === s.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      Step {s.step_order}: {s.subject?.slice(0, 30) || "Sin asunto"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {abLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : abStats.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground">Rendimiento por variante</span>
                </div>
                {abStats.map((v: any) => {
                  const maxRate = Math.max(...abStats.map((s: any) => s.replyRate), 1);
                  const isBest = v.replyRate === maxRate && v.sent >= 3;
                  const isWorst = v.replyRate === Math.min(...abStats.map((s: any) => s.replyRate)) && abStats.length > 1 && v.sent >= 3;
                  return (
                    <div key={v.index} className={`rounded-lg border p-3 space-y-2 ${isBest ? "border-green-500/50 bg-green-500/5" : isWorst ? "border-destructive/30 bg-destructive/5" : ""}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant={isBest ? "default" : "outline"} className="text-[10px] h-5 px-1.5">
                            {v.label}
                          </Badge>
                          {isBest && <Badge className="text-[10px] h-5 px-1.5 bg-green-600">🏆 Mejor</Badge>}
                          {isWorst && <Badge variant="destructive" className="text-[10px] h-5 px-1.5">⚠️ Peor</Badge>}
                        </div>
                        <span className="text-xs font-bold">{v.replyRate}% reply</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">📧 {v.subject || "Sin asunto"}</p>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{v.sent} enviados</span>
                        <span>{v.replied} replies</span>
                      </div>
                      <Progress value={maxRate > 0 ? (v.replyRate / maxRate) * 100 : 0} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            ) : abSelectedStep ? (
              <p className="text-xs text-muted-foreground text-center py-4">No hay datos de envío aún. Activa la campaña para empezar a recopilar datos.</p>
            ) : null}

            {abSelectedStep && (
              <div className="flex flex-col gap-2">
                <Button onClick={handleOptimize} disabled={abOptimizing} className="w-full gap-2" size="sm">
                  {abOptimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {abOptimizing ? "Generando variantes con IA..." : "Generar variantes mejoradas con IA"}
                </Button>
                <Button onClick={handleRemoveWorst} disabled={abRemoving || abStats.length < 2} variant="outline" className="w-full gap-2 text-destructive hover:text-destructive" size="sm">
                  {abRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {abRemoving ? "Eliminando..." : "Eliminar variante con peor rendimiento"}
                </Button>
                <Button onClick={() => loadAbStats(abSelectedStep)} variant="ghost" size="sm" className="gap-2 text-xs">
                  <TrendingUp className="h-3 w-3" /> Actualizar estadísticas
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════ EMAIL SIGNATURE ═══════════ */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <FileSignature className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Firma de Email</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Pega tu firma en HTML. Se añadirá automáticamente al final de cada email enviado en esta campaña.
        </p>
        <Textarea
          value={signatureHtml}
          onChange={(e) => { setSignatureHtml(e.target.value); markDirty(); }}
          placeholder='<p style="color:#555">— <br/>Tu Nombre<br/>tu@empresa.com</p>'
          className="font-mono text-xs min-h-[120px]"
        />
        {signatureHtml.trim() && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setShowSignaturePreview(!showSignaturePreview)}
            >
              {showSignaturePreview ? "Ocultar vista previa" : "Ver vista previa"}
            </Button>
            {showSignaturePreview && (
              <div className="rounded-md border bg-background p-3">
                <p className="text-[10px] text-muted-foreground mb-2">Vista previa:</p>
                <div
                  className="text-sm prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: signatureHtml }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cross-campaign dedup */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Leads duplicados entre campañas</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Verifica si hay leads en esta campaña que también están en otras campañas. Si los hay, puedes eliminarlos de aquí.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          disabled={deduping}
          onClick={handleCrossCampaignDedup}
        >
          {deduping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {deduping ? "Verificando..." : "Buscar y eliminar duplicados entre campañas"}
        </Button>
      </div>

      <Button onClick={save} disabled={saved} className="w-full">
        {saved ? "✓ Guardado" : "Guardar opciones"}
      </Button>
    </div>
  );
}
