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
import { Mail, Settings, Tag, FlaskConical, Sparkles, Trash2, Loader2, TrendingUp, BarChart3, Shield, Zap, Users, RefreshCw, FileSignature, Minus, Plus, Check, GitBranch, Gauge, Split, ChevronDown, Ban } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface Props { campaignId: string; }

/* ── Smartlead-style design primitives ─────────────────────────── */

/** Uppercase section label + a card that divides its rows cleanly. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {children}
      </div>
    </div>
  );
}

/** A single option row: icon badge + title/description on the left, control on the right. */
function Row({
  icon, tint = "primary", title, desc, badge, control, children, className = "",
}: {
  icon?: React.ReactNode; tint?: "primary" | "emerald" | "amber" | "violet" | "blue" | "rose";
  title: string; desc?: React.ReactNode; badge?: React.ReactNode; control?: React.ReactNode;
  children?: React.ReactNode; className?: string;
}) {
  const tints: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/10 text-emerald-600",
    amber: "bg-amber-500/10 text-amber-600",
    violet: "bg-violet-500/10 text-violet-600",
    blue: "bg-blue-500/10 text-blue-600",
    rose: "bg-rose-500/10 text-rose-600",
  };
  return (
    <div className={`px-4 py-3.5 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tints[tint]}`}>{icon}</span>}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-foreground">{title}</p>
              {badge}
            </div>
            {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
          </div>
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-3 pl-11">{children}</div>}
    </div>
  );
}

