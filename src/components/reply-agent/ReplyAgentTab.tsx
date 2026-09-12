import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bot, Clock, Pencil, Plus, Target, Trash2, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { ReplyAgentEditor, type CampaignOption } from "./ReplyAgentEditor";
import {
  GOAL_LABELS,
  parseResources,
  REPLYABLE_CATEGORIES,
  scopeSummary,
  type PrimaryGoal,
  type ReplyAgent,
} from "./types";

/** Normaliza la fila cruda de Supabase al tipo del cliente. */
function rowToAgent(row: Record<string, unknown>): ReplyAgent {
  return {
    ...(row as unknown as ReplyAgent),
    account_tags: (row.account_tags as string[]) || [],
    account_ids: (row.account_ids as string[]) || [],
    campaign_ids: (row.campaign_ids as string[]) || [],
    categories: (row.categories as string[]) || null,
    resources: parseResources(row.resources),
  };
}

export function ReplyAgentTab() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [agents, setAgents] = useState<ReplyAgent[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReplyAgent | null>(null);
  const [creating, setCreating] = useState(false);

  const loadAgents = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("auto_reply_rules")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setAgents(((data || []) as unknown as Record<string, unknown>[]).map(rowToAgent));
    setLoading(false);
  }, [user]);

  const loadRefs = useCallback(async () => {
    if (!user) return;
    const [{ data: accs }, { data: camps, error: campErr }] = await Promise.all([
      supabase.from("email_accounts").select("id, tags").eq("user_id", user.id),
      supabase.from("campaigns").select("id, name, status").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    const tags = new Set<string>();
    (accs || []).forEach((a: { tags: string[] | null }) => (a.tags || []).forEach((t) => tags.add(t)));
    setAvailableTags(Array.from(tags).sort());
    if (campErr) toast.error(campErr.message);
    setCampaigns((camps || []) as CampaignOption[]);
  }, [user]);

  useEffect(() => { loadAgents(); loadRefs(); }, [loadAgents, loadRefs]);

  const campaignNames = useMemo(() => {
    const map: Record<string, string> = {};
    campaigns.forEach((c) => { map[c.id] = c.name; });
    return map;
  }, [campaigns]);

  const handleToggle = async (agent: ReplyAgent) => {
    const { error } = await supabase
      .from("auto_reply_rules")
      .update({ is_active: !agent.is_active })
      .eq("id", agent.id);
    if (error) { toast.error(error.message); return; }
    toast.success(agent.is_active ? "Agente desactivado" : "Agente activado");
    loadAgents();
  };

  const handleDelete = async (agent: ReplyAgent) => {
    const ok = await confirm({
      title: `¿Eliminar el agente "${agent.name}"?`,
      description: "Dejará de redactar y responder. Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("auto_reply_rules").delete().eq("id", agent.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Agente eliminado");
    loadAgents();
  };

  if (editing || creating) {
    return (
      <ReplyAgentEditor
        agent={editing}
        campaigns={campaigns}
        availableTags={availableTags}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); loadAgents(); }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Un agente lee las respuestas de tus leads y contesta por ti: tú decides el objetivo, el alcance,
          el tono y si envía solo o te deja un borrador.
        </p>
        <Button className="gap-2" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Nuevo agente
        </Button>
      </div>

      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-display tracking-[-0.03em] mb-2 text-lg font-semibold">Sin agentes de respuesta</h3>
            <p className="mb-4 max-w-sm text-center text-sm text-muted-foreground">
              Crea tu primer agente para que responda a los leads interesados sin que tengas que estar encima.
            </p>
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Crear primer agente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => {
            const auto = a.reply_mode === "auto";
            const cats = a.category_mode === "all" ? [...REPLYABLE_CATEGORIES] : (a.categories || []);
            return (
              <Card key={a.id} className={`group transition-shadow hover:shadow-raised ${a.is_active ? "border-primary/30" : ""}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setEditing(a)}
                    >
                      <CardTitle className="flex items-center gap-2 text-base">
                        {auto
                          ? <Bot className={`h-4 w-4 shrink-0 ${a.is_active ? "text-primary" : "text-muted-foreground"}`} />
                          : <UserCheck className={`h-4 w-4 shrink-0 ${a.is_active ? "text-primary" : "text-muted-foreground"}`} />}
                        <span className="truncate">{a.name}</span>
                      </CardTitle>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <Switch checked={a.is_active} onCheckedChange={() => handleToggle(a)} aria-label="Activar agente" />
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(a)} aria-label="Editar agente">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(a)} aria-label="Eliminar agente">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={auto ? "default" : "secondary"} className="gap-1 text-[10.5px] font-semibold">
                      {auto ? <Bot className="h-2.5 w-2.5" /> : <UserCheck className="h-2.5 w-2.5" />}
                      {auto ? "Envío automático" : "Borradores para revisar"}
                    </Badge>
                    <Badge variant={a.is_active ? "outline" : "secondary"} className="text-[10.5px] font-semibold">
                      {a.is_active ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5">
                      <Target className="h-3 w-3 shrink-0" />
                      {GOAL_LABELS[(a.primary_goal || "book_meeting") as PrimaryGoal]}
                    </p>
                    <p className="truncate">Alcance: {scopeSummary(a, campaignNames)}</p>
                    <p className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 shrink-0" />
                      Espera {a.delay_minutes} min · máx. {a.max_replies_per_day ?? 50}/día
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cats.length === 0 ? (
                      <span className="text-[10px] italic text-muted-foreground">Sin categorías</span>
                    ) : (
                      cats.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10.5px] font-semibold">{c}</Badge>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ReplyAgentTab;
