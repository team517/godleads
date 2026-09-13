import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, Check } from "lucide-react";

type Manager = { id: string; name: string; color: string };
type Client = { id: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignIds: string[];
  managers?: Manager[];
  clients?: Client[];
  onDone: () => void;
}

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "L" }, { key: "tue", label: "M" }, { key: "wed", label: "X" },
  { key: "thu", label: "J" }, { key: "fri", label: "V" }, { key: "sat", label: "S" }, { key: "sun", label: "D" },
];

/** One editable option. The left switch decides whether this field is written to the
 *  selected campaigns — anything left OFF is not touched, so a bulk edit only changes
 *  exactly what you turn on. */
function ApplyRow({
  on, setOn, title, desc, children,
}: {
  on: boolean; setOn: (v: boolean) => void; title: string; desc?: string; children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <label className="flex min-w-0 cursor-pointer items-start gap-3">
          <Switch checked={on} onCheckedChange={setOn} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{title}</span>
            {desc && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{desc}</span>}
          </span>
        </label>
        {children && <div className={cn("shrink-0 transition-opacity", !on && "pointer-events-none opacity-40")}>{children}</div>}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-card">{children}</div>
    </div>
  );
}

export default function BulkEditCampaigns({ open, onOpenChange, campaignIds, managers = [], clients = [], onDone }: Props) {
  const { user } = useAuth();
  const n = campaignIds.length;
  const [saving, setSaving] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Which options to apply
  const [applyDaily, setApplyDaily] = useState(false);
  const [dailyAuto, setDailyAuto] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(50);

  const [applyRamp, setApplyRamp] = useState(false);
  const [rampEnabled, setRampEnabled] = useState(true);
  const [rampMax, setRampMax] = useState(2);
  const [rampInc, setRampInc] = useState(2);

  const [applyStop, setApplyStop] = useState(false);
  const [stopOnReply, setStopOnReply] = useState(true);

  const [applyWindow, setApplyWindow] = useState(false);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(18);

  const [applyDays, setApplyDays] = useState(false);
  const [sendDays, setSendDays] = useState<string[]>(["mon", "tue", "wed", "thu", "fri"]);

  const [applyTextOnly, setApplyTextOnly] = useState(false);
  const [textOnly, setTextOnly] = useState(false);

  const [applyFirstText, setApplyFirstText] = useState(false);
  const [firstText, setFirstText] = useState(false);

  const [applyPrioritize, setApplyPrioritize] = useState(false);
  const [prioritize, setPrioritize] = useState(false);

  const [applyDomain, setApplyDomain] = useState(false);
  const [domainEnabled, setDomainEnabled] = useState(true);
  const [domainLimit, setDomainLimit] = useState(3);

  const [applyProvider, setApplyProvider] = useState(false);
  const [provider, setProvider] = useState(false);

  const [applyExpert, setApplyExpert] = useState(false);
  const [expert, setExpert] = useState(false);

  const [applyUnsub, setApplyUnsub] = useState(false);
  const [unsub, setUnsub] = useState(false);

  const [applyBreak, setApplyBreak] = useState(false);
  const [breakAfter, setBreakAfter] = useState(0);

  const [applySig, setApplySig] = useState(false);
  const [signature, setSignature] = useState("");

  const [applyTags, setApplyTags] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  const [applyManager, setApplyManager] = useState(false);
  const [managerId, setManagerId] = useState<string>("none");

  const [applyClient, setApplyClient] = useState(false);
  const [clientId, setClientId] = useState<string>("none");

  useEffect(() => {
    if (!open || !user) return;
    // Tags available (created in Cuentas + any on the accounts).
    (async () => {
      const [{ data: t }, { data: accs }] = await Promise.all([
        supabase.from("email_tags").select("name").eq("user_id", user.id),
        supabase.from("email_accounts").select("tags").eq("user_id", user.id),
      ]);
      const set = new Set<string>();
      (t || []).forEach((r: any) => r.name && set.add(r.name));
      (accs || []).forEach((a: any) => (a.tags || []).forEach((x: string) => set.add(x)));
      setAllTags(Array.from(set).sort());
    })();
  }, [open, user]);

  const enabledCount = useMemo(() => [
    applyDaily, applyRamp, applyStop, applyWindow, applyDays, applyTextOnly, applyFirstText,
    applyPrioritize, applyDomain, applyProvider, applyExpert, applyUnsub, applyBreak, applySig,
    applyTags, applyManager, applyClient,
  ].filter(Boolean).length, [applyDaily, applyRamp, applyStop, applyWindow, applyDays, applyTextOnly, applyFirstText, applyPrioritize, applyDomain, applyProvider, applyExpert, applyUnsub, applyBreak, applySig, applyTags, applyManager, applyClient]);

  const toggleDay = (d: string) => setSendDays((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d]);
  const toggleTag = (t: string) => setTags((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);

  const save = async () => {
    if (!n || enabledCount === 0) { toast.error("Activa al menos una opción para aplicar"); return; }
    if (applyWindow && endHour <= startHour) { toast.error("La hora de fin debe ser mayor que la de inicio"); return; }
    if (applyDays && sendDays.length === 0) { toast.error("Marca al menos un día de envío"); return; }

    const patch: Record<string, any> = {};
    if (applyDaily) patch.daily_limit = dailyAuto ? 0 : Math.max(1, dailyLimit);
    if (applyRamp) { patch.slow_ramp_enabled = rampEnabled; patch.slow_ramp_max = Math.max(1, rampMax); patch.slow_ramp_increment = Math.max(1, rampInc); }
    if (applyStop) patch.stop_on_reply = stopOnReply;
    if (applyWindow) { patch.send_start_hour = startHour; patch.send_end_hour = endHour; }
    if (applyDays) patch.send_days = sendDays;
    if (applyTextOnly) patch.text_only_emails = textOnly;
    if (applyFirstText) patch.first_email_text_only = firstText;
    if (applyPrioritize) patch.prioritize_new_leads = prioritize;
    if (applyDomain) { patch.domain_limit_enabled = domainEnabled; patch.domain_daily_limit = Math.max(1, domainLimit); }
    if (applyProvider) patch.provider_matching = provider;
    if (applyExpert) patch.expert_rotation = expert;
    if (applyUnsub) { patch.include_unsubscribe = unsub; if (unsub) patch.unsubscribe_all = true; }
    if (applyBreak) patch.break_thread_after = Math.max(0, breakAfter);
    if (applySig) patch.signature_html = signature;
    if (applyTags) patch.account_tags = tags;
    if (applyManager) patch.manager_id = managerId === "none" ? null : managerId;
    if (applyClient) patch.client_id = clientId === "none" ? null : clientId;

    setSaving(true);
    // One update over the selected ids. RLS (auth.uid() = user_id) limits it to the
    // user's own campaigns, so a stray id can never touch someone else's campaign.
    const { error } = await supabase.from("campaigns").update(patch as any).in("id", campaignIds);
    setSaving(false);
    if (error) { toast.error(`No se pudo aplicar: ${error.message}`); return; }
    toast.success(`${enabledCount} ${enabledCount === 1 ? "opción aplicada" : "opciones aplicadas"} a ${n} ${n === 1 ? "campaña" : "campañas"}`);
    onOpenChange(false);
    onDone();
  };

  const numInput = (value: number, set: (v: number) => void, min = 0) => (
    <Input type="number" value={value} min={min}
      onChange={(e) => { const v = parseInt(e.target.value); set(Number.isNaN(v) ? min : Math.max(min, v)); }}
      className="h-9 w-20 text-center text-sm" />
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="font-display tracking-[-0.03em]">Editar {n} {n === 1 ? "campaña" : "campañas"} a la vez</DialogTitle>
          <p className="text-[13px] text-muted-foreground">Activa solo las opciones que quieras cambiar. Lo que dejes apagado no se toca.</p>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-5 overflow-y-auto px-5 py-4">
          <Section label="Envío y ritmo">
            <ApplyRow on={applyDaily} setOn={setApplyDaily} title="Límite diario de envíos" desc="Automático (sube con el warm-up) o un tope fijo.">
              <div className="flex items-center gap-2">
                {!dailyAuto && numInput(dailyLimit, setDailyLimit, 1)}
                <label className="flex items-center gap-1.5"><Switch checked={dailyAuto} onCheckedChange={setDailyAuto} /><span className="text-[11px] text-muted-foreground">Auto</span></label>
              </div>
            </ApplyRow>
            <ApplyRow on={applyRamp} setOn={setApplyRamp} title="Aumento gradual (Slow ramp)" desc="Sube poco a poco el volumen por cuenta.">
              <div className="flex items-center gap-2">
                <Switch checked={rampEnabled} onCheckedChange={setRampEnabled} />
                {rampEnabled && <><span className="text-[11px] text-muted-foreground">ini</span>{numInput(rampMax, setRampMax, 1)}<span className="text-[11px] text-muted-foreground">+día</span>{numInput(rampInc, setRampInc, 1)}</>}
              </div>
            </ApplyRow>
            <ApplyRow on={applyStop} setOn={setApplyStop} title="Parar al recibir respuesta" desc="Cancela los follow-ups si el lead contesta.">
              <Switch checked={stopOnReply} onCheckedChange={setStopOnReply} />
            </ApplyRow>
            <ApplyRow on={applyWindow} setOn={setApplyWindow} title="Ventana de envío (horas)" desc="Franja horaria en la que se envía.">
              <div className="flex items-center gap-1.5">{numInput(startHour, setStartHour, 0)}<span className="text-muted-foreground">–</span>{numInput(endHour, setEndHour, 1)}</div>
            </ApplyRow>
            <ApplyRow on={applyDays} setOn={setApplyDays} title="Días de envío" desc="Qué días de la semana envía.">
              <div className="flex gap-1">
                {DAYS.map((d) => (
                  <button key={d.key} type="button" onClick={() => toggleDay(d.key)}
                    className={cn("h-8 w-8 rounded-md border text-xs font-bold", sendDays.includes(d.key) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground")}>
                    {d.label}
                  </button>
                ))}
              </div>
            </ApplyRow>
          </Section>

          <Section label="Entregabilidad">
            <ApplyRow on={applyTextOnly} setOn={setApplyTextOnly} title="Enviar como solo texto" desc="Sin HTML — mejora la entregabilidad.">
              <Switch checked={textOnly} onCheckedChange={setTextOnly} />
            </ApplyRow>
            <ApplyRow on={applyFirstText} setOn={setApplyFirstText} title="Primer email como solo texto">
              <Switch checked={firstText} onCheckedChange={setFirstText} />
            </ApplyRow>
            <ApplyRow on={applyPrioritize} setOn={setApplyPrioritize} title="Priorizar nuevos leads" desc="Contacta antes a los nuevos que a los follow-ups.">
              <Switch checked={prioritize} onCheckedChange={setPrioritize} />
            </ApplyRow>
            <ApplyRow on={applyDomain} setOn={setApplyDomain} title="Limitar emails por empresa" desc="Máximo de correos al mismo dominio por día.">
              <div className="flex items-center gap-2"><Switch checked={domainEnabled} onCheckedChange={setDomainEnabled} />{domainEnabled && numInput(domainLimit, setDomainLimit, 1)}</div>
            </ApplyRow>
            <ApplyRow on={applyProvider} setOn={setApplyProvider} title="Emparejar proveedor" desc="Outlook→Outlook, Google→Google.">
              <Switch checked={provider} onCheckedChange={setProvider} />
            </ApplyRow>
            <ApplyRow on={applyExpert} setOn={setApplyExpert} title="Rotación experta" desc="Rota dominios para cuidar la reputación.">
              <Switch checked={expert} onCheckedChange={setExpert} />
            </ApplyRow>
            <ApplyRow on={applyUnsub} setOn={setApplyUnsub} title="Incluir enlace de baja" desc="Añade un enlace de baja (a todas las cuentas).">
              <Switch checked={unsub} onCheckedChange={setUnsub} />
            </ApplyRow>
            <ApplyRow on={applyBreak} setOn={setApplyBreak} title="Romper hilo tras follow-up nº" desc="0 = mantener el hilo siempre.">
              {numInput(breakAfter, setBreakAfter, 0)}
            </ApplyRow>
          </Section>

          <Section label="Cuentas de envío (por tag)">
            <ApplyRow on={applyTags} setOn={setApplyTags} title="Asignar cuentas por tag" desc="Reemplaza los tags de envío de las campañas seleccionadas." />
            {applyTags && (
              <div className="px-4 py-3">
                {allTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tienes tags. Créalos en Cuentas de email.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((t) => (
                      <button key={t} type="button" onClick={() => toggleTag(t)}
                        className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", tags.includes(t) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted")}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">Se guardará <strong>{tags.length ? tags.join(", ") : "ningún tag"}</strong> como selección de cuentas.</p>
              </div>
            )}
          </Section>

          <Section label="Contenido y equipo">
            <ApplyRow on={applySig} setOn={setApplySig} title="Firma de email" desc="Reemplaza la firma HTML de las campañas seleccionadas." />
            {applySig && (
              <div className="px-4 py-3">
                <Textarea value={signature} onChange={(e) => setSignature(e.target.value)} placeholder='<p style="color:#555">— <br/>Tu Nombre</p>' className="min-h-[90px] font-mono text-xs" />
              </div>
            )}
            <ApplyRow on={applyClient} setOn={setApplyClient} title="Cliente" desc="Asigna estas campañas a un cliente.">
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="h-9 w-[200px] text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cliente</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </ApplyRow>
            <ApplyRow on={applyManager} setOn={setApplyManager} title="Responsable" desc="Quién se encarga de estas campañas.">
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger className="h-9 w-[200px] text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin responsable</SelectItem>
                  {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </ApplyRow>
          </Section>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="mr-auto self-center text-[13px] text-muted-foreground">
            {enabledCount === 0 ? "Ninguna opción seleccionada" : `${enabledCount} ${enabledCount === 1 ? "opción" : "opciones"} → ${n} ${n === 1 ? "campaña" : "campañas"}`}
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button size="sm" onClick={save} disabled={saving || enabledCount === 0} className="gap-1.5">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Aplicando…</> : <><Check className="h-4 w-4" /> Aplicar a {n}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