/** Number stepper (− value +) like the design reference. */
function Stepper({ value, onChange, min = 0, max, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(max != null ? Math.min(max, value + step) : value + step);
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-border bg-background">
      <button type="button" onClick={dec} className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Minus className="h-3.5 w-3.5" /></button>
      <input
        type="number" value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="h-9 w-12 border-x border-border bg-transparent text-center text-sm font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" onClick={inc} className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

const proBadge = <Badge className="h-4 bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-600">Pro</Badge>;

export default function CampaignOptions({ campaignId }: Props) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [stopOnReply, setStopOnReply] = useState(true);
  const [includeUnsubscribe, setIncludeUnsubscribe] = useState(false);
  const [unsubAll, setUnsubAll] = useState(true);
  const [unsubAccountIds, setUnsubAccountIds] = useState<string[]>([]);
  const [unsubTags, setUnsubTags] = useState<string[]>([]);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [saved, setSaved] = useState(true);
  const [savedTags, setSavedTags] = useState<string[]>([]);
  const [slowRampEnabled, setSlowRampEnabled] = useState(false);
  const [slowRampMax, setSlowRampMax] = useState(2);
  const [slowRampIncrement, setSlowRampIncrement] = useState(2);
  const [campaignCreatedAt, setCampaignCreatedAt] = useState<string | null>(null);
  // Anchor for the campaign-level slow ramp = first ACTUAL send (mirrors backend),
  // not the creation date. A never-sent campaign stays at the starting cap.
  const [campaignFirstSentAt, setCampaignFirstSentAt] = useState<string | null>(null);
  const [sendStartHour, setSendStartHour] = useState(9);
  const [sendEndHour, setSendEndHour] = useState(18);
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
  const [expertRotation, setExpertRotation] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState("");
  const [showSignaturePreview, setShowSignaturePreview] = useState(false);
  const [breakThreadAfter, setBreakThreadAfter] = useState(0);
  const [accountsExpanded, setAccountsExpanded] = useState(false);
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
    savedTags.forEach((t) => tags.add(t));               // tags creados en Cuentas de email
    accounts.forEach(a => (a.tags || []).forEach((t: string) => tags.add(t)));
    return Array.from(tags).sort();
  }, [accounts, savedTags]);

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
      const [accRes, caRes, campRes, stepsRes, tagsRes] = await Promise.all([
        supabase.from("email_accounts").select("id, email, status, tags, sent_today, daily_limit, warmup_enabled, warmup_started_at, warmup_increment, warmup_limit").eq("user_id", user.id).eq("status", "connected"),
        supabase.from("campaign_accounts").select("account_id").eq("campaign_id", campaignId),
        supabase.from("campaigns").select("*").eq("id", campaignId).single(),
        supabase.from("campaign_steps").select("id, step_order, subject").eq("campaign_id", campaignId).order("step_order"),
        supabase.from("email_tags").select("name").eq("user_id", user.id).order("name"),
      ]);
      setSavedTags((tagsRes.data || []).map((t: any) => t.name));
      setAccounts(accRes.data || []);
      setSelectedAccounts((caRes.data || []).map((r: any) => r.account_id));
      const steps = stepsRes.data || [];
      setAbSteps(steps);
      if (steps.length && !abSelectedStep) setAbSelectedStep(steps[0].id);
      if (campRes.data) {
        const d = campRes.data as any;
        setDailyLimit(d.daily_limit || 50);
        setStopOnReply(d.stop_on_reply ?? true);
        setIncludeUnsubscribe(d.include_unsubscribe ?? false);
        setUnsubAll(d.unsubscribe_all ?? true);
        setUnsubAccountIds(d.unsubscribe_account_ids || []);
        setUnsubTags(d.unsubscribe_account_tags || []);
        setSelectedTags(d.account_tags || []);
        setSlowRampEnabled(d.slow_ramp_enabled ?? false);
        setSlowRampMax(d.slow_ramp_max ?? 2);
        setSlowRampIncrement(d.slow_ramp_increment ?? 2);
        setCampaignCreatedAt(d.created_at || null);
        // First actual send anchors the campaign slow ramp (same as the backend).
        supabase.from("sent_emails").select("sent_at").eq("campaign_id", campaignId).eq("status", "sent")
          .order("sent_at", { ascending: true }).limit(1)
          .then(({ data }) => setCampaignFirstSentAt(data?.[0]?.sent_at || null));
        setSendStartHour(d.send_start_hour ?? 9);
        setSendEndHour(d.send_end_hour ?? 18);
        setAbTestEnabled(d.ab_test_enabled ?? false);
        // New fields
        setTextOnlyEmails(d.text_only_emails ?? false);
        setFirstEmailTextOnly(d.first_email_text_only ?? false);
        setPrioritizeNewLeads(d.prioritize_new_leads ?? false);
        setDomainLimitEnabled(d.domain_limit_enabled ?? false);
        setDomainDailyLimit(d.domain_daily_limit ?? 3);
        setProviderMatching(d.provider_matching ?? false);
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
      daily_limit: usedAccounts.length ? capacityToday : dailyLimit,
      stop_on_reply: stopOnReply,
      include_unsubscribe: includeUnsubscribe,
      unsubscribe_all: unsubAll,
      unsubscribe_account_ids: unsubAccountIds,
      unsubscribe_account_tags: unsubTags,
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

  const rampInfo = (() => {
    if (!slowRampEnabled) return null;
    // Anchor to first ACTUAL send (matches backend rampDaysActive). Never sent → day 0.
    const anchor = campaignFirstSentAt ? new Date(campaignFirstSentAt).getTime() : null;
    const days = anchor ? Math.max(0, Math.floor((Date.now() - anchor) / (1000 * 60 * 60 * 24))) : 0;
    return { days, eff: slowRampMax + days * slowRampIncrement };
  })();

  // Accounts actually used by this campaign (selected directly or via tag).
  const usedAccounts = useMemo(
    () => accounts.filter((a: any) => selectedAccounts.includes(a.id) || tagAccountIds.has(a.id)),
    [accounts, selectedAccounts, tagAccountIds],
  );

  // Effective daily limit per account = smallest of account daily_limit, account slow
  // ramp, and campaign slow ramp. Mirrors process-campaign-queue.getEffectiveLimit.
  const HARD_DAILY_CAP = 30;
  const effLimitFor = (acc: any) => {
    let limit = Math.min(acc.daily_limit ?? HARD_DAILY_CAP, HARD_DAILY_CAP);
    let accRampDay: number | null = null;
    if (acc.warmup_enabled && acc.warmup_started_at) {
      const days = Math.max(0, Math.floor((Date.now() - new Date(acc.warmup_started_at).getTime()) / 86400000));
      const inc = acc.warmup_increment || 2;
      const target = acc.warmup_limit || limit;
      accRampDay = days + 1;
      limit = Math.min(limit, Math.min((days + 1) * inc, target));
    }
    if (rampInfo) limit = Math.min(limit, rampInfo.eff);
    return { limit, accRampDay };
  };
  const sentTodayTotal = usedAccounts.reduce((s: number, a: any) => s + (a.sent_today || 0), 0);
  const capacityToday = usedAccounts.reduce((s: number, a: any) => s + effLimitFor(a).limit, 0);

  // Sending rhythm — same formula the backend uses to pace this campaign:
  //   quota per account = total effective daily capacity / number of accounts
  //   interval per account = sending window (minutes) / quota per account
  // i.e. "1 email per account roughly every N minutes", auto-updates with slow ramp.
  const windowMinutes = Math.max(60, (sendEndHour - sendStartHour) * 60);
  const quotaPerAccount = usedAccounts.length > 0 ? capacityToday / usedAccounts.length : 0;
  const intervalPerAccountMin = quotaPerAccount > 0 ? Math.round(windowMinutes / quotaPerAccount) : 0;
  const fmtInterval = (m: number) => (m <= 0 ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + "min" : ""}`.trim());

  // Límite diario AUTOMÁTICO: es siempre la suma del límite efectivo de cada
  // cuenta seleccionada (slow-ramp aware, así que sube solo cada día). Mantiene
  // la columna daily_limit sincronizada para que backend + UI coincidan.
  useEffect(() => {
    if (!usedAccounts.length) return;
    if (dailyLimit !== capacityToday) {
      setDailyLimit(capacityToday);
      supabase.from("campaigns").update({ daily_limit: capacityToday } as any).eq("id", campaignId);
    }
  }, [capacityToday, usedAccounts.length]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">

      {/* ── ENVÍO Y RITMO ── */}
      <Section label="Envío y ritmo">
        <Row icon={<Gauge className="h-4 w-4" />} tint="primary"
          title="Límite diario de envíos"
          desc={slowRampEnabled
            ? "Automático: suma del límite de cada cuenta seleccionada. Con slow ramp sube solo cada día."
            : "Automático: límite por cuenta × nº de cuentas seleccionadas. Se recalcula solo."}
          control={
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tabular-nums text-foreground">{capacityToday}</span>
              <Badge variant="secondary" className="text-[10px]">auto</Badge>
            </div>
          }
        />
        <Row icon={<Mail className="h-4 w-4" />} tint="emerald"
          title="Parar al recibir respuesta"
          desc="Si un lead contesta, se cancelan automáticamente sus follow-ups."
          control={<Switch checked={stopOnReply} onCheckedChange={v => { setStopOnReply(v); markDirty(); }} />}
        />
        <Row icon={<Ban className="h-4 w-4" />} tint="rose"
          title="Incluir enlace de baja"
          desc="Añade abajo un pequeño enlace de baja. Si lo pulsan, salen de la lista y no se les vuelve a contactar en ninguna campaña."
          control={<Switch checked={includeUnsubscribe} onCheckedChange={v => { setIncludeUnsubscribe(v); markDirty(); }} />}
        >
          {includeUnsubscribe && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={unsubAll} onCheckedChange={v => { setUnsubAll(v); markDirty(); }} />
                <span>Todas las cuentas</span>
              </label>
              {!unsubAll && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Elige por tag o cuentas individuales que llevarán el enlace de baja.</p>
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map(tag => {
                        const sel = unsubTags.includes(tag);
                        return (
                          <button key={tag} type="button"
                            onClick={() => { setUnsubTags(p => sel ? p.filter(t => t !== tag) : [...p, tag]); markDirty(); }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"}`}>
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    {accounts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No hay cuentas conectadas.</p>
                    ) : accounts.map(acc => {
                      const viaTag = (acc.tags || []).some((t: string) => unsubTags.includes(t));
                      const checked = unsubAccountIds.includes(acc.id) || viaTag;
                      return (
                        <label key={acc.id} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox checked={checked} disabled={viaTag}
                            onCheckedChange={() => { setUnsubAccountIds(p => p.includes(acc.id) ? p.filter(i => i !== acc.id) : [...p, acc.id]); markDirty(); }} />
                          <span className={viaTag ? "text-muted-foreground" : ""}>{acc.email}</span>
                          {viaTag && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">vía tag</Badge>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Row>
        <Row icon={<Users className="h-4 w-4" />} tint="blue"
          title="Priorizar nuevos leads"
          desc="Contacta antes a los leads nuevos que a los follow-ups en cola."
          control={<Switch checked={prioritizeNewLeads} onCheckedChange={v => { setPrioritizeNewLeads(!!v); markDirty(); }} />}
        />
        <Row icon={<TrendingUp className="h-4 w-4" />} tint="violet"
          title="Aumento gradual" badge={<Badge variant="secondary" className="h-4 px-1.5 text-[10px]">SlowRamp</Badge>}
          desc="Sube poco a poco el volumen diario por cuenta para calentar los buzones."
          control={<Switch checked={slowRampEnabled} onCheckedChange={v => { setSlowRampEnabled(v); markDirty(); }} />}
        >
          {slowRampEnabled && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-5">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Inicio (emails/cuenta/día)</Label>
                  <Stepper value={slowRampMax} min={1} onChange={(v) => { setSlowRampMax(v); markDirty(); }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Incremento diario</Label>
                  <Stepper value={slowRampIncrement} min={1} onChange={(v) => { setSlowRampIncrement(v); markDirty(); }} />
                </div>
              </div>
              {rampInfo && (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  <TrendingUp className="mr-1 inline h-3 w-3 text-violet-600" /> Día {rampInfo.days + 1} de campaña → límite efectivo hoy: <span className="font-semibold text-foreground">{rampInfo.eff} emails/cuenta</span>
                  {dailyLimit > 0 && <span> (máx. global: {dailyLimit})</span>}
                </p>
              )}
            </div>
          )}
        </Row>
      </Section>

      {/* ── PROGRESO DE ENVÍO ── */}
      <Section label="Progreso de envío (hoy)">
        <div className="space-y-3 px-1 py-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Enviado hoy</span>
            <span className="font-semibold">{sentTodayTotal} <span className="text-xs font-normal text-muted-foreground">/ {capacityToday} capacidad hoy</span></span>
          </div>

          {/* Ritmo de envío (auto) — así reparte esta campaña, de forma independiente */}
          <div className="rounded-lg border border-violet-200/70 bg-violet-50/60 px-3 py-2.5 dark:border-violet-900/40 dark:bg-violet-950/20">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-semibold text-foreground">Ritmo automático</span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {slowRampEnabled ? "Slow Ramp activo" : "Ritmo pleno"}
              </Badge>
            </div>
            {usedAccounts.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Selecciona cuentas para calcular el ritmo de esta campaña.</p>
            ) : (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>
                  📨 Aprox. <span className="font-semibold text-foreground">1 correo por cuenta cada {fmtInterval(intervalPerAccountMin)}</span>
                  <span> (~{Math.round(quotaPerAccount)}/cuenta/día · {usedAccounts.length} cuentas)</span>
                </p>
                <p>
                  🕒 Ventana de envío: <span className="font-medium text-foreground">{sendStartHour}:00–{sendEndHour}:00</span> ({Math.round(windowMinutes / 60)}h) · se auto-regula por horas
                </p>
                {slowRampEnabled && rampInfo ? (
                  <p>
                    📈 Slow ramp: día <span className="font-medium text-foreground">{rampInfo.days + 1}</span> → hoy <span className="font-medium text-foreground">{rampInfo.eff} emails/cuenta</span>; el ritmo se acelera solo cada día.
                  </p>
                ) : (
                  <p>📈 Slow ramp desactivado — envía al límite diario configurado desde el primer día.</p>
                )}
              </div>
            )}
          </div>

          {usedAccounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Selecciona cuentas abajo para ver el reparto y el slow ramp por cuenta.</p>
          ) : (
            <div className="max-h-72 space-y-2.5 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2.5">
              {usedAccounts.map((acc: any) => {
                const { limit, accRampDay } = effLimitFor(acc);
                const pct = Math.min(((acc.sent_today || 0) / Math.max(1, limit)) * 100, 100);
                return (
                  <div key={acc.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{acc.email}</span>
                      <span className="flex flex-shrink-0 items-center gap-1.5">
                        {acc.warmup_enabled && accRampDay && (
                          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600">🐢 Día {accRampDay}</span>
                        )}
                        <span className="font-medium">{acc.sent_today || 0}/{limit}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {rampInfo && (
            <p className="text-[11px] text-muted-foreground">
              <TrendingUp className="mr-1 inline h-3 w-3 text-violet-600" />
              Slow ramp de campaña: día {rampInfo.days + 1} → {rampInfo.eff} emails/cuenta.
            </p>
          )}
        </div>
      </Section>

      {/* ── CUENTAS DE ENVÍO ── */}
      <Section label="Cuentas de envío">
        <Row icon={<Tag className="h-4 w-4" />} tint="blue" title="Seleccionar por tag"
          desc="Selecciona un tag e incluye automáticamente todas las cuentas que lo tengan.">
          <div className="space-y-2">
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aún no tienes tags. Créalos y asígnalos a tus cuentas en <span className="font-medium text-foreground">Cuentas de email</span>.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allTags.map(tag => {
                  const count = accounts.filter(a => (a.tags || []).includes(tag)).length;
                  const isSelected = selectedTags.includes(tag);
                  return (
                    <button key={tag} onClick={() => toggleTag(tag)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"}`}>
                      {tag} ({count})
                    </button>
                  );
                })}
              </div>
            )}
            {selectedTags.some(t => accounts.filter(a => (a.tags || []).includes(t)).length === 0) && (
              <p className="text-[11px] text-amber-600">
                ⚠ Ese tag no está asignado a ninguna cuenta todavía. Asígnalo a tus cuentas en <span className="font-medium">Cuentas de email</span> (puedes hacerlo en bloque) para que se incluyan aquí.
              </p>
            )}
          </div>
        </Row>

        <Row icon={<Mail className="h-4 w-4" />} tint="primary" title="Cuentas individuales"
          desc={accounts.length === 0 ? "No hay cuentas conectadas. Ve a Cuentas de Email primero." : "Elige qué buzones envían en esta campaña."}
          badge={totalAccountsUsed > 0 ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{totalAccountsUsed} en uso</Badge> : undefined}
          control={accounts.length > 0 ? (
            <button type="button" onClick={() => setAccountsExpanded(v => !v)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
              {accountsExpanded ? "Ocultar" : `Ver ${accounts.length}`}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${accountsExpanded ? "rotate-180" : ""}`} />
            </button>
          ) : undefined}>
          {accounts.length > 0 && accountsExpanded && (
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2.5">
              {accounts.map(acc => {
                const fromTag = tagAccountIds.has(acc.id);
                const isChecked = selectedAccounts.includes(acc.id) || fromTag;
                return (
                  <label key={acc.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={isChecked} disabled={fromTag} onCheckedChange={() => toggleAccount(acc.id)} />
                    <span className={fromTag ? "text-muted-foreground" : ""}>{acc.email}</span>
                    {fromTag && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">vía tag</Badge>}
                    {(acc.tags || []).length > 0 && <span className="ml-auto truncate text-[10px] text-muted-foreground">{(acc.tags || []).join(", ")}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </Row>
      </Section>

      {/* ── ENTREGABILIDAD ── */}
      <Section label="Entregabilidad">
        <Row icon={<Zap className="h-4 w-4" />} tint="emerald" title="Optimización de entrega"
          badge={<Badge variant="outline" className="h-4 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600">Recomendado</Badge>}
          desc="Desactiva el tracking de apertura para mejorar la entregabilidad.">
          <div className="space-y-2.5">
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox checked={textOnlyEmails} onCheckedChange={(v) => { setTextOnlyEmails(!!v); markDirty(); }} />
              <span className="text-sm">Enviar emails como solo texto (sin HTML)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox checked={firstEmailTextOnly} onCheckedChange={(v) => { setFirstEmailTextOnly(!!v); markDirty(); }} />
              <span className="text-sm">Enviar primer email como solo texto</span>
              {proBadge}
            </label>
          </div>
        </Row>

        <Row icon={<Shield className="h-4 w-4" />} tint="blue" title="Limitar emails por empresa"
          desc="Limita cuántos correos se envían al mismo dominio por día para evitar marcas de spam."
          control={<Switch checked={domainLimitEnabled} onCheckedChange={(v) => { setDomainLimitEnabled(v); markDirty(); }} />}>
          {domainLimitEnabled && (
            <div className="flex items-center gap-3">
              <Label className="text-xs text-muted-foreground">Límite diario por dominio</Label>
              <Stepper value={domainDailyLimit} min={1} onChange={(v) => { setDomainDailyLimit(v); markDirty(); }} />
            </div>
          )}
        </Row>

        <Row icon={<Split className="h-4 w-4" />} tint="violet" title="Provider Matching"
          desc="Empareja el proveedor del lead con tu buzón (Outlook → Outlook, Google → Google)."
          control={<Switch checked={providerMatching} onCheckedChange={(v) => { setProviderMatching(!!v); markDirty(); }} />}
        />

        <Row icon={<GitBranch className="h-4 w-4" />} tint="primary" title="Romper hilo"
          desc="Desde qué follow-up dejará de salir como respuesta y se enviará como email nuevo.">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={breakThreadAfter === 0 ? "default" : "outline"} className="h-8" onClick={() => { setBreakThreadAfter(0); markDirty(); }}>Mantener hilo siempre</Button>
              {abSteps.slice(1).map((step: any, idx: number) => {
                const n = idx + 1;
                return <Button key={step.id} type="button" size="sm" variant={breakThreadAfter === n ? "default" : "outline"} className="h-8" onClick={() => { setBreakThreadAfter(n); markDirty(); }}>Romper en follow-up {n}</Button>;
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {abSteps.length <= 1 ? "Añade al menos un follow-up en Sequences para poder romper el hilo." : breakThreadAfter === 0 ? "Todos los follow-ups seguirán en el mismo hilo." : `El follow-up ${breakThreadAfter} y los siguientes saldrán como mensaje nuevo.`}
            </p>
          </div>
        </Row>

        <Row icon={<RefreshCw className="h-4 w-4" />} tint="amber" title="Rotación experta" badge={proBadge}
          desc="Rota los dominios estratégicamente para mantener alta la reputación de todos tus buzones."
          control={<Switch checked={expertRotation} onCheckedChange={(v) => { setExpertRotation(v); markDirty(); }} />}>
          {expertRotation && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {["Calentamiento progresivo por dominio", "Distribución equilibrada entre dominios", "Pausas inteligentes para recuperar reputación", "Priorización de cuentas con mejor salud"].map(t => (
                <li key={t} className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-600" /> {t}</li>
              ))}
            </ul>
          )}
        </Row>
      </Section>

      {/* ── INTELIGENCIA ARTIFICIAL ── */}
      <Section label="Inteligencia artificial">

        <Row icon={<FlaskConical className="h-4 w-4" />} tint="rose" title="A/B Testing con IA"
          desc="La IA analiza tus variantes y crea mejoras automáticamente (máx. 5)."
          control={<Switch checked={abTestEnabled} onCheckedChange={v => { setAbTestEnabled(v); markDirty(); }} />}>
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
        </Row>
      </Section>

      {/* ── CONTENIDO ── */}
      <Section label="Contenido">
        <Row icon={<FileSignature className="h-4 w-4" />} tint="primary" title="Firma de email"
          desc="Pega tu firma en HTML. Se añade al final de cada email de esta campaña.">
          <div className="space-y-2">
            <Textarea
              value={signatureHtml}
              onChange={(e) => { setSignatureHtml(e.target.value); markDirty(); }}
              placeholder='<p style="color:#555">— <br/>Tu Nombre<br/>tu@empresa.com</p>'
              className="min-h-[110px] font-mono text-xs"
            />
            {signatureHtml.trim() && (
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowSignaturePreview(!showSignaturePreview)}>
                  {showSignaturePreview ? "Ocultar vista previa" : "Ver vista previa"}
                </Button>
                {showSignaturePreview && (
                  <div className="rounded-lg border bg-background p-3">
                    <p className="mb-2 text-[10px] text-muted-foreground">Vista previa:</p>
                    <div className="prose prose-sm max-w-none text-sm" dangerouslySetInnerHTML={{ __html: signatureHtml }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </Row>
      </Section>

      {/* ── MANTENIMIENTO ── */}
      <Section label="Mantenimiento">
        <Row icon={<Users className="h-4 w-4" />} tint="rose" title="Leads duplicados entre campañas"
          desc="Busca y elimina de aquí los leads que también están en otras campañas.">
          <Button variant="outline" size="sm" className="gap-2" disabled={deduping} onClick={handleCrossCampaignDedup}>
            {deduping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {deduping ? "Verificando…" : "Buscar y eliminar duplicados"}
          </Button>
        </Row>
      </Section>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-1 border-t border-border/60 bg-background/85 px-1 pb-1 pt-3 backdrop-blur">
        <Button onClick={save} disabled={saved} className="w-full gap-2">
          {saved ? <><Check className="h-4 w-4" /> Guardado</> : "Guardar opciones"}
        </Button>
      </div>
    </div>
  );
}
