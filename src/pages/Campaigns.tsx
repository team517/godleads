import { useState, useEffect } from "react";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Copy, Play, Pause, Trash2, Send, ChevronLeft, Pencil, Check, X, Shuffle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import CampaignDetail from "@/components/campaigns/CampaignDetail";
import CampaignReportBar from "@/components/campaigns/CampaignReportBar";
import CampaignSendsChart from "@/components/campaigns/CampaignSendsChart";
import CampaignMetricsInline from "@/components/campaigns/CampaignMetricsInline";
import CampaignProgressRing from "@/components/campaigns/CampaignProgressRing";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: "Active", variant: "default" },
  paused: { label: "Paused", variant: "secondary" },
  draft: { label: "Draft", variant: "outline" },
  completed: { label: "Completed", variant: "secondary" },
};

function EditableCampaignName({ campaign, onSaved }: { campaign: any; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(campaign.name);
  const status = statusConfig[campaign.status] || statusConfig.draft;

  const save = async () => {
    if (!name.trim()) return;
    await supabase.from("campaigns").update({ name: name.trim() }).eq("id", campaign.id);
    toast.success("Nombre actualizado");
    setEditing(false);
    onSaved();
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          className="h-8 text-lg font-bold w-32 sm:w-48 md:w-64"
          autoFocus
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(campaign.name); setEditing(false); } }}
        />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={save}><Check className="h-4 w-4 text-primary" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setName(campaign.name); setEditing(false); }}><X className="h-4 w-4" /></Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <h1 className="font-display text-lg sm:text-2xl font-bold truncate">{campaign.name}</h1>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
      <Badge variant={status.variant}>{status.label}</Badge>
    </div>
  );
}


export default function Campaigns() {
  const { user } = useAuth();
  // Instant re-entry: paint the cached list immediately, refresh in background.
  const [campaigns, setCampaigns] = useState<any[]>(() => cacheGet<any[]>("campaigns:list") || []);
  const [loading, setLoading] = useState(() => !cacheGet<any[]>("campaigns:list"));
  // All campaigns' metrics from ONE server-side RPC → cards render instantly with
  // zero per-card queries (was: up to 5000 sent_emails rows downloaded PER card).
  const [metricsMap, setMetricsMap] = useState<Record<string, any>>(() => cacheGet<Record<string, any>>("campaigns:metrics") || {});
  // Progress per campaign = leads already emailed / total leads (count-only queries).
  const [progressMap, setProgressMap] = useState<Record<string, { sent: number; total: number }>>(() => cacheGet<Record<string, { sent: number; total: number }>>("campaigns:progress") || {});
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "" });
  // Remix: fusionar otra campaña dentro de `remixDest`.
  const [remixDest, setRemixDest] = useState<any | null>(null);
  const [remixRunning, setRemixRunning] = useState(false);
  const [remixProgress, setRemixProgress] = useState<{ phase: string; current: number; total: number } | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("campaigns").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setCampaigns(data || []);
    cacheSet("campaigns:list", data || []);
    setLoading(false);
    // Metrics for ALL campaigns in a single RPC (numbers only, no row transfer).
    const { data: rows, error } = await supabase.rpc("campaign_metrics_for_user" as any, { p_user_id: user.id });
    if (!error && Array.isArray(rows)) {
      const map: Record<string, any> = {};
      for (const r of rows as any[]) {
        map[r.campaign_id] = {
          sent: Number(r.sent) || 0,
          opened: Number(r.opened) || 0,
          replied: Number(r.replied) || 0,
          positive: Number(r.positive) || 0,
          bounced: Number(r.bounced) || 0,
          senderBounced: Number(r.sender_bounced) || 0,
          sequences: Number(r.sequences) || 0,
        };
      }
      setMetricsMap(map);
      cacheSet("campaigns:metrics", map);
    }
    // Progress = leads emailed / total leads, per campaign. COUNT-only (head:true) so
    // no rows are transferred — cheap even with thousands of leads.
    const list = data || [];
    const progress: Record<string, { sent: number; total: number }> = {};
    await Promise.all(list.map(async (c: any) => {
      const [totalRes, sentRes] = await Promise.all([
        supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id),
        supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).not("last_sent_at", "is", null),
      ]);
      progress[c.id] = { total: totalRes.count || 0, sent: sentRes.count || 0 };
    }));
    setProgressMap(progress);
    cacheSet("campaigns:progress", progress);
  };

  useEffect(() => { load(); }, [user]);

  const handleCreate = async () => {
    if (!user || !form.name) return;
    const { error } = await supabase.from("campaigns").insert({
      user_id: user.id, name: form.name, status: "draft",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Campaign created");
    setShowCreate(false);
    setForm({ name: "" });
    load();
  };

  const handleDuplicate = async (campaign: any) => {
    if (!user) return;
    const { data: newCamp, error } = await supabase.from("campaigns").insert({
      user_id: user.id, name: `${campaign.name} (copy)`, status: "draft",
      daily_limit: campaign.daily_limit, send_start_hour: campaign.send_start_hour,
      send_end_hour: campaign.send_end_hour, timezone: campaign.timezone,
      send_days: campaign.send_days, stop_on_reply: campaign.stop_on_reply,
      account_tags: campaign.account_tags,
    }).select().single();
    if (error) { toast.error(error.message); return; }

    // Copy steps with variants
    const { data: stps } = await supabase.from("campaign_steps").select("*").eq("campaign_id", campaign.id);
    if (stps?.length) {
      await supabase.from("campaign_steps").insert(
        stps.map((s: any) => ({
          campaign_id: newCamp.id, step_order: s.step_order,
          subject: s.subject, body: s.body, delay_days: s.delay_days,
          variants: s.variants,
        }))
      );
    }

    // Copy account assignments
    const { data: accs } = await supabase.from("campaign_accounts").select("account_id").eq("campaign_id", campaign.id);
    if (accs?.length) {
      await supabase.from("campaign_accounts").insert(
        accs.map((a: any) => ({ campaign_id: newCamp.id, account_id: a.account_id }))
      );
    }

    toast.success("Campaign duplicated");
    load();
  };

  const handleStatusToggle = async (campaign: any) => {
    const newStatus = campaign.status === "active" ? "paused" : "active";
    if (newStatus === "active") {
      const [{ data: ca }, { data: cl }, { data: st }] = await Promise.all([
        supabase.from("campaign_accounts").select("id").eq("campaign_id", campaign.id),
        supabase.from("campaign_leads").select("id").eq("campaign_id", campaign.id),
        supabase.from("campaign_steps").select("id").eq("campaign_id", campaign.id),
      ]);

      // Check accounts: direct assignments OR tag-based accounts
      let hasAccounts = (ca?.length || 0) > 0;
      if (!hasAccounts && (campaign.account_tags || []).length > 0) {
        const { data: tagAccounts } = await supabase
          .from("email_accounts")
          .select("id")
          .eq("status", "connected")
          .overlaps("tags", campaign.account_tags);
        hasAccounts = (tagAccounts?.length || 0) > 0;
      }

      if (!hasAccounts) { toast.error("Asigna al menos una cuenta de email o un tag con cuentas"); return; }
      if (!cl?.length) { toast.error("Asigna al menos un lead"); return; }
      if (!st?.length) { toast.error("Añade al menos un paso de email"); return; }
    }
    await supabase.from("campaigns").update({ status: newStatus }).eq("id", campaign.id);
    toast.success(`Campaign ${newStatus === "active" ? "activated" : "paused"}`);
    load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("campaign_steps").delete().eq("campaign_id", id);
    await supabase.from("campaign_accounts").delete().eq("campaign_id", id);
    await supabase.from("campaign_leads").delete().eq("campaign_id", id);
    await supabase.from("campaigns").delete().eq("id", id);
    toast.success("Campaign deleted");
    if (selectedId === id) setSelectedId(null);
    load();
  };

  // REMIX: fusiona la campaña `src` DENTRO de `dest`. Los mensajes de `src`
  // (base + variantes) se añaden como NUEVAS variantes a los steps de `dest`
  // (creando los steps que falten), todos sus leads se mueven a `dest`, y al
  // terminar al 100% se elimina `src`. Muestra progreso en cada fase.
  const runRemix = async (dest: any, src: any) => {
    if (!user || !dest || !src || dest.id === src.id) return;
    setRemixRunning(true);
    // supabase-js never throws on a failed query — it returns { error }. Every call
    // is checked here so a silent failure ABORTS before we delete the source (the
    // old code ignored all errors and deleted src regardless → permanent data loss).
    const must = <T,>(res: { data: T; error: any }, what: string): T => {
      if (res.error) throw new Error(`${what}: ${res.error.message || res.error}`);
      return res.data;
    };
    try {
      // 1) Verificando — cargamos steps de ambas
      setRemixProgress({ phase: "Verificando campañas…", current: 0, total: 0 });
      const srcSteps = must(await supabase.from("campaign_steps").select("*").eq("campaign_id", src.id).order("step_order"), "leer pasos origen") || [];
      const destSteps = must(await supabase.from("campaign_steps").select("*").eq("campaign_id", dest.id).order("step_order"), "leer pasos destino") || [];

      // 2) Mensajes → nuevas variantes en los steps de dest (crea steps faltantes).
      //    IDEMPOTENTE: no se añade un (subject,body) que ya exista en el step destino,
      //    así que reintentar el remix tras un fallo no duplica variantes.
      const steps = srcSteps;
      setRemixProgress({ phase: "Creando variantes con los mensajes…", current: 0, total: steps.length });
      const destByOrder = new Map<number, any>((destSteps || []).map((s: any) => [s.step_order, s]));
      const vkey = (v: any) => `${(v.subject || "").trim()} ${(v.body || "").trim()}`;
      let sdone = 0;
      for (const s of steps) {
        const msgs = [{ subject: s.subject || "", body: s.body || "" }, ...(Array.isArray(s.variants) ? s.variants : [])];
        const existing = destByOrder.get(s.step_order);
        if (existing) {
          const have = new Set<string>([vkey(existing), ...((Array.isArray(existing.variants) ? existing.variants : []).map(vkey))]);
          const fresh = msgs.filter((m) => !have.has(vkey(m)));
          if (fresh.length) {
            const merged = [...(Array.isArray(existing.variants) ? existing.variants : []), ...fresh];
            must(await supabase.from("campaign_steps").update({ variants: merged as any }).eq("id", existing.id).select("id"), "actualizar variantes");
          }
        } else {
          must(await supabase.from("campaign_steps").insert({
            campaign_id: dest.id, step_order: s.step_order, subject: s.subject, body: s.body,
            delay_days: s.delay_days, variants: (Array.isArray(s.variants) ? s.variants : []) as any,
          }).select("id"), "crear paso");
        }
        sdone++;
        setRemixProgress({ phase: "Creando variantes con los mensajes…", current: sdone, total: steps.length });
      }

      // 3) Cargar todos los leads de src CON su progreso (paginado, distinguiendo error de fin)
      setRemixProgress({ phase: "Cargando leads…", current: 0, total: 0 });
      const srcLeads: any[] = [];
      let offset = 0;
      while (true) {
        const rows = must(
          await supabase.from("campaign_leads")
            .select("lead_id, current_step, status, last_sent_at, assigned_account_id")
            .eq("campaign_id", src.id).order("id").range(offset, offset + 999),
          "leer leads origen",
        ) || [];
        srcLeads.push(...rows);
        if (rows.length < 1000) break;   // < page size ⇒ fin (un error habría lanzado arriba)
        offset += 1000;
      }

      // 3b) Exportar leads a dest CONSERVANDO su progreso (current_step/status/last_sent_at),
      //     para que un lead ya contactado o que respondió NO reciba el step 1 de nuevo.
      //     ignoreDuplicates: si el lead ya está en dest, se respeta su progreso allí.
      setRemixProgress({ phase: "Exportando leads…", current: 0, total: srcLeads.length });
      for (let i = 0; i < srcLeads.length; i += 500) {
        const batch = srcLeads.slice(i, i + 500);
        must(await supabase.from("campaign_leads").upsert(
          batch.map((r: any) => ({
            campaign_id: dest.id, lead_id: r.lead_id,
            current_step: r.current_step ?? 0,
            status: r.status ?? "pending",
            last_sent_at: r.last_sent_at ?? null,
            assigned_account_id: r.assigned_account_id ?? null,
          })),
          { onConflict: "campaign_id,lead_id", ignoreDuplicates: true }
        ).select("id"), "exportar leads");
        setRemixProgress({ phase: "Exportando leads…", current: Math.min(i + 500, srcLeads.length), total: srcLeads.length });
      }

      // 3c) Unir cuentas/tags (moverlo todo)
      const destTags: string[] = dest.account_tags || [];
      const mergedTags = Array.from(new Set([...destTags, ...((src.account_tags as string[]) || [])]));
      if (mergedTags.length !== destTags.length) {
        must(await supabase.from("campaigns").update({ account_tags: mergedTags }).eq("id", dest.id).select("id"), "unir tags");
      }
      const srcAccs = must(await supabase.from("campaign_accounts").select("account_id").eq("campaign_id", src.id), "leer cuentas origen") || [];
      const destAccs = must(await supabase.from("campaign_accounts").select("account_id").eq("campaign_id", dest.id), "leer cuentas destino") || [];
      const haveAcc = new Set((destAccs || []).map((a: any) => a.account_id));
      const newAccs = (srcAccs || []).filter((a: any) => !haveAcc.has(a.account_id));
      if (newAccs.length) {
        must(await supabase.from("campaign_accounts").insert(newAccs.map((a: any) => ({ campaign_id: dest.id, account_id: a.account_id }))).select("campaign_id"), "unir cuentas");
      }

      // 3d) SANITY antes de borrar: dest debe tener al menos tantos leads como movimos.
      const destLeadCount = (await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", dest.id)).count || 0;
      if (destLeadCount < srcLeads.length) {
        throw new Error(`verificación fallida (destino tiene ${destLeadCount} leads, se esperaban ≥ ${srcLeads.length}) — no se elimina el origen`);
      }

      // 4) Eliminar la campaña fusionada — SOLO si todo lo anterior terminó sin error.
      setRemixProgress({ phase: "Eliminando la campaña fusionada…", current: 0, total: 0 });
      must(await supabase.from("campaign_steps").delete().eq("campaign_id", src.id).select("id"), "borrar pasos origen");
      must(await supabase.from("campaign_accounts").delete().eq("campaign_id", src.id).select("campaign_id"), "borrar cuentas origen");
      must(await supabase.from("campaign_leads").delete().eq("campaign_id", src.id).select("id"), "borrar leads origen");
      must(await supabase.from("campaigns").delete().eq("id", src.id).select("id"), "borrar campaña origen");

      toast.success(`«${src.name}» fusionada en «${dest.name}» · ${srcLeads.length} leads · ${steps.length} pasos`);
      setRemixDest(null);
      setRemixProgress(null);
      if (selectedId === src.id) setSelectedId(null);
      await load();
    } catch (e: any) {
      toast.error(`Remix cancelado (no se borró nada): ${e?.message || e}`);
      setRemixProgress(null);
    } finally {
      setRemixRunning(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const selectedCampaign = campaigns.find(c => c.id === selectedId);

  // Campaign detail view
  if (selectedCampaign) {
    const status = statusConfig[selectedCampaign.status] || statusConfig.draft;
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setSelectedId(null)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <EditableCampaignName campaign={selectedCampaign} onSaved={load} />
            </div>
          </div>
          <Button
            variant={selectedCampaign.status === "active" ? "secondary" : "default"}
            size="sm"
            className="gap-1.5 self-end sm:self-auto"
            onClick={() => handleStatusToggle(selectedCampaign)}
          >
            {selectedCampaign.status === "active" ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> {selectedCampaign.status === "draft" ? "Launch" : "Resume"}</>}
          </Button>
        </div>
        <CampaignReportBar campaign={selectedCampaign} metrics={metricsMap[selectedCampaign.id]} />
        <CampaignSendsChart campaignId={selectedCampaign.id} />
        <CampaignDetail campaignId={selectedCampaign.id} />
      </div>
    );
  }

  // Campaign list view
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">Campañas</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Gestiona tus secuencias de cold email</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2 self-end sm:self-auto"><Plus className="h-4 w-4" /> Nueva Campaña</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-display">Create campaign</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1"><Label>Campaign name</Label><Input value={form.name} onChange={e => setForm({ name: e.target.value })} placeholder="Q1 Outreach" /></div>
              <Button onClick={handleCreate} className="w-full" disabled={!form.name}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Send className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-display font-semibold mb-2">No campaigns yet</h3>
            <p className="text-sm text-muted-foreground">Create your first cold email campaign.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const status = statusConfig[campaign.status] || statusConfig.draft;
            return (
              <Card key={campaign.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedId(campaign.id)}>
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-sm sm:text-base truncate">{campaign.name}</h3>
                        <Badge variant={status.variant} className="text-[10px] sm:text-xs">{status.label}</Badge>
                      </div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
                        {new Date(campaign.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {/* Progress ring — how far the campaign has gone (leads emailed / total) */}
                    {(progressMap[campaign.id]?.total ?? 0) > 0 && (
                      <CampaignProgressRing sent={progressMap[campaign.id].sent} total={progressMap[campaign.id].total} />
                    )}
                    <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={() => handleStatusToggle(campaign)}>
                        {campaign.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8 hidden sm:flex" onClick={() => handleDuplicate(campaign)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" title="Remix — fusionar otra campaña aquí" onClick={() => setRemixDest(campaign)}>
                        <Shuffle className="h-3.5 w-3.5 text-primary" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={() => handleDelete(campaign.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {/* Inline metrics */}
                  <div className="mt-3 border-t border-border/40 pt-3">
                    <CampaignMetricsInline campaignId={campaign.id} metrics={metricsMap[campaign.id]} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Remix dialog */}
      <Dialog open={!!remixDest} onOpenChange={(o) => { if (!remixRunning && !o) { setRemixDest(null); setRemixProgress(null); } }}>
        <DialogContent className="max-w-md" onInteractOutside={(e) => { if (remixRunning) e.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-primary" /> Remix — fusionar en «{remixDest?.name}»
            </DialogTitle>
          </DialogHeader>
          {!remixRunning ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Elige una campaña. Sus mensajes se añadirán como <strong>nuevas variantes</strong> a los pasos de esta,
                todos sus <strong>leads</strong> se moverán aquí y, al terminar, <strong>esa campaña se eliminará</strong>.
              </p>
              <div className="space-y-1.5 max-h-72 overflow-auto">
                {campaigns.filter((c) => c.id !== remixDest?.id).map((c) => {
                  const st = statusConfig[c.status] || statusConfig.draft;
                  return (
                    <button
                      key={c.id}
                      onClick={() => runRemix(remixDest, c)}
                      className="w-full text-left rounded-lg border border-border/60 p-3 hover:bg-muted/50 hover:border-primary/40 transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-sm truncate">{c.name}</span>
                      <Badge variant={st.variant} className="text-[10px] shrink-0">{st.label}</Badge>
                    </button>
                  );
                })}
                {campaigns.filter((c) => c.id !== remixDest?.id).length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">No hay otras campañas para fusionar.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> {remixProgress?.phase || "Procesando…"}
              </div>
              {remixProgress && remixProgress.total > 0 ? (
                <>
                  <Progress value={(remixProgress.current / Math.max(remixProgress.total, 1)) * 100} />
                  <p className="text-xs text-muted-foreground text-right font-mono">{remixProgress.current} / {remixProgress.total}</p>
                </>
              ) : (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">No cierres esta ventana — la campaña se eliminará solo cuando todo esté al 100%.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
